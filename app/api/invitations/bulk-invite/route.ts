import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import {
  DEFAULT_AVAILABILITY_DURATION_MONTHS,
  getInviterEmailContext,
  sendSingleVendorInvite,
} from "@/lib/vendorInvites";

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

    for (const vendor of vendors as any[]) {
      const normalizedEmail = (vendor.email || "").toString().trim().toLowerCase();

      if (!isValidEmail(normalizedEmail)) {
        failedEmails.push(`Skipped ${vendor.id}: invalid email "${vendor.email || "missing"}"`);
        continue;
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

    const failures = failedEmails.length;

    return NextResponse.json({
      success: true,
      message: `Sent ${successes} invitation(s) successfully`,
      stats: {
        total: vendorIds.length,
        sent: successes,
        failed: failures
      },
      failures: failedEmails.length > 0 ? failedEmails : undefined
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error sending bulk vendor invitations:', error);
    return NextResponse.json({
      error: error.message || 'Failed to send invitations'
    }, { status: 500 });
  }
}
