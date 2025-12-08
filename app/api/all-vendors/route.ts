import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt, decryptData } from "@/lib/encryption";
import { isWithinRegion, calculateDistanceMiles } from "@/lib/geocoding";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
          first_name,
          last_name,
          phone,
          city,
          state,
          latitude,
          longitude,
          profile_photo_data,
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
        let profilePhotoUrl = null;

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

        // Convert binary profile photo (bytea) to data URL if exists
        if (vendor.profiles.profile_photo_data) {
          try {
            let photoData = vendor.profiles.profile_photo_data;

            // First, convert hex bytea to string if needed
            if (typeof photoData === 'string' && photoData.startsWith('\\x')) {
              const hexString = photoData.slice(2); // Remove \x prefix
              const buffer = Buffer.from(hexString, 'hex');
              photoData = buffer.toString('utf-8'); // Convert to string for decryption
            }

            // Check if photo data is encrypted (starts with U2FsdGVk = "Salted__" in base64)
            if (typeof photoData === 'string' && (photoData.startsWith('U2FsdGVk') || photoData.includes('Salted'))) {
              try {
                // Decrypt the binary photo data using decryptData() for binary data
                const decryptedBytes = decryptData(photoData);
                // Convert Uint8Array to base64
                const base64 = Buffer.from(decryptedBytes).toString('base64');
                profilePhotoUrl = `data:image/jpeg;base64,${base64}`;
              } catch (decryptError) {
                // Fallback: try treating it as a data URL string instead of binary
                try {
                  const decryptedText = decrypt(photoData);
                  if (decryptedText.startsWith('data:')) {
                    profilePhotoUrl = decryptedText;
                  }
                } catch (fallbackError) {
                  console.error('❌ Photo decryption failed for vendor:', vendor.id);
                }
              }
            } else if (Buffer.isBuffer(photoData)) {
              // Raw buffer - convert directly
              const base64 = photoData.toString('base64');
              profilePhotoUrl = `data:image/jpeg;base64,${base64}`;
            } else if (typeof photoData === 'string' && photoData.startsWith('data:')) {
              // Already a data URL
              profilePhotoUrl = photoData;
            }
          } catch (photoError) {
            console.error('❌ Error processing profile photo for vendor:', vendor.id, photoError);
          }
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
            profile_photo_url: profilePhotoUrl
          },
          region_id: vendor.profiles.region_id || null
        };
      });

    console.log('[ALL-VENDORS] 📦 Processed vendors (after decryption):', processedVendors.length);

    // Apply geographic filtering if enabled
    if (useGeoFilter && regionData && regionData.center_lat && regionData.center_lng) {
      console.log('[ALL-VENDORS] 🌍 Applying geographic filter:', {
        region: regionData.name,
        center: `${regionData.center_lat}, ${regionData.center_lng}`,
        radius: regionData.radius_miles
      });
      processedVendors = processedVendors
        .filter((vendor: any) => {
          // Only include vendors with valid coordinates that are within the region
          if (!vendor.profiles.latitude || !vendor.profiles.longitude) {
            console.log(`[ALL-VENDORS] ⚠️ Vendor ${vendor.id} excluded: missing coordinates`);
            return false;
          }

          const withinRegion = isWithinRegion(
            vendor.profiles.latitude,
            vendor.profiles.longitude,
            regionData.center_lat,
            regionData.center_lng,
            regionData.radius_miles
          );

          const distance = calculateDistanceMiles(
            vendor.profiles.latitude,
            vendor.profiles.longitude,
            regionData.center_lat,
            regionData.center_lng
          );

          console.log(`[ALL-VENDORS] 🔍 Vendor ${vendor.email}:`, {
            coordinates: `${vendor.profiles.latitude}, ${vendor.profiles.longitude}`,
            distance: `${Math.round(distance * 10) / 10} miles`,
            withinRegion,
            threshold: `${regionData.radius_miles} miles`
          });

          return withinRegion;
        })
        .map((vendor: any) => {
          // Add distance information for each vendor
          const distance = calculateDistanceMiles(
            vendor.profiles.latitude,
            vendor.profiles.longitude,
            regionData.center_lat,
            regionData.center_lng
          );

          return {
            ...vendor,
            // Expose a generic `distance` like other endpoints (e.g., available-vendors)
            distance: Math.round(distance * 10) / 10,
            distance_from_center: Math.round(distance * 10) / 10 // Round to 1 decimal place
          };
        })
        .sort((a: any, b: any) => {
          // Sort by distance from region center when using geo filter
          return a.distance_from_center - b.distance_from_center;
        });

      console.log('[ALL-VENDORS] ✅ Geographic filtering complete:', {
        filtered_count: processedVendors.length,
        sorted_by: 'distance'
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
        radius_miles: regionData.radius_miles
      } : null,
      geo_filtered: useGeoFilter && regionData != null
    }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in all-vendors list:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
