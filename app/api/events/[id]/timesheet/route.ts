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
        .select('id, event_date, start_time, end_time, ends_next_day, created_by')
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

    const startDate = new Date(`${date}T00:00:00Z`);
    const endDate = new Date(`${date}T23:59:59.999Z`);
    if (endsNextDay) {
      endDate.setUTCDate(endDate.getUTCDate() + 1);
    }
    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    // Fetch time entries by event_id (primary strategy)
    let { data: entries, error: teErr } = await supabaseAdmin
      .from('time_entries')
      .select('id, user_id, action, timestamp, started_at, event_id')
      .in('user_id', userIds)
      .eq('event_id', eventId)
      .order('timestamp', { ascending: true });
    if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 });

    // If the event crosses midnight, also pull untagged entries in the extended window
    if (endsNextDay) {
      const { data: byTimestamp, error: tsErr } = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, action, timestamp, started_at, event_id')
        .in('user_id', userIds)
        .gte('timestamp', startIso)
        .lte('timestamp', endIso)
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

    // Fallback 1: try date window on timestamp
    if (!entries || entries.length === 0) {
      const { data: byTimestamp, error: tsErr } = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, action, timestamp, started_at, event_id')
        .in('user_id', userIds)
        .gte('timestamp', startIso)
        .lte('timestamp', endIso)
        .order('timestamp', { ascending: true });

      if (byTimestamp && byTimestamp.length > 0) {
        entries = byTimestamp;
      } else {
        // Fallback 2: try date window on started_at
        const { data: byStarted } = await supabaseAdmin
          .from('time_entries')
          .select('id, user_id, action, timestamp, started_at, event_id')
          .in('user_id', userIds)
          .gte('started_at', startIso)
          .lte('started_at', endIso)
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
    }> = {};

    for (const uid of userIds) {
      const userEntries = entriesByUser[uid] || [];

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
