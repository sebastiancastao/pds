// app/api/employee-ytd-carryover/route.ts
//
// Per-employee year-to-date carryover baseline (see
// supabase/migrations/20260922000001_create_employee_ytd_carryover_table.sql).
// Backs the /adp-ytd-import page: an HR/payroll admin uploads (or hand-types)
// an ADP year-to-date report and this route persists one row per employee,
// keyed by user_id, so it doesn't have to be re-entered for every pay run.
//
// GET  -> every carryover row on file, with the employee's official_name for display
// POST -> upsert one or more rows (re-import replaces the prior baseline per employee)
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireHrCaller(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user?.id) user = data.user;
    }
  }

  if (!user?.id) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const { data: caller, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  const role = String(caller?.role || '').trim().toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
  }

  return { user, role };
}

// camelCase body key -> DB column. Every one of these is a nullable numeric
// column on employee_ytd_carryover except as_of_date/state_code/notes.
const NUMERIC_FIELDS: Record<string, string> = {
  federalIncomeYtd: 'federal_income_ytd',
  socialSecurityYtd: 'social_security_ytd',
  medicareYtd: 'medicare_ytd',
  stateIncomeYtd: 'state_income_ytd',
  stateDIYtd: 'state_di_ytd',
  calSaversRothRetYtd: 'calsavers_roth_ret_ytd',
  regularYtd: 'regular_ytd',
  overtimeYtd: 'overtime_ytd',
  doubleTimeYtd: 'doubletime_ytd',
  commissionYtd: 'commission_ytd',
  variableIncentiveYtd: 'variable_incentive_ytd',
  creditCardTipsYtd: 'credit_card_tips_ytd',
  restBreakPayYtd: 'rest_break_pay_ytd',
  travelPayYtd: 'travel_pay_ytd',
  bonusYtd: 'bonus_ytd',
  sickPayYtd: 'sick_pay_ytd',
  mealPremiumYtd: 'meal_premium_ytd',
  grossPayYtd: 'gross_pay_ytd',
  equipmentReimbYtd: 'equipment_reimb_ytd',
  mileageReimbYtd: 'mileage_reimb_ytd',
  miscReimbursementYtd: 'misc_reimbursement_ytd',
};

function toNumberOrNull(value: unknown): number | null | Error {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (Number.isNaN(num)) return new Error(`"${value}" is not a valid number`);
  return num;
}

export async function GET(req: NextRequest) {
  const auth = await requireHrCaller(req);
  if ('error' in auth) return auth.error;

  const { data, error } = await supabaseAdmin
    .from('employee_ytd_carryover')
    .select(
      'id, user_id, as_of_date, state_code, source, notes, updated_at, ' +
        Object.values(NUMERIC_FIELDS).join(', ')
    )
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = (data || []).map((row: any) => row.user_id).filter(Boolean);
  let namesByUserId: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('user_id, official_name')
      .in('user_id', userIds);
    namesByUserId = Object.fromEntries(
      (profiles || []).map((p: any) => [p.user_id, p.official_name || ''])
    );
  }

  const rows = (data || []).map((row: any) => ({
    ...row,
    employeeName: namesByUserId[row.user_id] || '(unknown employee)',
  }));

  return NextResponse.json({ rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireHrCaller(req);
  if ('error' in auth) return auth.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: '"rows" must be a non-empty array' }, { status: 400 });
  }
  if (rows.length > 1000) {
    return NextResponse.json({ error: 'Too many rows in a single request (max 1000)' }, { status: 400 });
  }

  const records: Record<string, any>[] = [];
  const problems: { index: number; message: string }[] = [];

  rows.forEach((row: any, index: number) => {
    const userId = String(row?.userId || '').trim();
    if (!UUID_RE.test(userId)) {
      problems.push({ index, message: `Row ${index + 1}: missing or invalid userId (employee must be matched first)` });
      return;
    }

    const record: Record<string, any> = {
      user_id: userId,
      as_of_date: row?.asOfDate ? String(row.asOfDate).slice(0, 10) : null,
      state_code: row?.stateCode ? String(row.stateCode).trim().toUpperCase().slice(0, 10) : null,
      notes: row?.notes ? String(row.notes).slice(0, 1000) : null,
      source: 'adp_import',
      imported_by: auth.user.id,
    };

    let rowHadError = false;
    for (const [key, column] of Object.entries(NUMERIC_FIELDS)) {
      const parsed = toNumberOrNull(row?.[key]);
      if (parsed instanceof Error) {
        problems.push({ index, message: `Row ${index + 1}: ${key} - ${parsed.message}` });
        rowHadError = true;
        continue;
      }
      record[column] = parsed;
    }
    if (rowHadError) return;

    records.push(record);
  });

  if (records.length === 0) {
    return NextResponse.json({ error: 'No valid rows to save', problems }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('employee_ytd_carryover')
    .upsert(records, { onConflict: 'user_id' })
    .select('id, user_id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    saved: data?.length || 0,
    skipped: problems.length,
    problems,
  });
}
