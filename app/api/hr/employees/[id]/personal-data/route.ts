// app/api/hr/employees/[id]/personal-data/route.ts
//
// HR-facing read/edit of an employee's personal data (the columns that live on
// `profiles`): name, phone, address, city, state, zip code and region.
//
// GET   -> current values (encrypted columns are decrypted for the HR viewer)
// PATCH -> partial update; only the keys present in the body are touched
//
// Notes:
//  - first_name / last_name / phone / address are stored encrypted, city / state /
//    zip_code / region_id are plain. This mirrors lib/employee-information-profile-sync.ts.
//  - latitude / longitude are deliberately NOT touched. A DB trigger recomputes
//    region_id whenever the coordinates change, which would silently undo a manual
//    region choice made here.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { encrypt, safeDecrypt } from '@/lib/encryption';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROFILE_COLUMNS =
  'user_id, first_name, last_name, phone, address, city, state, zip_code, region_id, regions ( id, name )';

type PersonalData = {
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  region_id: string | null;
  region_name: string | null;
};

function dec(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return safeDecrypt(value.trim());
  } catch {
    return value.trim();
  }
}

function toPersonalData(profile: any): PersonalData {
  const region = Array.isArray(profile?.regions) ? profile.regions[0] : profile?.regions;
  return {
    first_name: dec(profile?.first_name),
    last_name: dec(profile?.last_name),
    phone: dec(profile?.phone),
    address: dec(profile?.address),
    city: String(profile?.city ?? '').trim(),
    state: String(profile?.state ?? '').trim().toUpperCase(),
    zip_code: String(profile?.zip_code ?? '').trim(),
    region_id: profile?.region_id ?? null,
    region_name: region?.name ?? null,
  };
}

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

async function loadProfile(userId: string) {
  return supabaseAdmin.from('profiles').select(PROFILE_COLUMNS).eq('user_id', userId).maybeSingle();
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireHrCaller(req);
    if ('error' in auth) return auth.error;

    const employeeId = params.id;
    if (!employeeId || !UUID_RE.test(employeeId)) {
      return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });
    }

    const { data: profile, error } = await loadProfile(employeeId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 });
    }

    return NextResponse.json({ data: toPersonalData(profile) });
  } catch (e: any) {
    console.error('[HR personal-data GET] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}

// Returns the cleaned value, or an Error message string when the input is invalid.
type Cleaned = { ok: true; value: string | null } | { ok: false; message: string };

function cleanText(
  raw: unknown,
  label: string,
  opts: { required?: boolean; max: number; pattern?: RegExp; patternHint?: string; upper?: boolean }
): Cleaned {
  if (raw !== null && raw !== undefined && typeof raw !== 'string') {
    return { ok: false, message: `${label} must be text` };
  }
  let value = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (opts.upper) value = value.toUpperCase();
  if (!value) {
    return opts.required ? { ok: false, message: `${label} is required` } : { ok: true, value: null };
  }
  if (value.length > opts.max) {
    return { ok: false, message: `${label} must be ${opts.max} characters or fewer` };
  }
  if (opts.pattern && !opts.pattern.test(value)) {
    return { ok: false, message: opts.patternHint || `${label} is not valid` };
  }
  return { ok: true, value };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireHrCaller(req);
    if ('error' in auth) return auth.error;

    const employeeId = params.id;
    if (!employeeId || !UUID_RE.test(employeeId)) {
      return NextResponse.json({ error: 'Invalid employee id' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await loadProfile(employeeId);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 });
    }
    const before = toPersonalData(existing);

    // Plain-text values, keyed by column, that are candidates for the update.
    type TextKey = 'first_name' | 'last_name' | 'phone' | 'address' | 'city' | 'state' | 'zip_code';
    const next: Partial<Record<TextKey, string | null>> = {};
    const problems: string[] = [];

    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const take = (key: TextKey, cleaned: Cleaned) => {
      if (!cleaned.ok) problems.push(cleaned.message);
      else next[key] = cleaned.value;
    };

    if (has('first_name')) take('first_name', cleanText(body.first_name, 'First name', { required: true, max: 100 }));
    if (has('last_name')) take('last_name', cleanText(body.last_name, 'Last name', { required: true, max: 100 }));
    if (has('phone')) {
      take(
        'phone',
        cleanText(body.phone, 'Phone', {
          max: 30,
          pattern: /^[0-9+()\-.\s]{7,30}$/,
          patternHint: 'Phone may only contain digits, spaces and + ( ) - .',
        })
      );
    }
    if (has('address')) take('address', cleanText(body.address, 'Address', { max: 200 }));
    if (has('city')) take('city', cleanText(body.city, 'City', { max: 100 }));
    if (has('state')) {
      take(
        'state',
        cleanText(body.state, 'State', {
          required: true,
          max: 2,
          upper: true,
          pattern: /^[A-Z]{2}$/,
          patternHint: 'State must be a 2-letter code (for example CA)',
        })
      );
    }
    if (has('zip_code')) {
      take(
        'zip_code',
        cleanText(body.zip_code, 'ZIP code', {
          max: 10,
          pattern: /^\d{5}(-\d{4})?$/,
          patternHint: 'ZIP code must be 5 digits (or ZIP+4, for example 90210-1234)',
        })
      );
    }

    let nextRegionId: string | null | undefined;
    if (has('region_id')) {
      const raw = body.region_id;
      if (raw === null || raw === '') {
        nextRegionId = null;
      } else if (typeof raw === 'string' && UUID_RE.test(raw)) {
        const { data: region, error: regionError } = await supabaseAdmin
          .from('regions')
          .select('id')
          .eq('id', raw)
          .maybeSingle();
        if (regionError) {
          return NextResponse.json({ error: regionError.message }, { status: 500 });
        }
        if (!region) problems.push('Selected region does not exist');
        else nextRegionId = raw;
      } else {
        problems.push('Region is not valid');
      }
    }

    if (problems.length > 0) {
      return NextResponse.json({ error: problems.join('. ') }, { status: 400 });
    }

    // Work out what actually changed so we neither write nor audit no-ops.
    const changedFields: string[] = [];
    const update: Record<string, unknown> = {};

    const encryptedKeys = new Set<TextKey>(['first_name', 'last_name', 'phone', 'address']);
    for (const key of Object.keys(next) as TextKey[]) {
      const value = next[key] ?? '';
      const previous = String(before[key] ?? '');
      if (value === previous) continue;
      changedFields.push(key);
      update[key] = value ? (encryptedKeys.has(key) ? encrypt(value) : value) : null;
    }
    if (nextRegionId !== undefined && nextRegionId !== before.region_id) {
      changedFields.push('region_id');
      update.region_id = nextRegionId;
    }

    if (changedFields.length === 0) {
      return NextResponse.json({ data: before, changed: [] });
    }

    update.updated_at = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(update)
      .eq('user_id', employeeId);

    if (updateError) {
      console.error('[HR personal-data PATCH] update failed:', updateError);
      return NextResponse.json({ error: updateError.message || 'Failed to save changes' }, { status: 500 });
    }

    const { data: refreshed, error: refreshError } = await loadProfile(employeeId);
    if (refreshError || !refreshed) {
      return NextResponse.json(
        { error: refreshError?.message || 'Saved, but failed to reload the profile' },
        { status: 500 }
      );
    }
    const after = toPersonalData(refreshed);

    // Best-effort audit trail. Encrypted fields are recorded by name only, so no
    // personal data is copied into audit_logs.
    const plainTrail: Record<string, { from: string | null; to: string | null }> = {};
    for (const key of ['city', 'state', 'zip_code', 'region_id'] as const) {
      if (changedFields.includes(key)) {
        plainTrail[key] = { from: before[key] || null, to: after[key] || null };
      }
    }
    const { error: auditError } = await supabaseAdmin.from('audit_logs').insert({
      user_id: auth.user.id,
      action: 'hr.employee_personal_data_edit',
      resource_type: 'profile',
      resource_id: employeeId,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: req.headers.get('user-agent') || null,
      metadata: {
        origin: 'hr-employees',
        actor_role: auth.role,
        changed_fields: changedFields,
        changes: plainTrail,
      },
      success: true,
    });
    if (auditError) {
      console.error('[HR personal-data PATCH] audit log failed:', auditError.message);
    }

    return NextResponse.json({ data: after, changed: changedFields });
  } catch (e: any) {
    console.error('[HR personal-data PATCH] error:', e);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}
