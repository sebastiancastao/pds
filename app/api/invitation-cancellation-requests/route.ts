// app/api/invitation-cancellation-requests/route.ts
//
// Employee-initiated requests (filed from /employees/[id]) to cancel an
// already-responded (confirmed/declined) event invitation. A request only
// takes effect — removing the underlying event_teams / event_location_assignments
// row — once a privileged reviewer approves it via PATCH.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

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

const ALREADY_RESPONDED_STATUSES = new Set(["confirmed", "declined"]);

// Joins events() so the requester's profile can still show the event name/date
// after approval deletes the underlying event_teams / event_location_assignments row.
const REQUEST_COLUMNS =
  "id, user_id, event_id, source, team_member_id, location_assignment_id, previous_status, reason, status, requested_by, reviewed_by, reviewed_at, review_notes, created_at, updated_at, events (event_name, event_date, venue, city, state)";

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

async function getCallerRole(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return String(data?.role || "").trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const callerRole = await getCallerRole(user.id);
    const isPrivileged = PRIVILEGED_ROLES.has(callerRole);
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
      return NextResponse.json({ requests: data || [], canReview: true });
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

    return NextResponse.json({ requests: data || [], canReview: isPrivileged });
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

    const callerRole = await getCallerRole(user.id);
    const isPrivileged = PRIVILEGED_ROLES.has(callerRole);
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

    const { data: inserted, error: insertError } = await supabaseAdmin
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

    return NextResponse.json({ success: true, request: inserted }, { status: 201 });
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

    const callerRole = await getCallerRole(user.id);
    if (!PRIVILEGED_ROLES.has(callerRole)) {
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

    const { data: cancellationRequest, error: fetchError } = await supabaseAdmin
      .from("invitation_cancellation_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", requestId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!cancellationRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
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

    return NextResponse.json({ success: true, request: updated });
  } catch (err: any) {
    console.error("[INVITATION CANCELLATION REQUESTS][PATCH] error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
