import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt, safeDecrypt } from "@/lib/encryption";
import {
  isWithinRegion,
  calculateDistanceMiles,
  FIXED_REGION_RADIUS_MILES,
  geocodeAddress,
  delay
} from "@/lib/geocoding";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const toPlainText = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return safeDecrypt(value).trim();
};

const normalizeStreetAddress = (address: string): string => {
  if (!address) return "";
  return address.replace(/^(\d+)([A-Z])/i, "$1 $2").trim();
};

const getProfile = (vendor: any) =>
  Array.isArray(vendor?.profiles) ? vendor.profiles[0] : vendor?.profiles;

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
    const regionId = searchParams.get('region_id');
    const useGeoFilter = searchParams.get('geo_filter') === 'true'; // Optional: use geographic proximity

    console.log('[ALL-VENDORS] 🔍 Query parameters:', { regionId, useGeoFilter });

    // Fetch region data if regionId is provided (for geographic filtering)
    let regionData: any = null;
    if (regionId && regionId !== 'all') {
      const { data: region, error: regionError } = await supabaseAdmin
        .from('regions')
        .select('id, name, center_lat, center_lng, radius_miles')
        .eq('id', regionId)
        .single();

      if (regionError) {
        console.error('[ALL-VENDORS] ❌ Error fetching region:', regionError);
      } else {
        console.log('[ALL-VENDORS] ✅ Region data fetched:', region);
      }

      regionData = region;
    }

    // Query all vendors (users with division 'vendor' or 'both')
    // IMPORTANT: Only select non-sensitive fields to avoid exposing encrypted data
    let vendorQuery = supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        role,
        division,
        is_active,
        profiles!inner (
          id,
          first_name,
          last_name,
          phone,
          address,
          city,
          state,
          zip_code,
          latitude,
          longitude,
          region_id
        )
      `)
      .in('division', ['vendor', 'both', 'trailers'])
      .eq('is_active', true);

    // Apply region filter if provided (database-level filtering by region_id)
    // Geographic filtering will be done after fetching, if enabled
    if (regionId && regionId !== 'all' && !useGeoFilter) {
      console.log('[ALL-VENDORS] 🔍 Applying database filter for region_id:', regionId);
      vendorQuery = vendorQuery.eq('profiles.region_id', regionId);
    } else if (useGeoFilter) {
      console.log('[ALL-VENDORS] 🌍 Geographic filtering will be applied after fetching');
    } else {
      console.log('[ALL-VENDORS] 🌐 Fetching all vendors (no region filter)');
    }

    const { data: vendors, error } = await vendorQuery;

    // Gather recent responders within the past week for these vendors (invitations sent by current user)
    let recentResponderSet = new Set<string>();
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

    if (error) {
      console.error('[ALL-VENDORS] ❌ SUPABASE SELECT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    console.log('[ALL-VENDORS] 📦 Raw vendors fetched:', vendors?.length || 0);

    // Geocode missing vendor coordinates on modal load and persist in profiles.
    if (vendors && vendors.length > 0) {
      const vendorsMissingCoords = vendors.filter((vendor: any) => {
        const profile = getProfile(vendor);
        return profile && (profile.latitude == null || profile.longitude == null);
      });

      console.log('[ALL-VENDORS] Vendors missing coordinates:', vendorsMissingCoords.length);

      for (let i = 0; i < vendorsMissingCoords.length; i++) {
        const vendor = vendorsMissingCoords[i];
        const profile = getProfile(vendor);
        if (!profile) continue;

        const address = normalizeStreetAddress(toPlainText(profile.address));
        const city = toPlainText(profile.city);
        const state = toPlainText(profile.state);
        const zipCode = toPlainText(profile.zip_code);

        if (!address && !city && !state && !zipCode) {
          console.log('[ALL-VENDORS] Skipping geocode (missing address fields):', {
            vendorId: vendor.id,
            hasAddress: !!address,
            hasCity: !!city,
            hasState: !!state,
            hasZip: !!zipCode
          });
          continue;
        }

        try {
          let geocodeResult = await geocodeAddress(
            address,
            city,
            state,
            zipCode || undefined
          );

          // Fallbacks for partially populated profile data
          if (!geocodeResult && (city || state || zipCode)) {
            geocodeResult = await geocodeAddress(
              "",
              city,
              state,
              zipCode || undefined
            );
          }
          if (!geocodeResult && address) {
            geocodeResult = await geocodeAddress(
              address,
              "",
              "",
              zipCode || undefined
            );
          }

          if (!geocodeResult) {
            console.log('[ALL-VENDORS] Geocoding returned no result for vendor:', vendor.id);
            continue;
          }

          let updateError: any = null;
          if (profile.id) {
            const { error } = await supabaseAdmin
              .from('profiles')
              .update({
                latitude: geocodeResult.latitude,
                longitude: geocodeResult.longitude
              })
              .eq('id', profile.id);
            updateError = error;
          } else {
            const { error } = await supabaseAdmin
              .from('profiles')
              .update({
                latitude: geocodeResult.latitude,
                longitude: geocodeResult.longitude
              })
              .eq('user_id', vendor.id);
            updateError = error;
          }

          if (updateError) {
            console.error('[ALL-VENDORS] Failed to persist geocoded coordinates:', {
              vendorId: vendor.id,
              profileId: profile.id,
              error: updateError.message
            });
            continue;
          }

          // Keep in-memory data in sync for this response.
          profile.latitude = geocodeResult.latitude;
          profile.longitude = geocodeResult.longitude;

          console.log('[ALL-VENDORS] Geocoded and saved vendor coordinates:', {
            vendorId: vendor.id,
            latitude: geocodeResult.latitude,
            longitude: geocodeResult.longitude
          });
        } catch (geocodeErr: any) {
          console.error('[ALL-VENDORS] Geocoding failed for vendor:', {
            vendorId: vendor.id,
            error: geocodeErr?.message || geocodeErr
          });
        }

        if (i < vendorsMissingCoords.length - 1) {
          await delay(1100);
        }
      }
    }

    // Debug: Show first vendor's region_id if any vendors exist
    if (vendors && vendors.length > 0) {
      const firstVendor = vendors[0] as any;
      console.log('[ALL-VENDORS] 🔍 Sample vendor data (first vendor):', {
        id: firstVendor.id,
        email: firstVendor.email,
        profiles_region_id: firstVendor.profiles?.region_id,
        has_profiles: !!firstVendor.profiles,
        profiles_type: Array.isArray(firstVendor.profiles) ? 'array' : typeof firstVendor.profiles,
        profiles_data: firstVendor.profiles
      });
    } else {
      console.log('[ALL-VENDORS] ⚠️ No vendors returned from database query');
    }

    // Debug: Count vendors by region_id
    if (vendors && vendors.length > 0) {
      const regionCounts: Record<string, number> = {};
      vendors.forEach((v: any) => {
        const rid = v.profiles?.region_id || 'null';
        regionCounts[rid] = (regionCounts[rid] || 0) + 1;
      });
      console.log('[ALL-VENDORS] 📊 Vendors by region_id:', regionCounts);
    }

    // Process vendors and decrypt sensitive data
    let processedVendors = (vendors ?? [])
      .map((vendor: any) => {
        // Decrypt sensitive profile data
        let firstName = '';
        let lastName = '';
        let phone = '';

        try {
          firstName = vendor.profiles.first_name
            ? decrypt(vendor.profiles.first_name)
            : '';
          lastName = vendor.profiles.last_name
            ? decrypt(vendor.profiles.last_name)
            : '';
          phone = vendor.profiles.phone
            ? decrypt(vendor.profiles.phone)
            : '';
        } catch (decryptError) {
          console.error('❌ Error decrypting vendor profile data:', decryptError);
          // Use fallback values
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
          region_id: vendor.profiles.region_id || null
        };
      });

    console.log('[ALL-VENDORS] 📦 Processed vendors (after decryption):', processedVendors.length);

    // Apply geographic filtering if enabled
    if (
      useGeoFilter &&
      regionData &&
      regionData.center_lat != null &&
      regionData.center_lng != null &&
      regionData.radius_miles != null
    ) {
      const effectiveRadiusMiles = FIXED_REGION_RADIUS_MILES;
      console.log('[ALL-VENDORS] Applying geographic filter:', {
        region: regionData.name,
        center: `${regionData.center_lat}, ${regionData.center_lng}`,
        radius: effectiveRadiusMiles
      });
      processedVendors = processedVendors
        .filter((vendor: any) => {
          const hasCoordinates =
            vendor.profiles.latitude != null && vendor.profiles.longitude != null;
          const matchesAssignedRegion = vendor.region_id === regionId;

          let withinRegion = false;
          let distance: number | null = null;

          if (hasCoordinates) {
            withinRegion = isWithinRegion(
              vendor.profiles.latitude,
              vendor.profiles.longitude,
              regionData.center_lat,
              regionData.center_lng,
              regionData.radius_miles
            );

            distance = calculateDistanceMiles(
              vendor.profiles.latitude,
              vendor.profiles.longitude,
              regionData.center_lat,
              regionData.center_lng
            );
          }

          const includeVendor = withinRegion || matchesAssignedRegion;

          console.log(`[ALL-VENDORS] Vendor ${vendor.email}:`, {
            coordinates: hasCoordinates
              ? `${vendor.profiles.latitude}, ${vendor.profiles.longitude}`
              : 'missing',
            distance: distance != null ? `${Math.round(distance * 10) / 10} miles` : null,
            withinRegion,
            matchesAssignedRegion,
            included: includeVendor,
            threshold: `${effectiveRadiusMiles} miles`
          });

          return includeVendor;
        })
        .map((vendor: any) => {
          const hasCoordinates =
            vendor.profiles.latitude != null && vendor.profiles.longitude != null;
          const distance = hasCoordinates
            ? calculateDistanceMiles(
                vendor.profiles.latitude,
                vendor.profiles.longitude,
                regionData.center_lat,
                regionData.center_lng
              )
            : null;
          const roundedDistance =
            distance != null ? Math.round(distance * 10) / 10 : null;

          return {
            ...vendor,
            distance: roundedDistance,
            distance_from_center: roundedDistance
          };
        })
        .sort((a: any, b: any) => {
          const aDistance =
            typeof a.distance_from_center === 'number' ? a.distance_from_center : null;
          const bDistance =
            typeof b.distance_from_center === 'number' ? b.distance_from_center : null;

          if (aDistance != null && bDistance != null) return aDistance - bDistance;
          if (aDistance != null) return -1;
          if (bDistance != null) return 1;

          const nameA = `${a.profiles.first_name} ${a.profiles.last_name}`.toLowerCase();
          const nameB = `${b.profiles.first_name} ${b.profiles.last_name}`.toLowerCase();
          return nameA.localeCompare(nameB);
        });

      console.log('[ALL-VENDORS] Geographic filtering complete:', {
        filtered_count: processedVendors.length,
        sorted_by: 'distance'
      });
    } else if (regionId && regionId !== 'all' && useGeoFilter) {
      processedVendors = processedVendors
        .filter((vendor: any) => vendor.region_id === regionId)
        .sort((a: any, b: any) => {
          const nameA = `${a.profiles.first_name} ${a.profiles.last_name}`.toLowerCase();
          const nameB = `${b.profiles.first_name} ${b.profiles.last_name}`.toLowerCase();
          return nameA.localeCompare(nameB);
        });

      console.log('[ALL-VENDORS] Geo filter requested but region geometry missing; used region_id fallback:', {
        regionId,
        count: processedVendors.length
      });
    } else {
      // Standard alphabetical sorting when not using geographic filter
      processedVendors = processedVendors.sort((a: any, b: any) => {
        const nameA = `${a.profiles.first_name} ${a.profiles.last_name}`.toLowerCase();
        const nameB = `${b.profiles.first_name} ${b.profiles.last_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });

      console.log('[ALL-VENDORS] ✅ Standard sorting complete:', {
        count: processedVendors.length,
        sorted_by: 'name'
      });
    }

    console.log('[ALL-VENDORS] 📤 Returning vendors:', {
      total: processedVendors.length,
      region: regionData?.name || 'all',
      geo_filtered: useGeoFilter && regionData != null,
      sample_emails: processedVendors.slice(0, 3).map((v: any) => v.email)
    });

    return NextResponse.json({
      vendors: processedVendors,
      region: regionData ? {
        id: regionData.id,
        name: regionData.name,
        center_lat: regionData.center_lat,
        center_lng: regionData.center_lng,
        radius_miles: FIXED_REGION_RADIUS_MILES
      } : null,
      geo_filtered: useGeoFilter && regionData != null
    }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in all-vendors list:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}

