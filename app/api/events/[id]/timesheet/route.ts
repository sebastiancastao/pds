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

    // Fetch event and team members in parallel
    const [eventResult, teamResult] = await Promise.all([
      supabaseAdmin
        .from('events')
        .select('id, event_date, start_time, end_time, created_by')
        .eq('id', eventId)
        .maybeSingle(),
      supabaseAdmin
        .from('event_teams')
        .select('vendor_id')
        .eq('event_id', eventId),
    ]);

    const { data: event, error: evtErr } = eventResult;
    const { data: team, error: teamErr } = teamResult;

    if (evtErr) {
      return NextResponse.json({ error: evtErr.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (teamErr) {
      return NextResponse.json({ error: teamErr.message }, { status: 500 });
    }

    // Build event window - USE FULL DAY to catch all clock ins/outs
    let date = event.event_date;

    const userIds = (team || []).map(t => t.vendor_id).filter(Boolean);

    if (userIds.length === 0) {
      return NextResponse.json({
        totals: {},
        spans: {},
        entries: {},
        summary: { totalWorkers: 0, totalEntriesFound: 0, dateQueried: date }
      });
    }

    // Normalize date to YYYY-MM-DD format
    if (date && typeof date === 'string') {
      date = date.split('T')[0];
    }

    // Query for ENTIRE DAY - workers might clock in/out outside scheduled hours
    const startIso = new Date(`${date}T00:00:00Z`).toISOString();
    const endIso = new Date(`${date}T23:59:59.999Z`).toISOString();

    // Fetch all time entries for these users — single query covering event_id, timestamp range, and started_at range
    // This replaces the previous 3 sequential fallback queries with one combined query
    const { data: rawEntries, error: teErr } = await supabaseAdmin
      .from('time_entries')
      .select('user_id, action, timestamp, started_at, event_id')
      .in('user_id', userIds)
      .or(`event_id.eq.${eventId},and(timestamp.gte.${startIso},timestamp.lte.${endIso}),and(started_at.gte.${startIso},started_at.lte.${endIso})`)
      .order('timestamp', { ascending: true });
    if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 });

    // Prefer entries matched by event_id; fall back to date-range matches
    const byEventId = (rawEntries || []).filter(e => e.event_id === eventId);
    const entries = byEventId.length > 0 ? byEventId : (rawEntries || []);

    // Group entries by user for easier processing
    const entriesByUser: Record<string, any[]> = {};
    for (const uid of userIds) {
      entriesByUser[uid] = (entries || []).filter(e => e.user_id === uid);
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
    }> = {};
    const allEntries: Record<string, any[]> = {};

    for (const uid of userIds) {
      const userEntries = entriesByUser[uid] || [];
      allEntries[uid] = userEntries;

      totals[uid] = 0;
      spans[uid] = {
        firstIn: null,
        lastOut: null,
        firstMealStart: null,
        lastMealEnd: null,
        secondMealStart: null,
        secondMealEnd: null
      };

      // Track first clock_in and last clock_out
      const clockIns = userEntries.filter(e => e.action === 'clock_in');
      const clockOuts = userEntries.filter(e => e.action === 'clock_out');
      const mealStarts = userEntries.filter(e => e.action === 'meal_start');
      const mealEnds = userEntries.filter(e => e.action === 'meal_end');

      if (clockIns.length > 0) {
        spans[uid].firstIn = clockIns[0].timestamp;
      }
      if (clockOuts.length > 0) {
        spans[uid].lastOut = clockOuts[clockOuts.length - 1].timestamp;
      }

      // Track first and second meal periods
      if (mealStarts.length > 0) {
        spans[uid].firstMealStart = mealStarts[0].timestamp;
        if (mealStarts.length > 1) {
          spans[uid].secondMealStart = mealStarts[1].timestamp;
        }
      }
      if (mealEnds.length > 0) {
        spans[uid].lastMealEnd = mealEnds[0].timestamp;
        if (mealEnds.length > 1) {
          spans[uid].secondMealEnd = mealEnds[1].timestamp;
        }
      }

      // Calculate total worked time by pairing clock_in with clock_out
      // Handle imperfect data gracefully
      let currentClockIn: string | null = null;
      const workIntervals: Array<{ start: Date; end: Date }> = [];

      for (const entry of userEntries) {
        if (entry.action === 'clock_in') {
          if (!currentClockIn) {
            currentClockIn = entry.timestamp;
          } else {
            console.warn(`⚠️ User ${uid}: Found clock_in without matching clock_out`);
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
          } else {
            console.warn(`⚠️ User ${uid}: Found clock_out without matching clock_in`);
          }
        }
      }

      // If still clocked in by end of day, don't count it
      if (currentClockIn) {
        console.warn(`⚠️ User ${uid}: Still clocked in at end of day, not counting incomplete shift`);
      }

      // AUTO-DETECT MEAL BREAKS: Analyze gaps between work intervals
      // If there are no explicit meal_start/meal_end, infer from gaps
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
          if (gaps.length >= 2) break;
        }

        if (gaps[0]) {
          spans[uid].firstMealStart = gaps[0].start.toISOString();
          spans[uid].lastMealEnd = gaps[0].end.toISOString();
        }
        if (gaps[1]) {
          spans[uid].secondMealStart = gaps[1].start.toISOString();
          spans[uid].secondMealEnd = gaps[1].end.toISOString();
        }
      }
    }

    return NextResponse.json({
      totals,
      spans,
      entries: allEntries,
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

type TimesheetSpanPayload = {
  firstIn?: string;
  lastOut?: string;
  firstMealStart?: string;
  lastMealEnd?: string;
  secondMealStart?: string;
  secondMealEnd?: string;
};

const toEventIso = (eventDate: string, hhmm?: string) => {
  const value = (hhmm || "").trim();
  if (!value) return null;
  const [hh, mm] = value.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;

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
    console.log("[timesheet PUT] body:", JSON.stringify(body, null, 2));
    const targetUserId = String(body?.userId || "").trim();
    const spans: TimesheetSpanPayload = body?.spans || {};
    if (!targetUserId) {
      console.error("[timesheet PUT] 400: userId is required");
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

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
      .select("event_date")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    const eventDate = normalizeEventDate(event?.event_date);
    if (!eventDate) {
      return NextResponse.json({ error: "Event date is missing" }, { status: 400 });
    }

    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from("users")
      .select("division")
      .eq("id", targetUserId)
      .maybeSingle();
    if (targetUserError) {
      return NextResponse.json({ error: targetUserError.message }, { status: 500 });
    }
    const division = targetUser?.division || "vendor";

    const timeline = [
      { action: "clock_in", timestamp: toEventIso(eventDate, spans.firstIn) },
      { action: "meal_start", timestamp: toEventIso(eventDate, spans.firstMealStart) },
      { action: "meal_end", timestamp: toEventIso(eventDate, spans.lastMealEnd) },
      { action: "meal_start", timestamp: toEventIso(eventDate, spans.secondMealStart) },
      { action: "meal_end", timestamp: toEventIso(eventDate, spans.secondMealEnd) },
      { action: "clock_out", timestamp: toEventIso(eventDate, spans.lastOut) },
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

    const hasClockIn = !!spans.firstIn;
    const hasClockOut = !!spans.lastOut;
    if (hasClockIn !== hasClockOut) {
      return NextResponse.json(
        { error: "Clock In and Clock Out are both required when editing a shift." },
        { status: 400 }
      );
    }
    const hasMeal1Start = !!spans.firstMealStart;
    const hasMeal1End = !!spans.lastMealEnd;
    if (hasMeal1Start !== hasMeal1End) {
      return NextResponse.json(
        { error: "Meal 1 Start and Meal 1 End must both be set." },
        { status: 400 }
      );
    }
    const hasMeal2Start = !!spans.secondMealStart;
    const hasMeal2End = !!spans.secondMealEnd;
    if (hasMeal2Start !== hasMeal2End) {
      return NextResponse.json(
        { error: "Meal 2 Start and Meal 2 End must both be set." },
        { status: 400 }
      );
    }

    for (let i = 1; i < timeline.length; i++) {
      const prev = new Date(String(timeline[i - 1].timestamp)).getTime();
      const curr = new Date(String(timeline[i].timestamp)).getTime();
      if (!(curr > prev)) {
        return NextResponse.json(
          { error: "Times must be strictly increasing from Clock In to Clock Out." },
          { status: 400 }
        );
      }
    }

    // Use Pacific time day boundaries for deleting existing entries
    // Extend to next day to cover overnight shifts
    const testForDst = new Date(`${eventDate}T12:00:00Z`);
    const dstFormatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      timeZoneName: "short",
    }).format(testForDst);
    const ptOffset = dstFormatted.includes("PDT") ? 7 : 8;
    const dayStartUTC = new Date(`${eventDate}T00:00:00Z`);
    dayStartUTC.setUTCHours(ptOffset, 0, 0, 0); // midnight Pacific in UTC
    const dayEndUTC = new Date(`${eventDate}T00:00:00Z`);
    dayEndUTC.setUTCHours(23 + ptOffset + 24, 59, 59, 999); // end of NEXT day Pacific in UTC (covers overnight)
    const dayStart = dayStartUTC.toISOString();
    const dayEnd = dayEndUTC.toISOString();

    const { error: deleteError } = await supabaseAdmin
      .from("time_entries")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", targetUserId)
      .gte("timestamp", dayStart)
      .lte("timestamp", dayEnd);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (timeline.length > 0) {
      const records = timeline.map((entry) => ({
        user_id: targetUserId,
        action: entry.action,
        timestamp: entry.timestamp,
        division,
        event_id: eventId,
        notes: "Manual edit by exec",
      }));

      const { error: insertError } = await supabaseAdmin
        .from("time_entries")
        .insert(records as any);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unhandled error" }, { status: 500 });
  }
}







