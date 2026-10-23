// app/api/vendor-availability-change-requests/route.ts
//
// Vendor-initiated (or admin-on-behalf) requests, filed from the "Personal
// Calendar" on /employees/[id], to correct an already-submitted availability
// answer for one or more specific dates. A request only actually changes
// anything once a privileged reviewer approves it via PATCH — at that point
// each date's corrected value is written to vendor_availability_corrections,
// which lib/vendorAvailability.ts's getMergedVendorAvailability() treats as
// the highest-priority source for that date. Mirrors
// app/api/invitation-cancellation-requests/route.ts's self-service shape.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { getEffectiveAvailabilityByDate } from "@/lib/vendorAvailability";
import {
  describeAvailabilityAnswer,
  normalizeTimeFrameTime,
  sameAvailabilityAnswer,
  toAvailabilityAnswer,
  type AvailabilityAnswer,
} from "@/lib/availabilityTimeFrame";
import { getSingleProfile } from "@/lib/vendorInvites";
import {
  APPROVAL_NOTIFICATION_EMAILS,
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

// Mirrors the role set used by invitation_cancellation_requests /
// vendor_invite_override_requests, plus 'admin' at the app level (the DB
// role enum has no 'admin' label — see vendor_invite_override_requests'
// migration comment for why that's only checked here, not in RLS).
const PRIVILEGED_ROLES = new Set([
  "admin",
  "exec",
  "hr",
  "manager",
  "supervisor",
  "supervisor6",
  "supervisor2",
  "supervisor3",
  "supervisor4",
  "finance",
]);
const EXTRA_REVIEWER_EMAILS = new Set(["jenvillar@1pds.net"]);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const REQUEST_COLUMNS =
  "id, vendor_id, date_changes, reason, status, requested_by, reviewed_by, reviewed_at, review_notes, created_at, updated_at, " +
  "approval_notification_sent, approval_notification_error, outcome_notification_sent, outcome_notification_error, " +
  "vendor:users!vendor_availability_change_requests_vendor_id_fkey (email, profiles (first_name, last_name)), " +
  "requested_by_user:users!vendor_availability_change_requests_requested_by_fkey (email, profiles (first_name, last_name))";

// Each entry in vendor_availability_change_requests.date_changes. The
// *_all_day / *_start_time / *_end_time keys were added with time frames
// (2026-10-22); requests filed before that only carry the two booleans.
// requested_all_day === false means "available only between
// requested_start_time and requested_end_time" ("HH:MM", end may be earlier
// than start for windows crossing midnight).
type DateChange = {
  date: string;
  current_available: boolean | null;
  current_all_day?: boolean | null;
  current_start_time?: string | null;
  current_end_time?: string | null;
  requested_available: boolean;
  requested_all_day?: boolean;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
};

function currentAnswerOf(change: DateChange): AvailabilityAnswer | null {
  if (change.current_available === null || change.current_available === undefined) return null;
  return toAvailabilityAnswer({
    available: change.current_available,
    allDay: change.current_all_day ?? true,
    startTime: change.current_start_time,
    endTime: change.current_end_time,
  });
}

function requestedAnswerOf(change: DateChange): AvailabilityAnswer {
  return toAvailabilityAnswer({
    available: change.requested_available,
    allDay: change.requested_all_day ?? true,
    startTime: change.requested_start_time,
    endTime: change.requested_end_time,
  });
}

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

function isPrivilegedReviewer(role: string, email: string): boolean {
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

function buildApprovalNotificationEmailHtml(params: {
  requesterName: string;
  vendorName: string;
  reason: string;
  changes: DateChange[];
  reviewUrl: string;
}) {
  const rows = params.changes
    .map(
      (c) => `
        <tr>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(c.date)}</td>
          <td style="padding: 6px 10px; color: #374151;">${escapeHtml(describeAvailabilityAnswer(currentAnswerOf(c)))}</td>
          <td style="padding: 6px 10px; font-weight: 600; color: #b45309;">${escapeHtml(describeAvailabilityAnswer(requestedAnswerOf(c)))}</td>
        </tr>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Availability Change Request Awaiting Approval</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; margin:0; padding:20px;">
    <div style="max-width:600px;margin:0 auto;">
      <h2 style="margin:0 0 12px 0; color:#b45309;">Availability Change Request</h2>
      <p style="margin:0 0 16px 0;">
        ${escapeHtml(params.requesterName)} has requested to correct ${escapeHtml(params.vendorName)}'s submitted availability for ${params.changes.length} date${params.changes.length !== 1 ? "s" : ""}. Review and approve or reject below.
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width:100%; margin-bottom: 16px;">
        <tr style="background:#f9fafb;">
          <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Date</td>
          <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Currently</td>
          <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Requested</td>
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
              Review Request
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

function buildOutcomeNotificationEmailHtml(params: {
  vendorName: string;
  approved: boolean;
  changes: DateChange[];
  reviewNotes: string | null;
}) {
  const heading = params.approved ? "Availability Change Approved" : "Availability Change Denied";
  const headingColor = params.approved ? "#15803d" : "#b91c1c";
  const bodyText = params.approved
    ? "Your requested availability correction was approved and your calendar has been updated."
    : "Your requested availability correction was not approved. Your calendar is unchanged.";
  const rows = params.changes
    .map(
      (c) => `
        <tr>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(c.date)}</td>
          <td style="padding: 6px 10px; color: #374151;">${escapeHtml(describeAvailabilityAnswer(requestedAnswerOf(c)))}</td>
        </tr>`
    )
    .join("");

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
      <p style="margin:0 0 16px 0;">Hi ${escapeHtml(params.vendorName)},</p>
      <p style="margin:0 0 16px 0;">${bodyText}</p>
      ${
        params.approved
          ? `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width:100%; margin-bottom: 16px;">
              <tr style="background:#f9fafb;">
                <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Date</td>
                <td style="padding: 6px 10px; font-weight:600; color:#6b7280;">Now Shows</td>
              </tr>
              ${rows}
            </table>`
          : ""
      }
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
    const statusFilter = req.nextUrl.searchParams.get("status")?.trim().toLowerCase() || null;

    let query = supabaseAdmin.from("vendor_availability_change_requests").select(REQUEST_COLUMNS);

    if (!requestedUserId) {
      if (!isPrivileged) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }
    } else {
      if (requestedUserId !== user.id && !isPrivileged) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      query = query.eq("vendor_id", requestedUserId);
    }

    if (statusFilter && ["pending", "approved", "rejected"].includes(statusFilter)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      requests: (data || []).map(decorateRequestRow),
      canReview: isPrivileged,
    });
  } catch (err: any) {
    console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][GET] error:", err);
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
    const reason = String(body?.reason || "").trim();
    const rawDates = Array.isArray(body?.dates) ? body.dates : [];

    if (!targetUserId || !reason || rawDates.length === 0) {
      return NextResponse.json(
        { error: "userId, reason, and a non-empty dates array are required" },
        { status: 400 }
      );
    }

    const { role: callerRole, email: callerEmail } = await getCallerAuthInfo(user.id);
    const isPrivileged = isPrivilegedReviewer(callerRole, callerEmail);
    if (targetUserId !== user.id && !isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate + dedupe requested dates (last occurrence for a repeated date wins).
    // An available date may carry a time frame: allDay: false + startTime/endTime
    // ("HH:MM", 24h; end earlier than start = crosses midnight).
    const requestedByDate = new Map<string, AvailabilityAnswer>();
    for (const entry of rawDates) {
      const date = typeof entry?.date === "string" ? entry.date.slice(0, 10) : "";
      if (!DATE_REGEX.test(date) || typeof entry?.requestedAvailable !== "boolean") {
        return NextResponse.json(
          { error: `Invalid date entry: each date must be 'YYYY-MM-DD' with a boolean requestedAvailable` },
          { status: 400 }
        );
      }
      const wantsTimeFrame = entry.requestedAvailable === true && entry?.allDay === false;
      if (wantsTimeFrame) {
        const startTime = normalizeTimeFrameTime(entry?.startTime);
        const endTime = normalizeTimeFrameTime(entry?.endTime);
        if (!startTime || !endTime || startTime === endTime) {
          return NextResponse.json(
            { error: `Invalid time frame for ${date}: give a start and end time (HH:MM) that are different.` },
            { status: 400 }
          );
        }
      }
      requestedByDate.set(
        date,
        toAvailabilityAnswer({
          available: entry.requestedAvailable,
          allDay: wantsTimeFrame ? false : true,
          startTime: entry?.startTime,
          endTime: entry?.endTime,
        })
      );
    }

    const currentByDate = await getEffectiveAvailabilityByDate(
      supabaseAdmin,
      targetUserId,
      Array.from(requestedByDate.keys())
    );

    const dateChanges: DateChange[] = Array.from(requestedByDate.entries())
      .filter(([date, requested]) => !sameAvailabilityAnswer(currentByDate.get(date) ?? null, requested))
      .map(([date, requested]) => {
        const current = currentByDate.get(date) ?? null;
        return {
          date,
          current_available: current ? current.available : null,
          current_all_day: current ? current.allDay : null,
          current_start_time: current?.startTime ?? null,
          current_end_time: current?.endTime ?? null,
          requested_available: requested.available,
          requested_all_day: requested.allDay,
          requested_start_time: requested.startTime,
          requested_end_time: requested.endTime,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    if (dateChanges.length === 0) {
      return NextResponse.json(
        { error: "No changes requested — the requested value(s) already match the current record." },
        { status: 400 }
      );
    }

    const { data: existingPending, error: existingPendingError } = await supabaseAdmin
      .from("vendor_availability_change_requests")
      .select("id")
      .eq("vendor_id", targetUserId)
      .eq("status", "pending")
      .maybeSingle();

    if (existingPendingError) {
      return NextResponse.json({ error: existingPendingError.message }, { status: 500 });
    }
    if (existingPending) {
      return NextResponse.json(
        { error: "An availability change request is already pending for this vendor." },
        { status: 409 }
      );
    }

    const { data: insertedRaw, error: insertError } = await supabaseAdmin
      .from("vendor_availability_change_requests")
      .insert({
        vendor_id: targetUserId,
        date_changes: dateChanges,
        reason,
        requested_by: user.id,
      })
      .select(REQUEST_COLUMNS)
      .single();

    if (insertError) {
      if (String((insertError as any)?.code || "") === "23505") {
        return NextResponse.json(
          { error: "An availability change request is already pending for this vendor." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const inserted = insertedRaw as any;

    let notificationSent = false;
    let notificationError: string | null = null;
    try {
      const { data: requesterRow } = await supabaseAdmin
        .from("users")
        .select("email, profiles(first_name, last_name)")
        .eq("id", user.id)
        .maybeSingle();
      const requesterName = nameFromProfile(getSingleProfile((requesterRow as any)?.profiles), (requesterRow as any)?.email || callerEmail);
      const vendorName = nameFromProfile(getSingleProfile(inserted.vendor?.profiles), inserted.vendor?.email);

      const isTestingOrigin = req.nextUrl.origin === "https://pds-git-testing-sebastiancastaos-projects.vercel.app";
      const appUrl = isTestingOrigin
        ? "https://pds-git-testing-sebastiancastaos-projects.vercel.app"
        : process.env.NEXT_PUBLIC_APP_URL || "https://pds-murex.vercel.app";
      const reviewUrl = `${appUrl}/vendor-invite-requests`;

      const emailResult = await sendEmailWithRetry({
        to: APPROVAL_NOTIFICATION_EMAILS,
        subject: `Availability Change Request Awaiting Approval - ${vendorName}`,
        html: buildApprovalNotificationEmailHtml({
          requesterName,
          vendorName,
          reason,
          changes: dateChanges,
          reviewUrl,
        }),
      });

      notificationSent = Boolean(emailResult.success);
      if (!emailResult.success) {
        notificationError = emailResult.error || "Unknown email error";
        console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][POST] approval email failed:", emailResult.error);
      }
    } catch (notifyError: any) {
      notificationError = notifyError?.message || "Unknown email error";
      console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][POST] approval email error:", notifyError);
    }

    await supabaseAdmin
      .from("vendor_availability_change_requests")
      .update({ approval_notification_sent: notificationSent, approval_notification_error: notificationError })
      .eq("id", inserted.id);

    return NextResponse.json(
      {
        success: true,
        request: decorateRequestRow(inserted),
        notificationSent,
        message: notificationSent
          ? "Availability change request submitted and the review team was notified."
          : "Availability change request submitted, but the notification email to the review team failed to send. They can still see it at /vendor-invite-requests.",
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][POST] error:", err);
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

    const { data: requestRowRaw, error: fetchError } = await supabaseAdmin
      .from("vendor_availability_change_requests")
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

    const dateChanges: DateChange[] = Array.isArray(requestRow.date_changes) ? requestRow.date_changes : [];

    if (action === "approved") {
      // requested_all_day is missing on requests filed before time frames
      // existed; those keep all_day NULL (legacy semantics, see the
      // 20261022000002 migration). Times are always written so an older
      // window on the same date is cleared.
      const correctionRows = dateChanges.map((c) => {
        const requested = requestedAnswerOf(c);
        const hasTimeFrameKeys = typeof c.requested_all_day === "boolean";
        return {
          vendor_id: requestRow.vendor_id,
          date: c.date,
          available: requested.available,
          all_day: !hasTimeFrameKeys || !requested.available ? null : requested.allDay,
          start_time: requested.available && !requested.allDay ? requested.startTime : null,
          end_time: requested.available && !requested.allDay ? requested.endTime : null,
          change_request_id: requestRow.id,
        };
      });

      if (correctionRows.length > 0) {
        const { error: upsertError } = await supabaseAdmin
          .from("vendor_availability_corrections")
          .upsert(correctionRows, { onConflict: "vendor_id,date" });

        if (upsertError) {
          return NextResponse.json({ error: upsertError.message }, { status: 500 });
        }
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("vendor_availability_change_requests")
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
      const vendorEmail = String(requestRow.vendor?.email || "").trim();
      const vendorName = nameFromProfile(getSingleProfile(requestRow.vendor?.profiles), vendorEmail);

      if (vendorEmail) {
        const emailResult = await sendEmailWithRetry({
          to: vendorEmail,
          bcc: APPROVAL_NOTIFICATION_EMAILS,
          subject: `Availability Change ${action === "approved" ? "Approved" : "Denied"}`,
          html: buildOutcomeNotificationEmailHtml({
            vendorName,
            approved: action === "approved",
            changes: dateChanges,
            reviewNotes,
          }),
        });

        notificationSent = Boolean(emailResult.success);
        if (!emailResult.success) {
          notificationError = emailResult.error || "Unknown email error";
          console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][PATCH] outcome email failed:", emailResult.error);
        }
      }
    } catch (notifyError: any) {
      notificationError = notifyError?.message || "Unknown email error";
      console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][PATCH] outcome email error:", notifyError);
    }

    await supabaseAdmin
      .from("vendor_availability_change_requests")
      .update({ outcome_notification_sent: notificationSent, outcome_notification_error: notificationError })
      .eq("id", requestId);

    return NextResponse.json({ success: true, request: decorateRequestRow(updated), notificationSent });
  } catch (err: any) {
    console.error("[VENDOR AVAILABILITY CHANGE REQUESTS][PATCH] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
