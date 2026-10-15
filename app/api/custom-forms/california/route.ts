import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { fetchAllCustomFormAssignments } from '@/lib/custom-form-assignments';
import {
  getCustomFormPdfProxyPathFromStoragePath,
  parsePayrollPacketVirtualStoragePath,
} from '@/lib/payroll-packet-custom-forms';

// Lists the custom forms that were sent to California, for the
// /california-forms download page. A form counts as "sent to California" when
// it targets the CA state, targets a California region, or is assigned to at
// least one employee who lives in California.

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const PROFILES_PAGE_SIZE = 1000;

// Meal waivers sent as custom forms otherwise resolve to the shared route,
// which only has a placeholder page; the blank route has the real form.
const MEAL_WAIVER_BLANK_URLS: Record<string, string> = {
  'meal-waiver-6hour': '/api/meal-waiver/blank?type=6-hour',
  'meal-waiver-10-12': '/api/meal-waiver/blank?type=10-12-hour',
};

const isCaliforniaState = (value: unknown) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'CA' || normalized === 'CALIFORNIA';
};

async function getRequestUser(request: NextRequest) {
  const authClient = createRouteHandlerClient({ cookies });
  const { data: { user: cookieUser } } = await authClient.auth.getUser();
  if (cookieUser) return cookieUser;

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (!token) return null;

  const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user: tokenUser } } = await tokenClient.auth.getUser();
  return tokenUser ?? null;
}

async function fetchAllProfiles(client: SupabaseClient) {
  const rows: Array<{ user_id: string; state: string | null; region_id: string | null }> = [];
  for (let from = 0; ; from += PROFILES_PAGE_SIZE) {
    const { data, error } = await client
      .from('profiles')
      .select('user_id, state, region_id')
      .order('id', { ascending: true })
      .range(from, from + PROFILES_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PROFILES_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getRequestUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: userRecord, error: roleError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    if (roleError || !userRecord) {
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
    }
    const role = String(userRecord.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const [formsResult, assignmentsResult, profilesResult, regionsResult] = await Promise.all([
      adminClient
        .from('custom_pdf_forms')
        .select('id, title, created_at, target_state, target_region, storage_path, requires_signature')
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
      fetchAllCustomFormAssignments(adminClient, 'form_id,user_id'),
      fetchAllProfiles(adminClient),
      adminClient.from('regions').select('id, name'),
    ]);

    const firstError =
      formsResult.error || assignmentsResult.error || profilesResult.error || regionsResult.error;
    if (firstError) {
      console.error('[CUSTOM-FORMS CALIFORNIA] Load error:', firstError);
      return NextResponse.json(
        { error: 'Failed to load custom forms', details: (firstError as any)?.message },
        { status: 500 },
      );
    }

    const profiles = profilesResult.data ?? [];

    // A region is a California region when most of its members live in CA.
    const regionTotals = new Map<string, { total: number; california: number }>();
    for (const profile of profiles) {
      if (!profile.region_id) continue;
      const totals = regionTotals.get(profile.region_id) ?? { total: 0, california: 0 };
      totals.total += 1;
      if (isCaliforniaState(profile.state)) totals.california += 1;
      regionTotals.set(profile.region_id, totals);
    }
    const regionNameById = new Map<string, string>(
      (regionsResult.data ?? []).map((region: any) => [region.id, region.name]),
    );
    const californiaRegionIds = new Set(
      Array.from(regionTotals.entries())
        .filter(([, totals]) => totals.california * 2 > totals.total)
        .map(([regionId]) => regionId),
    );

    const californiaUserIds = new Set(
      profiles
        .filter(
          (profile) =>
            isCaliforniaState(profile.state) ||
            (!!profile.region_id && californiaRegionIds.has(profile.region_id)),
        )
        .map((profile) => profile.user_id),
    );

    const recipientsByForm = new Map<string, { total: number; california: number }>();
    for (const assignment of assignmentsResult.data ?? []) {
      const counts = recipientsByForm.get(assignment.form_id) ?? { total: 0, california: 0 };
      counts.total += 1;
      if (californiaUserIds.has(assignment.user_id)) counts.california += 1;
      recipientsByForm.set(assignment.form_id, counts);
    }

    const forms = (formsResult.data ?? [])
      .map((form: any) => {
        const recipients = recipientsByForm.get(form.id) ?? { total: 0, california: 0 };
        const targetsCaliforniaState = isCaliforniaState(form.target_state);
        const targetsCaliforniaRegion =
          !!form.target_region && californiaRegionIds.has(form.target_region);

        if (!targetsCaliforniaState && !targetsCaliforniaRegion && recipients.california === 0) {
          return null;
        }

        const packet = parsePayrollPacketVirtualStoragePath(form.storage_path);
        return {
          id: form.id as string,
          title: form.title as string,
          created_at: form.created_at as string,
          requires_signature: !!form.requires_signature,
          kind: packet ? ('packet' as const) : ('upload' as const),
          packet_state: packet?.stateCode ?? null,
          packet_form: packet?.rawFormType ?? null,
          // Packet-based forms are downloaded from the public blank route so no
          // one's name gets stamped on them.
          blank_url: packet
            ? MEAL_WAIVER_BLANK_URLS[packet.formType] ?? getCustomFormPdfProxyPathFromStoragePath(form.storage_path)
            : null,
          // Some old packet sends point at a state route that does not exist
          // (e.g. AZ home venue); the shared route serves the same template.
          fallback_url: packet
            ? `/api/payroll-packet-common/${encodeURIComponent(packet.formType)}?state=${encodeURIComponent(packet.stateCode)}`
            : null,
          target_state: form.target_state ?? null,
          target_region_name:
            targetsCaliforniaRegion ? regionNameById.get(form.target_region) ?? null : null,
          california_recipients: recipients.california,
          total_recipients: recipients.total,
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      forms,
      california_regions: Array.from(californiaRegionIds)
        .map((id) => regionNameById.get(id))
        .filter(Boolean)
        .sort(),
    });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS CALIFORNIA] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
