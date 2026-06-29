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

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2", "supervisor3"]);

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

function isMissingColumnError(error: any, columnName?: string): boolean {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "");
  if (code !== "42703" && !/column .* does not exist/i.test(message)) {
    return false;
  }
  return columnName ? message.toLowerCase().includes(columnName.toLowerCase()) : true;
}

function normalizeEventTeamRole(value: unknown): "staff" | "manager" | "supervisor" | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "staff" || normalized === "manager" || normalized === "supervisor") {
    return normalized;
  }
  return null;
}

async function persistTipsEligibility(params: {
  eventId: string;
  vendorId: string;
  actingUserId: string;
  tipsEligible: boolean;
}) {
  const { eventId, vendorId, actingUserId, tipsEligible } = params;

  const { data: existingVendorPayment, error: existingVendorPaymentError } = await supabaseAdmin
    .from("event_vendor_payments")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", vendorId)
    .maybeSingle();

  if (existingVendorPaymentError) {
    throw new Error(existingVendorPaymentError.message);
  }

  const timestamp = new Date().toISOString();

  if (tipsEligible) {
    if (!existingVendorPayment?.id) {
      return { persisted: false };
    }

    const { error: updateError } = await supabaseAdmin
      .from("event_vendor_payments")
      .update({
        tips_deleted: false,
        tips_override: null,
        updated_at: timestamp,
      })
      .eq("id", existingVendorPayment.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { persisted: true };
  }

  let eventPaymentId: string | null = null;
  const { data: existingEventPayment, error: existingEventPaymentError } = await supabaseAdmin
    .from("event_payments")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();

  if (existingEventPaymentError) {
    throw new Error(existingEventPaymentError.message);
  }

  if (existingEventPayment?.id) {
    eventPaymentId = String(existingEventPayment.id);
  } else {
    const { data: insertedEventPayment, error: insertEventPaymentError } = await supabaseAdmin
      .from("event_payments")
      .insert({
        event_id: eventId,
        created_by: actingUserId,
        updated_at: timestamp,
      })
      .select("id")
      .single();

    if (insertEventPaymentError) {
      throw new Error(insertEventPaymentError.message);
    }

    eventPaymentId = String(insertedEventPayment?.id || "");
  }

  if (!eventPaymentId) {
    throw new Error("Failed to create event payment summary");
  }

  if (existingVendorPayment?.id) {
    const { error: updateError } = await supabaseAdmin
      .from("event_vendor_payments")
      .update({
        tips_deleted: true,
        tips_override: null,
        updated_at: timestamp,
      })
      .eq("id", existingVendorPayment.id);

    if (updateError) {
      throw new Error(updateError.message);
    }
  } else {
    const { error: insertVendorPaymentError } = await supabaseAdmin
      .from("event_vendor_payments")
      .insert({
        event_payment_id: eventPaymentId,
        event_id: eventId,
        user_id: vendorId,
        tips_override: null,
        tips_deleted: true,
        updated_at: timestamp,
      });

    if (insertVendorPaymentError) {
      throw new Error(insertVendorPaymentError.message);
    }
  }

  return { persisted: true };
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
      .select("id, vendor_id, status, created_at")
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
      // Snapshot the original invite time so reports can show when this member
      // was invited even after the event_teams row is deleted.
      invited_at: (teamMember as any).created_at || null,
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

export async function PATCH(
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

    const body = await req.json().catch(() => ({}));
    const hasEventRoleInput = Object.prototype.hasOwnProperty.call(body, "eventRole");
    const hasTipsEligibleInput = Object.prototype.hasOwnProperty.call(body, "tipsEligible");
    const hasStandLeaderInput = Object.prototype.hasOwnProperty.call(body, "standLeader");
    const requestedEventRole = hasEventRoleInput ? normalizeEventTeamRole(body?.eventRole) : null;
    const tipsEligible = body?.tipsEligible;
    const standLeader = body?.standLeader;

    if (!hasEventRoleInput && !hasTipsEligibleInput && !hasStandLeaderInput) {
      return NextResponse.json(
        { error: "At least one of eventRole, tipsEligible, or standLeader must be provided" },
        { status: 400 }
      );
    }

    if (hasEventRoleInput && !requestedEventRole) {
      return NextResponse.json(
        { error: "eventRole must be one of: staff, manager, supervisor" },
        { status: 400 }
      );
    }

    if (hasTipsEligibleInput && typeof tipsEligible !== "boolean") {
      return NextResponse.json({ error: "tipsEligible must be a boolean" }, { status: 400 });
    }

    if (hasStandLeaderInput && typeof standLeader !== "boolean") {
      return NextResponse.json({ error: "standLeader must be a boolean" }, { status: 400 });
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

    let teamMember: any = null;
    let teamMemberError: any = null;
    let eventRoleColumnAvailable = true;

    const teamMemberWithRoleResult = await supabaseAdmin
      .from("event_teams")
      .select("id, vendor_id, event_role")
      .eq("id", memberId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (teamMemberWithRoleResult.error && isMissingColumnError(teamMemberWithRoleResult.error, "event_role")) {
      eventRoleColumnAvailable = false;
      if (hasEventRoleInput) {
        return NextResponse.json(
          { error: "Database migration required before event-specific team roles can be updated." },
          { status: 409 }
        );
      }

      const legacyTeamMemberResult = await supabaseAdmin
        .from("event_teams")
        .select("id, vendor_id")
        .eq("id", memberId)
        .eq("event_id", eventId)
        .maybeSingle();

      teamMember = legacyTeamMemberResult.data || null;
      teamMemberError = legacyTeamMemberResult.error || null;
    } else {
      teamMember = teamMemberWithRoleResult.data || null;
      teamMemberError = teamMemberWithRoleResult.error || null;
    }

    if (teamMemberError) {
      return NextResponse.json({ error: teamMemberError.message }, { status: 500 });
    }
    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found for this event" }, { status: 404 });
    }

    const vendorId = String(teamMember.vendor_id || "").trim();
    if (!vendorId) {
      return NextResponse.json({ error: "Team member is missing a vendor ID" }, { status: 400 });
    }

    let resolvedEventRole = eventRoleColumnAvailable
      ? normalizeEventTeamRole(teamMember?.event_role) || "staff"
      : "staff";

    if (hasEventRoleInput && requestedEventRole && requestedEventRole !== resolvedEventRole) {
      const { error: updateRoleError } = await supabaseAdmin
        .from("event_teams")
        .update({
          event_role: requestedEventRole,
          updated_at: new Date().toISOString(),
        })
        .eq("id", memberId)
        .eq("event_id", eventId);

      if (updateRoleError) {
        if (isMissingColumnError(updateRoleError, "event_role")) {
          return NextResponse.json(
            { error: "Database migration required before event-specific team roles can be updated." },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: updateRoleError.message }, { status: 500 });
      }

      resolvedEventRole = requestedEventRole;
    }

    let standLeaderPersisted = false;
    let resolvedStandLeader: boolean | null = null;

    if (hasStandLeaderInput) {
      const { error: updateStandLeaderError } = await supabaseAdmin
        .from("event_teams")
        .update({
          stand_leader: standLeader,
          updated_at: new Date().toISOString(),
        })
        .eq("id", memberId)
        .eq("event_id", eventId);

      if (updateStandLeaderError) {
        if (isMissingColumnError(updateStandLeaderError, "stand_leader")) {
          return NextResponse.json(
            { error: "Database migration required before stand leaders can be assigned." },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: updateStandLeaderError.message }, { status: 500 });
      }

      standLeaderPersisted = true;
      resolvedStandLeader = standLeader;
    }

    let tipsPersisted = false;

    if (hasTipsEligibleInput) {
      if (resolvedEventRole !== "manager" && resolvedEventRole !== "supervisor") {
        return NextResponse.json(
          { error: "tipsEligible can only be set for event managers or supervisors." },
          { status: 400 }
        );
      }

      const result = await persistTipsEligibility({
        eventId,
        vendorId,
        actingUserId: user.id,
        tipsEligible,
      });
      tipsPersisted = result.persisted;
    } else if (hasEventRoleInput && resolvedEventRole === "staff") {
      const result = await persistTipsEligibility({
        eventId,
        vendorId,
        actingUserId: user.id,
        tipsEligible: true,
      });
      tipsPersisted = result.persisted;
    }

    return NextResponse.json({
      success: true,
      eventRole: resolvedEventRole,
      tipsEligible:
        resolvedEventRole === "manager" || resolvedEventRole === "supervisor"
          ? hasTipsEligibleInput
            ? tipsEligible
            : null
          : true,
      standLeader: resolvedStandLeader,
      persisted: tipsPersisted || standLeaderPersisted,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to update team member settings" },
      { status: 500 }
    );
  }
}
