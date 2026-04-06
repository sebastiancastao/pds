export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

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
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

async function checkAdminRole(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  const role = (data?.role || '').toLowerCase();
  return ['admin', 'exec', 'hr', 'manager', 'supervisor3'].includes(role);
}

/**
 * GET /api/mileage-approvals?event_ids=id1,id2
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await checkAdminRole(user.id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const eventIdsParam = searchParams.get('event_ids');
    if (!eventIdsParam) return NextResponse.json({ approvals: {} });

    const eventIds = eventIdsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (eventIds.length === 0) return NextResponse.json({ approvals: {} });

    const { data, error } = await supabaseAdmin
      .from('event_payment_approvals')
      .select('event_id, user_id, mileage_approved, travel_approved')
      .in('event_id', eventIds);

    if (error) {
      console.error('[MILEAGE-APPROVALS GET]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const approvals: Record<string, Record<string, { mileage: boolean | null; travel: boolean | null }>> = {};
    for (const row of data || []) {
      if (!row.event_id || !row.user_id) continue;
      if (!approvals[row.event_id]) approvals[row.event_id] = {};
      approvals[row.event_id][row.user_id] = {
        mileage: row.mileage_approved ?? null,
        travel: row.travel_approved ?? null,
      };
    }

    return NextResponse.json({ approvals });
  } catch (e: any) {
    console.error('[MILEAGE-APPROVALS GET]', e.message);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/mileage-approvals
 * Body: { event_id, user_id, field: 'mileage'|'travel', approved: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await checkAdminRole(user.id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { event_id, user_id, field, approved } = body || {};

    if (!event_id || !user_id || !field || typeof approved !== 'boolean') {
      return NextResponse.json({ error: 'event_id, user_id, field and approved are required' }, { status: 400 });
    }
    if (field !== 'mileage' && field !== 'travel') {
      return NextResponse.json({ error: 'field must be mileage or travel' }, { status: 400 });
    }

    const column = field === 'mileage' ? 'mileage_approved' : 'travel_approved';

    // Upsert into dedicated approvals table
    const { error } = await supabaseAdmin
      .from('event_payment_approvals')
      .upsert(
        { event_id, user_id, [column]: approved, updated_at: new Date().toISOString() },
        { onConflict: 'event_id,user_id' }
      );

    if (error) {
      console.error('[MILEAGE-APPROVALS POST]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('[MILEAGE-APPROVALS POST]', e.message);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
