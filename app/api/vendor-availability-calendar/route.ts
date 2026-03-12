import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { decrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type AvailabilityDay = { date: string; available: boolean };

const normalizeAvailability = (payload: unknown): AvailabilityDay[] => {
  if (Array.isArray(payload)) {
    return payload.filter((d: any) => d && typeof d.date === 'string');
  }
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).map(([date, available]) => ({
      date,
      available: available === true,
    }));
  }
  return [];
};

/**
 * GET /api/vendor-availability-calendar
 *
 * Returns a date-keyed map of available vendors.
 * Query params:
 *   - region_id: filter vendors by assigned region (optional)
 *   - start:     ISO date string – only include dates >= start (optional)
 *   - end:       ISO date string – only include dates <= end (optional)
 *
 * Response:
 * {
 *   byDate: {
 *     "2025-06-01": [{ id, name, email, division, region_id }],
 *     ...
 *   },
 *   vendors: [{ id, name, email, division, region_id, availableDates: string[] }]
 * }
 */
export async function GET(req: NextRequest) {
  try {
    // Auth
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
        if (tokenUser?.user?.id) user = tokenUser.user as any;
      }
    }

    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const regionId = searchParams.get('region_id');
    const rangeStart = searchParams.get('start');
    const rangeEnd = searchParams.get('end');

    // Fetch vendors
    let vendorQuery = supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        division,
        role,
        profiles!inner (
          id,
          first_name,
          last_name,
          region_id
        )
      `)
      .in('division', ['vendor', 'both', 'trailers'])
      .eq('is_active', true);

    if (regionId && regionId !== 'all') {
      vendorQuery = vendorQuery.eq('profiles.region_id', regionId);
    }

    const { data: rawVendors, error: vendorError } = await vendorQuery;
    if (vendorError) {
      return NextResponse.json({ error: vendorError.message }, { status: 500 });
    }

    const vendors = rawVendors || [];
    const vendorIds = vendors.map((v: any) => v.id).filter(Boolean);

    if (vendorIds.length === 0) {
      return NextResponse.json({ byDate: {}, vendors: [] });
    }

    // Filter by onboarding status (same logic as all-vendors)
    const profileIds = vendors
      .map((v: any) =>
        Array.isArray(v.profiles) ? v.profiles[0]?.id : v.profiles?.id
      )
      .filter((id: any) => typeof id === 'string');

    const { data: onboardingRows } = await supabaseAdmin
      .from('vendor_onboarding_status')
      .select('profile_id')
      .in('profile_id', profileIds);

    const allowedProfileIds = new Set((onboardingRows || []).map((r: any) => r.profile_id));
    const onboardedVendors = vendors.filter((v: any) => {
      const pid = Array.isArray(v.profiles) ? v.profiles[0]?.id : v.profiles?.id;
      return typeof pid === 'string' && allowedProfileIds.has(pid);
    });

    const onboardedIds = onboardedVendors.map((v: any) => v.id);

    // Fetch ALL availability submissions per vendor (not just the latest one).
    // A vendor may have been invited to multiple events and submitted separate
    // availability for each — we need to merge all of them.
    const { data: invitations, error: invError } = await supabaseAdmin
      .from('vendor_invitations')
      .select('vendor_id, availability')
      .in('vendor_id', onboardedIds)
      .not('availability', 'is', null);

    if (invError) {
      return NextResponse.json({ error: invError.message }, { status: 500 });
    }

    // Accumulate every available date across ALL invitations per vendor
    const allDatesByVendor = new Map<string, Set<string>>();
    for (const inv of invitations || []) {
      if (!inv.vendor_id) continue;
      if (!allDatesByVendor.has(inv.vendor_id)) {
        allDatesByVendor.set(inv.vendor_id, new Set());
      }
      const dateSet = allDatesByVendor.get(inv.vendor_id)!;
      for (const day of normalizeAvailability(inv.availability)) {
        if (day.available && day.date) {
          const dateStr = day.date.slice(0, 10);
          if (dateStr) dateSet.add(dateStr);
        }
      }
    }

    // Build vendor info map (decrypt names)
    const vendorInfoMap = new Map<
      string,
      { id: string; name: string; email: string; division: string | null; region_id: string | null }
    >();

    for (const v of onboardedVendors) {
      const profile = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
      let firstName = '';
      let lastName = '';
      try {
        firstName = profile?.first_name ? decrypt(profile.first_name) : '';
        lastName = profile?.last_name ? decrypt(profile.last_name) : '';
      } catch {
        firstName = 'Vendor';
      }
      const name = `${firstName} ${lastName}`.trim() || v.email;
      vendorInfoMap.set(v.id, {
        id: v.id,
        name,
        email: v.email,
        division: v.division || null,
        region_id: profile?.region_id || null,
      });
    }

    // Build date → vendor list map and vendor → available dates
    const byDate: Record<string, { id: string; name: string; email: string; division: string | null; region_id: string | null }[]> = {};
    const vendorDatesMap = new Map<string, string[]>();

    for (const [vendorId, dateSet] of allDatesByVendor.entries()) {
      const info = vendorInfoMap.get(vendorId);
      if (!info) continue;

      const availableDates: string[] = [];

      for (const dateStr of dateSet) {
        // Apply date range filter if provided
        if (rangeStart && dateStr < rangeStart) continue;
        if (rangeEnd && dateStr > rangeEnd) continue;

        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push(info);
        availableDates.push(dateStr);
      }

      vendorDatesMap.set(vendorId, availableDates.sort());
    }

    // Build flat vendor list with their available dates
    const vendorList = Array.from(vendorInfoMap.values())
      .map((info) => ({
        ...info,
        availableDates: vendorDatesMap.get(info.id) || [],
      }))
      .filter((v) => v.availableDates.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ byDate, vendors: vendorList }, { status: 200 });
  } catch (err: any) {
    console.error('[VENDOR-AVAILABILITY-CALENDAR] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
