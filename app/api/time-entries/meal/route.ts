import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

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
  if (user?.id) return user as any;
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
 * GET /api/time-entries/meal?open=1
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthedUserFromRequest(req);
    if (!user?.id) return jsonError('Not authenticated', 401);

    const { searchParams } = new URL(req.url);
    const open = searchParams.get('open');

    if (open) {
      const { data, error } = await supabaseAdmin
        .from('time_entries')
        .select('id, action, timestamp, notes')
        .eq('user_id', user.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return jsonError(error.message, 500);
      if (!data || data.action !== 'meal_start') {
        return NextResponse.json({ open: null });
      }

      return NextResponse.json({ open: {
        id: data.id,
        user_id: user.id,
        started_at: data.timestamp,
        ended_at: null,
        notes: data.notes ?? null,
        created_at: data.timestamp,
      }});
    }

    return NextResponse.json({ open: null });
  } catch (e: any) {
    return jsonError(e?.message || 'Unhandled GET error', 500);
  }
}

/**
 * POST /api/time-entries/meal  (Start Meal)
 * body: { notes?: string }
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthedUserFromRequest(req);
    if (!user?.id) return jsonError('Unauthorized', 401);

    let notes = '';
    try {
      const body = await req.json();
      notes = (body?.notes ?? '').toString();
    } catch {
      notes = '';
    }

    // Validate state: must be clocked in, and not already on a meal
    const { data: lastEntry, error: lastErr } = await supabaseAdmin
      .from('time_entries')
      .select('action')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) return jsonError(lastErr.message, 500);
    if (!lastEntry || (lastEntry.action !== 'clock_in' && lastEntry.action !== 'meal_end')) {
      return jsonError('You must be clocked in to start a meal.', 409);
    }

    const division = await getUserDivision(user.id);
    const { data, error } = await supabaseAdmin
      .from('time_entries')
      .insert({ user_id: user.id, action: 'meal_start', division, notes })
      .select('id, timestamp, notes')
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
    return jsonError(e?.message || 'Unhandled POST error', 500);
  }
}

/**
 * PATCH /api/time-entries/meal  (End Meal)
 * body: { notes?: string }
 */
export async function PATCH(req: Request) {
  try {
    const user = await getAuthedUserFromRequest(req);
    if (!user?.id) return jsonError('Unauthorized', 401);

    let notes: string | undefined;
    try {
      const body = await req.json();
      notes = typeof body?.notes === 'string' ? body.notes : undefined;
    } catch {
      notes = undefined;
    }

    // Ensure last action is meal_start
    const { data: lastEntry, error: lastErr } = await supabaseAdmin
      .from('time_entries')
      .select('id, action, timestamp')
      .eq('user_id', user.id)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) return jsonError(lastErr.message, 500);
    if (!lastEntry || lastEntry.action !== 'meal_start') {
      return jsonError('No open meal to end.', 409);
    }

    const division = await getUserDivision(user.id);
    const { data, error } = await supabaseAdmin
      .from('time_entries')
      .insert({ user_id: user.id, action: 'meal_end', division, notes })
      .select('id, timestamp, notes')
      .single();

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ entry: {
      id: lastEntry.id,
      user_id: user.id,
      started_at: lastEntry.timestamp,
      ended_at: data.timestamp,
      notes: (typeof notes === 'string' ? notes : null),
      created_at: lastEntry.timestamp,
    } }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message || 'Unhandled PATCH error', 500);
  }
}


