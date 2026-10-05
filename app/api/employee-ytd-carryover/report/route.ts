// app/api/employee-ytd-carryover/report/route.ts
//
// "Missing YTD" half of the coverage report on /adp-ytd-import.
//
// GET -> every user that has NO row in employee_ytd_carryover, with name,
//        email, role, active flag and how much they clocked this year
//        (time_entries since Jan 1, Pacific time), so the page can show who
//        still needs an ADP baseline. All roles are returned; the page filters
//        (worked this year / workers / everyone).
//
// The other half of the report (imported ADP rows that did not match a
// user) lives only in the page's pending rows, so it needs no endpoint.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { isEncrypted, safeDecrypt } from '@/lib/encryption';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Same roles as /api/employee-ytd-carryover.
const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const PAGE_SIZE = 1000;
const ID_CHUNK = 100;
const TIME_ZONE = 'America/Los_Angeles';

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
  return { user };
}

function plainName(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const decrypted = safeDecrypt(raw).trim();
  return isEncrypted(decrypted) ? '' : decrypted;
}

async function fetchAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

// YYYY-MM-DD of an instant, in Pacific time.
function pacificDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
}

// Jan 1 00:00 Pacific of the current Pacific year, as an ISO instant. PST is
// always in effect on Jan 1, so the -08:00 offset is exact.
function yearStart(): { year: number; iso: string } {
  const year = Number(pacificDate(new Date()).slice(0, 4));
  return { year, iso: new Date(`${year}-01-01T00:00:00-08:00`).toISOString() };
}

type WorkSummary = { lastWorked: string; days: Set<string> };

async function workSince(userIds: string[], sinceIso: string): Promise<Map<string, WorkSummary>> {
  const out = new Map<string, WorkSummary>();
  for (let i = 0; i < userIds.length; i += ID_CHUNK) {
    const ids = userIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, timestamp')
        .in('user_id', ids)
        .gte('timestamp', sinceIso)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`time_entries: ${error.message}`);
      for (const entry of (data || []) as { user_id: string; timestamp: string }[]) {
        if (!entry.user_id || !entry.timestamp) continue;
        const day = pacificDate(entry.timestamp);
        const summary = out.get(entry.user_id);
        if (!summary) {
          out.set(entry.user_id, { lastWorked: day, days: new Set([day]) });
        } else {
          summary.days.add(day);
          if (day > summary.lastWorked) summary.lastWorked = day;
        }
      }
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireHrCaller(req);
  if ('error' in auth) return auth.error;

  try {
    const started = Date.now();
    const [users, profiles, carryover] = await Promise.all([
      fetchAll<{ id: string; email: string | null; role: string | null; is_active: boolean | null; created_at: string | null }>(
        'users',
        'id, email, role, is_active, created_at',
        'id'
      ),
      fetchAll<{ user_id: string; official_name: string | null; first_name: string | null; last_name: string | null }>(
        'profiles',
        'user_id, official_name, first_name, last_name',
        'user_id'
      ),
      fetchAll<{ user_id: string }>('employee_ytd_carryover', 'user_id', 'user_id'),
    ]);

    const withBaseline = new Set(carryover.map((c) => c.user_id));
    const profileByUser = new Map(profiles.map((p) => [p.user_id, p]));
    const missingUsers = users.filter((u) => u.id && !withBaseline.has(u.id));

    const { year, iso } = yearStart();
    const work = await workSince(
      missingUsers.map((u) => u.id),
      iso
    );

    const people = missingUsers.map((u) => {
      const p = profileByUser.get(u.id);
      const official = String(p?.official_name || '').trim();
      const firstLast = `${plainName(p?.first_name)} ${plainName(p?.last_name)}`.trim();
      const w = work.get(u.id);
      return {
        userId: u.id,
        name: official || firstLast || '',
        email: u.email || '',
        role: String(u.role || ''),
        active: u.is_active !== false,
        createdAt: u.created_at,
        lastWorked: w?.lastWorked ?? null,
        daysWorked: w ? w.days.size : 0,
      };
    });

    return NextResponse.json({
      year,
      totalUsers: users.length,
      withBaseline: users.length - missingUsers.length,
      people,
      ms: Date.now() - started,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build the YTD report' }, { status: 500 });
  }
}
