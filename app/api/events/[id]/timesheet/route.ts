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

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function timeToSeconds(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const s = t.trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (![hh, mm, ss].every((n) => Number.isFinite(n))) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  if (ss < 0 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    // Fetch event and team in parallel to reduce latency
    const [eventResult, teamResult] = await Promise.all([
      supabaseAdmin
        .from('events')
        .select('id, event_date, start_time, end_time, ends_next_day, created_by, state')
        .eq('id', eventId)
        .maybeSingle(),
      supabaseAdmin
        .from('event_teams')
        .select('vendor_id')
        .eq('event_id', eventId),
    ]);

    if (eventResult.error) {
      return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
    }
    const event = eventResult.data;
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (teamResult.error) {
      return NextResponse.json({ error: teamResult.error.message }, { status: 500 });
    }

    // Build event window
    let date = event.event_date;
    const userIds = (teamResult.data || []).map(t => t.vendor_id).filter(Boolean);

    if (userIds.length === 0) {
      return NextResponse.json({
        totals: {},
        spans: {},
        summary: { totalWorkers: 0, totalEntriesFound: 0, dateQueried: date }
      });
    }

    // Normalize date to YYYY-MM-DD format
    if (date && typeof date === 'string') {
      date = date.split('T')[0];
    }

    const startSec = timeToSeconds((event as any).start_time);
    const endSec = timeToSeconds((event as any).end_time);
    const endsNextDay =
      Boolean((event as any).ends_next_day) ||
      (startSec !== null && endSec !== null && endSec <= startSec);
    const eventTimezone = getTimezoneForState((event as any).state);
    // Always scan a 2-day local window so manual overnight edits remain visible
    // while stale rows from older days for the same event_id are excluded.
    const queryRange = getLocalDateRange(date, eventTimezone, 2);
    if (!queryRange) {
      return NextResponse.json({ error: 'Invalid event date/timezone' }, { status: 400 });
    }
    const { startIso, endExclusiveIso } = queryRange;

    // Fetch time entries by event_id (primary strategy)
    let { data: entries, error: teErr } = await supabaseAdmin
      .from('time_entries')
      .select('id, user_id, action, timestamp, started_at, event_id, notes')
      .in('user_id', userIds)
      .eq('event_id', eventId)
      .gte('timestamp', startIso)
      .lt('timestamp', endExclusiveIso)
      .order('timestamp', { ascending: true });
    if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 });

    // If the event crosses midnight, also pull untagged entries in the extended window
    if (endsNextDay) {
      const { data: byTimestamp, error: tsErr } = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, action, timestamp, started_at, event_id, notes')
        .in('user_id', userIds)
        .or(`event_id.eq.${eventId},event_id.is.null`)
        .gte('timestamp', startIso)
        .lt('timestamp', endExclusiveIso)
        .order('timestamp', { ascending: true });
      if (tsErr) return NextResponse.json({ error: tsErr.message }, { status: 500 });

      const merged: any[] = [];
      const seen = new Set<string>();
      for (const row of [...(entries || []), ...(byTimestamp || [])]) {
        if (row?.event_id && row.event_id !== eventId) continue;
        const key = row?.id ? `id:${row.id}` : `k:${row?.user_id}|${row?.action}|${row?.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
      entries = merged;
    }

    // Fallback 1: try date window on timestamp (only this event or untagged entries)
    if (!entries || entries.length === 0) {
      const { data: byTimestamp, error: tsErr2 } = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, action, timestamp, started_at, event_id, notes')
        .in('user_id', userIds)
        .or(`event_id.eq.${eventId},event_id.is.null`)
        .gte('timestamp', startIso)
        .lt('timestamp', endExclusiveIso)
        .order('timestamp', { ascending: true });
      if (tsErr2) return NextResponse.json({ error: tsErr2.message }, { status: 500 });

      if (byTimestamp && byTimestamp.length > 0) {
        entries = byTimestamp;
      } else {
        // Fallback 2: try date window on started_at (only this event or untagged entries)
        const { data: byStarted } = await supabaseAdmin
          .from('time_entries')
          .select('id, user_id, action, timestamp, started_at, event_id, notes')
          .in('user_id', userIds)
          .or(`event_id.eq.${eventId},event_id.is.null`)
          .gte('started_at', startIso)
          .lt('started_at', endExclusiveIso)
          .order('started_at', { ascending: true });
        if (byStarted && byStarted.length > 0) {
          entries = byStarted;
        }
      }
    }

    // Group entries by user for easier processing
    const entriesByUser: Record<string, any[]> = {};
    for (const uid of userIds) {
      entriesByUser[uid] = [];
    }
    for (const e of entries || []) {
      if (entriesByUser[e.user_id]) {
        entriesByUser[e.user_id].push(e);
      }
    }

    // Calculate totals and spans per user
    const totals: Record<string, number> = {};
    const spans: Record<string, {
      firstIn: string | null;
      lastOut: string | null;
      firstMealStart: string | null;
      lastMealEnd: string | null;
      secondMealStart: string | null;
      secondMealEnd: string | null;
      thirdMealStart: string | null;
      thirdMealEnd: string | null;
      firstInDisplay: string;
      lastOutDisplay: string;
      firstMealStartDisplay: string;
      lastMealEndDisplay: string;
      secondMealStartDisplay: string;
      secondMealEndDisplay: string;
      thirdMealStartDisplay: string;
      thirdMealEndDisplay: string;
      managerEdited: boolean;
      managerEditNote: string | null;
      managerEditSignatureId: string | null;
      managerEditedByRole: string | null;
      managerEditSignatureData: string | null;
      managerEditedByName: string | null;
    }> = {};

    // Parse notes like: "Manual edit by manager | Reason: ... | Signature: <uuid>"
    const parseEditNotes = (notes: string) => {
      const reasonMatch = notes.match(/\| Reason: (.+?) \| Signature:/);
      const sigMatch = notes.match(/\| Signature: ([0-9a-f-]{36})/i);
      const roleMatch = notes.match(/^Manual edit by (\w+)/i);
      return {
        editNote: reasonMatch?.[1] ?? null,
        sigId: sigMatch?.[1] ?? null,
        editRole: roleMatch?.[1] ?? null,
      };
    };

    for (const uid of userIds) {
      const userEntries = entriesByUser[uid] || [];

      // Find first manager-edited entry that has a structured note
      const editedEntry = userEntries.find(e => {
        const n = (e.notes || "").toLowerCase();
        return n.includes("manual edit by manager") || n.includes("manual edit by supervisor") || n.includes("manual edit by exec");
      });
      const parsed = editedEntry ? parseEditNotes(editedEntry.notes || "") : null;

      totals[uid] = 0;
      spans[uid] = {
        firstIn: null,
        lastOut: null,
        firstMealStart: null,
        lastMealEnd: null,
        secondMealStart: null,
        secondMealEnd: null,
        thirdMealStart: null,
        thirdMealEnd: null,
        firstInDisplay: "",
        lastOutDisplay: "",
        firstMealStartDisplay: "",
        lastMealEndDisplay: "",
        secondMealStartDisplay: "",
        secondMealEndDisplay: "",
        thirdMealStartDisplay: "",
        thirdMealEndDisplay: "",
        managerEdited: !!editedEntry,
        managerEditNote: parsed?.editNote ?? null,
        managerEditSignatureId: parsed?.sigId ?? null,
        managerEditedByRole: parsed?.editRole ?? null,
        managerEditSignatureData: null,
        managerEditedByName: null,
      };

      // Track first clock_in and last clock_out
      const clockIns = userEntries.filter(e => e.action === 'clock_in');
      const clockOuts = userEntries.filter(e => e.action === 'clock_out');
      const mealStarts = userEntries.filter(e => e.action === 'meal_start');
      const mealEnds = userEntries.filter(e => e.action === 'meal_end');

      if (clockIns.length > 0) {
        spans[uid].firstIn = clockIns[0].timestamp;
        spans[uid].firstInDisplay = formatIsoToHHMM(clockIns[0].timestamp, eventTimezone);
      }
      if (clockOuts.length > 0) {
        spans[uid].lastOut = clockOuts[clockOuts.length - 1].timestamp;
        spans[uid].lastOutDisplay = formatIsoToHHMM(clockOuts[clockOuts.length - 1].timestamp, eventTimezone);
      }

      // Track first, second, and (unusual) third meal periods
      if (mealStarts.length > 0) {
        spans[uid].firstMealStart = mealStarts[0].timestamp;
        spans[uid].firstMealStartDisplay = formatIsoToHHMM(mealStarts[0].timestamp, eventTimezone);
        if (mealStarts.length > 1) {
          spans[uid].secondMealStart = mealStarts[1].timestamp;
          spans[uid].secondMealStartDisplay = formatIsoToHHMM(mealStarts[1].timestamp, eventTimezone);
        }
        if (mealStarts.length > 2) {
          spans[uid].thirdMealStart = mealStarts[2].timestamp;
          spans[uid].thirdMealStartDisplay = formatIsoToHHMM(mealStarts[2].timestamp, eventTimezone);
        }
      }
      if (mealEnds.length > 0) {
        spans[uid].lastMealEnd = mealEnds[0].timestamp;
        spans[uid].lastMealEndDisplay = formatIsoToHHMM(mealEnds[0].timestamp, eventTimezone);
        if (mealEnds.length > 1) {
          spans[uid].secondMealEnd = mealEnds[1].timestamp;
          spans[uid].secondMealEndDisplay = formatIsoToHHMM(mealEnds[1].timestamp, eventTimezone);
        }
        if (mealEnds.length > 2) {
          spans[uid].thirdMealEnd = mealEnds[2].timestamp;
          spans[uid].thirdMealEndDisplay = formatIsoToHHMM(mealEnds[2].timestamp, eventTimezone);
        }
      }

      // Calculate total worked time by pairing clock_in with clock_out
      let currentClockIn: string | null = null;
      const workIntervals: Array<{ start: Date; end: Date }> = [];

      for (const entry of userEntries) {
        if (entry.action === 'clock_in') {
          if (!currentClockIn) {
            currentClockIn = entry.timestamp;
          }
        } else if (entry.action === 'clock_out') {
          if (currentClockIn) {
            const startMs = new Date(currentClockIn).getTime();
            const endMs = new Date(entry.timestamp).getTime();
            const duration = endMs - startMs;
            if (duration > 0) {
              totals[uid] += duration;
              workIntervals.push({ start: new Date(currentClockIn), end: new Date(entry.timestamp) });
            }
            currentClockIn = null;
          }
        }
      }

      // AUTO-DETECT MEAL BREAKS: Analyze gaps between work intervals
      const hasExplicitMeals = mealStarts.length > 0 || mealEnds.length > 0;
      if (!hasExplicitMeals && workIntervals.length >= 2) {
        workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());

        const gaps: Array<{ start: Date; end: Date }> = [];
        for (let i = 0; i < workIntervals.length - 1; i++) {
          const gapStart = workIntervals[i].end;
          const gapEnd = workIntervals[i + 1].start;
          const gapMs = gapEnd.getTime() - gapStart.getTime();

          if (gapMs > 0) {
            gaps.push({ start: gapStart, end: gapEnd });
          }
          if (gaps.length >= 3) break;
        }

        if (gaps[0]) {
          spans[uid].firstMealStart = gaps[0].start.toISOString();
          spans[uid].lastMealEnd = gaps[0].end.toISOString();
          spans[uid].firstMealStartDisplay = formatIsoToHHMM(gaps[0].start.toISOString(), eventTimezone);
          spans[uid].lastMealEndDisplay = formatIsoToHHMM(gaps[0].end.toISOString(), eventTimezone);
        }
        if (gaps[1]) {
          spans[uid].secondMealStart = gaps[1].start.toISOString();
          spans[uid].secondMealEnd = gaps[1].end.toISOString();
          spans[uid].secondMealStartDisplay = formatIsoToHHMM(gaps[1].start.toISOString(), eventTimezone);
          spans[uid].secondMealEndDisplay = formatIsoToHHMM(gaps[1].end.toISOString(), eventTimezone);
        }
        if (gaps[2]) {
          spans[uid].thirdMealStart = gaps[2].start.toISOString();
          spans[uid].thirdMealEnd = gaps[2].end.toISOString();
          spans[uid].thirdMealStartDisplay = formatIsoToHHMM(gaps[2].start.toISOString(), eventTimezone);
          spans[uid].thirdMealEndDisplay = formatIsoToHHMM(gaps[2].end.toISOString(), eventTimezone);
        }
      }
    }

    // For exec: resolve signature data + editor name for manager-edited entries
    const sigIds = Object.values(spans)
      .map(s => s.managerEditSignatureId)
      .filter((id): id is string => !!id);

    if (sigIds.length > 0) {
      const { data: sigRows } = await supabaseAdmin
        .from("form_signatures")
        .select("id, user_id, signature_data")
        .in("id", sigIds);

      const editorUserIds = [...new Set((sigRows || []).map(r => r.user_id).filter(Boolean))];
      let editorNames: Record<string, string> = {};
      if (editorUserIds.length > 0) {
        // Name is in profiles table (first_name + last_name); fall back to email from users
        const [{ data: profiles }, { data: editorUsers }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("user_id, first_name, last_name")
            .in("user_id", editorUserIds),
          supabaseAdmin
            .from("users")
            .select("id, email")
            .in("id", editorUserIds),
        ]);
        const emailMap: Record<string, string> = {};
        for (const u of editorUsers || []) emailMap[u.id] = u.email;
        for (const p of profiles || []) {
          const first = p.first_name ? safeDecrypt(p.first_name) : "";
          const last = p.last_name ? safeDecrypt(p.last_name) : "";
          const full = [first, last].filter(Boolean).join(" ").trim();
          editorNames[p.user_id] = full || emailMap[p.user_id] || p.user_id;
        }
        // Fill in any user_ids that had no profile row
        for (const uid of editorUserIds) {
          if (!editorNames[uid]) editorNames[uid] = emailMap[uid] || uid;
        }
      }

      const sigMap: Record<string, { sigData: string; editorName: string }> = {};
      for (const row of sigRows || []) {
        sigMap[row.id] = {
          sigData: row.signature_data,
          editorName: editorNames[row.user_id] ?? "Unknown",
        };
      }

      for (const span of Object.values(spans)) {
        if (span.managerEditSignatureId && sigMap[span.managerEditSignatureId]) {
          span.managerEditSignatureData = sigMap[span.managerEditSignatureId].sigData;
          span.managerEditedByName = sigMap[span.managerEditSignatureId].editorName;
        }
      }
    }

    return NextResponse.json({
      totals,
      spans,
      summary: {
        totalWorkers: userIds.length,
        totalEntriesFound: entries?.length || 0,
        dateQueried: date
      }
    });
  } catch (err: any) {
    console.error('Error in timesheet endpoint:', err);
    return NextResponse.json({ error: err.message || 'Unhandled error' }, { status: 500 });
  }
}

// ─── PUT: Edit timesheet for a specific user ───

type TimesheetSpanPayload = {
  firstIn?: string;
  lastOut?: string;
  firstMealStart?: string;
  lastMealEnd?: string;
  secondMealStart?: string;
  secondMealEnd?: string;
  thirdMealStart?: string;
  thirdMealEnd?: string;
};

const toEventIso = (eventDate: string, hhmm?: string) => {
  const value = (hhmm || "").trim();
  if (!value) return null;
  let [hh, mm] = value.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;
  // Normalize "24:00" → "00:00" (some Intl formatters produce this for midnight)
  if (hh === 24) hh = 0;

  // Determine if PDT or PST applies on this event date
  const testDate = new Date(`${eventDate}T12:00:00Z`);
  if (Number.isNaN(testDate.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(testDate);
  const offsetHours = formatted.includes("PDT") ? 7 : 8; // PDT=UTC-7, PST=UTC-8

  // Convert Pacific time HH:mm to UTC
  const utcDate = new Date(`${eventDate}T00:00:00Z`);
  utcDate.setUTCHours(hh + offsetHours, mm, 0, 0);
  return utcDate.toISOString();
};

const normalizeEventDate = (dateValue?: string | null) => {
  if (!dateValue) return null;
  return dateValue.split("T")[0];
};

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const { data: requester, error: requesterError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (requesterError) {
      return NextResponse.json({ error: requesterError.message }, { status: 500 });
    }
    const requesterRole = String(requester?.role || "").toLowerCase().trim();
    if (requesterRole !== "exec" && requesterRole !== "manager") {
      return NextResponse.json({ error: "Only exec or manager can edit timesheets." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const targetUserId = String(body?.userId || "").trim();
    const spans: TimesheetSpanPayload = body?.spans || {};
    const editNote = String(body?.editNote || "").trim();
    const editSignatureDataUrl = String(body?.editSignature || "").trim();
    console.log("[timesheet-PUT] received:", { userId: targetUserId, spans });
    if (!targetUserId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (!editNote) {
      return NextResponse.json({ error: "A reason for the edit is required." }, { status: 400 });
    }
    if (!editSignatureDataUrl.startsWith("data:image/png;base64,")) {
      return NextResponse.json({ error: "A drawn signature is required to save timesheet edits." }, { status: 400 });
    }

    // Insert drawn signature into form_signatures table
    const now = new Date().toISOString();
    const ipAddress = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    const userAgent = req.headers.get("user-agent") ?? "";
    const formId = `timesheet_edit_${eventId}_${targetUserId}_${Date.now()}`;
    const formDataHash = createHash("sha256")
      .update(JSON.stringify({ eventId, targetUserId, spans, editNote }))
      .digest("hex");
    const signatureHash = createHash("sha256")
      .update(`${editSignatureDataUrl}${now}${user.id}${ipAddress}`)
      .digest("hex");
    const bindingHash = createHash("sha256")
      .update(`${formDataHash}${signatureHash}`)
      .digest("hex");

    const { data: sigRow, error: sigError } = await supabaseAdmin
      .from("form_signatures")
      .insert({
        form_id: formId,
        form_type: "timesheet_edit",
        user_id: user.id,
        signature_role: "employer",
        signature_data: editSignatureDataUrl,
        signature_type: "drawn",
        form_data_hash: formDataHash,
        signature_hash: signatureHash,
        binding_hash: bindingHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        signed_at: now,
      })
      .select("id")
      .single();
    if (sigError) {
      console.error("[timesheet-PUT] form_signatures insert error:", sigError.message);
      return NextResponse.json({ error: "Failed to store signature: " + sigError.message }, { status: 500 });
    }
    const editSignature = sigRow.id;

    const { data: teamMember, error: teamError } = await supabaseAdmin
      .from("event_teams")
      .select("id")
      .eq("event_id", eventId)
      .eq("vendor_id", targetUserId)
      .maybeSingle();
    if (teamError) {
      return NextResponse.json({ error: teamError.message }, { status: 500 });
    }
    if (!teamMember) {
      return NextResponse.json({ error: "User is not assigned to this event" }, { status: 404 });
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("event_date, state")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    const eventDate = normalizeEventDate(event?.event_date);
    if (!eventDate) {
      return NextResponse.json({ error: "Event date is missing" }, { status: 400 });
    }
    const eventTimezone = getTimezoneForState(event?.state);

    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from("users")
      .select("division")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetUserError) {
      return NextResponse.json({ error: targetUserError.message }, { status: 500 });
    }
    const division = targetUser?.division || "vendor";

    // Strip incomplete meal pairs instead of rejecting
    const meal1Start = (spans.firstMealStart || "").trim();
    const meal1End = (spans.lastMealEnd || "").trim();
    const meal2Start = (spans.secondMealStart || "").trim();
    const meal2End = (spans.secondMealEnd || "").trim();
    const meal3Start = (spans.thirdMealStart || "").trim();
    const meal3End = (spans.thirdMealEnd || "").trim();
    const useMeal1 = !!(meal1Start && meal1End);
    const useMeal2 = !!(meal2Start && meal2End);
    const useMeal3 = !!(meal3Start && meal3End);

    const timeline = [
      { action: "clock_in", timestamp: toZonedIso(eventDate, spans.firstIn, eventTimezone) },
      ...(useMeal1
        ? [
            { action: "meal_start", timestamp: toZonedIso(eventDate, meal1Start, eventTimezone) },
            { action: "meal_end", timestamp: toZonedIso(eventDate, meal1End, eventTimezone) },
          ]
        : []),
      ...(useMeal2
        ? [
            { action: "meal_start", timestamp: toZonedIso(eventDate, meal2Start, eventTimezone) },
            { action: "meal_end", timestamp: toZonedIso(eventDate, meal2End, eventTimezone) },
          ]
        : []),
      ...(useMeal3
        ? [
            { action: "meal_start", timestamp: toZonedIso(eventDate, meal3Start, eventTimezone) },
            { action: "meal_end", timestamp: toZonedIso(eventDate, meal3End, eventTimezone) },
          ]
        : []),
      { action: "clock_out", timestamp: toZonedIso(eventDate, spans.lastOut, eventTimezone) },
    ].filter((entry) => !!entry.timestamp);

    // Handle overnight shifts: if a timestamp is earlier than the previous one,
    // it crossed midnight — advance it by 24 hours
    for (let i = 1; i < timeline.length; i++) {
      const prevMs = new Date(String(timeline[i - 1].timestamp)).getTime();
      const currMs = new Date(String(timeline[i].timestamp)).getTime();
      if (currMs <= prevMs) {
        timeline[i].timestamp = new Date(currMs + 24 * 60 * 60 * 1000).toISOString();
      }
    }

    for (let i = 1; i < timeline.length; i++) {
      const prev = new Date(String(timeline[i - 1].timestamp)).getTime();
      const curr = new Date(String(timeline[i].timestamp)).getTime();
      if (!(curr > prev)) {
        console.error("[timesheet-PUT] Order validation failed:", {
          spans,
          timeline: timeline.map((t) => `${t.action} → ${t.timestamp}`),
          failedIndex: i,
        });
        return NextResponse.json(
          {
            error: `Times must be strictly increasing: ${timeline[i - 1].action} (${spans.firstIn || spans.lastOut}) and ${timeline[i].action} conflict.`,
          },
          { status: 400 }
        );
      }
    }

    const dayRange = getLocalDateRange(eventDate, eventTimezone, 2);
    if (!dayRange) {
      return NextResponse.json({ error: "Invalid event date/timezone" }, { status: 400 });
    }
    const { startIso: dayStart, endExclusiveIso: dayEndExclusive } = dayRange;

    // Replace all rows already bound to this event for this worker, plus any
    // untagged rows inside the local 2-day window that the editor is taking over.
    const [eventBoundResult, nullWindowResult] = await Promise.all([
      supabaseAdmin
        .from("time_entries")
        .select("id, action, timestamp")
        .eq("user_id", targetUserId)
        .eq("event_id", eventId)
        .order("timestamp", { ascending: true }),
      supabaseAdmin
        .from("time_entries")
        .select("id, action, timestamp")
        .eq("user_id", targetUserId)
        .is("event_id", null)
        .gte("timestamp", dayStart)
        .lt("timestamp", dayEndExclusive)
        .order("timestamp", { ascending: true }),
    ]);
    if (eventBoundResult.error) {
      return NextResponse.json({ error: eventBoundResult.error.message }, { status: 500 });
    }
    if (nullWindowResult.error) {
      return NextResponse.json({ error: nullWindowResult.error.message }, { status: 500 });
    }
    const existingRaw = [
      ...(eventBoundResult.data || []),
      ...(nullWindowResult.data || []),
    ].filter((row, index, arr) => arr.findIndex((candidate) => candidate.id === row.id) === index);

    // Group both existing and new entries by action type
    const existingByAction: Record<string, Array<{ id: string; action: string; timestamp: string }>> = {};
    for (const e of existingRaw || []) {
      if (!existingByAction[e.action]) existingByAction[e.action] = [];
      existingByAction[e.action].push(e);
    }

    const newByAction: Record<string, Array<{ action: string; timestamp: string | null }>> = {};
    for (const e of timeline) {
      if (!newByAction[e.action]) newByAction[e.action] = [];
      newByAction[e.action].push(e);
    }

    const toUpdate: Array<{ id: string; timestamp: string }> = [];
    const toInsert: Array<{ user_id: string; action: string; timestamp: string; division: string; event_id: string; notes: string }> = [];
    const toDelete: string[] = [];

    const allActions = new Set([...Object.keys(existingByAction), ...Object.keys(newByAction)]);
    for (const action of allActions) {
      const existingList = existingByAction[action] || [];
      const newList = newByAction[action] || [];
      const maxLen = Math.max(existingList.length, newList.length);
      for (let i = 0; i < maxLen; i++) {
        if (i < existingList.length && i < newList.length) {
          toUpdate.push({ id: existingList[i].id, timestamp: newList[i].timestamp! });
        } else if (i < newList.length) {
          toInsert.push({ user_id: targetUserId, action, timestamp: newList[i].timestamp!, division, event_id: eventId, notes: `Manual edit by ${requesterRole} | Reason: ${editNote} | Signature: ${editSignature}` });
        } else {
          toDelete.push(existingList[i].id);
        }
      }
    }

    if (toDelete.length > 0) {
      if (requesterRole !== "exec") {
        return NextResponse.json(
          { error: "Only execs can delete time entries. Managers and supervisors may only update existing entries." },
          { status: 403 }
        );
      }
      const { error: deleteError } = await supabaseAdmin
        .from("time_entries")
        .delete()
        .in("id", toDelete);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
    }

    for (const upd of toUpdate) {
      const { error: updateError } = await supabaseAdmin
        .from("time_entries")
        .update({ timestamp: upd.timestamp, event_id: eventId, notes: `Manual edit by ${requesterRole} | Reason: ${editNote} | Signature: ${editSignature}` })
        .eq("id", upd.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from("time_entries")
        .insert(toInsert as any);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    const clockInTs = timeline.find((entry) => entry.action === "clock_in")?.timestamp ?? null;
    const clockOutTs = [...timeline].reverse().find((entry) => entry.action === "clock_out")?.timestamp ?? null;
    const mealStarts = timeline.filter((entry) => entry.action === "meal_start");
    const mealEnds = timeline.filter((entry) => entry.action === "meal_end");

    const totalMs = (() => {
      if (!clockInTs || !clockOutTs) return 0;
      const grossMs = Math.max(new Date(clockOutTs).getTime() - new Date(clockInTs).getTime(), 0);
      const meal1Ms =
        mealStarts[0]?.timestamp && mealEnds[0]?.timestamp
          ? Math.max(new Date(mealEnds[0].timestamp).getTime() - new Date(mealStarts[0].timestamp).getTime(), 0)
          : 0;
      const meal2Ms =
        mealStarts[1]?.timestamp && mealEnds[1]?.timestamp
          ? Math.max(new Date(mealEnds[1].timestamp).getTime() - new Date(mealStarts[1].timestamp).getTime(), 0)
          : 0;
      const meal3Ms =
        mealStarts[2]?.timestamp && mealEnds[2]?.timestamp
          ? Math.max(new Date(mealEnds[2].timestamp).getTime() - new Date(mealStarts[2].timestamp).getTime(), 0)
          : 0;
      return Math.max(grossMs - meal1Ms - meal2Ms - meal3Ms, 0);
    })();

    return NextResponse.json({
      ok: true,
      totalMs,
      span: {
        firstIn: clockInTs,
        lastOut: clockOutTs,
        firstMealStart: mealStarts[0]?.timestamp ?? null,
        lastMealEnd: mealEnds[0]?.timestamp ?? null,
        secondMealStart: mealStarts[1]?.timestamp ?? null,
        secondMealEnd: mealEnds[1]?.timestamp ?? null,
        thirdMealStart: mealStarts[2]?.timestamp ?? null,
        thirdMealEnd: mealEnds[2]?.timestamp ?? null,
        firstInDisplay: (spans.firstIn || "").trim(),
        lastOutDisplay: (spans.lastOut || "").trim(),
        firstMealStartDisplay: useMeal1 ? meal1Start : "",
        lastMealEndDisplay: useMeal1 ? meal1End : "",
        secondMealStartDisplay: useMeal2 ? meal2Start : "",
        secondMealEndDisplay: useMeal2 ? meal2End : "",
        thirdMealStartDisplay: useMeal3 ? meal3Start : "",
        thirdMealEndDisplay: useMeal3 ? meal3End : "",
        managerEdited: true,
        managerEditNote: editNote,
        managerEditedByRole: requesterRole,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unhandled error" }, { status: 500 });
  }
}
