import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_ROLES = ['admin', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'hr', 'exec'];
const VENDOR_BATCH_SIZE = 200;

type AvailabilityDay = {
  date: string;
  available: boolean;
};

type DailyAvailabilityValue = {
  available: boolean;
  submittedAt: string | null;
};

const normalizeAvailability = (payload: unknown): AvailabilityDay[] => {
  if (Array.isArray(payload)) {
    return payload.filter((day: any) => day && typeof day.date === 'string');
  }

  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>).map(([date, available]) => ({
      date,
      available: available === true,
    }));
  }

  return [];
};

const getAvailabilityScope = (payload: unknown) => {
  const dates = normalizeAvailability(payload)
    .map((day) => day.date?.slice(0, 10))
    .filter((date): date is string => Boolean(date));

  if (dates.length === 0) {
    return {
      scopeStart: null,
      scopeEnd: null,
    };
  }

  const sorted = [...new Set(dates)].sort();
  return {
    scopeStart: sorted[0] || null,
    scopeEnd: sorted[sorted.length - 1] || null,
  };
};

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const dec = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return safeDecrypt(value.trim());
  } catch {
    return value.trim();
  }
};

const getSubmissionTimestamp = (row: any) =>
  row?.responded_at || row?.updated_at || row?.created_at || null;

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();

  if (user?.id) return user;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', authedUser.id)
      .maybeSingle();

    const role = (userData?.role || '').toLowerCase().trim();
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const rangeStart = searchParams.get('start');
    const rangeEnd = searchParams.get('end');

    const { data: regions, error: regionsError } = await supabaseAdmin
      .from('regions')
      .select('id, name')
      .order('name', { ascending: true });

    if (regionsError) {
      return NextResponse.json({ error: regionsError.message }, { status: 500 });
    }

    const { data: rawVendors, error: vendorsError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        division,
        role,
        is_active,
        profiles!inner (
          id,
          first_name,
          last_name,
          region_id
        )
      `)
      .in('division', ['vendor', 'both', 'trailers'])
      .eq('is_active', true);

    if (vendorsError) {
      return NextResponse.json({ error: vendorsError.message }, { status: 500 });
    }

    const vendors = rawVendors || [];
    const profileIds = vendors
      .map((vendor: any) => (Array.isArray(vendor.profiles) ? vendor.profiles[0]?.id : vendor.profiles?.id))
      .filter((profileId: any): profileId is string => typeof profileId === 'string');

    const allowedProfileIds = new Set<string>();
    for (const batch of chunkArray(profileIds, VENDOR_BATCH_SIZE)) {
      const { data: onboardingRows, error: onboardingError } = await supabaseAdmin
        .from('vendor_onboarding_status')
        .select('profile_id')
        .in('profile_id', batch);

      if (onboardingError) {
        return NextResponse.json({ error: onboardingError.message }, { status: 500 });
      }

      (onboardingRows || []).forEach((row: any) => {
        if (row?.profile_id) allowedProfileIds.add(row.profile_id);
      });
    }

    const onboardedVendors = vendors.filter((vendor: any) => {
      const profileId = Array.isArray(vendor.profiles) ? vendor.profiles[0]?.id : vendor.profiles?.id;
      return typeof profileId === 'string' && allowedProfileIds.has(profileId);
    });

    const vendorIds = onboardedVendors.map((vendor: any) => vendor.id).filter(Boolean);
    const invitations: any[] = [];

    for (const batch of chunkArray(vendorIds, VENDOR_BATCH_SIZE)) {
      const { data: invitationRows, error: invitationsError } = await supabaseAdmin
        .from('vendor_invitations')
        .select('vendor_id, responded_at, updated_at, created_at, availability')
        .in('vendor_id', batch)
        .not('availability', 'is', null);

      if (invitationsError) {
        return NextResponse.json({ error: invitationsError.message }, { status: 500 });
      }

      invitations.push(...(invitationRows || []));
    }

    invitations.sort((left, right) => {
      const leftTime = getSubmissionTimestamp(left) || '';
      const rightTime = getSubmissionTimestamp(right) || '';
      return rightTime.localeCompare(leftTime);
    });

    const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dailyAvailabilityByVendor = new Map<string, Map<string, DailyAvailabilityValue>>();
    const latestAvailabilityByVendor = new Map<
      string,
      { respondedAt: string | null; scopeStart: string | null; scopeEnd: string | null }
    >();

    let minSubmittedDate: string | null = null;
    let maxSubmittedDate: string | null = null;
    let minAvailableDate: string | null = null;
    let maxAvailableDate: string | null = null;

    for (const invitation of invitations) {
      if (!invitation.vendor_id) continue;

      const vendorId = invitation.vendor_id as string;
      const respondedAt = getSubmissionTimestamp(invitation);
      if (!latestAvailabilityByVendor.has(vendorId)) {
        const { scopeStart, scopeEnd } = getAvailabilityScope(invitation.availability);
        latestAvailabilityByVendor.set(vendorId, {
          respondedAt,
          scopeStart,
          scopeEnd,
        });
      }

      if (!dailyAvailabilityByVendor.has(vendorId)) {
        dailyAvailabilityByVendor.set(vendorId, new Map());
      }

      const dailyAvailability = dailyAvailabilityByVendor.get(vendorId)!;
      for (const day of normalizeAvailability(invitation.availability)) {
        const dateStr = day.date.slice(0, 10);
        if (!dateStr) continue;
        if (!minSubmittedDate || dateStr < minSubmittedDate) minSubmittedDate = dateStr;
        if (!maxSubmittedDate || dateStr > maxSubmittedDate) maxSubmittedDate = dateStr;
        if (!dailyAvailability.has(dateStr)) {
          dailyAvailability.set(dateStr, {
            available: day.available === true,
            submittedAt: respondedAt,
          });
        }
      }
    }

    const vendorInfoMap = new Map<
      string,
      {
        id: string;
        name: string;
        email: string;
        division: string | null;
        region_id: string | null;
      }
    >();

    const vendorRows = onboardedVendors
      .map((vendor: any) => {
        const profile = Array.isArray(vendor.profiles) ? vendor.profiles[0] : vendor.profiles;
        const latestAvailability = latestAvailabilityByVendor.get(vendor.id);
        const firstName = dec(profile?.first_name);
        const lastName = dec(profile?.last_name);
        const name = `${firstName} ${lastName}`.trim() || vendor.email;

        vendorInfoMap.set(vendor.id, {
          id: vendor.id,
          name,
          email: vendor.email,
          division: vendor.division || null,
          region_id: profile?.region_id || null,
        });

        return {
          id: vendor.id,
          email: vendor.email,
          division: vendor.division || null,
          recently_responded: Boolean(latestAvailability?.respondedAt && latestAvailability.respondedAt >= weekAgoIso),
          has_submitted_availability: latestAvailabilityByVendor.has(vendor.id),
          availability_responded_at: latestAvailability?.respondedAt || null,
          availability_scope_start: latestAvailability?.scopeStart || null,
          availability_scope_end: latestAvailability?.scopeEnd || null,
          region_id: profile?.region_id || null,
          profiles: {
            first_name: firstName,
            last_name: lastName,
          },
          daily_availability: Object.fromEntries(
            Array.from(dailyAvailabilityByVendor.get(vendor.id)?.entries() || [])
              .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
              .map(([date, value]) => [date, value.available])
          ),
        };
      })
      .sort((left: any, right: any) => {
        const leftName = `${left.profiles.first_name} ${left.profiles.last_name}`.trim().toLowerCase() || left.email.toLowerCase();
        const rightName = `${right.profiles.first_name} ${right.profiles.last_name}`.trim().toLowerCase() || right.email.toLowerCase();
        return leftName.localeCompare(rightName);
      });

    const byDate: Record<string, any[]> = {};
    const calendarVendors = Array.from(vendorInfoMap.values())
      .map((vendorInfo) => {
        const allAvailableDates = Array.from(dailyAvailabilityByVendor.get(vendorInfo.id)?.entries() || [])
          .filter(([, value]) => value.available)
          .map(([date]) => date)
          .sort();
        const availableDates = allAvailableDates.filter((dateStr) => {
          if (rangeStart && dateStr < rangeStart) return false;
          if (rangeEnd && dateStr > rangeEnd) return false;
          return true;
        });

        availableDates.forEach((dateStr) => {
          if (!byDate[dateStr]) byDate[dateStr] = [];
          byDate[dateStr].push(vendorInfo);
        });

        return {
          ...vendorInfo,
          availableDates,
        };
      })
      .filter((vendor) => vendor.availableDates.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const vendor of calendarVendors) {
      for (const dateStr of vendor.availableDates) {
        if (!minAvailableDate || dateStr < minAvailableDate) minAvailableDate = dateStr;
        if (!maxAvailableDate || dateStr > maxAvailableDate) maxAvailableDate = dateStr;
      }
    }

    return NextResponse.json({
      regions: regions || [],
      vendors: vendorRows,
      calendarVendors,
      byDate,
      dataRange: {
        minSubmittedDate,
        maxSubmittedDate,
        minAvailableDate,
        maxAvailableDate,
      },
    });
  } catch (error: any) {
    console.error('[REPORTS][AVAILABILITY-BY-REGION]', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
