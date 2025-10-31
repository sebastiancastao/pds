// app/api/time-entries/route.ts
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from '@supabase/supabase-js';

// Force Node runtime (auth-helpers don't work on edge)
export const runtime = "nodejs";

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAuthedUserFromRequest(req: Request) {
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

async function getUserDivision(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('division')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.division || 'vendor';
}

/**
 * GET /api/time-entries?open=1
 * GET /api/time-entries?since=YYYY-MM-DD
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthedUserFromRequest(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    
    const { searchParams } = new URL(req.url);
    const open = searchParams.get("open");
    const since = searchParams.get("since") || new Date().toISOString().slice(0, 10);

    if (open) {
      // Determine open session based on last clock_in vs last clock_out (ignore meal actions)
      const { data: lastIn, error: inErr } = await supabaseAdmin
        .from('time_entries')
        .select('id, timestamp, notes')
        .eq('user_id', user.id)
        .eq('action', 'clock_in')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inErr) return jsonError(inErr.message, 500);

      const { data: lastOut, error: outErr } = await supabaseAdmin
        .from('time_entries')
        .select('timestamp')
        .eq('user_id', user.id)
        .eq('action', 'clock_out')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (outErr) return jsonError(outErr.message, 500);

      const hasOpen = !!lastIn && (!lastOut || new Date(lastIn.timestamp as any).getTime() > new Date(lastOut.timestamp as any).getTime());
      if (!hasOpen || !lastIn) return NextResponse.json({ open: null });

      return NextResponse.json({ open: {
        id: lastIn.id,
        user_id: user.id,
        started_at: lastIn.timestamp as any,
        ended_at: null,
        notes: lastIn.notes ?? null,
        created_at: lastIn.timestamp as any,
      }});
    }

    // Build day intervals from clock_in/clock_out pairs since the given date
    const { data, error } = await supabaseAdmin
      .from("time_entries")
      .select("id, action, timestamp, notes")
      .eq("user_id", user.id)
      .gte("timestamp", new Date(since).toISOString())
      .order("timestamp", { ascending: true });

    if (error) return jsonError(error.message, 500);

    const intervals: Array<{ id: string; user_id: string; started_at: string; ended_at: string | null; notes: string | null; created_at: string; }> = [];
    let current: any = null;
    for (const row of data || []) {
      if (row.action === 'clock_in') {
        // Start a new interval only if none is open
        if (!current) {
          current = {
            id: row.id,
            user_id: user.id,
            started_at: row.timestamp,
            ended_at: null,
            notes: row.notes ?? null,
            created_at: row.timestamp,
          };
        }
      } else if (row.action === 'clock_out') {
        if (current) {
          current.ended_at = row.timestamp;
          intervals.push(current);
          current = null;
        }
      }
    }
    // If there is an open interval, include it too (ended_at null)
    if (current) intervals.push(current);

    // Sort descending by started_at to match previous behavior
    intervals.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

    return NextResponse.json({ entries: intervals });
  } catch (e: any) {
    return jsonError(e?.message || "Unhandled GET error", 500);
  }
}

/**
 * POST /api/time-entries  (Clock In)
 * body: { notes?: string }
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthedUserFromRequest(req);
    if (!user?.id) return jsonError("Unauthorized", 401);

    let notes = "";
    try {
      const body = await req.json();
      notes = (body?.notes ?? "").toString();
    } catch {
      notes = "";
    }

    // Prevent double clock-in: last action must not be clock_in
    const { data: lastEntry, error: lastErr } = await supabaseAdmin
      .from("time_entries")
      .select("action")
      .eq("user_id", user.id)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) return jsonError(lastErr.message, 500);
    if (lastEntry && lastEntry.action === 'clock_in') {
      return jsonError("You already have an open time entry.", 409);
    }

    const division = await getUserDivision(user.id);
    const { data, error } = await supabaseAdmin
      .from("time_entries")
      .insert({ user_id: user.id, action: 'clock_in', division, notes })
      .select("id, timestamp, notes")
      .single();

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ entry: {
      id: data.id,
      user_id: user.id,
      started_at: data.timestamp,
      ended_at: null,
      notes: data.notes ?? null,
      created_at: data.timestamp,
    } }, { status: 201 });
  } catch (e: any) {
    return jsonError(e?.message || "Unhandled POST error", 500);
  }
}

/**
 * PATCH /api/time-entries  (Clock Out)
 * body: { notes?: string }
 */
export async function PATCH(req: Request) {
  try {
    const user = await getAuthedUserFromRequest(req);
    if (!user?.id) return jsonError("Unauthorized", 401);

    let notes: string | undefined;
    try {
      const body = await req.json();
      notes = typeof body?.notes === "string" ? body.notes : undefined;
    } catch {
      notes = undefined;
    }

    // Determine open work session by comparing last clock_in vs last clock_out
    const { data: lastIn, error: inErr } = await supabaseAdmin
      .from('time_entries')
      .select('id, timestamp')
      .eq('user_id', user.id)
      .eq('action', 'clock_in')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inErr) return jsonError(inErr.message, 500);

    const { data: lastOut, error: outErr } = await supabaseAdmin
      .from('time_entries')
      .select('timestamp')
      .eq('user_id', user.id)
      .eq('action', 'clock_out')
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (outErr) return jsonError(outErr.message, 500);

    const canClockOut = !!lastIn && (!lastOut || new Date(lastIn.timestamp as any).getTime() > new Date(lastOut.timestamp as any).getTime());
    if (!canClockOut || !lastIn) {
      return jsonError("No open time entry to close.", 409);
    }

    const division = await getUserDivision(user.id);
    const { data, error } = await supabaseAdmin
      .from("time_entries")
      .insert({ user_id: user.id, action: 'clock_out', division, notes })
      .select("id, timestamp, notes")
      .single();

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ entry: {
      id: lastIn.id,
      user_id: user.id,
      started_at: lastIn.timestamp as any,
      ended_at: data.timestamp,
      notes: (typeof notes === 'string' ? notes : null),
      created_at: lastIn.timestamp as any,
    } }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message || "Unhandled PATCH error", 500);
  }
}
