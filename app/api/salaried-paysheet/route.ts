export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';

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

async function getUserRole(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return (data?.role || '').toString().trim().toLowerCase();
}

async function buildUserDisplayMap(
  userIds: string[]
): Promise<Record<string, { name: string; email: string | null }>> {
  if (userIds.length === 0) return {};
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, email, profiles ( first_name, last_name )')
    .in('id', userIds);

  const map: Record<string, { name: string; email: string | null }> = {};
  for (const user of users || []) {
    const profile = Array.isArray((user as any).profiles)
      ? (user as any).profiles[0]
      : (user as any).profiles;
    const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
    const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
    map[user.id] = {
      name: `${firstName} ${lastName}`.trim() || (user as any).email || 'Unknown',
      email: (user as any).email || null,
    };
  }
  return map;
}

function normalizeRecord(row: any, userMap: Record<string, { name: string; email: string | null }>) {
  return {
    id: row.id,
    user_id: row.user_id,
    employee_name: userMap[row.user_id]?.name || 'Unknown',
    employee_email: userMap[row.user_id]?.email || null,
    pay_period_start: row.pay_period_start,
    pay_period_end: row.pay_period_end,
    annual_salary: Number(row.annual_salary || 0),
    gross_pay: Number(row.gross_pay || 0),
    federal_tax: Number(row.federal_tax || 0),
    state_tax: Number(row.state_tax || 0),
    social_security: Number(row.social_security || 0),
    medicare: Number(row.medicare || 0),
    other_deductions: Number(row.other_deductions || 0),
    deduction_notes: row.deduction_notes || null,
    net_pay: Number(row.net_pay || 0),
    status: row.status,
    notes: row.notes || null,
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const role = await getUserRole(user.id);
    if (!['exec', 'admin', 'finance'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    let query = supabaseAdmin
      .from('salaried_pay_records')
      .select('*')
      .order('pay_period_start', { ascending: false })
      .order('employee_name' as any, { ascending: true });

    if (startDate) query = query.gte('pay_period_start', startDate);
    if (endDate) query = query.lte('pay_period_end', endDate);

    const { data: rows, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const userIds = Array.from(new Set((rows || []).map((r: any) => r.user_id).filter(Boolean)));
    const userMap = await buildUserDisplayMap(userIds as string[]);

    return NextResponse.json({
      records: (rows || []).map((row: any) => normalizeRecord(row, userMap)),
    });
  } catch (err: any) {
    console.error('[GET /api/salaried-paysheet]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const role = await getUserRole(user.id);
    if (!['exec', 'admin', 'finance'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      user_id,
      pay_period_start,
      pay_period_end,
      annual_salary,
      gross_pay,
      federal_tax = 0,
      state_tax = 0,
      social_security = 0,
      medicare = 0,
      other_deductions = 0,
      deduction_notes = null,
      notes = null,
      status = 'draft',
    } = body;

    if (!user_id || !pay_period_start || !pay_period_end || annual_salary == null || gross_pay == null) {
      return NextResponse.json(
        { error: 'user_id, pay_period_start, pay_period_end, annual_salary, and gross_pay are required' },
        { status: 400 }
      );
    }

    const totalDeductions =
      Number(federal_tax) + Number(state_tax) + Number(social_security) +
      Number(medicare) + Number(other_deductions);
    const net_pay = Number(gross_pay) - totalDeductions;

    const { data: inserted, error } = await supabaseAdmin
      .from('salaried_pay_records')
      .insert({
        user_id,
        pay_period_start,
        pay_period_end,
        annual_salary: Number(annual_salary),
        gross_pay: Number(gross_pay),
        federal_tax: Number(federal_tax),
        state_tax: Number(state_tax),
        social_security: Number(social_security),
        medicare: Number(medicare),
        other_deductions: Number(other_deductions),
        deduction_notes: deduction_notes || null,
        net_pay,
        status,
        notes: notes || null,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const userMap = await buildUserDisplayMap([inserted.user_id]);
    return NextResponse.json({ record: normalizeRecord(inserted, userMap) }, { status: 201 });
  } catch (err: any) {
    console.error('[POST /api/salaried-paysheet]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const role = await getUserRole(user.id);
    if (!['exec', 'admin', 'finance'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('salaried_pay_records')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const mergedGross = fields.gross_pay != null ? Number(fields.gross_pay) : Number(existing.gross_pay);
    const mergedFederal = fields.federal_tax != null ? Number(fields.federal_tax) : Number(existing.federal_tax);
    const mergedState = fields.state_tax != null ? Number(fields.state_tax) : Number(existing.state_tax);
    const mergedSS = fields.social_security != null ? Number(fields.social_security) : Number(existing.social_security);
    const mergedMedicare = fields.medicare != null ? Number(fields.medicare) : Number(existing.medicare);
    const mergedOther = fields.other_deductions != null ? Number(fields.other_deductions) : Number(existing.other_deductions);
    const net_pay = mergedGross - mergedFederal - mergedState - mergedSS - mergedMedicare - mergedOther;

    const updatePayload: Record<string, any> = {
      gross_pay: mergedGross,
      federal_tax: mergedFederal,
      state_tax: mergedState,
      social_security: mergedSS,
      medicare: mergedMedicare,
      other_deductions: mergedOther,
      net_pay,
    };

    if (fields.annual_salary != null) updatePayload.annual_salary = Number(fields.annual_salary);
    if (fields.pay_period_start != null) updatePayload.pay_period_start = fields.pay_period_start;
    if (fields.pay_period_end != null) updatePayload.pay_period_end = fields.pay_period_end;
    if ('deduction_notes' in fields) updatePayload.deduction_notes = fields.deduction_notes || null;
    if ('notes' in fields) updatePayload.notes = fields.notes || null;
    if (fields.status != null) updatePayload.status = fields.status;

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('salaried_pay_records')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    const userMap = await buildUserDisplayMap([updated.user_id]);
    return NextResponse.json({ record: normalizeRecord(updated, userMap) });
  } catch (err: any) {
    console.error('[PATCH /api/salaried-paysheet]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const role = await getUserRole(user.id);
    if (!['exec', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { error } = await supabaseAdmin
      .from('salaried_pay_records')
      .delete()
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[DELETE /api/salaried-paysheet]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
