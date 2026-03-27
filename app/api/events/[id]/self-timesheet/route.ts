import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createHash } from "crypto";
import { safeDecrypt } from "@/lib/encryption";
import {
  formatIsoToHHMM,
  getLocalDateRange,
  getTimezoneForState,
  toZonedIso,
} from "@/lib/timezones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTESTATION_TIME_MATCH_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_RESPONSE_ENTRY_PROCESSING_MS = 30 * 60 * 1000;
const ALLOWED_ROLES = new Set([
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
  "exec",
]);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type EventRow = {
  id: string;
  event_name: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  event_type: string | null;
};

type TimesheetSpanPayload = {
  firstIn?: string;
  lastOut?: string;
  firstMealStart?: string;
  lastMealEnd?: string;
  secondMealStart?: string;
  secondMealEnd?: string;
};

type TimeEntryRow = {
  id: string;
  action: string;
  timestamp: string;
  event_id: string | null;
  attestation_accepted?: boolean | null;
};

type TimelineRow = {
  action: string;
  timestamp: string;
};

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeEventDate(dateValue?: string | null) {
  if (!dateValue) return null;
  return String(dateValue).split("T")[0];
}

function buildTimeline(
  eventDate: string,
  eventTimezone: string,
  spans: TimesheetSpanPayload
): { timeline: TimelineRow[]; error?: string } {
  const meal1Start = String(spans.firstMealStart || "").trim();
  const meal1End = String(spans.lastMealEnd || "").trim();
  const meal2Start = String(spans.secondMealStart || "").trim();
  const meal2End = String(spans.secondMealEnd || "").trim();

  if (!!meal1Start !== !!meal1End) {
    return { timeline: [], error: "Meal 1 requires both a start and end time." };
  }
  if (!!meal2Start !== !!meal2End) {
    return { timeline: [], error: "Meal 2 requires both a start and end time." };
  }

  const timeline: TimelineRow[] = [
    { action: "clock_in", timestamp: toZonedIso(eventDate, spans.firstIn, eventTimezone) || "" },
    ...(meal1Start && meal1End
      ? [
          { action: "meal_start", timestamp: toZonedIso(eventDate, meal1Start, eventTimezone) || "" },
          { action: "meal_end", timestamp: toZonedIso(eventDate, meal1End, eventTimezone) || "" },
        ]
      : []),
    ...(meal2Start && meal2End
      ? [
          { action: "meal_start", timestamp: toZonedIso(eventDate, meal2Start, eventTimezone) || "" },
          { action: "meal_end", timestamp: toZonedIso(eventDate, meal2End, eventTimezone) || "" },
        ]
      : []),
    { action: "clock_out", timestamp: toZonedIso(eventDate, spans.lastOut, eventTimezone) || "" },
  ].filter((row) => !!row.timestamp);

  if (timeline.length < 2) {
    return { timeline: [], error: "Clock in and clock out times are required." };
  }

  for (let i = 1; i < timeline.length; i++) {
    const prevMs = new Date(timeline[i - 1].timestamp).getTime();
    const currMs = new Date(timeline[i].timestamp).getTime();
    if (!Number.isFinite(prevMs) || !Number.isFinite(currMs)) {
      return { timeline: [], error: "One or more time values are invalid." };
    }
    if (currMs <= prevMs) {
      timeline[i].timestamp = new Date(currMs + 24 * 60 * 60 * 1000).toISOString();
    }
  }

  for (let i = 1; i < timeline.length; i++) {
    const prevMs = new Date(timeline[i - 1].timestamp).getTime();
    const currMs = new Date(timeline[i].timestamp).getTime();
    if (!(currMs > prevMs)) {
      return { timeline: [], error: "Times must be strictly increasing." };
    }
  }

  return { timeline };
}

function buildSnapshot(
  entries: TimeEntryRow[],
  eventTimezone: string,
  attestationStatus: "submitted" | "rejected" | "not_submitted",
  attestationSignedAt: string | null,
  rejectionReason: string | null
) {
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const clockIns = sortedEntries.filter((entry) => entry.action === "clock_in");
  const clockOuts = sortedEntries.filter((entry) => entry.action === "clock_out");
  const mealStarts = sortedEntries.filter((entry) => entry.action === "meal_start");
  const mealEnds = sortedEntries.filter((entry) => entry.action === "meal_end");

  let grossWorkedMs = 0;
  let openClockInMs: number | null = null;
  for (const entry of sortedEntries) {
    const entryMs = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(entryMs)) continue;
    if (entry.action === "clock_in") {
      if (openClockInMs === null) openClockInMs = entryMs;
      continue;
    }
    if (entry.action === "clock_out" && openClockInMs !== null) {
      grossWorkedMs += Math.max(0, entryMs - openClockInMs);
      openClockInMs = null;
    }
  }

  let mealMs = 0;
  let openMealMs: number | null = null;
  for (const entry of sortedEntries) {
    const entryMs = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(entryMs)) continue;
    if (entry.action === "meal_start") {
      if (openMealMs === null) openMealMs = entryMs;
      continue;
    }
    if (entry.action === "meal_end" && openMealMs !== null) {
      mealMs += Math.max(0, entryMs - openMealMs);
      openMealMs = null;
    }
  }

  const totalMs = Math.max(0, grossWorkedMs - mealMs);
  const totalMsWithAdminResponse =
    totalMs > 0 ? totalMs + ADMIN_RESPONSE_ENTRY_PROCESSING_MS : 0;

  return {
    firstIn: clockIns[0]?.timestamp ?? null,
    lastOut: clockOuts[clockOuts.length - 1]?.timestamp ?? null,
    firstMealStart: mealStarts[0]?.timestamp ?? null,
    lastMealEnd: mealEnds[0]?.timestamp ?? null,
    secondMealStart: mealStarts[1]?.timestamp ?? null,
    secondMealEnd: mealEnds[1]?.timestamp ?? null,
    firstInDisplay: formatIsoToHHMM(clockIns[0]?.timestamp ?? null, eventTimezone),
    lastOutDisplay: formatIsoToHHMM(clockOuts[clockOuts.length - 1]?.timestamp ?? null, eventTimezone),
    firstMealStartDisplay: formatIsoToHHMM(mealStarts[0]?.timestamp ?? null, eventTimezone),
    lastMealEndDisplay: formatIsoToHHMM(mealEnds[0]?.timestamp ?? null, eventTimezone),
    secondMealStartDisplay: formatIsoToHHMM(mealStarts[1]?.timestamp ?? null, eventTimezone),
    secondMealEndDisplay: formatIsoToHHMM(mealEnds[1]?.timestamp ?? null, eventTimezone),
    mealMs,
    totalMs,
    totalMsWithAdminResponse,
    attestationStatus,
    attestationSignedAt,
    rejectionReason,
  };
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
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

async function loadRequester(userId: string) {
  const [{ data: userRow, error: userError }, { data: profileRow, error: profileError }] =
    await Promise.all([
      supabaseAdmin.from("users").select("role, email, division").eq("id", userId).maybeSingle(),
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

  const role = String(userRow?.role || "").trim().toLowerCase();
  const firstName = profileRow?.first_name ? safeDecrypt(String(profileRow.first_name)) : "";
  const lastName = profileRow?.last_name ? safeDecrypt(String(profileRow.last_name)) : "";
  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || userRow?.email || userId;

  return {
    role,
    email: String(userRow?.email || ""),
    division: String(userRow?.division || "vendor"),
    name,
  };
}

async function loadEvent(eventId: string): Promise<EventRow> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("id, event_name, event_date, start_time, end_time, venue, city, state, event_type")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Event not found.");
  }

  return data as EventRow;
}

async function loadCurrentEntries(userId: string, eventId: string, eventDate: string, eventTimezone: string) {
  const range = getLocalDateRange(eventDate, eventTimezone, 2);
  if (!range) {
    throw new Error("Invalid event date or timezone.");
  }

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .select("id, action, timestamp, event_id, attestation_accepted")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .gte("timestamp", range.startIso)
    .lt("timestamp", range.endExclusiveIso)
    .order("timestamp", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return { entries: (data || []) as TimeEntryRow[], range };
}

async function loadAttestationState(userId: string, entries: TimeEntryRow[]) {
  const clockOutEntries = entries
    .filter((entry) => entry.action === "clock_out")
    .map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      timestampMs: new Date(entry.timestamp).getTime(),
      formId: `clock-out-${entry.id}`,
      attestationAccepted:
        typeof entry.attestation_accepted === "boolean" ? entry.attestation_accepted : null,
    }))
    .filter((entry) => Number.isFinite(entry.timestampMs));

  const latestClockOut = [...clockOutEntries]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .find(Boolean);

  if (!latestClockOut) {
    return {
      attestationStatus: "not_submitted" as const,
      attestationSignedAt: null,
      rejectionReason: null,
    };
  }

  if (latestClockOut.attestationAccepted === false) {
    const { data: rejectionRow } = await supabaseAdmin
      .from("attestation_rejections")
      .select("rejection_reason")
      .eq("time_entry_id", latestClockOut.id)
      .limit(1)
      .maybeSingle();

    return {
      attestationStatus: "rejected" as const,
      attestationSignedAt: latestClockOut.timestamp,
      rejectionReason: String(rejectionRow?.rejection_reason || "").trim() || null,
    };
  }

  const minMs = Math.min(...clockOutEntries.map((entry) => entry.timestampMs)) - ATTESTATION_TIME_MATCH_WINDOW_MS;
  const maxMs = Math.max(...clockOutEntries.map((entry) => entry.timestampMs)) + ATTESTATION_TIME_MATCH_WINDOW_MS;

  const { data: attestationRows, error: attestationError } = await supabaseAdmin
    .from("form_signatures")
    .select("form_id, signed_at")
    .eq("form_type", "clock_out_attestation")
    .eq("user_id", userId)
    .gte("signed_at", new Date(minMs).toISOString())
    .lte("signed_at", new Date(maxMs).toISOString())
    .order("signed_at", { ascending: false })
    .limit(25);

  if (attestationError) {
    throw new Error(attestationError.message);
  }

  const matchedAttestation =
    (attestationRows || []).find((row: any) => {
      const formId = String(row?.form_id || "").trim();
      const signedAtMs = Date.parse(String(row?.signed_at || ""));
      const directFormMatch = clockOutEntries.some((clockOut) => clockOut.formId === formId);
      const timeMatch =
        !Number.isNaN(signedAtMs) &&
        clockOutEntries.some(
          (clockOut) => Math.abs(clockOut.timestampMs - signedAtMs) <= ATTESTATION_TIME_MATCH_WINDOW_MS
        );
      return directFormMatch || timeMatch;
    }) || null;

  return {
    attestationStatus: matchedAttestation ? ("submitted" as const) : ("not_submitted" as const),
    attestationSignedAt: matchedAttestation?.signed_at || null,
    rejectionReason: null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return jsonError("Not authenticated.", 401);
    }

    const requester = await loadRequester(user.id);
    if (!ALLOWED_ROLES.has(requester.role)) {
      return jsonError("Only managers, supervisors, and execs can access this page.", 403);
    }

    const eventId = String(params.id || "").trim();
    if (!eventId) {
      return jsonError("Event ID is required.", 400);
    }

    // Support ?userId=xxx to load a specific team member's timesheet
    const url = new URL(req.url);
    const targetUserId = url.searchParams.get("userId") || user.id;
    const targetRequester = targetUserId !== user.id ? await loadRequester(targetUserId) : requester;

    const event = await loadEvent(eventId);
    const eventDate = normalizeEventDate(event.event_date);
    if (!eventDate) {
      return jsonError("Event date is missing.", 400);
    }

    const eventTimezone = getTimezoneForState(event.state);

    // Load team members on the initial request (no ?userId param) so the page can populate the selector
    let teamMembers: Array<{ id: string; name: string; role: string }> = [];
    if (!url.searchParams.get("userId")) {
      const { data: teamRows } = await supabaseAdmin
        .from("event_teams")
        .select("vendor_id")
        .eq("event_id", eventId);

      const vendorIds = (teamRows || []).map((t: any) => t.vendor_id).filter(Boolean);

      if (vendorIds.length > 0) {
        const [usersResult, profilesResult] = await Promise.all([
          supabaseAdmin.from("users").select("id, email, role").in("id", vendorIds),
          supabaseAdmin.from("profiles").select("user_id, first_name, last_name").in("user_id", vendorIds),
        ]);

        const usersMap = new Map((usersResult.data || []).map((u: any) => [u.id, u]));
        const profilesMap = new Map((profilesResult.data || []).map((p: any) => [p.user_id, p]));

        teamMembers = vendorIds.map((id: string) => {
          const u = (usersMap.get(id) || {}) as any;
          const p = (profilesMap.get(id) || {}) as any;
          const first = p.first_name ? safeDecrypt(String(p.first_name)) : "";
          const last = p.last_name ? safeDecrypt(String(p.last_name)) : "";
          return {
            id,
            name: [first, last].filter(Boolean).join(" ").trim() || u.email || id,
            role: u.role || "vendor",
          };
        });
      }
    }

    const { entries } = await loadCurrentEntries(targetUserId, eventId, eventDate, eventTimezone);
    const attestationState = await loadAttestationState(targetUserId, entries);
    const timesheet = buildSnapshot(
      entries,
      eventTimezone,
      attestationState.attestationStatus,
      attestationState.attestationSignedAt,
      attestationState.rejectionReason
    );

    return NextResponse.json({
      event: {
        id: event.id,
        name: event.event_name,
        date: eventDate,
        startTime: event.start_time,
        endTime: event.end_time,
        venue: event.venue,
        city: event.city,
        state: event.state,
        type: event.event_type || "normal",
        timezone: eventTimezone,
      },
      user: {
        id: targetUserId,
        name: targetRequester.name,
        role: targetRequester.role,
      },
      requester: {
        id: user.id,
        name: requester.name,
        role: requester.role,
      },
      timesheet,
      teamMembers,
    });
  } catch (err: any) {
    return jsonError(err?.message || "Unhandled error.", 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return jsonError("Not authenticated.", 401);
    }

    const requester = await loadRequester(user.id);
    if (!ALLOWED_ROLES.has(requester.role)) {
      return jsonError("Only managers, supervisors, and execs can submit this timesheet.", 403);
    }

    const eventId = String(params.id || "").trim();
    if (!eventId) {
      return jsonError("Event ID is required.", 400);
    }

    const body = await req.json().catch(() => null);
    const spans: TimesheetSpanPayload = body?.spans || {};
    const signature = String(body?.signature || "").trim();
    const attestationAccepted =
      typeof body?.attestationAccepted === "boolean" ? body.attestationAccepted : undefined;
    const rejectionReason = String(body?.rejectionReason || "").trim();

    // Support submitting for another team member
    const targetUserId = String(body?.targetUserId || user.id).trim() || user.id;
    const targetRequester = targetUserId !== user.id ? await loadRequester(targetUserId) : requester;

    if (!signature.startsWith("data:image/png;base64,")) {
      return jsonError("A drawn signature is required.", 400);
    }
    if (typeof attestationAccepted !== "boolean") {
      return jsonError("Attestation response is required.", 400);
    }
    if (attestationAccepted === false && !rejectionReason) {
      return jsonError("A rejection reason is required when rejecting the attestation.", 400);
    }
    if (!String(spans.firstIn || "").trim() || !String(spans.lastOut || "").trim()) {
      return jsonError("Clock in and clock out times are required.", 400);
    }

    const event = await loadEvent(eventId);
    const eventDate = normalizeEventDate(event.event_date);
    if (!eventDate) {
      return jsonError("Event date is missing.", 400);
    }

    const eventTimezone = getTimezoneForState(event.state);
    const { timeline, error: timelineError } = buildTimeline(eventDate, eventTimezone, spans);
    if (timelineError) {
      return jsonError(timelineError, 400);
    }

    const { entries: existingEntries, range } = await loadCurrentEntries(
      targetUserId,
      eventId,
      eventDate,
      eventTimezone
    );

    const existingByAction: Record<string, TimeEntryRow[]> = {};
    for (const entry of existingEntries) {
      if (!existingByAction[entry.action]) existingByAction[entry.action] = [];
      existingByAction[entry.action].push(entry);
    }

    const newByAction: Record<string, TimelineRow[]> = {};
    for (const entry of timeline) {
      if (!newByAction[entry.action]) newByAction[entry.action] = [];
      newByAction[entry.action].push(entry);
    }

    const baseNote = targetUserId !== user.id
      ? `Manager-submitted timesheet (entered by ${requester.name})`
      : "Self-submitted event timesheet";
    const toUpdate: Array<{ id: string; action: string; timestamp: string }> = [];
    const toInsert: Array<{ action: string; timestamp: string }> = [];
    const toDelete: string[] = [];

    const allActions = new Set([...Object.keys(existingByAction), ...Object.keys(newByAction)]);
    for (const action of allActions) {
      const existingList = existingByAction[action] || [];
      const newList = newByAction[action] || [];
      const maxLen = Math.max(existingList.length, newList.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < existingList.length && i < newList.length) {
          toUpdate.push({
            id: existingList[i].id,
            action,
            timestamp: newList[i].timestamp,
          });
        } else if (i < newList.length) {
          toInsert.push({
            action,
            timestamp: newList[i].timestamp,
          });
        } else {
          toDelete.push(existingList[i].id);
        }
      }
    }

    if (toDelete.length > 0) {
      const { error: deleteEntriesError } = await supabaseAdmin
        .from("time_entries")
        .delete()
        .in("id", toDelete);
      if (deleteEntriesError) {
        return jsonError(deleteEntriesError.message, 500);
      }
    }

    for (const update of toUpdate) {
      const payload: Record<string, unknown> = {
        timestamp: update.timestamp,
        event_id: eventId,
        notes:
          update.action === "clock_out"
            ? attestationAccepted
              ? `${baseNote} - attested`
              : `${baseNote} - attestation rejected`
            : baseNote,
      };

      if (update.action === "clock_out") {
        payload.attestation_accepted = attestationAccepted;
      } else {
        payload.attestation_accepted = null;
      }

      const { error: updateError } = await supabaseAdmin
        .from("time_entries")
        .update(payload)
        .eq("id", update.id);

      if (updateError) {
        return jsonError(updateError.message, 500);
      }
    }

    for (const insert of toInsert) {
      const payload: Record<string, unknown> = {
        user_id: targetUserId,
        division: targetRequester.division || "vendor",
        action: insert.action,
        timestamp: insert.timestamp,
        event_id: eventId,
        notes:
          insert.action === "clock_out"
            ? attestationAccepted
              ? `${baseNote} - attested`
              : `${baseNote} - attestation rejected`
            : baseNote,
      };

      if (insert.action === "clock_out") {
        payload.attestation_accepted = attestationAccepted;
      }

      const { error: insertError } = await supabaseAdmin.from("time_entries").insert(payload);
      if (insertError) {
        return jsonError(insertError.message, 500);
      }
    }

    const { data: currentEntries, error: currentEntriesError } = await supabaseAdmin
      .from("time_entries")
      .select("id, action, timestamp, event_id, attestation_accepted")
      .eq("user_id", targetUserId)
      .eq("event_id", eventId)
      .gte("timestamp", range.startIso)
      .lt("timestamp", range.endExclusiveIso)
      .order("timestamp", { ascending: true });

    if (currentEntriesError) {
      return jsonError(currentEntriesError.message, 500);
    }

    const normalizedCurrentEntries = (currentEntries || []) as TimeEntryRow[];
    const currentClockOut = [...normalizedCurrentEntries]
      .reverse()
      .find((entry) => entry.action === "clock_out");

    if (!currentClockOut?.id) {
      return jsonError("Failed to resolve the saved clock out entry.", 500);
    }

    const allClockOutIds = [
      ...existingEntries.filter((entry) => entry.action === "clock_out").map((entry) => entry.id),
      currentClockOut.id,
    ].filter(Boolean);
    const uniqueClockOutIds = [...new Set(allClockOutIds)];
    const formIdsToClear = uniqueClockOutIds.map((id) => `clock-out-${id}`);

    if (uniqueClockOutIds.length > 0) {
      const { error: clearRejectionsError } = await supabaseAdmin
        .from("attestation_rejections")
        .delete()
        .in("time_entry_id", uniqueClockOutIds);
      if (clearRejectionsError) {
        return jsonError(clearRejectionsError.message, 500);
      }
    }

    if (formIdsToClear.length > 0) {
      const { error: clearSignaturesError } = await supabaseAdmin
        .from("form_signatures")
        .delete()
        .eq("form_type", "clock_out_attestation")
        .eq("user_id", targetUserId)
        .in("form_id", formIdsToClear);
      if (clearSignaturesError) {
        return jsonError(clearSignaturesError.message, 500);
      }
    }

    if (attestationAccepted) {
      const ipAddress =
        req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
      const userAgent = req.headers.get("user-agent") || "unknown";
      const signedAt = currentClockOut.timestamp || new Date().toISOString();
      const formId = `clock-out-${currentClockOut.id}`;
      const formDataString = JSON.stringify({
        entryId: currentClockOut.id,
        workerId: targetUserId,
        action: "clock_out",
        timestamp: signedAt,
        eventId,
      });
      const formDataHash = createHash("sha256").update(formDataString).digest("hex");
      const signatureHash = createHash("sha256")
        .update(`${signature}${signedAt}${targetUserId}${ipAddress}`)
        .digest("hex");
      const bindingHash = createHash("sha256")
        .update(`${formDataHash}${signatureHash}${targetUserId}`)
        .digest("hex");

      const { error: signatureInsertError } = await supabaseAdmin
        .from("form_signatures")
        .insert({
          form_id: formId,
          form_type: "clock_out_attestation",
          user_id: targetUserId,
          signature_role: targetUserId !== user.id ? "manager_proxy" : "employee",
          signature_data: signature,
          signature_type: "drawn",
          form_data_hash: formDataHash,
          signature_hash: signatureHash,
          binding_hash: bindingHash,
          ip_address: ipAddress,
          user_agent: userAgent,
          signed_at: signedAt,
          is_valid: true,
        });

      if (signatureInsertError) {
        return jsonError(signatureInsertError.message, 500);
      }
    } else {
      const { error: rejectionInsertError } = await supabaseAdmin
        .from("attestation_rejections")
        .insert({
          time_entry_id: currentClockOut.id,
          user_id: targetUserId,
          event_id: eventId,
          rejection_reason: rejectionReason,
          signature_data: signature,
        });

      if (rejectionInsertError) {
        return jsonError(rejectionInsertError.message, 500);
      }
    }

    const attestationState = await loadAttestationState(targetUserId, normalizedCurrentEntries);
    const timesheet = buildSnapshot(
      normalizedCurrentEntries,
      eventTimezone,
      attestationState.attestationStatus,
      attestationState.attestationSignedAt,
      attestationState.rejectionReason
    );

    return NextResponse.json({
      ok: true,
      timesheet,
    });
  } catch (err: any) {
    return jsonError(err?.message || "Unhandled error.", 500);
  }
}
