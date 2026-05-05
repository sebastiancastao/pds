import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Haversine formula to calculate distance in miles between two coordinates
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
  'district of columbia': 'dc',
};

function normalizeStateKey(value: unknown): string {
  const normalized = normalizeText(value).replace(/\./g, '').replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  return STATE_NAME_TO_CODE[normalized] || normalized;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }
    if (!user || !user.id) {
      console.error('No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(req.url);
    const venueName = searchParams.get('venue');
    const regionId = searchParams.get('region_id');
    const venueCity = searchParams.get('city');
    const venueState = searchParams.get('state');
    const slim = searchParams.get('slim') === 'true';
    const useVenueRegion = searchParams.get('use_venue_region') === 'true';

    if (!venueName) {
      return NextResponse.json({ error: 'Venue name is required' }, { status: 400 });
    }

    // Get venue coordinates and region from venue_reference table
    const { data: venueMatches, error: venueError } = await supabaseAdmin
      .from('venue_reference')
      .select('id, venue_name, latitude, longitude, city, state, region_id')
      .eq('venue_name', venueName);

    if (venueError || !Array.isArray(venueMatches) || venueMatches.length === 0) {
      console.error('Venue not found in venue_reference:', venueName, venueError);
      return NextResponse.json({
        error: 'Venue not found in venue_reference table. Please ensure the venue exists with coordinates.',
        venueName,
        details: venueError
      }, { status: 404 });
    }

    const normalizedVenueName = normalizeText(venueName);
    const normalizedVenueCity = normalizeText(venueCity);
    const normalizedVenueState = normalizeStateKey(venueState);
    const sameNameVenueMatches = venueMatches.filter(
      (candidate: any) => normalizeText(candidate?.venue_name) === normalizedVenueName
    );
    const exactVenueMatches = sameNameVenueMatches.filter((candidate: any) => {
      const cityMatches =
        !normalizedVenueCity || normalizeText(candidate?.city) === normalizedVenueCity;
      const stateMatches =
        !normalizedVenueState || normalizeStateKey(candidate?.state) === normalizedVenueState;
      return cityMatches && stateMatches;
    });
    const venueCandidates = exactVenueMatches.length > 0 ? exactVenueMatches : sameNameVenueMatches;
    const venueData = venueCandidates[0] || venueMatches[0];

    const { latitude: venueLat, longitude: venueLon } = venueData;
    const venueRegionId =
      typeof venueData?.region_id === 'string' ? venueData.region_id.trim() : '';

    if (!venueLat || !venueLon) {
      console.error('Venue coordinates missing for:', venueName, { latitude: venueLat, longitude: venueLon });
      return NextResponse.json({
        error: 'Venue coordinates not available in database',
        venueName,
        venueData
      }, { status: 400 });
    }

    // Query all vendors (users with division 'vendor' or 'both')
    // Include vendors with AND without coordinates
    // IMPORTANT: Only select non-sensitive fields to avoid exposing encrypted data
    const profileFields = slim
      ? 'first_name, last_name, city, state, latitude, longitude, region_id'
      : 'first_name, last_name, phone, city, state, latitude, longitude, region_id';

    let vendorQuery = supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        role,
        division,
        is_active,
        profiles!inner (
          ${profileFields}
        )
      `)
      .in('division', ['vendor', 'both', 'trailers'])
      .eq('is_active', true);

    // Preserve the branch's default venue-region filtering, but allow callers
    // to fail fast when they explicitly require a configured venue region.
    const explicitRegionId = (regionId && regionId !== 'all') ? regionId : null;
    const effectiveRegionId = explicitRegionId || venueRegionId || null;
    if (useVenueRegion && !effectiveRegionId) {
      return NextResponse.json(
        { error: 'This venue does not have a region configured in venue_reference.' },
        { status: 422 }
      );
    }
    if (effectiveRegionId) {
      vendorQuery = vendorQuery.eq('profiles.region_id', effectiveRegionId);
    }

    const { data: vendors, error } = await vendorQuery;

    // Compute recent availability responders in the past 7 days (skipped in slim mode)
    let recentResponderSet = new Set<string>();
    if (!slim) {
      try {
        const vendorIds = (vendors || []).map((v: any) => v.id);
        if (vendorIds.length > 0) {
          const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const { data: recent, error: recentErr } = await supabaseAdmin
            .from('vendor_invitations')
            .select('vendor_id, responded_at')
            .in('vendor_id', vendorIds)
            .eq('invited_by', (user as any).id)
            .gte('responded_at', weekAgoIso);
          if (!recentErr && Array.isArray(recent)) {
            recentResponderSet = new Set(recent.map((r: any) => r.vendor_id));
          }
        }
      } catch {}
    }

    if (error) {
      console.error('SUPABASE SELECT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    const regionVendorIdSet = new Set((vendors || []).map((vendor: any) => String(vendor?.id || '')).filter(Boolean));
    const assignedToVenueIds = new Set<string>();

    const venueId = String((venueData as any)?.id || '').trim();
    if (venueId) {
      // Fetch ALL venue assignments regardless of region so in-venue vendors outside the region are included
      const { data: venueAssignments, error: venueAssignmentsError } = await supabaseAdmin
        .from('vendor_venue_assignments')
        .select('vendor_id')
        .eq('venue_id', venueId);

      if (venueAssignmentsError) {
        console.error('Error loading vendor venue assignments:', venueAssignmentsError);
      } else {
        (venueAssignments || []).forEach((assignment: any) => {
          const vendorId = String(assignment?.vendor_id || '').trim();
          if (vendorId) assignedToVenueIds.add(vendorId);
        });
      }
    }

    // Normal venue pickers on this branch include in-venue vendors even when they
    // fall outside the venue's region. The close-event notification flow opts out
    // by setting use_venue_region=true so recipients stay region-only.
    let allVendors = [...(vendors || [])];
    const missingInVenueIds = useVenueRegion
      ? []
      : Array.from(assignedToVenueIds).filter(id => !regionVendorIdSet.has(id));
    if (missingInVenueIds.length > 0) {
      const { data: extraVendors } = await supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          role,
          division,
          is_active,
          profiles!inner (
            ${profileFields}
          )
        `)
        .in('id', missingInVenueIds)
        .in('division', ['vendor', 'both', 'trailers'])
        .eq('is_active', true);

      if (extraVendors && extraVendors.length > 0) {
        allVendors = [...allVendors, ...extraVendors];
      }
    }

    // Calculate distance for vendors with coordinates, and sort by proximity (closest first)
    // Vendors without coordinates will appear at the end
    const vendorsWithDistance = allVendors
      .map((vendor: any) => {
        // Calculate distance only if vendor has coordinates
        let distance: number | null = null;
        const hasCoordinates = vendor.profiles.latitude != null && vendor.profiles.longitude != null;

        if (hasCoordinates) {
          distance = calculateDistance(
            venueLat,
            venueLon,
            vendor.profiles.latitude,
            vendor.profiles.longitude
          );
        }

        // Decrypt sensitive profile data
        let firstName = '';
        let lastName = '';
        let phone = '';

        try {
          firstName = vendor.profiles.first_name ? decrypt(vendor.profiles.first_name) : '';
          lastName = vendor.profiles.last_name ? decrypt(vendor.profiles.last_name) : '';
          if (!slim) {
            phone = vendor.profiles.phone ? decrypt(vendor.profiles.phone) : '';
          }
        } catch (decryptError) {
          console.error('❌ Error decrypting vendor profile data:', decryptError);
          firstName = 'Vendor';
          lastName = '';
          phone = '';
        }


        // Explicitly construct the response object to avoid exposing sensitive/encrypted fields
        return {
          id: vendor.id,
          email: vendor.email,
          role: vendor.role,
          division: vendor.division,
          is_active: vendor.is_active,
          recently_responded: recentResponderSet.has(vendor.id),
          profiles: {
            first_name: firstName,
            last_name: lastName,
            phone: phone,
            city: vendor.profiles.city,
            state: vendor.profiles.state,
            latitude: vendor.profiles.latitude,
            longitude: vendor.profiles.longitude,
            profile_photo_url: null
          },
          region_id: vendor.profiles.region_id || null,
          isOutOfVenue: !assignedToVenueIds.has(String(vendor.id || '')),
          distance: distance !== null ? Math.round(distance * 10) / 10 : null, // Round to 1 decimal place or null
          hasCoordinates: hasCoordinates
        };
      })
      .sort((a: any, b: any) => {
        // Vendors with coordinates come first, sorted by distance
        if (a.hasCoordinates && !b.hasCoordinates) return -1;
        if (!a.hasCoordinates && b.hasCoordinates) return 1;

        // Both have coordinates: sort by distance
        if (a.hasCoordinates && b.hasCoordinates) {
          return (a.distance || 0) - (b.distance || 0);
        }

        // Both don't have coordinates: sort alphabetically by name
        const nameA = `${a.profiles.first_name} ${a.profiles.last_name}`.toLowerCase();
        const nameB = `${b.profiles.first_name} ${b.profiles.last_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

    return NextResponse.json({
      vendors: vendorsWithDistance,
      venue: {
        name: venueName,
        city: venueData.city,
        state: venueData.state
      }
    }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in vendors list:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
