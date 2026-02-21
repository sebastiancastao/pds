import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ATTESTATION_TIME_MATCH_WINDOW_MS = 15 * 60 * 1000;

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2"]);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }

  return null;
}

function isMissingRelationError(error: any): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "");
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; memberId: string } }
) {
  try {
    const eventId = String(params?.id || "").trim();
    const memberId = String(params?.memberId || "").trim();

    if (!eventId || !memberId) {
      return NextResponse.json({ error: "Event ID and member ID are required" }, { status: 400 });
    }

    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, created_by")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const isCreator = event.created_by === user.id;
    if (!isCreator) {
      const { data: requester, error: requesterError } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (requesterError) {
        return NextResponse.json({ error: requesterError.message }, { status: 500 });
      }

      const role = String(requester?.role || "").toLowerCase().trim();
      if (!MANAGE_ROLES.has(role)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const { data: teamMember, error: teamMemberError } = await supabaseAdmin
      .from("event_teams")
      .select("id, vendor_id, status")
      .eq("id", memberId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (teamMemberError) {
      return NextResponse.json({ error: teamMemberError.message }, { status: 500 });
    }
    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found for this event" }, { status: 404 });
    }

    const vendorId = String(teamMember.vendor_id || "").trim();
    if (vendorId) {
      let clockOutRows: any[] | null = null;
      let clockOutError: any = null;
      const clockOutWithAttestationResult = await supabaseAdmin
        .from("time_entries")
        .select("id, timestamp, attestation_accepted")
        .eq("event_id", eventId)
        .eq("user_id", vendorId)
        .eq("action", "clock_out");

      if (
        clockOutWithAttestationResult.error &&
        String((clockOutWithAttestationResult.error as any)?.code || "").trim() === "42703"
      ) {
        const fallbackClockOutResult = await supabaseAdmin
          .from("time_entries")
          .select("id, timestamp")
          .eq("event_id", eventId)
          .eq("user_id", vendorId)
          .eq("action", "clock_out");
        clockOutRows = fallbackClockOutResult.data || null;
        clockOutError = fallbackClockOutResult.error || null;
      } else {
        clockOutRows = clockOutWithAttestationResult.data || null;
        clockOutError = clockOutWithAttestationResult.error || null;
      }

      if (clockOutError) {
        return NextResponse.json({ error: clockOutError.message }, { status: 500 });
      }

      const normalizedClockOutRows = (clockOutRows || [])
        .map((row: any) => {
          const entryId = String(row?.id || "").trim();
          const parsedMs = Date.parse(String(row?.timestamp || ""));
          const rawAttestationAccepted = row?.attestation_accepted;
          const attestationAccepted =
            typeof rawAttestationAccepted === "boolean" ? rawAttestationAccepted : null;
          return {
            formId: entryId ? `clock-out-${entryId}` : "",
            timestampMs: Number.isNaN(parsedMs) ? null : parsedMs,
            attestationAccepted,
          };
        })
        .filter((row) => row.formId.length > 0);

      const attestationEligibleClockOutRows = normalizedClockOutRows.filter(
        (row) => row.attestationAccepted !== false
      );

      if (attestationEligibleClockOutRows.length > 0) {
        let attestationQuery = supabaseAdmin
          .from("form_signatures")
          .select("id, form_id, signed_at")
          .eq("form_type", "clock_out_attestation")
          .eq("user_id", vendorId);

        const validClockOutMs = attestationEligibleClockOutRows
          .map((row) => row.timestampMs)
          .filter((value): value is number => typeof value === "number");
        if (validClockOutMs.length > 0) {
          const minMs = Math.min(...validClockOutMs) - ATTESTATION_TIME_MATCH_WINDOW_MS;
          const maxMs = Math.max(...validClockOutMs) + ATTESTATION_TIME_MATCH_WINDOW_MS;
          attestationQuery = attestationQuery
            .gte("signed_at", new Date(minMs).toISOString())
            .lte("signed_at", new Date(maxMs).toISOString());
        }

        const { data: attestationRows, error: attestationError } = await attestationQuery;

        if (attestationError) {
          return NextResponse.json({ error: attestationError.message }, { status: 500 });
        }

        const hasAttestationForEvent = (attestationRows || []).some((row: any) => {
          const formId = String(row?.form_id || "").trim();
          const signedAtMs = Date.parse(String(row?.signed_at || ""));
          const directFormMatch = attestationEligibleClockOutRows.some((clockOut) => clockOut.formId === formId);
          const timeMatch =
            !Number.isNaN(signedAtMs) &&
            attestationEligibleClockOutRows.some(
              (clockOut) =>
                clockOut.timestampMs !== null &&
                Math.abs(clockOut.timestampMs - signedAtMs) <= ATTESTATION_TIME_MATCH_WINDOW_MS
            );
          return directFormMatch || timeMatch;
        });

        if (hasAttestationForEvent) {
          return NextResponse.json(
            {
              error:
                "Cannot uninvite this team member because they already have a clock-out attestation for this event.",
            },
            { status: 409 }
          );
        }
      }
    }

    const { error: assignmentDeleteError } = await supabaseAdmin
      .from("event_location_assignments")
      .delete()
      .eq("event_id", eventId)
      .eq("vendor_id", teamMember.vendor_id);

    if (assignmentDeleteError && !isMissingRelationError(assignmentDeleteError)) {
      return NextResponse.json({ error: assignmentDeleteError.message }, { status: 500 });
    }

    const { data: deletedRows, error: deleteError } = await supabaseAdmin
      .from("event_teams")
      .delete()
      .eq("id", teamMember.id)
      .eq("event_id", eventId)
      .select("id");

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: "Team member was not removed" }, { status: 404 });
    }

    const uninviteMetadata = {
      event_id: eventId,
      team_member_id: teamMember.id,
      vendor_id: teamMember.vendor_id,
      previous_status: teamMember.status || null,
      uninvited_by_user_id: user.id,
    };

    const { error: uninviteHistoryError } = await supabaseAdmin
      .from("event_team_uninvites")
      .insert({
        event_id: eventId,
        team_member_id: teamMember.id,
        vendor_id: teamMember.vendor_id,
        previous_status: teamMember.status || null,
        uninvited_by: user.id,
        metadata: uninviteMetadata,
      });

    if (uninviteHistoryError && !isMissingRelationError(uninviteHistoryError)) {
      console.error("Failed to persist team uninvite history:", uninviteHistoryError);
    }

    const { error: auditError } = await supabaseAdmin
      .from("audit_logs")
      .insert({
        user_id: user.id,
        action: "team_member_uninvited",
        resource_type: "event",
        resource_id: eventId,
        metadata: uninviteMetadata,
      });

    if (auditError) {
      console.error("Failed to log team uninvite audit event:", auditError);
    }

    return NextResponse.json({
      success: true,
      message: "Team member uninvited successfully",
      memberId: teamMember.id,
      vendorId: teamMember.vendor_id,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to uninvite team member" },
      { status: 500 }
    );
  }
}
