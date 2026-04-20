import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { canUserAccessLoadedEvent } from "@/lib/event-access";
import { decrypt } from "@/lib/encryption";
import { FIXED_REGION_RADIUS_MILES, geocodeAddress } from "@/lib/geocoding";

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
  allDay?: boolean;   // undefined or true = all day; false = partial
  startTime?: string; // "HH:MM"
  endTime?: string;   // "HH:MM"
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

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

const MIN_OVERLAP_MINUTES = 1; // Include vendors with any positive overlap

/**
 * Returns the number of minutes that two time windows overlap.
 * Times are "HH:MM" or "HH:MM:SS" strings (24-hour).
 * Supports ranges that cross midnight (e.g. 23:00-01:00).
 */
function overlapMinutes(
  vendorStart: string,
  vendorEnd: string,
  eventStart: string,
  eventEnd: string
): number {
  const toMins = (t: string) => {
    const [h, m = "0"] = t.slice(0, 5).split(":");
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  };

  const toSegments = (startRaw: string, endRaw: string): Array<[number, number]> => {
    const start = toMins(startRaw);
    const end = toMins(endRaw);

    // Same-day range.
    if (end > start) return [[start, end]];

    // Cross-midnight range (or equal times, which is treated as crossing midnight window).
    return [
      [start, 24 * 60],
      [0, end],
    ];
  };

  const vendorSegments = toSegments(vendorStart, vendorEnd);
  const eventSegments = toSegments(eventStart, eventEnd);

  let total = 0;
  for (const [vs, ve] of vendorSegments) {
    for (const [es, ee] of eventSegments) {
      const overlapStart = Math.max(vs, es);
      const overlapEnd = Math.min(ve, ee);
      total += Math.max(0, overlapEnd - overlapStart);
    }
  }

  return total;
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

    // Get event details
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('event_date, start_time, end_time, venue, city, state, created_by')
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

    const allowed = await canUserAccessLoadedEvent(
      supabaseAdmin,
      {
        id: eventId,
        created_by: String(event.created_by || '').trim() || null,
        venue: String(event.venue || '').trim() || null,
      },
      {
        userId: user.id,
        role: requesterRole,
      }
    );

    if (!allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get venue coordinates. Some venue names are reused across cities/states, so
    // prefer an exact city/state match to avoid incorrect distance calculations.
    const { data: venueMatches, error: venueError } = await supabaseAdmin
      .from('venue_reference')
      .select('latitude, longitude, city, state')
      .eq('venue_name', event.venue);

    console.log('🔍 DEBUG - Venue Lookup:', {
      venueName: event.venue,
      eventCity: event.city,
      eventState: event.state,
      venueMatchCount: venueMatches?.length || 0,
      venueError
    });

    let venueLat: number | null = null;
    let venueLng: number | null = null;

    if (!venueError && venueMatches && venueMatches.length > 0) {
      const eventCity = normalizeText(event.city);
      const eventState = normalizeText(event.state);
      const venueData =
        venueMatches.find((candidate: any) => {
          const cityMatches = !eventCity || normalizeText(candidate?.city) === eventCity;
          const stateMatches = !eventState || normalizeText(candidate?.state) === eventState;
          return cityMatches && stateMatches;
        }) || venueMatches[0];

      venueLat = toFiniteNumber((venueData as any)?.latitude);
      venueLng = toFiniteNumber((venueData as any)?.longitude);
    }

    // Fall back to geocoding if venue_reference lookup failed or had no coordinates
    if (venueLat == null || venueLng == null) {
      console.log('⚠️ Venue missing coords, attempting geocoding:', event.venue, event.city, event.state);
      try {
        // Try full venue name + city + state first
        let geocoded = event.venue
          ? await geocodeAddress(event.venue, event.city || '', event.state || '')
          : null;

        // Fall back to city + state only (works even for unknown venue names)
        if (!geocoded && (event.city || event.state)) {
          console.log('⚠️ Venue name geocoding failed, trying city+state only');
          geocoded = await geocodeAddress('', event.city || '', event.state || '');
        }

        if (geocoded) {
          venueLat = geocoded.latitude;
          venueLng = geocoded.longitude;
          console.log('✅ Geocoded venue coordinates:', { venueLat, venueLng });

          // Persist coords back to venue_reference so future requests skip geocoding
          if (event.venue) {
            await supabaseAdmin
              .from('venue_reference')
              .update({ latitude: geocoded.latitude, longitude: geocoded.longitude })
              .eq('venue_name', event.venue);
          }
        } else {
          console.log('⚠️ Geocoding returned no results, distance will not be calculated');
        }
      } catch (geocodeErr) {
        console.warn('⚠️ Geocoding failed, distance will not be calculated:', geocodeErr);
      }
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
      .or('invitation_type.eq.bulk,invitation_type.is.null')
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

    const eventStart = typeof event.start_time === "string" ? event.start_time : null;
    const eventEnd   = typeof event.end_time   === "string" ? event.end_time   : null;

    // Map of vendorId → availability metadata (only vendors with at least partial overlap)
    type VendorAvailMeta = { isPartial: boolean; startTime?: string; endTime?: string };
    const vendorMetaMap = new Map<string, VendorAvailMeta>();

    for (const inv of (invitations || [])) {
      if (!inv.availability) {
        console.log(`  ❌ No availability data for vendor ${inv.vendor_id}`);
        continue;
      }
      // Use the most-recent invitation per vendor (already de-duped below)
      if (vendorMetaMap.has(inv.vendor_id)) continue;

      const availability = normalizeAvailabilityPayload(inv.availability);

      for (const day of availability) {
        const dayDate = typeof day?.date === "string" ? day.date.slice(0, 10) : "";
        if (dayDate !== eventDateKey || day.available !== true) continue;

        // All-day (or legacy without allDay) → full availability, not partial
        if (day.allDay !== false) {
          console.log(`  ✅ ${dayDate} all-day for vendor ${inv.vendor_id}`);
          vendorMetaMap.set(inv.vendor_id, { isPartial: false });
          break;
        }

        const vendorStart: string | undefined = day.startTime;
        const vendorEnd:   string | undefined = day.endTime;

        // No event time data or no vendor times → treat as full availability
        if (!eventStart || !eventEnd || !vendorStart || !vendorEnd) {
          console.log(`  ✅ ${dayDate} partial (missing times, treating as all-day) for vendor ${inv.vendor_id}`);
          vendorMetaMap.set(inv.vendor_id, { isPartial: false });
          break;
        }

        const mins = overlapMinutes(vendorStart, vendorEnd, eventStart, eventEnd);
        if (mins >= MIN_OVERLAP_MINUTES) {
          console.log(`  ✅ ${dayDate} partial ${vendorStart}-${vendorEnd} vs event ${eventStart}-${eventEnd} — overlap: ${mins}min`);
          vendorMetaMap.set(inv.vendor_id, {
            isPartial: true,
            startTime: vendorStart,
            endTime:   vendorEnd,
          });
        } else {
          console.log(`  ❌ ${dayDate} partial ${vendorStart}-${vendorEnd} — no overlap with event ${eventStart}-${eventEnd} — excluding vendor ${inv.vendor_id}`);
        }
        break;
      }
    }

    const uniqueAvailableVendorIds = Array.from(vendorMetaMap.keys());
    console.log('🔍 DEBUG - Available Vendor IDs with meta:', uniqueAvailableVendorIds);

    // Find vendors already confirmed in other events on the same date
    const confirmedElsewhereIds = new Set<string>();
    if (uniqueAvailableVendorIds.length > 0) {
      const { data: sameDateEvents } = await supabaseAdmin
        .from('events')
        .select('id')
        .eq('event_date', eventDateKey)
        .neq('id', eventId);

      if (sameDateEvents && sameDateEvents.length > 0) {
        const sameEventIds = sameDateEvents.map((e: any) => e.id);
        const { data: confirmedMembers } = await supabaseAdmin
          .from('event_teams')
          .select('vendor_id')
          .in('event_id', sameEventIds)
          .eq('status', 'confirmed')
          .in('vendor_id', uniqueAvailableVendorIds);

        if (confirmedMembers) {
          for (const m of confirmedMembers) {
            confirmedElsewhereIds.add(m.vendor_id);
          }
        }
      }
    }

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
          const regionCenterLat = toFiniteNumber(regionData.center_lat);
          const regionCenterLng = toFiniteNumber(regionData.center_lng);

          if (regionCenterLat == null || regionCenterLng == null) {
            console.log('[AVAILABLE-VENDORS] ⚠️ Region center coordinates are invalid; skipping geo filter', {
              regionId,
              center_lat: regionData.center_lat,
              center_lng: regionData.center_lng
            });
          } else {
            console.log('[AVAILABLE-VENDORS] 📍 Region center:', {
              lat: regionCenterLat,
              lng: regionCenterLng,
              radius: FIXED_REGION_RADIUS_MILES
            });

            filteredVendors = filteredVendors.filter((vendor: any) => {
              const vendorLat = toFiniteNumber(vendor.profiles?.latitude);
              const vendorLng = toFiniteNumber(vendor.profiles?.longitude);

              if (vendorLat == null || vendorLng == null) {
                console.log(`  ⚠️ Vendor ${vendor.id} has no coordinates, excluding`);
                return false;
              }

              const distance = calculateDistance(
                regionCenterLat,
                regionCenterLng,
                vendorLat,
                vendorLng
              );

              const isInRegion = distance <= FIXED_REGION_RADIUS_MILES;
              console.log(`  ${isInRegion ? '✅' : '❌'} Vendor ${vendor.profiles.first_name} ${vendor.profiles.last_name}: ${distance.toFixed(1)}mi (limit: ${FIXED_REGION_RADIUS_MILES}mi)`);
              return isInRegion;
            });

            console.log('[AVAILABLE-VENDORS] ✅ After geo filter:', filteredVendors.length, 'vendors');
          }
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
        const vendorLat = toFiniteNumber(vendor.profiles?.latitude);
        const vendorLng = toFiniteNumber(vendor.profiles?.longitude);
        let distance: number | null = null;
        if (venueLat != null && venueLng != null && vendorLat != null && vendorLng != null) {
          distance = calculateDistance(
            venueLat,
            venueLng,
            vendorLat,
            vendorLng
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
            latitude: vendorLat,
            longitude: vendorLng,
            region_id: vendor.profiles.region_id
          },
          distance: distance !== null ? Math.round(distance * 10) / 10 : null,
          partialAvailability: vendorMetaMap.get(vendor.id)?.isPartial ?? false,
          availableFrom: vendorMetaMap.get(vendor.id)?.startTime ?? null,
          availableTo:   vendorMetaMap.get(vendor.id)?.endTime   ?? null,
          confirmedElsewhere: confirmedElsewhereIds.has(vendor.id),
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

    // Determine which vendors are NOT assigned to this event's venue
    // Uses vendor_venue_assignments + venue_reference to check by venue name
    const outOfVenueIds = new Set<string>();
    if (event.venue && vendorsWithDistance.length > 0) {
      try {
        const { data: venueMatches, error: venueError } = await supabaseAdmin
          .from('venue_reference')
          .select('id, city, state')
          .eq('venue_name', event.venue);

        if (venueError) {
          throw venueError;
        }

        if (Array.isArray(venueMatches) && venueMatches.length > 0) {
          const eventCity = normalizeText(event.city);
          const eventState = normalizeText(event.state);
          const matchedVenue =
            venueMatches.find((candidate: any) => {
              const cityMatches = !eventCity || normalizeText(candidate?.city) === eventCity;
              const stateMatches = !eventState || normalizeText(candidate?.state) === eventState;
              return cityMatches && stateMatches;
            }) || venueMatches[0];

          const venueId = String((matchedVenue as any)?.id || '').trim();
          if (venueId) {
            const vendorIds = vendorsWithDistance.map((v: any) => v.id);
            const { data: venueAssignments, error: venueAssignmentsError } = await supabaseAdmin
              .from('vendor_venue_assignments')
              .select('vendor_id')
              .eq('venue_id', venueId)
              .in('vendor_id', vendorIds);

            if (venueAssignmentsError) {
              throw venueAssignmentsError;
            }

            const assignedToVenue = new Set(
              (venueAssignments || [])
                .map((assignment: any) => String(assignment?.vendor_id || '').trim())
                .filter(Boolean)
            );

            for (const v of vendorsWithDistance) {
              if (!assignedToVenue.has(v.id)) {
                outOfVenueIds.add(v.id);
              }
            }
          }
        }
      } catch (venueCheckErr) {
        console.warn('[AVAILABLE-VENDORS] Could not check venue assignments:', venueCheckErr);
      }
    }

    const vendorsWithVenueFlag = vendorsWithDistance.map((v: any) => ({
      ...v,
      isOutOfVenue: outOfVenueIds.has(v.id),
    }));

    return NextResponse.json({
      vendors: vendorsWithVenueFlag
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in available-vendors endpoint:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch available vendors'
    }, { status: 500 });
  }
}
