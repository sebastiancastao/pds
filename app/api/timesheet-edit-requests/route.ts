import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const PRIVILEGED_ROLES = new Set([
  "admin",
  "exec",
  "hr",
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
]);

const OPEN_REQUEST_STATUSES = ["submitted", "in_review"] as const;
const ATTESTATION_TIME_MATCH_WINDOW_MS = 15 * 60 * 1000;
const TIMESHEET_EDIT_REQUEST_NOTIFICATION_RECIPIENTS = [
  "portal@1pds.net",
  "sebastiancastao379@gmail.com",
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

async function requirePrivilegedRequester(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const requester = await loadUserSummary(user.id);
  if (!PRIVILEGED_ROLES.has(requester.role)) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to review timesheet edit requests." },
        { status: 403 }
      ),
    };
  }

  return { user, requester };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePrivilegedRequester(req);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const statusFilter = String(searchParams.get("status") || "open").trim().toLowerCase();
    const requestId = String(searchParams.get("requestId") || "").trim();
    const limitRaw = Number(searchParams.get("limit") || "200");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 500) : 200;

    let query = supabaseAdmin
      .from("timesheet_edit_requests")
      .select(
        "id, event_id, user_id, requested_by, requester_role, request_reason, status, review_notes, reviewed_by, reviewed_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (requestId) {
      query = query.eq("id", requestId);
    }

    if (statusFilter === "open") {
      query = query.in("status", ["submitted", "in_review"]);
    } else if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []) as EditRequestRow[];
    if (rows.length === 0) {
      return NextResponse.json({ requests: [] });
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

    const requester = await loadUserSummary(user.id);
    if (user.id !== targetUserId && !PRIVILEGED_ROLES.has(requester.role)) {
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
      .in("status", [...OPEN_REQUEST_STATUSES])
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

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePrivilegedRequester(req);
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

    const { data: existingRequest, error: loadError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .select("id, status")
      .eq("id", requestId)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 500 });
    }
    if (!existingRequest?.id) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const payload: Record<string, unknown> = {
      status: nextStatus,
      review_notes: reviewNotes || null,
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
    };

    const { data: updatedRequest, error: updateError } = await supabaseAdmin
      .from("timesheet_edit_requests")
      .update(payload)
      .eq("id", requestId)
      .select("id, status, review_notes, reviewed_at, reviewed_by, updated_at")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
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
