// app/api/invitation-cancellation-requests/route.ts
//
// Employee-initiated requests (filed from /employees/[id]) to cancel an
// already-responded (confirmed/declined) event invitation. A request only
// takes effect — removing the underlying event_teams / event_location_assignments
// row — once a privileged reviewer approves it via PATCH.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { safeDecrypt } from "@/lib/encryption";
import { getTimezoneForState, toZonedIso } from "@/lib/timezones";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Roles allowed to review (approve/reject) cancellation requests and to see
// another employee's request history. Mirrors /api/data-edition-requests,
// plus supervisor4, which also exists in this database's user_role enum.
const PRIVILEGED_ROLES = new Set([
  "exec",
  "hr",
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
  "supervisor4",
  "finance",
]);

// Notified by email (with a link to the review UI) whenever a cancellation
// request is filed. jenvillar@1pds.net is granted review access below
// without a role change, since their actual role ("worker") shouldn't gain
// the broader HR/manager permissions that come with the roles above —
// sebastiancastao379@gmail.com already holds the "exec" role, so no such
// grant is needed for them to approve/reject.
const APPROVAL_NOTIFICATION_EMAILS = ["jenvillar@1pds.net", "sebastiancastao379@gmail.com"];
const EXTRA_REVIEWER_EMAILS = new Set(["jenvillar@1pds.net"]);

// Employees can no longer self-serve a cancellation once the event is this close.
const MIN_HOURS_BEFORE_EVENT = 24;

const ALREADY_RESPONDED_STATUSES = new Set(["confirmed", "declined"]);

// Joins events() so the requester's profile can still show the event name/date
// after approval deletes the underlying event_teams / event_location_assignments row.
// Also embeds the employee (user_id) and requester (requested_by) so the
// cross-employee review panel (/cancellation-requests) can list who's asking
// without a separate lookup per row — both reference public.users, so each
// embed is disambiguated by its specific FK constraint name.
const REQUEST_COLUMNS =
  "id, user_id, event_id, source, team_member_id, location_assignment_id, previous_status, reason, status, requested_by, reviewed_by, reviewed_at, review_notes, created_at, updated_at, " +
  "approval_notification_sent, approval_notification_error, outcome_notification_sent, outcome_notification_error, " +
  "events (event_name, event_date, start_time, venue, city, state), " +
  "employee:users!invitation_cancellation_requests_user_id_fkey (email, profiles (first_name, last_name)), " +
  "requested_by_user:users!invitation_cancellation_requests_requested_by_fkey (email, profiles (first_name, last_name))";

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
  const { data } = await supabaseAdmin
    .from("users")
    .select("role, email")
    .eq("id", userId)
    .maybeSingle();
  return {
    role: String(data?.role || "").trim().toLowerCase(),
    email: String(data?.email || "").trim().toLowerCase(),
  };
}

function isPrivilegedReviewer(role: string, email: string): boolean {
  return PRIVILEGED_ROLES.has(role) || EXTRA_REVIEWER_EMAILS.has(email);
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "TBD";
  const ymd = String(value).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  const date = new Date(ymd);
  return Number.isNaN(date.getTime()) ? ymd : date.toLocaleDateString("en-US");
}

/** Milliseconds until the event's local (state) start time, or null if it can't be computed. */
function msUntilEventStart(eventDate: string | null | undefined, startTime: string | null | undefined, state: string | null | undefined): number | null {
  if (!eventDate || !startTime) return null;
  const dateStr = String(eventDate).split("T")[0];
  const tz = getTimezoneForState(state);
  const iso = toZonedIso(dateStr, String(startTime), tz);
  const eventStartMs = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(eventStartMs)) return null;
  return eventStartMs - Date.now();
}

/**
 * Resend calls occasionally fail transiently (network blip, rate limit) — a
 * bare `sendEmail` call was observed silently returning success:false with
 * no queryable trace, so retry once before giving up rather than leaving the
 * reviewers/employee with no notification at all.
 */
async function sendEmailWithRetry(
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

async function getDisplayNameAndEmail(userId: string): Promise<{ name: string; email: string }> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("email, profiles(first_name, last_name)")
    .eq("id", userId)
    .maybeSingle();

  const email = String(data?.email || "").trim();
  const profileRaw = (data as any)?.profiles;
  const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;

  let firstName = "";
  let lastName = "";
  try {
    firstName = profile?.first_name ? safeDecrypt(String(profile.first_name)) : "";
  } catch {}
  try {
    lastName = profile?.last_name ? safeDecrypt(String(profile.last_name)) : "";
  } catch {}

  return { name: `${firstName} ${lastName}`.trim() || email || "Unknown", email };
}

function decryptProfilePart(value: unknown): string {
  if (!value) return "";
  try {
    return safeDecrypt(String(value));
  } catch {
    return "";
  }
}

/**
 * Flattens the embedded `employee`/`requested_by_user` users(profiles) rows
 * (see REQUEST_COLUMNS) into plain, decrypted display fields, and drops the
 * raw embeds so callers never see ciphertext.
 */
function decorateRequestRow(row: Record<string, any>): Record<string, any> {
  const { employee, requested_by_user, ...rest } = row;

  const employeeProfile = Array.isArray(employee?.profiles) ? employee.profiles[0] : employee?.profiles;
  const requesterProfile = Array.isArray(requested_by_user?.profiles)
    ? requested_by_user.profiles[0]
    : requested_by_user?.profiles;

  const employeeName =
    `${decryptProfilePart(employeeProfile?.first_name)} ${decryptProfilePart(employeeProfile?.last_name)}`.trim() ||
    employee?.email ||
    "Unknown";
  const requesterName =
    `${decryptProfilePart(requesterProfile?.first_name)} ${decryptProfilePart(requesterProfile?.last_name)}`.trim() ||
    requested_by_user?.email ||
    "Unknown";

  return {
    ...rest,
    employee_name: employeeName,
    employee_email: employee?.email || null,
    requested_by_name: requesterName,
    requested_by_email: requested_by_user?.email || null,
  };
}

function buildApprovalNotificationEmailHtml(params: {
  employeeName: string;
  eventName: string;
  eventDateLabel: string;
  venue: string;
  cityState: string;
  previousStatus: string;
  reason: string;
  requestedByName: string;
  approvalUrl: string;
}) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Cancellation Request Awaiting Approval</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; margin:0; padding:20px;">
    <div style="max-width:600px;margin:0 auto;">
      <h2 style="margin:0 0 12px 0; color:#b45309;">Cancellation Request Awaiting Approval</h2>
      <p style="margin:0 0 16px 0;">
        ${escapeHtml(params.employeeName)} has requested to cancel a ${escapeHtml(params.previousStatus)} invitation. Review and approve or reject it below.
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width:100%;">
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Event</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.eventName)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Event Date</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.eventDateLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Venue</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.venue)}${params.cityState ? ` (${escapeHtml(params.cityState)})` : ""}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Employee</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.employeeName)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151; vertical-align: top;">Reason</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.reason)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Requested By</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.requestedByName)}</td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td align="center">
            <a href="${params.approvalUrl}"
               style="display: inline-block; background: #b45309; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: bold;">
              Review Request
            </a>
          </td>
        </tr>
      </table>
      <p style="color:#6b7280; font-size:13px;">
        Or copy and paste this link in your browser:<br>
        <a href="${params.approvalUrl}" style="color:#b45309; word-break: break-all;">${params.approvalUrl}</a>
      </p>
    </div>
  </body>
</html>
`.trim();
}

function buildOutcomeNotificationEmailHtml(params: {
  employeeName: string;
  eventName: string;
  eventDateLabel: string;
  venue: string;
  cityState: string;
  approved: boolean;
  reviewNotes: string | null;
}) {
  const heading = params.approved ? "Cancellation Approved" : "Cancellation Request Denied";
  const headingColor = params.approved ? "#15803d" : "#b91c1c";
  const bodyText = params.approved
    ? "Your request to cancel this invitation has been approved. You have been removed from the team for this event."
    : "Your request to cancel this invitation was not approved. You remain on the team for this event as originally scheduled.";

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
      <p style="margin:0 0 16px 0;">Hi ${escapeHtml(params.employeeName)},</p>
      <p style="margin:0 0 16px 0;">${escapeHtml(bodyText)}</p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width:100%;">
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Event</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.eventName)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Event Date</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.eventDateLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Venue</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.venue)}${params.cityState ? ` (${escapeHtml(params.cityState)})` : ""}</td>
        </tr>
      </table>
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

    const { role: callerRole, email: callerEmail } = await getCallerAuthInfo(user.id);
    const isPrivileged = isPrivilegedReviewer(callerRole, callerEmail);
    const requestedUserId = req.nextUrl.searchParams.get("userId")?.trim() || null;

    if (!requestedUserId) {
      if (!isPrivileged) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }
      const { data, error } = await supabaseAdmin
        .from("invitation_cancellation_requests")
        .select(REQUEST_COLUMNS)
        .order("created_at", { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ requests: (data || []).map(decorateRequestRow), canReview: true });
    }

    if (requestedUserId !== user.id && !isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("invitation_cancellation_requests")
      .select(REQUEST_COLUMNS)
      .eq("user_id", requestedUserId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ requests: (data || []).map(decorateRequestRow), canReview: isPrivileged });
  } catch (err: any) {
    console.error("[INVITATION CANCELLATION REQUESTS][GET] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body?.userId || "").trim();
    const invitationId = String(body?.invitationId || "").trim();
    const source = String(body?.source || "").trim();
    const reason = String(body?.reason || "").trim();

    if (!targetUserId || !invitationId || (source !== "team" && source !== "location") || !reason) {
      return NextResponse.json(
        { error: "userId, invitationId, source ('team' or 'location'), and reason are required" },
        { status: 400 }
      );
    }

    const { role: callerRole, email: callerEmail } = await getCallerAuthInfo(user.id);
    const isPrivileged = isPrivilegedReviewer(callerRole, callerEmail);
    if (targetUserId !== user.id && !isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let eventId: string;
    let previousStatus: string | null = null;

    if (source === "team") {
      const { data: teamMember, error: teamMemberError } = await supabaseAdmin
        .from("event_teams")
        .select("id, event_id, vendor_id, status")
        .eq("id", invitationId)
        .maybeSingle();

      if (teamMemberError) {
        return NextResponse.json({ error: teamMemberError.message }, { status: 500 });
      }
      if (!teamMember || teamMember.vendor_id !== targetUserId) {
        return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
      }

      const status = String(teamMember.status || "").toLowerCase();
      if (!ALREADY_RESPONDED_STATUSES.has(status)) {
        return NextResponse.json(
          { error: "Only an already-responded invitation (confirmed or declined) can be cancelled." },
          { status: 400 }
        );
      }

      eventId = teamMember.event_id;
      previousStatus = status;
    } else {
      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from("event_location_assignments")
        .select("id, event_id, vendor_id")
        .eq("id", invitationId)
        .maybeSingle();

      if (assignmentError) {
        return NextResponse.json({ error: assignmentError.message }, { status: 500 });
      }
      if (!assignment || assignment.vendor_id !== targetUserId) {
        return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
      }

      eventId = assignment.event_id;
      previousStatus = "assigned";
    }

    const { data: eventRow, error: eventFetchError } = await supabaseAdmin
      .from("events")
      .select("id, event_name, event_date, start_time, venue, city, state")
      .eq("id", eventId)
      .maybeSingle();

    if (eventFetchError) {
      return NextResponse.json({ error: eventFetchError.message }, { status: 500 });
    }

    // Skip the gate (rather than block) when the stored date/time can't be parsed —
    // mirrors the same tradeoff in /api/check-in/validate's window check.
    const msUntilStart = msUntilEventStart(eventRow?.event_date, eventRow?.start_time, eventRow?.state);
    if (msUntilStart !== null && msUntilStart < MIN_HOURS_BEFORE_EVENT * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: `Cancellation requests must be submitted at least ${MIN_HOURS_BEFORE_EVENT} hours before the event starts.` },
        { status: 400 }
      );
    }

    // Defense in depth alongside the table's partial unique index on
    // (source, invitation id) WHERE status = 'pending'.
    const pendingLookupColumn = source === "team" ? "team_member_id" : "location_assignment_id";
    const { data: existingPending, error: existingPendingError } = await supabaseAdmin
      .from("invitation_cancellation_requests")
      .select("id")
      .eq("source", source)
      .eq(pendingLookupColumn, invitationId)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPendingError) {
      return NextResponse.json({ error: existingPendingError.message }, { status: 500 });
    }
    if (existingPending) {
      return NextResponse.json(
        { error: "A cancellation request is already pending for this invitation." },
        { status: 409 }
      );
    }

    const insertPayload: Record<string, any> = {
      user_id: targetUserId,
      event_id: eventId,
      source,
      previous_status: previousStatus,
      reason,
      requested_by: user.id,
    };
    insertPayload[pendingLookupColumn] = invitationId;

    const { data: insertedRaw, error: insertError } = await supabaseAdmin
      .from("invitation_cancellation_requests")
      .insert(insertPayload)
      .select(REQUEST_COLUMNS)
      .single();

    if (insertError) {
      if (String((insertError as any)?.code || "") === "23505") {
        return NextResponse.json(
          { error: "A cancellation request is already pending for this invitation." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Cast to `any`: postgrest-js can't type-infer REQUEST_COLUMNS's two
    // same-table embeds (disambiguated by FK constraint name) — same
    // workaround already used in lib/email.ts for a similar select string.
    const inserted = insertedRaw as any;

    let notificationSent = false;
    let notificationError: string | null = null;
    try {
      const [employeeInfo, requesterInfo] = await Promise.all([
        getDisplayNameAndEmail(targetUserId),
        getDisplayNameAndEmail(user.id),
      ]);

      const isTestingOrigin = req.nextUrl.origin === "https://pds-git-testing-sebastiancastaos-projects.vercel.app";
      const appUrl = isTestingOrigin
        ? "https://pds-git-testing-sebastiancastaos-projects.vercel.app"
        : process.env.NEXT_PUBLIC_APP_URL || "https://pds-murex.vercel.app";
      const approvalUrl = `${appUrl}/cancellation-requests?requestId=${inserted.id}`;

      const emailResult = await sendEmailWithRetry({
        to: APPROVAL_NOTIFICATION_EMAILS,
        subject: `Cancellation Request Awaiting Approval - ${employeeInfo.name}`,
        html: buildApprovalNotificationEmailHtml({
          employeeName: employeeInfo.name,
          eventName: String(eventRow?.event_name || "Event"),
          eventDateLabel: formatDateLabel(eventRow?.event_date),
          venue: String(eventRow?.venue || "TBD"),
          cityState: [eventRow?.city, eventRow?.state].filter(Boolean).join(", "),
          previousStatus: previousStatus || "responded",
          reason,
          requestedByName: requesterInfo.name,
          approvalUrl,
        }),
      });

      notificationSent = Boolean(emailResult.success);
      if (!emailResult.success) {
        notificationError = emailResult.error || "Unknown email error";
        console.error("[INVITATION CANCELLATION REQUESTS][POST] approval email failed:", emailResult.error);
      }
    } catch (notifyError: any) {
      // The cancellation request is already recorded — a notification failure
      // shouldn't roll that back or fail the request.
      notificationError = notifyError?.message || "Unknown email error";
      console.error("[INVITATION CANCELLATION REQUESTS][POST] approval email error:", notifyError);
    }

    await supabaseAdmin
      .from("invitation_cancellation_requests")
      .update({ approval_notification_sent: notificationSent, approval_notification_error: notificationError })
      .eq("id", inserted.id);

    return NextResponse.json(
      {
        success: true,
        request: decorateRequestRow(inserted),
        notificationSent,
        message: notificationSent
          ? "Cancellation request submitted and the review team was notified."
          : `Cancellation request submitted, but the notification email to the review team failed to send: ${notificationError}. They can still see it at /cancellation-requests.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[INVITATION CANCELLATION REQUESTS][POST] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { role: callerRole, email: callerEmail } = await getCallerAuthInfo(user.id);
    if (!isPrivilegedReviewer(callerRole, callerEmail)) {
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

    const { data: cancellationRequestRaw, error: fetchError } = await supabaseAdmin
      .from("invitation_cancellation_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", requestId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!cancellationRequestRaw) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    // Same postgrest-js type-inference workaround as `inserted` above.
    const cancellationRequest = cancellationRequestRaw as any;
    if (cancellationRequest.status !== "pending") {
      return NextResponse.json(
        { error: `This request has already been ${cancellationRequest.status}.` },
        { status: 409 }
      );
    }

    if (action === "approved") {
      if (cancellationRequest.source === "team" && cancellationRequest.team_member_id) {
        const { data: teamMember } = await supabaseAdmin
          .from("event_teams")
          .select("id, vendor_id, status, created_at")
          .eq("id", cancellationRequest.team_member_id)
          .maybeSingle();

        if (teamMember) {
          // Also drop any location assignment tied to the same vendor/event —
          // mirrors the cleanup already done by the existing uninvite endpoint
          // (app/api/events/[id]/team/[memberId]/route.ts DELETE).
          await supabaseAdmin
            .from("event_location_assignments")
            .delete()
            .eq("event_id", cancellationRequest.event_id)
            .eq("vendor_id", teamMember.vendor_id);

          const { error: deleteError } = await supabaseAdmin
            .from("event_teams")
            .delete()
            .eq("id", teamMember.id);

          if (deleteError) {
            return NextResponse.json({ error: deleteError.message }, { status: 500 });
          }

          const uninviteMetadata = {
            event_id: cancellationRequest.event_id,
            team_member_id: teamMember.id,
            vendor_id: teamMember.vendor_id,
            previous_status: teamMember.status || null,
            uninvited_by_user_id: user.id,
            invited_at: (teamMember as any).created_at || null,
            source: "invitation_cancellation_request",
            cancellation_request_id: cancellationRequest.id,
            cancellation_reason: cancellationRequest.reason,
          };

          const { error: uninviteHistoryError } = await supabaseAdmin
            .from("event_team_uninvites")
            .insert({
              event_id: cancellationRequest.event_id,
              team_member_id: teamMember.id,
              vendor_id: teamMember.vendor_id,
              previous_status: teamMember.status || null,
              uninvited_by: user.id,
              metadata: uninviteMetadata,
            });

          if (uninviteHistoryError) {
            console.error("Failed to persist team uninvite history:", uninviteHistoryError);
          }

          const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
            user_id: user.id,
            action: "team_member_uninvited",
            resource_type: "event",
            resource_id: cancellationRequest.event_id,
            metadata: uninviteMetadata,
          });

          if (auditError) {
            console.error("Failed to log team uninvite audit event:", auditError);
          }
        }
      } else if (cancellationRequest.source === "location" && cancellationRequest.location_assignment_id) {
        const { error: deleteAssignmentError } = await supabaseAdmin
          .from("event_location_assignments")
          .delete()
          .eq("id", cancellationRequest.location_assignment_id);

        if (deleteAssignmentError) {
          return NextResponse.json({ error: deleteAssignmentError.message }, { status: 500 });
        }
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("invitation_cancellation_requests")
      .update({
        status: action,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
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
      const employeeProfile = Array.isArray(cancellationRequest.employee?.profiles)
        ? cancellationRequest.employee.profiles[0]
        : cancellationRequest.employee?.profiles;
      const employeeEmail = String(cancellationRequest.employee?.email || "").trim();
      const employeeName =
        `${decryptProfilePart(employeeProfile?.first_name)} ${decryptProfilePart(employeeProfile?.last_name)}`.trim() ||
        employeeEmail ||
        "there";
      const eventInfo = Array.isArray(cancellationRequest.events) ? cancellationRequest.events[0] : cancellationRequest.events;

      if (employeeEmail) {
        const emailResult = await sendEmailWithRetry({
          to: employeeEmail,
          bcc: APPROVAL_NOTIFICATION_EMAILS,
          subject: `Cancellation Request ${action === "approved" ? "Approved" : "Denied"} - ${eventInfo?.event_name || "Event"}`,
          html: buildOutcomeNotificationEmailHtml({
            employeeName,
            eventName: String(eventInfo?.event_name || "Event"),
            eventDateLabel: formatDateLabel(eventInfo?.event_date),
            venue: String(eventInfo?.venue || "TBD"),
            cityState: [eventInfo?.city, eventInfo?.state].filter(Boolean).join(", "),
            approved: action === "approved",
            reviewNotes,
          }),
        });

        notificationSent = Boolean(emailResult.success);
        if (!emailResult.success) {
          notificationError = emailResult.error || "Unknown email error";
          console.error("[INVITATION CANCELLATION REQUESTS][PATCH] outcome email failed:", emailResult.error);
        }
      }
    } catch (notifyError: any) {
      // The review is already recorded — a notification failure shouldn't roll that back.
      notificationError = notifyError?.message || "Unknown email error";
      console.error("[INVITATION CANCELLATION REQUESTS][PATCH] outcome email error:", notifyError);
    }

    await supabaseAdmin
      .from("invitation_cancellation_requests")
      .update({ outcome_notification_sent: notificationSent, outcome_notification_error: notificationError })
      .eq("id", requestId);

    return NextResponse.json({ success: true, request: decorateRequestRow(updated), notificationSent });
  } catch (err: any) {
    console.error("[INVITATION CANCELLATION REQUESTS][PATCH] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
