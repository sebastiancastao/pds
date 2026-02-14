import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";
import { FIXED_REGION_RADIUS_MILES } from "@/lib/geocoding";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Haversine formula to calculate distance in miles
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
  return R * c;
}

type AvailabilityDay = {
  date: string;
  available: boolean;
};

function normalizeAvailabilityPayload(payload: unknown): AvailabilityDay[] {
  if (Array.isArray(payload)) {
    return payload.filter((day: any) => day && typeof day.date === "string");
  }

  // Backward compatibility for malformed legacy rows where availability
  // was stored as an object map (e.g. { "2026-02-13": true }).
  if (payload && typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>)
      .filter(([date]) => typeof date === "string")
      .map(([date, available]) => ({
        date,
        available: available === true
      }));
  }

  return [];
}

/**
 * GET /api/events/[id]/available-vendors
 * Get vendors who have confirmed availability for this event's date
 * Query params:
 *  - region_id: Filter by region
 *  - geo_filter: Use geographic filtering (distance from region center)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    const supabase = createRouteHandlerClient({ cookies });

    // Get query params
    const { searchParams } = new URL(req.url);
    const regionId = searchParams.get('region_id');
    const geoFilter = searchParams.get('geo_filter') === 'true';

    console.log('[AVAILABLE-VENDORS] 🔍 Query params:', { eventId, regionId, geoFilter });

    // Authenticate user
    let { data: { user } } = await supabase.auth.getUser();

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
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get requester role for authorization
    const { data: requester, error: requesterError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (requesterError || !requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const requesterRole = String(requester.role || '').toLowerCase();
    const canAccessAllEvents = requesterRole === 'exec' || requesterRole === 'admin';

    // Get event details
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('event_date, venue, created_by')
      .eq('id', eventId)
      .single();

    console.log('🔍 DEBUG - Event Details:', {
      eventId,
      event,
      eventError
    });

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Managers can access their own events. Exec/Admin can access all events.
    if (!canAccessAllEvents && event.created_by !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get venue coordinates
    const { data: venueData, error: venueError } = await supabaseAdmin
      .from('venue_reference')
      .select('latitude, longitude')
      .eq('venue_name', event.venue)
      .single();

    console.log('🔍 DEBUG - Venue Lookup:', {
      venueName: event.venue,
      venueData,
      venueError
    });

    if (venueError || !venueData) {
      console.log('❌ Venue not found, returning empty vendors list');
      return NextResponse.json({
        error: 'Venue not found',
        vendors: []
      }, { status: 200 });
    }

    // Get all vendor invitations that include this event date
    // NOTE: We do NOT filter by event_teams - vendors can work multiple events!
    let invitationsQuery = supabaseAdmin
      .from('vendor_invitations')
      .select(`
        vendor_id,
        availability,
        invitation_type,
        status,
        responded_at
      `)
      .eq('invitation_type', 'bulk')
      .eq('status', 'accepted')
      .not('responded_at', 'is', null)
      .not('availability', 'is', null);

    const { data: invitations, error: invitationsError } = await invitationsQuery;

    console.log('🔍 DEBUG - Invitations Query:', {
      userId: user.id,
      requesterRole,
      invitationsCount: invitations?.length || 0,
      invitationsError
    });

    if (invitationsError) {
      console.error('❌ Error fetching invitations:', invitationsError);
      return NextResponse.json({
        vendors: []
      }, { status: 200 });
    }

    // Filter vendors who are available on this event date
    // IMPORTANT: This does NOT check if they're on other event teams
    const eventDateKey =
      typeof event.event_date === "string"
        ? event.event_date.slice(0, 10)
        : new Date(event.event_date).toISOString().slice(0, 10);
    console.log('🔍 DEBUG - Event Date for Comparison:', event.event_date, 'normalized:', eventDateKey);

    const availableVendorIds = (invitations || [])
      .map((inv, index) => {
        console.log(`🔍 DEBUG - Processing Invitation ${index + 1}:`, {
          vendor_id: inv.vendor_id,
          has_availability: !!inv.availability,
          status: inv.status
        });

        if (!inv.availability) {
          console.log(`  ❌ No availability data for vendor ${inv.vendor_id}`);
          return null;
        }

        const availability = normalizeAvailabilityPayload(inv.availability);
        console.log(`  📅 Checking ${availability.length} days for vendor ${inv.vendor_id}`);

        const isAvailable = availability.some((day: any) => {
          const dayDate = typeof day?.date === "string" ? day.date.slice(0, 10) : "";
          const match = dayDate === eventDateKey && day.available === true;
          if (dayDate === eventDateKey) {
            console.log(`  🎯 Found matching date: ${dayDate}, available: ${day.available}, match: ${match}`);
          }
          return match;
        });

        if (isAvailable) {
          console.log(`  ✅ Vendor ${inv.vendor_id} is available on ${eventDateKey}`);
          return inv.vendor_id;
        } else {
          console.log(`  ❌ Vendor ${inv.vendor_id} is NOT available on ${eventDateKey}`);
          return null;
        }
      })
      .filter(id => id !== null);
    const uniqueAvailableVendorIds = Array.from(new Set(availableVendorIds));

    console.log('🔍 DEBUG - Available Vendor IDs (NO EVENT_TEAMS FILTERING):', uniqueAvailableVendorIds);

    if (uniqueAvailableVendorIds.length === 0) {
      console.log('❌ No available vendors found for this date');
      return NextResponse.json({
        vendors: []
      }, { status: 200 });
    }

    // Get vendor details for available vendors
    // NO filtering by event_teams - vendors can work multiple events!
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        role,
        division,
        is_active,
        region_id,
        profiles!inner (
          first_name,
          last_name,
          phone,
          city,
          state,
          latitude,
          longitude,
          region_id
        )
      `)
      .in('id', uniqueAvailableVendorIds)
      .eq('is_active', true);

    console.log('🔍 DEBUG - Vendor Details Query:', {
      availableVendorIds: uniqueAvailableVendorIds,
      vendorsCount: vendors?.length || 0,
      vendorsError
    });

    if (vendorsError) {
      console.error('❌ Error fetching vendors:', vendorsError);
      return NextResponse.json({
        vendors: []
      }, { status: 200 });
    }

    let filteredVendors = vendors || [];

    // Apply region filtering if specified
    if (regionId && regionId !== 'all') {
      console.log('[AVAILABLE-VENDORS] 🌍 Applying region filter:', { regionId, geoFilter });

      if (geoFilter) {
        // Geographic filtering: filter by distance from region center
        const { data: regionData } = await supabaseAdmin
          .from('regions')
          .select('center_lat, center_lng, radius_miles')
          .eq('id', regionId)
          .single();

        if (regionData) {
          console.log('[AVAILABLE-VENDORS] 📍 Region center:', {
            lat: regionData.center_lat,
            lng: regionData.center_lng,
            radius: FIXED_REGION_RADIUS_MILES
          });

          filteredVendors = filteredVendors.filter((vendor: any) => {
            if (!vendor.profiles.latitude || !vendor.profiles.longitude) {
              console.log(`  ⚠️ Vendor ${vendor.id} has no coordinates, excluding`);
              return false;
            }

            const distance = calculateDistance(
              regionData.center_lat,
              regionData.center_lng,
              vendor.profiles.latitude,
              vendor.profiles.longitude
            );

            const isInRegion = distance <= FIXED_REGION_RADIUS_MILES;
            console.log(`  ${isInRegion ? '✅' : '❌'} Vendor ${vendor.profiles.first_name} ${vendor.profiles.last_name}: ${distance.toFixed(1)}mi (limit: ${FIXED_REGION_RADIUS_MILES}mi)`);
            return isInRegion;
          });

          console.log('[AVAILABLE-VENDORS] ✅ After geo filter:', filteredVendors.length, 'vendors');
        }
      } else {
        // Simple region_id filtering
        console.log('[AVAILABLE-VENDORS] 🔍 Filtering by region_id field');
        filteredVendors = filteredVendors.filter((vendor: any) => {
          // Check if vendor has region_id in profiles or users table
          const vendorRegionId = vendor.region_id || vendor.profiles?.region_id;
          const matches = vendorRegionId === regionId;
          console.log(`  ${matches ? '✅' : '❌'} Vendor ${vendor.profiles.first_name} ${vendor.profiles.last_name}: region_id=${vendorRegionId}`);
          return matches;
        });
        console.log('[AVAILABLE-VENDORS] ✅ After region_id filter:', filteredVendors.length, 'vendors');
      }
    }

    // Calculate distances and sort by proximity
    const vendorsWithDistance = filteredVendors
      .map((vendor: any) => {
        // Decrypt sensitive profile fields for display
        let firstName = '';
        let lastName = '';
        let phone = '';
        try {
          firstName = vendor.profiles?.first_name ? decrypt(vendor.profiles.first_name) : '';
          lastName = vendor.profiles?.last_name ? decrypt(vendor.profiles.last_name) : '';
          phone = vendor.profiles?.phone ? decrypt(vendor.profiles.phone) : '';
        } catch (_) {
          // fallback to blanks if decryption fails
          firstName = firstName || 'Vendor';
          lastName = lastName || '';
          phone = phone || '';
        }
        let distance: number | null = null;
        if (vendor.profiles.latitude != null && vendor.profiles.longitude != null) {
          distance = calculateDistance(
            venueData.latitude,
            venueData.longitude,
            vendor.profiles.latitude,
            vendor.profiles.longitude
          );
        }
        return {
          id: vendor.id,
          email: vendor.email,
          role: vendor.role,
          division: vendor.division,
          is_active: vendor.is_active,
          region_id: vendor.region_id,
          profiles: {
            first_name: firstName,
            last_name: lastName,
            phone: phone,
            city: vendor.profiles.city,
            state: vendor.profiles.state,
            latitude: vendor.profiles.latitude,
            longitude: vendor.profiles.longitude,
            region_id: vendor.profiles.region_id
          },
          distance: distance !== null ? Math.round(distance * 10) / 10 : null
        };
      })
      .sort((a: any, b: any) => {
        const nameA = `${a.profiles.first_name} ${a.profiles.last_name}`.trim().toLowerCase();
        const nameB = `${b.profiles.first_name} ${b.profiles.last_name}`.trim().toLowerCase();
        return nameA.localeCompare(nameB);
      });

    console.log('✅ DEBUG - Final Result:', {
      vendorsWithDistanceCount: vendorsWithDistance.length,
      vendorNames: vendorsWithDistance.map((v: any) => `${v.profiles.first_name} ${v.profiles.last_name} (${v.distance}mi)`)
    });

    return NextResponse.json({
      vendors: vendorsWithDistance
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in available-vendors endpoint:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch available vendors'
    }, { status: 500 });
  }
}

