import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';
import { calculateDistanceMiles, geocodeAddress, delay } from '@/lib/geocoding';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    // Validate auth via cookie session or bearer token
    const routeClient = createRouteHandlerClient({ cookies });
    let { data: { user } } = await routeClient.auth.getUser();

    if (!user) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } }
        });
        const { data: tokenUser, error: tokenError } = await supabaseAnon.auth.getUser(token);
        if (!tokenError && tokenUser?.user) {
          user = tokenUser.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Verify caller is exec or admin
    const { data: callerData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!callerData || !['exec', 'admin'].includes(callerData.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch all vendors with their profiles and region
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        division,
        is_active,
        profiles (
          first_name,
          last_name,
          phone,
          address,
          city,
          state,
          zip_code,
          latitude,
          longitude,
          region_id,
          regions (
            name
          )
        )
      `)
      .in('division', ['vendor', 'trailers', 'both'])
      .eq('is_active', true)
      .order('id');

    if (vendorsError) {
      console.error('[VENDOR_ROSTER_VENUES] Error fetching vendors:', vendorsError);
      return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
    }

    // Fetch all venues (include full_address for geocoding fallback)
    const { data: venuesRaw, error: venuesError } = await supabaseAdmin
      .from('venue_reference')
      .select('id, venue_name, city, state, full_address, latitude, longitude')
      .order('venue_name');

    if (venuesError) {
      console.error('[VENDOR_ROSTER_VENUES] Error fetching venues:', venuesError);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    // --- Geocode venues missing coordinates ---
    const venues = [...(venuesRaw ?? [])];
    for (let i = 0; i < venues.length; i++) {
      const venue = venues[i];
      if (venue.latitude == null || venue.longitude == null) {
        console.log(`[VENDOR_ROSTER_VENUES] Geocoding venue: ${venue.venue_name}`);
        const addressStr = venue.full_address || '';
        const geo = await geocodeAddress(addressStr, venue.city, venue.state);
        if (geo) {
          venues[i] = { ...venue, latitude: geo.latitude, longitude: geo.longitude };
          // Persist so future calls skip geocoding
          await supabaseAdmin
            .from('venue_reference')
            .update({ latitude: geo.latitude, longitude: geo.longitude })
            .eq('id', venue.id);
        }
        // Respect Nominatim rate limit
        if (i < venues.length - 1) await delay(1100);
      }
    }

    // --- Geocode vendors missing coordinates ---
    const vendorCoords: Record<string, { lat: number; lon: number }> = {};
    for (const v of vendors ?? []) {
      const profile = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
      if (!profile) continue;

      let lat: number | null = profile.latitude ?? null;
      let lon: number | null = profile.longitude ?? null;

      if (lat == null || lon == null) {
        const addressRaw = profile.address ? safeDecrypt(profile.address) : '';
        const zip = profile.zip_code ? safeDecrypt(profile.zip_code) : '';
        if (addressRaw && profile.city && profile.state) {
          console.log(`[VENDOR_ROSTER_VENUES] Geocoding vendor: ${v.email}`);
          const geo = await geocodeAddress(addressRaw, profile.city, profile.state, zip || undefined);
          if (geo) {
            lat = geo.latitude;
            lon = geo.longitude;
            // Persist
            await supabaseAdmin
              .from('profiles')
              .update({ latitude: lat, longitude: lon })
              .eq('user_id', v.id);
          }
          await delay(1100);
        }
      }

      if (lat != null && lon != null) {
        vendorCoords[v.id] = { lat, lon };
      }
    }

    // Build response rows
    const rows = (vendors ?? []).map((v: any) => {
      const profile = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const phone = profile?.phone ? safeDecrypt(profile.phone) : '';
      const address = profile?.address ? safeDecrypt(profile.address) : '';
      const zipCode = profile?.zip_code ? safeDecrypt(profile.zip_code) : '';

      const regionData = profile?.regions;
      const regionName = Array.isArray(regionData)
        ? (regionData[0]?.name ?? 'Unassigned')
        : (regionData?.name ?? 'Unassigned');

      const coords = vendorCoords[v.id] ?? null;
      const vendorLat = coords?.lat ?? profile?.latitude ?? null;
      const vendorLon = coords?.lon ?? profile?.longitude ?? null;

      // Calculate distance to each venue
      const venueDistances: Record<string, string> = {};
      for (const venue of venues) {
        const key = `${venue.venue_name} (${venue.city}, ${venue.state})`;
        if (
          vendorLat != null &&
          vendorLon != null &&
          venue.latitude != null &&
          venue.longitude != null
        ) {
          const dist = calculateDistanceMiles(vendorLat, vendorLon, venue.latitude, venue.longitude);
          venueDistances[key] = `${dist.toFixed(1)} mi`;
        } else {
          venueDistances[key] = 'N/A';
        }
      }

      return {
        first_name: firstName,
        last_name: lastName,
        email: v.email,
        phone,
        address,
        city: profile?.city ?? '',
        state: profile?.state ?? '',
        zip_code: zipCode,
        division: v.division,
        region: regionName,
        ...venueDistances,
      };
    });

    return NextResponse.json({
      vendors: rows,
      venues: venues.map((v: any) => ({
        id: v.id,
        name: v.venue_name,
        city: v.city,
        state: v.state,
      })),
    }, { status: 200 });
  } catch (err: any) {
    console.error('[VENDOR_ROSTER_VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
