import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email";
import { applyTimesheetProposal } from "@/lib/timesheet-apply";
import {
  ACTIVE_TIMESHEET_EDIT_STATUSES,
  OPEN_TIMESHEET_EDIT_STATUSES,
  TIMESHEET_EDIT_REASON_MAX_LENGTH,
  TIMESHEET_TIME_FIELDS,
  type TimesheetEditProposal,
  canRequesterWithdraw,
  canTransitionTimesheetEditRequest,
  formatClock12h,
  isTimesheetEditReviewer,
  isTimesheetEditStatus,
  parseTimesheetEditProposal,
} from "@/lib/timesheet-edit-requests";

export const dynamic = "force-dynamic";
// Approvals must be visible right away. Next.js would otherwise serve cached
// Supabase responses from its fetch Data Cache.
export const fetchCache = "force-no-store";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ATTESTATION_TIME_MATCH_WINDOW_MS = 15 * 60 * 1000;
const TIMESHEET_EDIT_REQUEST_NOTIFICATION_RECIPIENTS = [
  "portal@1pds.net",
  "sebastiancastao379@gmail.com",
  "jenvillar@1pds.net",
] as const;

type UserSummary = {
  id: string;
  role: string;
  email: string | null;
  name: string;
};

type ClockOutRow = {
  id: string;
  timestamp: string;
  attestation_accepted: boolean | null;
};

type EditRequestRow = {
  id: string;
  event_id: string;
  user_id: string;
  requested_by: string;
  requester_role: string | null;
  request_reason: string;
  requested_changes: TimesheetEditProposal | null;
  status: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type EventLookupRow = {
  id: string;
  event_name: string | null;
  event_date: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
};

type UserLookupRow = {
  id: string;
  email: string | null;
  role: string | null;
};

type ProfileLookupRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

function dedupeEmails(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

// Table of the times a requester wants, for the notification email. Every value
// was validated as HH:MM or a real date, so nothing here needs HTML escaping.
function renderProposalEmailHtml(proposal: TimesheetEditProposal | null) {
  if (!proposal) return "";

  const rows = TIMESHEET_TIME_FIELDS.filter(
    (field) => proposal.requested[field.key] || proposal.previous?.[field.key]
  )
    .map((field) => {
      const before = proposal.previous ? proposal.previous[field.key] : "";
      const after = proposal.requested[field.key];
      const changed = before !== after;
      const cell = "padding:8px 12px;border-top:1px solid #e2e8f0;font-size:14px;";
      return (
        `<tr${changed ? ' style="background:#fffbeb;"' : ""}>` +
        `<td style="${cell}color:#64748b;">${field.label}</td>` +
        `<td style="${cell}color:#0f172a;">${formatClock12h(before)}</td>` +
        `<td style="${cell}color:#0f172a;${changed ? "font-weight:700;" : ""}">${formatClock12h(after)}</td>` +
        `</tr>`
      );
    })
    .join("");

  const dayNote = proposal.workDate
    ? `<p style="margin:0 0 8px 0;color:#64748b;font-size:12px;">Work day: ${proposal.workDate}</p>`
    : "";

  return `
              <div style="margin-top:24px;">
                <p style="margin:0 0 8px 0;color:#334155;font-size:14px;font-weight:700;">Requested Times</p>
                ${dayNote}
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;">
                  <tr style="background:#f8fafc;">
                    <td style="padding:8px 12px;font-size:12px;color:#64748b;font-weight:700;">Field</td>
                    <td style="padding:8px 12px;font-size:12px;color:#64748b;font-weight:700;">Current</td>
                    <td style="padding:8px 12px;font-size:12px;color:#64748b;font-weight:700;">Requested</td>
                  </tr>
                  ${rows}
                </table>
              </div>`;
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (!error && data?.user?.id) {
      return data.user as any;
    }
  }

  return null;
}

async function loadUserSummary(userId: string): Promise<UserSummary> {
  const [{ data: userRow, error: userError }, { data: profileRow, error: profileError }] =
    await Promise.all([
      supabaseAdmin.from("users").select("id, role, email").eq("id", userId).maybeSingle(),
      supabaseAdmin
        .from("profiles")
        .select("first_name, last_name")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (userError) {
    throw new Error(userError.message);
  }
  if (profileError) {
    throw new Error(profileError.message);
  }
  if (!userRow?.id) {
    throw new Error("User not found.");
  }

  const first = profileRow?.first_name ? safeDecrypt(String(profileRow.first_name)) : "";
  const last = profileRow?.last_name ? safeDecrypt(String(profileRow.last_name)) : "";
  const name = [first, last].filter(Boolean).join(" ").trim() || String(userRow.email || userRow.id);

  return {
    id: String(userRow.id),
    role: String(userRow.role || "").trim().toLowerCase(),
    email: userRow.email ? String(userRow.email) : null,
    name,
  };
}

async function loadUserEmails(userIds: string[]) {
  const uniqueUserIds = Array.from(
    new Set(
      userIds
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  if (uniqueUserIds.length === 0) {
    return [] as string[];
  }

  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("id, email")
    .in("id", uniqueUserIds);

  if (error) {
    throw new Error(error.message);
  }

  return dedupeEmails((users || []).map((user) => user.email));
}

async function loadRoomManagerEmails(userId: string) {
  const { data: teamLinks, error: teamLinksError } = await supabaseAdmin
    .from("manager_team_members")
    .select("manager_id")
    .eq("member_id", userId)
    .eq("is_active", true);

  if (teamLinksError) {
    throw new Error(teamLinksError.message);
  }

  const directManagerIds = Array.from(
    new Set(
      (teamLinks || [])
        .map((row: { manager_id?: string | null }) => String(row.manager_id || "").trim())
        .filter(Boolean)
    )
  );

  const directManagerEmails = await loadUserEmails(directManagerIds);
  if (directManagerEmails.length > 0) {
    return directManagerEmails;
  }

  const { data: venueAssignments, error: venueAssignmentsError } = await supabaseAdmin
    .from("vendor_venue_assignments")
    .select("venue_id")
    .eq("vendor_id", userId);

  if (venueAssignmentsError) {
    throw new Error(venueAssignmentsError.message);
  }

  const venueIds = Array.from(
    new Set(
      (venueAssignments || [])
        .map((row: { venue_id?: string | null }) => String(row.venue_id || "").trim())
        .filter(Boolean)
    )
  );

  if (venueIds.length === 0) {
    return [] as string[];
  }

  const { data: venueManagers, error: venueManagersError } = await supabaseAdmin
    .from("venue_managers")
    .select("manager_id")
    .in("venue_id", venueIds)
    .eq("is_active", true);

  if (venueManagersError) {
    throw new Error(venueManagersError.message);
  }

  const venueManagerIds = Array.from(
    new Set(
      (venueManagers || [])
        .map((row: { manager_id?: string | null }) => String(row.manager_id || "").trim())
        .filter(Boolean)
    )
  );

  return loadUserEmails(venueManagerIds);
}

async function loadTimesheetStatus(userId: string, eventId: string) {
  const { data: clockOutRows, error: clockOutError } = await supabaseAdmin
    .from("time_entries")
    .select("id, timestamp, attestation_accepted")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .eq("action", "clock_out")
    .order("timestamp", { ascending: false });

  if (clockOutError) {
    throw new Error(clockOutError.message);
  }

  const clockOuts = (clockOutRows || []) as ClockOutRow[];
  if (clockOuts.length === 0) {
    return "not_submitted" as const;
  }

  const latestRejected = clockOuts.find((row) => row.attestation_accepted === false);
  if (latestRejected) {
    return "rejected" as const;
  }

  const latestAccepted = clockOuts.find((row) => row.attestation_accepted === true);
  if (latestAccepted) {
    return "submitted" as const;
  }

  const clockOutIds = clockOuts.map((row) => `clock-out-${row.id}`);
  const timestamps = clockOuts
    .map((row) => new Date(row.timestamp).getTime())
    .filter((value) => Number.isFinite(value));

  if (clockOutIds.length === 0 || timestamps.length === 0) {
    return "not_submitted" as const;
  }

  const minMs = Math.min(...timestamps) - ATTESTATION_TIME_MATCH_WINDOW_MS;
  const maxMs = Math.max(...timestamps) + ATTESTATION_TIME_MATCH_WINDOW_MS;

  const { data: signatureRows, error: signatureError } = await supabaseAdmin
    .from("form_signatures")
    .select("form_id, signed_at")
    .eq("form_type", "clock_out_attestation")
    .eq("user_id", userId)
    .in("form_id", clockOutIds)
    .gte("signed_at", new Date(minMs).toISOString())
    .lte("signed_at", new Date(maxMs).toISOString())
    .limit(25);

  if (signatureError) {
    throw new Error(signatureError.message);
  }

  return (signatureRows || []).length > 0 ? ("submitted" as const) : ("not_submitted" as const);
}

async function requireAuthedViewer(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const requester = await loadUserSummary(user.id);
  return { user, requester, canReview: isTimesheetEditReviewer(requester.role) };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthedViewer(req);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const statusFilter = String(searchParams.get("status") || "open").trim().toLowerCase();
    const requestId = String(searchParams.get("requestId") || "").trim();
    const userIdFilter = String(searchParams.get("userId") || "").trim();
    const viewer = {
      id: auth.requester.id,
      role: auth.requester.role,
      canReview: auth.canReview,
    };

    // Reviewers can read every request. Everyone else may only read the
    // requests filed for their own timesheets.
    if (!auth.canReview && userIdFilter !== auth.requester.id) {
      return NextResponse.json(
        { error: "You do not have permission to review timesheet edit requests." },
        { status: 403 }
      );
    }
    const limitRaw = Number(searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200;

    let query = supabaseAdmin
      .from("timesheet_edit_requests")
      .select(
        "id, event_id, user_id, requested_by, requester_role, request_reason, requested_changes, status, review_notes, reviewed_by, reviewed_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (requestId) {
      query = query.eq("id", requestId);
    }

    if (userIdFilter) {
      query = query.eq("user_id", userIdFilter);
    }

    if (statusFilter === "open") {
      query = query.in("status", [...OPEN_TIMESHEET_EDIT_STATUSES]);
    } else if (statusFilter === "active") {
      query = query.in("status", [...ACTIVE_TIMESHEET_EDIT_STATUSES]);
    } else if (statusFilter !== "all") {
      // A single status or a comma separated list, e.g. "submitted,approved".
      const requestedStatuses = statusFilter
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (requestedStatuses.length === 0 || !requestedStatuses.every(isTimesheetEditStatus)) {
        return NextResponse.json({ error: "Invalid status filter." }, { status: 400 });
      }
      query = query.in("status", requestedStatuses);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []) as EditRequestRow[];
    if (rows.length === 0) {
      return NextResponse.json({ requests: [], viewer });
    }

    const eventIds = [...new Set(rows.map((row) => row.event_id).filter(Boolean))];
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.user_id, row.requested_by, row.reviewed_by])
          .filter((value): value is string => Boolean(value))
      ),
    ];

    const [eventsRes, usersRes, profilesRes] = await Promise.all([
      eventIds.length > 0
        ? supabaseAdmin
            .from("events")
            .select("id, event_name, event_date, venue, city, state")
            .in("id", eventIds)
        : Promise.resolve({ data: [], error: null } as any),
      userIds.length > 0
        ? supabaseAdmin.from("users").select("id, email, role").in("id", userIds)
        : Promise.resolve({ data: [], error: null } as any),
      userIds.length > 0
        ? supabaseAdmin
            .from("profiles")
            .select("user_id, first_name, last_name")
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (eventsRes.error) {
      return NextResponse.json({ error: eventsRes.error.message }, { status: 500 });
    }
    if (usersRes.error) {
      return NextResponse.json({ error: usersRes.error.message }, { status: 500 });
    }
    if (profilesRes.error) {
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
    }

    const eventsById = new Map(
      ((eventsRes.data || []) as EventLookupRow[]).map((row) => [row.id, row] as const)
    );
    const usersById = new Map(
      ((usersRes.data || []) as UserLookupRow[]).map((row) => [row.id, row] as const)
    );
    const profilesById = new Map(
      ((profilesRes.data || []) as ProfileLookupRow[]).map((row) => [row.user_id, row] as const)
    );

    const getName = (id: string | null | undefined) => {
      if (!id) return null;
      const user = usersById.get(id) || null;
      const profile = profilesById.get(id) || null;
      const first = profile?.first_name ? safeDecrypt(String(profile.first_name)) : "";
      const last = profile?.last_name ? safeDecrypt(String(profile.last_name)) : "";
      return [first, last].filter(Boolean).join(" ").trim() || String(user?.email || id);
    };

    return NextResponse.json({
      viewer,
      requests: rows.map((row) => {
        const event = eventsById.get(row.event_id) || null;
        const workerUser = usersById.get(row.user_id) || null;
        const requesterUser = usersById.get(row.requested_by) || null;
        const reviewerUser = row.reviewed_by ? usersById.get(row.reviewed_by) || null : null;

        return {
          id: row.id,
          eventId: row.event_id,
          eventName: String(event?.event_name || row.event_id),
          eventDate: event?.event_date ? String(event.event_date).split("T")[0] : null,
          venue: event?.venue || null,
          city: event?.city || null,
          state: event?.state || null,
          userId: row.user_id,
          workerName: getName(row.user_id),
          workerEmail: workerUser?.email ? String(workerUser.email) : null,
          workerRole: workerUser?.role ? String(workerUser.role) : null,
          requestedBy: row.requested_by,
          requesterName: getName(row.requested_by),
          requesterEmail: requesterUser?.email ? String(requesterUser.email) : null,
          requesterRole: row.requester_role,
          requestReason: row.request_reason,
          requestedChanges: row.requested_changes ?? null,
          status: row.status,
          reviewNotes: row.review_notes,
          reviewedBy: row.reviewed_by,
          reviewerName: getName(row.reviewed_by),
          reviewerEmail: reviewerUser?.email ? String(reviewerUser.email) : null,
          reviewedAt: row.reviewed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      }),
    });
  } catch (err: any) {
    console.error("[timesheet-edit-requests:GET] error:", err);
    return NextResponse.json({ error: err?.message || "Unhandled error." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const eventId = String(body?.eventId || "").trim();
    const targetUserId = String(body?.targetUserId || "").trim();
    const requestReason = String(body?.requestReason || "").trim();

    if (!eventId || !targetUserId || !requestReason) {
      return NextResponse.json({ error: "Event, worker, and request reason are required." }, { status: 400 });
    }
    if (requestReason.length > TIMESHEET_EDIT_REASON_MAX_LENGTH) {
      return NextResponse.json(
        { error: `The request reason must be ${TIMESHEET_EDIT_REASON_MAX_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }

    const parsedProposal = parseTimesheetEditProposal(body?.requestedChanges);
    if (!parsedProposal.ok) {
      return NextResponse.json({ error: parsedProposal.error }, { status: 400 });
    }
    const proposal = parsedProposal.value;

    const requester = await loadUserSummary(user.id);
    if (user.id !== targetUserId && !isTimesheetEditReviewer(requester.role)) {
      return NextResponse.json(
        { error: "You do not have permission to request edits for this timesheet." },
        { status: 403 }
      );
    }

    const [targetUser, eventRow] = await Promise.all([
      targetUserId === requester.id ? requester : loadUserSummary(targetUserId),
      supabaseAdmin
        .from("events")
        .select("id, event_name, event_date")
        .eq("id", eventId)
        .maybeSingle(),
    ]);

    if (eventRow.error) {
      return NextResponse.json({ error: eventRow.error.message }, { status: 500 });
    }
    if (!eventRow.data?.id) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }

    const timesheetStatus = await loadTimesheetStatus(targetUserId, eventId);
    if (timesheetStatus === "not_submitted") {
      return NextResponse.json(
        { error: "An edit request can only be submitted after the timesheet has been attested." },
        { status: 400 }
      );
    }

    const { data: existingRequest, error: existingRequestError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .select("id, status, request_reason, created_at")
      .eq("event_id", eventId)
      .eq("user_id", targetUserId)
      // An approved, unused permission also blocks a duplicate request.
      .in("status", [...ACTIVE_TIMESHEET_EDIT_STATUSES])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRequestError) {
      return NextResponse.json({ error: existingRequestError.message }, { status: 500 });
    }

    if (existingRequest?.id) {
      return NextResponse.json({
        ok: true,
        request: {
          id: existingRequest.id,
          status: existingRequest.status,
          requestReason: existingRequest.request_reason,
          createdAt: existingRequest.created_at,
        },
        deduped: true,
      });
    }

    const { data: insertedRequest, error: insertError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .insert({
        event_id: eventId,
        user_id: targetUserId,
        requested_by: requester.id,
        requester_role: requester.role,
        request_reason: requestReason,
        requested_changes: proposal,
        status: "submitted",
      })
      .select("id, status, request_reason, created_at")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const eventName = String(eventRow.data.event_name || "Unnamed Event");
    const eventDate = eventRow.data.event_date ? String(eventRow.data.event_date).split("T")[0] : null;
    const reviewUrl = `https://pds-murex.vercel.app/timesheet-edit-requests?requestId=${insertedRequest.id}`;
    const subject = `Timesheet Edit Request - ${targetUser.name} - ${eventName}`;
    const statusLabel = timesheetStatus === "submitted" ? "Attested" : "Rejected";
    const submittedAt = new Date(insertedRequest.created_at).toLocaleString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:32px 0;background:#f5f5f5;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="640" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 32px;color:#ffffff;">
              <h1 style="margin:0;font-size:24px;">Timesheet Edit Request</h1>
              <p style="margin:10px 0 0 0;font-size:14px;color:#cbd5e1;">A previously ${statusLabel.toLowerCase()} timesheet needs review.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Worker</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">${targetUser.name}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Worker Email</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">${targetUser.email || "-"}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Event</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">${eventName}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Event Date</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">${eventDate || "-"}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Current Status</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">${statusLabel}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Requested By</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">${requester.name} (${requester.role})</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Requested At</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">${submittedAt}</td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <div style="margin-top:24px;">
                <p style="margin:0 0 8px 0;color:#334155;font-size:14px;font-weight:700;">Reason</p>
                <div style="border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;padding:16px;color:#0f172a;font-size:14px;line-height:1.6;">
                  ${requestReason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")}
                </div>
              </div>
              ${renderProposalEmailHtml(proposal)}
              <div style="margin-top:28px;text-align:center;">
                <a href="${reviewUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-size:14px;font-weight:700;">Open Event Dashboard</a>
                <p style="margin:12px 0 0 0;color:#64748b;font-size:12px;">${reviewUrl}</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

    let roomManagerEmails: string[] = [];
    try {
      roomManagerEmails = await loadRoomManagerEmails(targetUser.id);
    } catch (managerLookupError: any) {
      console.error(
        "[timesheet-edit-requests] failed to load room manager recipients:",
        managerLookupError?.message || managerLookupError
      );
    }

    const notificationRecipients = dedupeEmails([
      ...TIMESHEET_EDIT_REQUEST_NOTIFICATION_RECIPIENTS,
      ...roomManagerEmails,
    ]);

    const emailResult = await sendEmail({
      to: notificationRecipients,
      subject,
      html,
    });

    if (!emailResult.success) {
      console.error("[timesheet-edit-requests] failed to send notification email:", emailResult.error);
    }

    return NextResponse.json({
      ok: true,
      request: {
        id: insertedRequest.id,
        status: insertedRequest.status,
        requestReason: insertedRequest.request_reason,
        createdAt: insertedRequest.created_at,
      },
      emailed: emailResult.success,
    });
  } catch (err: any) {
    console.error("[timesheet-edit-requests] error:", err);
    return NextResponse.json({ error: err?.message || "Unhandled error." }, { status: 500 });
  }
}

type RequestToApprove = {
  id: string;
  status: string;
  user_id: string;
  event_id: string;
  request_reason: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

// Approving a request that carries times changes the timesheet to those times.
// The request goes straight to completed, since the correction is made here and
// the worker is not asked to make it again.
async function approveAndApply(args: {
  request: RequestToApprove;
  proposal: TimesheetEditProposal;
  reviewer: { id: string; role: string };
  reviewNotes: string;
}) {
  const { request, proposal, reviewer, reviewNotes } = args;
  // Applying a request that was already approved keeps the note it was approved with.
  const extraNote = reviewNotes || (request.status === "approved" ? request.review_notes || "" : "");
  const approvedNote = extraNote
    ? `Approved and applied to the timesheet. ${extraNote}`
    : "Approved and applied to the timesheet.";

  // Take the request first, so a second reviewer cannot act on it while the
  // times are being applied.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("timesheet_edit_requests")
    .update({
      status: "completed",
      review_notes: approvedNote,
      reviewed_by: reviewer.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .eq("status", request.status)
    .select("id, status, review_notes, reviewed_at, reviewed_by, updated_at")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimed?.id) {
    return NextResponse.json(
      { error: "This request was just updated by someone else. Refresh and try again." },
      { status: 409 }
    );
  }

  const applied = await applyTimesheetProposal({
    db: supabaseAdmin,
    eventId: request.event_id,
    userId: request.user_id,
    proposal,
    actor: { role: reviewer.role },
    requestId: request.id,
    reason: request.request_reason,
  });

  if (!applied.ok) {
    // Put the request back as it was so it can be reviewed again.
    const { error: revertError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .update({
        status: request.status,
        review_notes: request.review_notes,
        reviewed_by: request.reviewed_by,
        reviewed_at: request.reviewed_at,
      })
      .eq("id", request.id)
      .eq("status", "completed");
    if (revertError) {
      console.error("[timesheet-edit-requests] could not restore request after a failed apply:", revertError.message);
    }
    return NextResponse.json(
      {
        error: `Could not apply the requested times. ${applied.error}${
          revertError ? " The request may show as completed even though the timesheet was not changed." : " The request was not approved."
        }`,
      },
      { status: applied.status }
    );
  }

  return NextResponse.json({
    ok: true,
    applied: { updated: applied.updated, inserted: applied.inserted, deleted: applied.deleted },
    request: {
      id: claimed.id,
      status: claimed.status,
      reviewNotes: claimed.review_notes,
      reviewedAt: claimed.reviewed_at,
      reviewedBy: claimed.reviewed_by,
      updatedAt: claimed.updated_at,
    },
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAuthedViewer(req);
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => null);
    const requestId = String(body?.requestId || "").trim();
    const nextStatus = String(body?.status || "").trim().toLowerCase();
    const reviewNotes = String(body?.reviewNotes || "").trim();

    if (!requestId || !nextStatus) {
      return NextResponse.json({ error: "requestId and status are required." }, { status: 400 });
    }

    const allowedStatuses = new Set(["in_review", "approved", "rejected", "cancelled", "completed"]);
    if (!allowedStatuses.has(nextStatus)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    if (reviewNotes.length > TIMESHEET_EDIT_REASON_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Review notes must be ${TIMESHEET_EDIT_REASON_MAX_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }

    const { data: existingRequest, error: loadError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .select(
        "id, status, user_id, requested_by, event_id, request_reason, requested_changes, review_notes, reviewed_by, reviewed_at"
      )
      .eq("id", requestId)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 });
    }
    if (!existingRequest?.id) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    // Reviewers can take any allowed step. The person who filed the request, or
    // the worker it is for, can only withdraw it while it is still waiting.
    const isParty =
      existingRequest.requested_by === auth.user.id || existingRequest.user_id === auth.user.id;
    const isWithdrawal = nextStatus === "cancelled" && canRequesterWithdraw(existingRequest.status);
    if (!auth.canReview && !(isParty && isWithdrawal)) {
      return NextResponse.json(
        { error: "You do not have permission to review timesheet edit requests." },
        { status: 403 }
      );
    }

    if (!canTransitionTimesheetEditRequest(existingRequest.status, nextStatus)) {
      return NextResponse.json(
        { error: `A ${existingRequest.status} request cannot be changed to ${nextStatus}.` },
        { status: 409 }
      );
    }

    // Approving a request that carries times applies them to the timesheet. So does
    // completing a request that was approved earlier, before its times were applied.
    const appliesTimes =
      nextStatus === "approved" || (nextStatus === "completed" && existingRequest.status === "approved");
    if (appliesTimes && auth.canReview) {
      const stored = parseTimesheetEditProposal(existingRequest.requested_changes);
      if (!stored.ok) {
        return NextResponse.json(
          {
            error:
              "The times saved with this request are not valid, so they cannot be applied. Reject it and ask for a new request.",
          },
          { status: 409 }
        );
      }
      if (stored.value) {
        return approveAndApply({
          request: existingRequest as RequestToApprove,
          proposal: stored.value,
          reviewer: { id: auth.user.id, role: auth.requester.role },
          reviewNotes,
        });
      }
    }

    const withdrawnByRequester = !auth.canReview;
    const payload: Record<string, unknown> = withdrawnByRequester
      ? {
          status: nextStatus,
          review_notes: reviewNotes || "Withdrawn by the requester.",
        }
      : {
          status: nextStatus,
          review_notes: reviewNotes || null,
          reviewed_by: auth.user.id,
          reviewed_at: new Date().toISOString(),
        };

    // Only update while the request is still in the status we validated, so two
    // reviewers acting at the same time cannot overwrite each other.
    const { data: updatedRequest, error: updateError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .update(payload)
      .eq("id", requestId)
      .eq("status", existingRequest.status)
      .select("id, status, review_notes, reviewed_at, reviewed_by, updated_at")
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if (!updatedRequest?.id) {
      return NextResponse.json(
        { error: "This request was just updated by someone else. Refresh and try again." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      request: {
        id: updatedRequest.id,
        status: updatedRequest.status,
        reviewNotes: updatedRequest.review_notes,
        reviewedAt: updatedRequest.reviewed_at,
        reviewedBy: updatedRequest.reviewed_by,
        updatedAt: updatedRequest.updated_at,
      },
    });
  } catch (err: any) {
    console.error("[timesheet-edit-requests:PATCH] error:", err);
    return NextResponse.json({ error: err?.message || "Unhandled error." }, { status: 500 });
  }
}
