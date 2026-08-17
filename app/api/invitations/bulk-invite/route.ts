import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";
import {
  DEFAULT_AVAILABILITY_DURATION_MONTHS,
  getInviterEmailContext,
  getLatestVendorInvitation,
  isVendorInviteApprovalExempt,
  isVendorInviteBlocked,
  sendSingleVendorInvite,
} from "@/lib/vendorInvites";
import { createVendorInviteOverrideRequests } from "@/lib/vendorInviteOverrides";

const OVERRIDE_REQUEST_REASON =
  "Requested via Send Invites — vendor already submitted availability for their current invitation period.";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());

/**
 * POST /api/invitations/bulk-invite
 * Send bulk invitations to selected vendors for multiple events over a period
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // Authenticate user
    let { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get request body
    const body = await req.json();
    const { vendorIds } = body;
    const durationMonths = DEFAULT_AVAILABILITY_DURATION_MONTHS;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return NextResponse.json({ error: 'Vendor IDs are required' }, { status: 400 });
    }

    const { managerName, managerPhone, eventCount } = await getInviterEmailContext(supabaseAdmin, user.id);

    // Get vendor details (only those selected)
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        profiles!inner (
          first_name,
          last_name
        )
      `)
      .in('id', vendorIds);

    if (vendorsError || !vendors || vendors.length === 0) {
      return NextResponse.json({ error: 'No vendors found' }, { status: 404 });
    }

    // Send invitations sequentially to avoid provider burst rate limiting (429)
    let successes = 0;
    const failedEmails: string[] = [];
    const blockedInfo = new Map<string, { email: string; name: string; periodEnd: string }>();

    for (const vendor of vendors as any[]) {
      const normalizedEmail = (vendor.email || "").toString().trim().toLowerCase();

      if (!isValidEmail(normalizedEmail)) {
        failedEmails.push(`Skipped ${vendor.id}: invalid email "${vendor.email || "missing"}"`);
        continue;
      }

      // Block re-inviting a vendor who already submitted availability for
      // their current invitation period (until that period ends) — unless
      // exempt. Rather than silently skipping, an approval request is filed
      // and the review team notified below; the invite goes out once
      // approved via PATCH /api/vendor-invite-override-requests.
      if (!isVendorInviteApprovalExempt(normalizedEmail)) {
        const latest = await getLatestVendorInvitation(supabaseAdmin, vendor.id);
        if (isVendorInviteBlocked(latest)) {
          let name = normalizedEmail;
          try {
            const first = vendor.profiles?.first_name ? safeDecrypt(vendor.profiles.first_name) : "";
            const last = vendor.profiles?.last_name ? safeDecrypt(vendor.profiles.last_name) : "";
            name = `${first} ${last}`.trim() || normalizedEmail;
          } catch {
            name = normalizedEmail;
          }
          blockedInfo.set(vendor.id, { email: normalizedEmail, name, periodEnd: latest!.end_date! });
          continue;
        }
      }

      const result = await sendSingleVendorInvite({
        supabaseAdmin,
        vendor,
        invitedBy: user.id,
        managerName,
        managerPhone,
        eventCount,
        durationMonths,
      });

      if (result.success) {
        successes++;
      } else {
        failedEmails.push(result.error);
      }

      // Light throttling between sends to reduce 429 likelihood
      await sleep(125);
    }

    // File (or reuse) a pending override request for every blocked vendor and
    // notify the review team (jenvillar@1pds.net, sebastiancastao379@gmail.com)
    // in one batched email — nothing is emailed to these vendors until a
    // reviewer approves at /vendor-invite-requests.
    let blocked: Array<{
      vendorId: string;
      email: string;
      name: string;
      periodEnd: string;
      requestStatus: "pending_review" | "already_pending_review";
    }> = [];
    let overrideNotificationSent = false;

    if (blockedInfo.size > 0) {
      const blockedVendorIds = Array.from(blockedInfo.keys());
      const overrideOutcome = await createVendorInviteOverrideRequests(supabaseAdmin, {
        vendorIds: blockedVendorIds,
        reason: OVERRIDE_REQUEST_REASON,
        requestedBy: user.id,
      });

      const newlyCreatedIds = new Set(overrideOutcome.created.map((c) => c.vendorId));
      overrideNotificationSent = overrideOutcome.notificationSent;
      blocked = blockedVendorIds.map((vendorId) => {
        const info = blockedInfo.get(vendorId)!;
        return {
          vendorId,
          email: info.email,
          name: info.name,
          periodEnd: info.periodEnd,
          requestStatus: newlyCreatedIds.has(vendorId) ? "pending_review" : "already_pending_review",
        };
      });
    }

    const failures = failedEmails.length;

    return NextResponse.json({
      success: true,
      message: `Sent ${successes} invitation(s) successfully${
        blocked.length > 0
          ? `, ${blocked.length} held for approval (already submitted for their current period)${
              blocked.some((b) => b.requestStatus === "pending_review")
                ? overrideNotificationSent
                  ? " — review team notified"
                  : " — review team notification failed, but the request is visible at /vendor-invite-requests"
                : ""
            }`
          : ''
      }`,
      stats: {
        total: vendorIds.length,
        sent: successes,
        failed: failures,
        blocked: blocked.length
      },
      failures: failedEmails.length > 0 ? failedEmails : undefined,
      blocked: blocked.length > 0 ? blocked : undefined
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error sending bulk vendor invitations:', error);
    return NextResponse.json({
      error: error.message || 'Failed to send invitations'
    }, { status: 500 });
  }
}
