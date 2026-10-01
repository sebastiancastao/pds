// app/api/employee-ytd-carryover/match/route.ts
//
// Batch employee matching for /adp-ytd-import.
//
// POST { names: string[] } -> { results: NameMatchResult[] } (same order as names)
//
// Replaces the page's old one-request-per-row calls to /api/match-employee,
// which only accepted an exact (case-insensitive) official_name. Here the
// whole employee directory is loaded once (official_name plus the decrypted
// first/last name, every profile, active or not), cached briefly in memory,
// and every name in the batch is matched against it in one pass with the
// tolerant matcher in lib/employee-name-match.ts.
//
// /api/match-employee itself is unchanged; /paystub-generator still uses it.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { isEncrypted, safeDecrypt } from '@/lib/encryption';
import {
  matchNames,
  prepareDirectory,
  type DirectoryPerson,
  type PreparedDirectory,
} from '@/lib/employee-name-match';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Same roles as /api/employee-ytd-carryover.
const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const MAX_NAMES = 2000;
const PAGE_SIZE = 1000;
const CACHE_MS = 2 * 60 * 1000;

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
  // Undecryptable ciphertext would only add noise tokens.
  return isEncrypted(decrypted) ? '' : decrypted;
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .order(table === 'users' ? 'id' : 'user_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

let cached: { at: number; dir: PreparedDirectory } | null = null;

async function loadDirectory(): Promise<PreparedDirectory> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.dir;

  const [profiles, users] = await Promise.all([
    fetchAll<{ user_id: string; official_name: string | null; first_name: string | null; last_name: string | null }>(
      'profiles',
      'user_id, official_name, first_name, last_name'
    ),
    fetchAll<{ id: string; email: string | null; is_active: boolean | null }>('users', 'id, email, is_active'),
  ]);
  const usersById = new Map(users.map((u) => [u.id, u]));

  const people: DirectoryPerson[] = [];
  for (const p of profiles) {
    if (!p.user_id) continue;
    const official = String(p.official_name || '').trim();
    const first = plainName(p.first_name);
    const last = plainName(p.last_name);
    const firstLast = `${first} ${last}`.trim();
    const names = [official, firstLast].filter(Boolean);
    if (names.length === 0) continue;
    const u = usersById.get(p.user_id);
    people.push({
      userId: p.user_id,
      names,
      label: official || firstLast,
      email: u?.email ?? null,
      active: u?.is_active !== false,
    });
  }

  const dir = prepareDirectory(people);
  cached = { at: Date.now(), dir };
  return dir;
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
  const names: string[] = Array.isArray(body?.names) ? body.names.map((n: unknown) => String(n ?? '')) : [];
  if (names.length === 0) {
    return NextResponse.json({ error: '"names" must be a non-empty array' }, { status: 400 });
  }
  if (names.length > MAX_NAMES) {
    return NextResponse.json({ error: `Too many names in one request (max ${MAX_NAMES})` }, { status: 400 });
  }

  try {
    const started = Date.now();
    if (body?.refresh === true) cached = null;
    const dir = await loadDirectory();
    const results = matchNames(names, dir);
    return NextResponse.json({
      results,
      directorySize: dir.people.length,
      ms: Date.now() - started,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to match names' }, { status: 500 });
  }
}
