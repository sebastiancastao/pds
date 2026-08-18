// app/api/vendor-invite-override-requests/route.ts
//
// Requests to send a vendor a calendar-availability invite even though that
// vendor already submitted availability for their current invitation period
// (see isVendorInviteBlocked in lib/vendorInvites.ts). Most requests are
// filed automatically by app/api/invitations/bulk-invite/route.ts the moment
// a blocked vendor is included in a send (via createVendorInviteOverrideRequests
// in lib/vendorInviteOverrides.ts) — this route's POST exists for a manual
// re-file (e.g. after a rejection). A request only actually sends the invite
// once a privileged reviewer approves it via PATCH — mirrors
// app/api/invitation-cancellation-requests/route.ts.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { getInviterEmailContext, getSingleProfile, sendSingleVendorInvite } from "@/lib/vendorInvites";
import {
  APPROVAL_NOTIFICATION_EMAILS,
  createVendorInviteOverrideRequests,
  escapeHtml,
  nameFromProfile,
  sendEmailWithRetry,
} from "@/lib/vendorInviteOverrides";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Roles allowed to file and review these requests. Only admins reach the
// invite-sending UI in the first place (see the role gates on
// /global-calendar and /dashboard), so unlike invitation_cancellation_requests
// there's no separate "self" case — every caller here needs to be privileged.
const PRIVILEGED_ROLES = new Set([
  "admin",
  "exec",
  "hr",
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
  "supervisor4",
  "finance",
]);

const EXTRA_REVIEWER_EMAILS = new Set(["jenvillar@1pds.net"]);

const REQUEST_COLUMNS =
  "id, vendor_id, last_invitation_id, last_invited_at, period_end_at, reason, status, requested_by, reviewed_by, reviewed_at, review_notes, sent_invitation_id, created_at, updated_at, " +
  "approval_notification_sent, approval_notification_error, outcome_notification_sent, outcome_notification_error, " +
  "vendor:users!vendor_invite_override_requests_vendor_id_fkey (email, profiles (first_name, last_name)), " +
  "requested_by_user:users!vendor_invite_override_requests_requested_by_fkey (email, profiles (first_name, last_name))";

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data } = await supabaseAnon.auth.getUser(token);
    if (data?.user) return data.user;
  }

  return null;
}

async function getCallerAuthInfo(userId: string): Promise<{ role: string; email: string }> {
  const { data } = await supabaseAdmin.from("users").select("role, email").eq("id", userId).maybeSingle();
  return {
    role: String(data?.role || "").trim().toLowerCase(),
    email: String(data?.email || "").trim().toLowerCase(),
  };
}

function isPrivilegedCaller(role: string, email: string): boolean {
  return PRIVILEGED_ROLES.has(role) || EXTRA_REVIEWER_EMAILS.has(email);
}

/** Flattens the embedded vendor/requested_by_user rows into plain, decrypted display fields. */
function decorateRequestRow(row: Record<string, any>): Record<string, any> {
  const { vendor, requested_by_user, ...rest } = row;
  const vendorProfile = getSingleProfile(vendor?.profiles);
  const requesterProfile = getSingleProfile(requested_by_user?.profiles);

  return {
    ...rest,
    vendor_name: nameFromProfile(vendorProfile, vendor?.email),
    vendor_email: vendor?.email || null,
    requested_by_name: nameFromProfile(requesterProfile, requested_by_user?.email),
    requested_by_email: requested_by_user?.email || null,
  };
}

function buildOutcomeNotificationEmailHtml(params: {
  requesterName: string;
  vendorName: string;
  approved: boolean;
  reviewNotes: string | null;
}) {
  const heading = params.approved ? "Vendor Invite Override Approved" : "Vendor Invite Override Denied";
  const headingColor = params.approved ? "#15803d" : "#b91c1c";
  const bodyText = params.approved
    ? `Your request to re-invite ${escapeHtml(params.vendorName)} was approved and the invite has been sent.`
    : `Your request to re-invite ${escapeHtml(params.vendorName)} was not approved. No invite was sent.`;

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; margin:0; padding:20px;">
    <div style="max-width:600px;margin:0 auto;">
      <h2 style="margin:0 0 12px 0; color:${headingColor};">${escapeHtml(heading)}</h2>
      <p style="margin:0 0 16px 0;">Hi ${escapeHtml(params.requesterName)},</p>
      <p style="margin:0 0 16px 0;">${bodyText}</p>
      ${
        params.reviewNotes
          ? `<p style="margin-top:16px; color:#374151; background:#f3f4f6; border-left:4px solid #9ca3af; padding:10px 14px;"><strong>Reviewer notes:</strong> ${escapeHtml(params.reviewNotes)}</p>`
          : ""
      }
    </div>
  </body>
</html>
`.trim();
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { role, email } = await getCallerAuthInfo(user.id);
    if (!isPrivilegedCaller(role, email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const statusFilter = req.nextUrl.searchParams.get("status")?.trim().toLowerCase() || null;

    let query = supabaseAdmin
      .from("vendor_invite_override_requests")
      .select(REQUEST_COLUMNS)
      .order("created_at", { ascending: false });

    if (statusFilter && ["pending", "approved", "rejected"].includes(statusFilter)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ requests: (data || []).map(decorateRequestRow), canReview: true });
  } catch (err: any) {
    console.error("[VENDOR INVITE OVERRIDE REQUESTS][GET] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { role, email: callerEmail } = await getCallerAuthInfo(user.id);
    if (!isPrivilegedCaller(role, callerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const vendorIds: string[] = Array.isArray(body?.vendorIds)
      ? Array.from(new Set(body.vendorIds.map((v: any) => String(v || "").trim()).filter(Boolean)))
      : [];
    const reason = String(body?.reason || "").trim();

    if (vendorIds.length === 0 || !reason) {
      return NextResponse.json({ error: "vendorIds (non-empty array) and reason are required" }, { status: 400 });
    }

    const { created, skipped, notificationSent, notificationError } = await createVendorInviteOverrideRequests(
      supabaseAdmin,
      { vendorIds, reason, requestedBy: user.id }
    );

    return NextResponse.json(
      {
        success: true,
        created,
        skipped,
        notificationSent,
        message:
          created.length === 0
            ? "No override requests were created."
            : notificationSent
              ? `${created.length} override request(s) submitted and the review team was notified.`
              : `${created.length} override request(s) submitted, but the notification email to the review team failed to send (${notificationError}). They can still see it at /vendor-invite-requests.`,
      },
      { status: created.length > 0 ? 201 : 200 }
    );
  } catch (err: any) {
    console.error("[VENDOR INVITE OVERRIDE REQUESTS][POST] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { role, email: callerEmail } = await getCallerAuthInfo(user.id);
    if (!isPrivilegedCaller(role, callerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.id || "").trim();
    const action = String(body?.status || "").trim().toLowerCase(); // 'approved' | 'rejected'
    const reviewNotes = typeof body?.review_notes === "string" ? body.review_notes.trim() || null : null;

    if (!requestId || (action !== "approved" && action !== "rejected")) {
      return NextResponse.json(
        { error: "id and status ('approved' or 'rejected') are required" },
        { status: 400 }
      );
    }

    const { data: requestRowRaw, error: fetchError } = await supabaseAdmin
      .from("vendor_invite_override_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", requestId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!requestRowRaw) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    const requestRow = requestRowRaw as any;
    if (requestRow.status !== "pending") {
      return NextResponse.json({ error: `This request has already been ${requestRow.status}.` }, { status: 409 });
    }

    let sentInvitationId: string | null = null;

    if (action === "approved") {
      const { data: vendorRow, error: vendorError } = await supabaseAdmin
        .from("users")
        .select("id, email, profiles(first_name, last_name)")
        .eq("id", requestRow.vendor_id)
        .maybeSingle();

      if (vendorError || !vendorRow) {
        return NextResponse.json({ error: "Vendor no longer exists" }, { status: 404 });
      }

      const inviterId = requestRow.requested_by || user.id;
      const { managerName, managerPhone, eventCount } = await getInviterEmailContext(supabaseAdmin, inviterId);

      const sendResult = await sendSingleVendorInvite({
        supabaseAdmin,
        vendor: vendorRow as any,
        invitedBy: inviterId,
        managerName,
        managerPhone,
        eventCount,
      });

      if (!sendResult.success) {
        return NextResponse.json(
          { error: `Approved, but the invite failed to send: ${sendResult.error}. The request is still pending — try approving again.` },
          { status: 500 }
        );
      }

      sentInvitationId = sendResult.invitationId;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("vendor_invite_override_requests")
      .update({
        status: action,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
        sent_invitation_id: sentInvitationId,
      })
      .eq("id", requestId)
      .select(REQUEST_COLUMNS)
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    let notificationSent = false;
    let notificationError: string | null = null;
    try {
      const requesterEmail = String(requestRow.requested_by_user?.email || "").trim();
      const requesterName = nameFromProfile(getSingleProfile(requestRow.requested_by_user?.profiles), requesterEmail);
      const vendorName = nameFromProfile(getSingleProfile(requestRow.vendor?.profiles), requestRow.vendor?.email);

      if (requesterEmail) {
        const emailResult = await sendEmailWithRetry({
          to: requesterEmail,
          bcc: APPROVAL_NOTIFICATION_EMAILS,
          subject: `Vendor Invite Override ${action === "approved" ? "Approved" : "Denied"} - ${vendorName}`,
          html: buildOutcomeNotificationEmailHtml({
            requesterName,
            vendorName,
            approved: action === "approved",
            reviewNotes,
          }),
        });

        notificationSent = Boolean(emailResult.success);
        if (!emailResult.success) {
          notificationError = emailResult.error || "Unknown email error";
          console.error("[VENDOR INVITE OVERRIDE REQUESTS][PATCH] outcome email failed:", emailResult.error);
        }
      }
    } catch (notifyError: any) {
      notificationError = notifyError?.message || "Unknown email error";
      console.error("[VENDOR INVITE OVERRIDE REQUESTS][PATCH] outcome email error:", notifyError);
    }

    await supabaseAdmin
      .from("vendor_invite_override_requests")
      .update({ outcome_notification_sent: notificationSent, outcome_notification_error: notificationError })
      .eq("id", requestId);

    return NextResponse.json({ success: true, request: decorateRequestRow(updated), notificationSent });
  } catch (err: any) {
    console.error("[VENDOR INVITE OVERRIDE REQUESTS][PATCH] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
