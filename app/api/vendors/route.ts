import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt, decryptData } from "@/lib/encryption";

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

    if (!venueName) {
      return NextResponse.json({ error: 'Venue name is required' }, { status: 400 });
    }

    // Get venue coordinates from venue_reference table
    const { data: venueData, error: venueError } = await supabaseAdmin
      .from('venue_reference')
      .select('latitude, longitude, city, state')
      .eq('venue_name', venueName)
      .single();

    if (venueError || !venueData) {
      console.error('Venue not found in venue_reference:', venueName, venueError);
      return NextResponse.json({
        error: 'Venue not found in venue_reference table. Please ensure the venue exists with coordinates.',
        venueName,
        details: venueError
      }, { status: 404 });
    }

    const { latitude: venueLat, longitude: venueLon } = venueData;

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
      .in('division', ['vendor', 'both'])
      .eq('is_active', true);

    // Apply region filter if provided
    if (regionId && regionId !== 'all') {
      vendorQuery = vendorQuery.eq('profiles.region_id', regionId);
    }

    const { data: vendors, error } = await vendorQuery;

    if (error) {
      console.error('SUPABASE SELECT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    // Calculate distance for vendors with coordinates, and sort by proximity (closest first)
    // Vendors without coordinates will appear at the end
    const vendorsWithDistance = (vendors ?? [])
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
          region_id: vendor.profiles.region_id || null,
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
