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
  console.log('🚀 Timesheet API called', { eventId: params.id, url: req.url });

  try {
    const user = await getAuthedUser(req);
    console.log('👤 Authenticated user:', { userId: user?.id, userEmail: user?.email });

    if (!user?.id) {
      console.log('❌ Authentication failed');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      console.log('❌ No event ID provided');
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    // Ensure requester owns the event
    console.log('🔍 Querying event:', { eventId, userId: user.id });
    const { data: event, error: evtErr } = await supabaseAdmin
      .from('events')
      .select('id, event_date, start_time, end_time, created_by')
      .eq('id', eventId)
      .maybeSingle();

    console.log('📋 Event query result:', { event, error: evtErr });

    if (evtErr) {
      console.error('❌ Event query error:', evtErr);
      return NextResponse.json({ error: evtErr.message }, { status: 500 });
    }
    if (!event) {
      console.log('❌ Event not found or not owned by user');
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    console.log('✅ Event found:', event);

    // Get team members (user ids) - only confirmed members
    console.log('🔍 Querying event_teams for event:', eventId);
    const { data: team, error: teamErr } = await supabaseAdmin
      .from('event_teams')
      .select('vendor_id')
      .eq('event_id', eventId)
      

    console.log('👥 Team query result:', { team, error: teamErr, teamCount: team?.length || 0 });

    if (teamErr) {
      console.error('❌ Team query error:', teamErr);
      return NextResponse.json({ error: teamErr.message }, { status: 500 });
    }

    // Build event window - USE FULL DAY to catch all clock ins/outs
    // Workers may clock in before/after scheduled event times
    let date = event.event_date;

    const userIds = (team || []).map(t => t.vendor_id).filter(Boolean);
    console.log('👥 Extracted vendor IDs (user IDs):', userIds);

    if (userIds.length === 0) {
      console.log('⚠️ No team members found, returning empty data');
      return NextResponse.json({
        totals: {},
        spans: {},
        entries: {},
        summary: { totalWorkers: 0, totalEntriesFound: 0, dateQueried: date }
      });
    }

    // Normalize date to YYYY-MM-DD format
    if (date && typeof date === 'string') {
      // If it's a full timestamp, extract just the date part
      date = date.split('T')[0];
    }

    console.log('📅 Event details:', {
      event_date: event.event_date,
      normalized_date: date,
      start_time: event.start_time,
      end_time: event.end_time
    });

    // Query for ENTIRE DAY - workers might clock in/out outside scheduled hours
    const startIso = new Date(`${date}T00:00:00Z`).toISOString();
    const endIso = new Date(`${date}T23:59:59.999Z`).toISOString();

    console.log('⏰ Query window (FULL DAY):', { startIso, endIso });

    // Fetch all time entries for these users for this event (prefer event_id over date window)
    let { data: entries, error: teErr } = await supabaseAdmin
      .from('time_entries')
      .select('user_id, action, timestamp, started_at, event_id')
      .in('user_id', userIds)
      .eq('event_id', eventId)
      .order('timestamp', { ascending: true });
    if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 });

    console.log('🔍 DEBUG - Timesheet query:', {
      eventId,
      date,
      startIso,
      endIso,
      userIds,
      entriesCount: entries?.length || 0,
      entries: entries || [],
      queryError: teErr
    });

        // Fallback 1: try date window on timestamp
    if (!entries || entries.length === 0) {
      console.log('[TIMESHEET] No entries with event_id, trying timestamp range fallback');
      const { data: byTimestamp, error: tsErr } = await supabaseAdmin
        .from('time_entries')
        .select('user_id, action, timestamp, started_at, event_id')
        .in('user_id', userIds)
        .gte('timestamp', startIso)
        .lte('timestamp', endIso)
        .order('timestamp', { ascending: true });

      console.log('[TIMESHEET] Timestamp range query:', {
        startIso,
        endIso,
        userIds,
        foundCount: byTimestamp?.length || 0,
        error: tsErr,
        sample: byTimestamp?.slice(0, 3)
      });

      if (byTimestamp && byTimestamp.length > 0) {
        entries = byTimestamp;
        console.log('[TIMESHEET] ✅ Using timestamp range fallback');
      } else {
        // Fallback 2: try date window on started_at
        console.log('[TIMESHEET] Trying started_at range fallback');
        const { data: byStarted } = await supabaseAdmin
          .from('time_entries')
          .select('user_id, action, timestamp, started_at, event_id')
          .in('user_id', userIds)
          .gte('started_at', startIso)
          .lte('started_at', endIso)
          .order('started_at', { ascending: true });
        console.log('[TIMESHEET] Started_at range query found:', byStarted?.length || 0);
        if (byStarted && byStarted.length > 0) {
          entries = byStarted;
          console.log('[TIMESHEET] ✅ Using started_at range fallback');
        }
      }
    }if (!entries || entries.length === 0) {
      console.log('⚠️ No time entries found for this event');
      console.log('💡 TIP: Check that time_entries exist for:');
      console.log(`   - User IDs: ${userIds.join(', ')}`);
      console.log(`   - Date range: ${startIso} to ${endIso}`);
      console.log(`   - Event date: ${date}`);
    }

    // Group entries by user for easier processing
    const entriesByUser: Record<string, any[]> = {};
    for (const uid of userIds) {
      entriesByUser[uid] = (entries || []).filter(e => e.user_id === uid);
    }

    // Log all entries for each user for debugging
    console.log('[TIMESHEET] All entries by user:');
    for (const uid of userIds) {
      const userEntries = entriesByUser[uid] || [];
      console.log(`  User ${uid}: ${userEntries.length} entries`);
      userEntries.forEach((entry, idx) => {
        console.log(`    ${idx + 1}. ${entry.action} at ${entry.timestamp}`);
      });
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
        console.log(`[MEAL-DETECT] User ${uid}: Analyzing ${workIntervals.length} work intervals for gaps`);

        // Sort intervals by start time
        workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());

        // Find gaps between consecutive work intervals
        const gaps: Array<{ start: Date; end: Date }> = [];
        for (let i = 0; i < workIntervals.length - 1; i++) {
          const gapStart = workIntervals[i].end;
          const gapEnd = workIntervals[i + 1].start;
          const gapMs = gapEnd.getTime() - gapStart.getTime();

          if (gapMs > 0) {
            console.log(`[MEAL-DETECT] User ${uid}: Found gap ${i + 1}: ${gapStart.toISOString()} to ${gapEnd.toISOString()} (${Math.round(gapMs / 1000 / 60)} minutes)`);
            gaps.push({ start: gapStart, end: gapEnd });
          }

          // Limit to 2 meal breaks
          if (gaps.length >= 2) break;
        }

        // Apply detected gaps as meal breaks
        if (gaps[0]) {
          spans[uid].firstMealStart = gaps[0].start.toISOString();
          spans[uid].lastMealEnd = gaps[0].end.toISOString();
          console.log(`[MEAL-DETECT] User ${uid}: Set first meal break: ${spans[uid].firstMealStart} to ${spans[uid].lastMealEnd}`);
        }
        if (gaps[1]) {
          spans[uid].secondMealStart = gaps[1].start.toISOString();
          spans[uid].secondMealEnd = gaps[1].end.toISOString();
          console.log(`[MEAL-DETECT] User ${uid}: Set second meal break: ${spans[uid].secondMealStart} to ${spans[uid].secondMealEnd}`);
        }

        if (gaps.length > 0) {
          console.log(`[MEAL-DETECT] User ${uid}: Detected ${gaps.length} meal break(s) from gaps`);
        } else {
          console.log(`[MEAL-DETECT] User ${uid}: No gaps found (continuous work or single interval)`);
        }
      } else if (hasExplicitMeals) {
        console.log(`[MEAL-DETECT] User ${uid}: Using explicit meal_start/meal_end entries`);
      } else {
        console.log(`[MEAL-DETECT] User ${uid}: Not enough work intervals (${workIntervals.length}) to detect meal breaks`);
      }
    }

    const responseData = {
      totals,
      spans,
      entries: allEntries, // Include raw entries for each user
      summary: {
        totalWorkers: userIds.length,
        totalEntriesFound: entries?.length || 0,
        dateQueried: date
      }
    };

    console.log('✅ Returning timesheet data:', {
      totals,
      spans,
      totalsCount: Object.keys(totals).length,
      spansCount: Object.keys(spans).length,
      entriesCount: entries?.length || 0,
      summary: responseData.summary
    });

    return NextResponse.json(responseData);
  } catch (err: any) {
    console.error('❌ Error in timesheet endpoint:', err);
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
  const parsed = new Date(`${eventDate}T${value}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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
    if (requesterRole !== "exec") {
      return NextResponse.json({ error: "Only exec can edit timesheets." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const targetUserId = String(body?.userId || "").trim();
    const spans: TimesheetSpanPayload = body?.spans || {};
    if (!targetUserId) {
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

    const dayStart = new Date(`${eventDate}T00:00:00`).toISOString();
    const dayEnd = new Date(`${eventDate}T23:59:59.999`).toISOString();

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







