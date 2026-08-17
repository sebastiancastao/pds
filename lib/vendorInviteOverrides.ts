// Shared logic for filing "vendor invite override" approval requests — used
// by both app/api/invitations/bulk-invite/route.ts (which auto-files one the
// moment a blocked vendor is included in a send) and
// app/api/vendor-invite-override-requests/route.ts's own POST (a manual
// re-file, e.g. after a rejection). Centralizing this means both paths
// produce an identical request row and reviewer-notification email.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { safeDecrypt } from "@/lib/encryption";
import { getInviterEmailContext, getLatestVendorInvitation, getSingleProfile, isVendorInviteApprovalExempt, isVendorInviteBlocked } from "@/lib/vendorInvites";

// Reviewers notified whenever an override request is filed — same team as
// /api/invitation-cancellation-requests.
export const APPROVAL_NOTIFICATION_EMAILS = ["jenvillar@1pds.net", "sebastiancastao379@gmail.com"];

export function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function decryptProfilePart(value: unknown): string {
  if (!value) return "";
  try {
    return safeDecrypt(String(value));
  } catch {
    return "";
  }
}

export function nameFromProfile(profile: { first_name?: unknown; last_name?: unknown } | null, fallback: string): string {
  const name = `${decryptProfilePart(profile?.first_name)} ${decryptProfilePart(profile?.last_name)}`.trim();
  return name || fallback || "Unknown";
}

export async function sendEmailWithRetry(
  payload: Parameters<typeof sendEmail>[0],
  attempts = 2
): Promise<Awaited<ReturnType<typeof sendEmail>>> {
  let lastResult: Awaited<ReturnType<typeof sendEmail>> = { success: false, error: "Email not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    lastResult = await sendEmail(payload);
    if (lastResult.success) return lastResult;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return lastResult;
}

function buildApprovalNotificationEmailHtml(params: {
  requesterName: string;
  reason: string;
  vendors: Array<{ name: string; email: string; periodEnd: string | null }>;
  reviewUrl: string;
}) {
  const rows = params.vendors
    .map(
      (v) => `
        <tr>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(v.name)}</td>
          <td style="padding: 6px 10px; color: #374151;">${escapeHtml(v.email)}</td>
          <td style="padding: 6px 10px; color: #374151;">${v.periodEnd ? escapeHtml(new Date(v.periodEnd).toLocaleDateString("en-US")) : "—"}</td>
        </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Vendor Invite Override Request Awaiting Approval</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; margin:0; padding:20px;">
    <div style="max-width:600px;margin:0 auto;">
      <h2 style="margin:0 0 12px 0; color:#b45309;">Vendor Invite Override Request</h2>
      <p style="margin:0 0 16px 0;">
        ${escapeHtml(params.requesterName)} tried to send a calendar-availability invite to ${params.vendors.length} vendor${params.vendors.length !== 1 ? "s" : ""} who already submitted availability for their current invitation period. The invite has been held — review and approve or reject below to release it.
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width:100%; margin-bottom: 16px;">
        <tr style="background:#f9fafb;">
          <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Vendor</td>
          <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Email</td>
          <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Current Period Ends</td>
        </tr>
        ${rows}
      </table>
      <p style="margin:0 0 16px 0; color:#374151; background:#f3f4f6; border-left:4px solid #9ca3af; padding:10px 14px;">
        <strong>Reason:</strong> ${escapeHtml(params.reason)}
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td align="center">
            <a href="${params.reviewUrl}"
               style="display: inline-block; background: #b45309; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: bold;">
              Review Request${params.vendors.length !== 1 ? "s" : ""}
            </a>
          </td>
        </tr>
      </table>
      <p style="color:#6b7280; font-size:13px;">
        Or copy and paste this link in your browser:<br>
        <a href="${params.reviewUrl}" style="color:#b45309; word-break: break-all;">${params.reviewUrl}</a>
      </p>
    </div>
  </body>
</html>
`.trim();
}

export type OverrideRequestOutcome = {
  created: Array<{ id: string; vendorId: string; name: string; email: string; periodEnd: string }>;
  skipped: Array<{ vendorId: string; reason: string }>;
  notificationSent: boolean;
  notificationError: string | null;
};

/**
 * Files a pending vendor_invite_override_requests row for each vendorId that
 * is actually blocked right now (already submitted availability for a
 * still-current period) and isn't exempt, skipping the rest with a reason.
 * Sends a single batched "awaiting approval" email to the review team
 * covering every newly created request. Does NOT send any invite — that
 * only happens once a reviewer approves via PATCH
 * /api/vendor-invite-override-requests.
 */
export async function createVendorInviteOverrideRequests(
  supabaseAdmin: SupabaseClient,
  params: { vendorIds: string[]; reason: string; requestedBy: string }
): Promise<OverrideRequestOutcome> {
  const { vendorIds, reason, requestedBy } = params;

  const created: OverrideRequestOutcome["created"] = [];
  const skipped: OverrideRequestOutcome["skipped"] = [];

  if (vendorIds.length === 0) {
    return { created, skipped, notificationSent: false, notificationError: null };
  }

  const { data: vendorRows, error: vendorsError } = await supabaseAdmin
    .from("users")
    .select("id, email, profiles(first_name, last_name)")
    .in("id", vendorIds);

  if (vendorsError) {
    for (const vendorId of vendorIds) skipped.push({ vendorId, reason: vendorsError.message });
    return { created, skipped, notificationSent: false, notificationError: null };
  }

  const vendorById = new Map((vendorRows || []).map((v: any) => [v.id, v]));

  for (const vendorId of vendorIds) {
    const vendor = vendorById.get(vendorId);
    if (!vendor) {
      skipped.push({ vendorId, reason: "Vendor not found" });
      continue;
    }

    const normalizedEmail = String(vendor.email || "").trim().toLowerCase();
    if (isVendorInviteApprovalExempt(normalizedEmail)) {
      skipped.push({ vendorId, reason: "This vendor is exempt from the approval rule — send directly." });
      continue;
    }

    const latest = await getLatestVendorInvitation(supabaseAdmin, vendorId);
    if (!isVendorInviteBlocked(latest)) {
      skipped.push({ vendorId, reason: "This vendor isn't currently blocked — send the invite directly." });
      continue;
    }
    const recent = latest!;

    const { data: existingPending, error: existingPendingError } = await supabaseAdmin
      .from("vendor_invite_override_requests")
      .select("id")
      .eq("vendor_id", vendorId)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPendingError) {
      skipped.push({ vendorId, reason: existingPendingError.message });
      continue;
    }
    if (existingPending) {
      skipped.push({ vendorId, reason: "An override request is already pending approval for this vendor." });
      continue;
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("vendor_invite_override_requests")
      .insert({
        vendor_id: vendorId,
        last_invitation_id: recent.id,
        last_invited_at: recent.created_at,
        period_end_at: recent.end_date,
        reason,
        requested_by: requestedBy,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      if (String((insertError as any)?.code || "") === "23505") {
        skipped.push({ vendorId, reason: "An override request is already pending approval for this vendor." });
      } else {
        skipped.push({ vendorId, reason: insertError?.message || "Failed to create request" });
      }
      continue;
    }

    const profile = getSingleProfile(vendor.profiles);
    const name = nameFromProfile(profile, normalizedEmail);
    created.push({ id: inserted.id, vendorId, name, email: normalizedEmail, periodEnd: recent.end_date || "" });
  }

  let notificationSent = false;
  let notificationError: string | null = null;

  if (created.length > 0) {
    try {
      const [requesterInfo, requesterRowResult] = await Promise.all([
        getInviterEmailContext(supabaseAdmin, requestedBy),
        supabaseAdmin.from("users").select("email, profiles(first_name, last_name)").eq("id", requestedBy).maybeSingle(),
      ]);
      const requesterRow = requesterRowResult.data as any;
      const requesterName = nameFromProfile(getSingleProfile(requesterRow?.profiles), requesterRow?.email || "");

      const reviewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://pds-murex.vercel.app"}/vendor-invite-requests`;

      const emailResult = await sendEmailWithRetry({
        to: APPROVAL_NOTIFICATION_EMAILS,
        subject: `Vendor Invite Override Request Awaiting Approval - ${requesterInfo.managerName}`,
        html: buildApprovalNotificationEmailHtml({
          requesterName,
          reason,
          vendors: created.map((c) => ({ name: c.name, email: c.email, periodEnd: c.periodEnd })),
          reviewUrl,
        }),
      });

      notificationSent = Boolean(emailResult.success);
      if (!emailResult.success) {
        notificationError = emailResult.error || "Unknown email error";
        console.error("[VENDOR INVITE OVERRIDE REQUESTS] approval email failed:", emailResult.error);
      }
    } catch (notifyError: any) {
      notificationError = notifyError?.message || "Unknown email error";
      console.error("[VENDOR INVITE OVERRIDE REQUESTS] approval email error:", notifyError);
    }

    await supabaseAdmin
      .from("vendor_invite_override_requests")
      .update({ approval_notification_sent: notificationSent, approval_notification_error: notificationError })
      .in(
        "id",
        created.map((c) => c.id)
      );
  }

  return { created, skipped, notificationSent, notificationError };
}
