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

    // Try to include amount override + company-vehicle columns (may not exist in DB yet — fall back gracefully)
    let data: any[] | null = null;
    let fetchError: any = null;
    const withVehicle = await supabaseAdmin
      .from('event_payment_approvals')
      .select('event_id, user_id, mileage_approved, travel_approved, mileage_amount_override, travel_amount_override, mileage_company_vehicle')
      .in('event_id', eventIds);
    if (withVehicle.error) {
      // Optional amount override columns may not exist yet; keep company-vehicle state if available.
      const vehicleOnly = await supabaseAdmin
        .from('event_payment_approvals')
        .select('event_id, user_id, mileage_approved, travel_approved, mileage_company_vehicle')
        .in('event_id', eventIds);
      if (vehicleOnly.error) {
        // mileage_company_vehicle column may not exist yet; fall back to amount-override columns.
        const withAmounts = await supabaseAdmin
          .from('event_payment_approvals')
          .select('event_id, user_id, mileage_approved, travel_approved, mileage_amount_override, travel_amount_override')
          .in('event_id', eventIds);
        if (withAmounts.error) {
          // Amount override columns may not exist yet either; fall back to base columns.
          const base = await supabaseAdmin
            .from('event_payment_approvals')
            .select('event_id, user_id, mileage_approved, travel_approved')
            .in('event_id', eventIds);
          data = base.data;
          fetchError = base.error;
        } else {
          data = withAmounts.data;
        }
      } else {
        data = vehicleOnly.data;
      }
    } else {
      data = withVehicle.data;
    }

    if (fetchError) {
      console.error('[MILEAGE-APPROVALS GET]', fetchError.message);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const approvals: Record<string, Record<string, { mileage: boolean | null; travel: boolean | null; mileage_amount?: number | null; travel_amount?: number | null; company_vehicle?: boolean }>> = {};
    for (const row of data || []) {
      if (!row.event_id || !row.user_id) continue;
      if (!approvals[row.event_id]) approvals[row.event_id] = {};
      approvals[row.event_id][row.user_id] = {
        mileage: row.mileage_approved ?? null,
        travel: row.travel_approved ?? null,
        mileage_amount: row.mileage_amount_override ?? null,
        travel_amount: row.travel_amount_override ?? null,
        company_vehicle: row.mileage_company_vehicle ?? false,
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
 * Body: { event_id, user_id, field: 'mileage'|'travel'|'company_vehicle', approved: boolean }
 * 'company_vehicle' marks that the employee used a company vehicle for the event,
 * which forces mileage pay to $0 regardless of the mileage_approved flag or any
 * amount override (see mileage calculation call sites).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await checkAdminRole(user.id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { event_id, user_id, field, approved, amount_override } = body || {};

    if (!event_id || !user_id || !field || typeof approved !== 'boolean') {
      return NextResponse.json({ error: 'event_id, user_id, field and approved are required' }, { status: 400 });
    }
    if (field !== 'mileage' && field !== 'travel' && field !== 'company_vehicle') {
      return NextResponse.json({ error: 'field must be mileage, travel or company_vehicle' }, { status: 400 });
    }

    const column = field === 'mileage' ? 'mileage_approved' : field === 'travel' ? 'travel_approved' : 'mileage_company_vehicle';
    const amountColumn = field === 'mileage' ? 'mileage_amount_override' : field === 'travel' ? 'travel_amount_override' : null;

    const upsertData: Record<string, any> = {
      event_id,
      user_id,
      [column]: approved,
      updated_at: new Date().toISOString(),
    };
    if (field === 'mileage' && approved) {
      upsertData.mileage_company_vehicle = false;
    }
    if (field === 'company_vehicle' && approved) {
      upsertData.mileage_approved = false;
      upsertData.mileage_amount_override = null;
    }
    if (amountColumn && amount_override === null) {
      upsertData[amountColumn] = null;
    } else if (amountColumn && typeof amount_override === 'number') {
      upsertData[amountColumn] = amount_override;
    }

    // Upsert into dedicated approvals table; if optional columns do not exist yet, retry with base fields.
    let { error } = await supabaseAdmin
      .from('event_payment_approvals')
      .upsert(upsertData, { onConflict: 'event_id,user_id' });

    if (error) {
      const retryData: Record<string, any> = { event_id, user_id, [column]: approved, updated_at: new Date().toISOString() };
      if (field === 'mileage' && approved) {
        retryData.mileage_company_vehicle = false;
      }
      if (field === 'company_vehicle' && approved) {
        retryData.mileage_approved = false;
      }
      const retry = await supabaseAdmin
        .from('event_payment_approvals')
        .upsert(retryData, { onConflict: 'event_id,user_id' });
      error = retry.error;
    }

    if (error && field === 'mileage' && approved) {
      const baseData: Record<string, any> = { event_id, user_id, [column]: approved, updated_at: new Date().toISOString() };
      const retry = await supabaseAdmin
        .from('event_payment_approvals')
        .upsert(baseData, { onConflict: 'event_id,user_id' });
      error = retry.error;
    }

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
