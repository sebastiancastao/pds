import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserRegion, type Region } from "@/lib/geocoding";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const INVITATION_WINDOW_DAYS = 42;

const normalizeDateKey = (value: unknown): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const normalizeText = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const buildDefaultWindow = () => {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + (INVITATION_WINDOW_DAYS - 1));

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const getInvitationWindow = (invitation: any) => {
  const startDate = normalizeDateKey(invitation?.start_date);
  const endDate = normalizeDateKey(invitation?.end_date);

  if (startDate && endDate) {
    return { startDate, endDate };
  }

  return buildDefaultWindow();
};

const createVenueKey = (venue: unknown, city: unknown, state: unknown) =>
  [
    normalizeText(venue),
    normalizeText(city),
    normalizeText(state),
  ].join("|");

const addEventToDateMap = (
  target: Record<
    string,
    Array<{
      id: string;
      eventName: string | null;
      venue: string | null;
      city: string | null;
      state: string | null;
      startTime: string | null;
      endTime: string | null;
    }>
  >,
  event: any
) => {
  const eventDate = normalizeDateKey(event?.event_date);
  if (!eventDate) return;

  if (!target[eventDate]) target[eventDate] = [];

  if (target[eventDate].some((entry) => entry.id === event?.id)) {
    return;
  }

  target[eventDate].push({
    id: String(event?.id || `${eventDate}-${event?.venue || "event"}`),
    eventName: event?.event_name ?? null,
    venue: event?.venue ?? null,
    city: event?.city ?? null,
    state: event?.state ?? null,
    startTime: event?.start_time ?? null,
    endTime: event?.end_time ?? null,
  });
};

/**
 * GET /api/invitations/[token]
 * Retrieve invitation details and existing availability
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Look up the invitation
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('vendor_invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (invitationError) {
      if (invitationError.code === "PGRST116") {
        return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
      }
      console.error("Error loading invitation row:", invitationError);
      return NextResponse.json({ error: 'Failed to load invitation' }, { status: 500 });
    }

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      // Update status to expired
      await supabaseAdmin
        .from('vendor_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);

      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 });
    }

    const invitationType =
      invitation.invitation_type ||
      (invitation.event_id ? "single" : "bulk");
    const { startDate, endDate } = getInvitationWindow(invitation);

    const [
      { data: invitationEvent, error: invitationEventError },
      { data: vendorUser, error: vendorUserError },
      { data: vendorProfile, error: vendorProfileError },
      { data: regions, error: regionsError },
      { data: venuesRaw, error: venuesError },
    ] = await Promise.all([
      invitation.event_id
        ? supabaseAdmin
            .from("events")
            .select("id, event_name, event_date, start_time, end_time, venue, city, state")
            .eq("id", invitation.event_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      invitation.vendor_id
        ? supabaseAdmin
            .from("users")
            .select("id, email, region_id")
            .eq("id", invitation.vendor_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      invitation.vendor_id
        ? supabaseAdmin
            .from("profiles")
            .select("user_id, first_name, last_name, region_id, latitude, longitude")
            .eq("user_id", invitation.vendor_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      supabaseAdmin
        .from("regions")
        .select("id, name, center_lat, center_lng, radius_miles, is_active")
        .eq("is_active", true),
      supabaseAdmin
        .from("venue_reference")
        .select("venue_name, city, state, latitude, longitude, region_id"),
    ]);

    if (invitationEventError) {
      console.error("Error loading invitation event:", invitationEventError);
    }

    if (vendorUserError) {
      console.error("Error loading invitation vendor:", vendorUserError);
    }

    if (vendorProfileError) {
      console.error("Error loading invitation vendor profile:", vendorProfileError);
    }

    if (regionsError) {
      console.error("Error loading regions:", regionsError);
    }

    if (venuesError) {
      console.error("Error loading venues:", venuesError);
    }

    const activeRegions: Region[] = (regions || [])
      .map((region: any) => {
        const centerLat = toFiniteNumber(region.center_lat);
        const centerLng = toFiniteNumber(region.center_lng);
        const radiusMiles = toFiniteNumber(region.radius_miles);

        if (centerLat == null || centerLng == null) {
          return null;
        }

        return {
          id: String(region.id),
          name: String(region.name || ""),
          center_lat: centerLat,
          center_lng: centerLng,
          radius_miles: radiusMiles ?? 0,
        };
      })
      .filter((region): region is Region => region !== null);

    const derivedVendorRegion = getUserRegion(
      toFiniteNumber(vendorProfile?.latitude),
      toFiniteNumber(vendorProfile?.longitude),
      activeRegions
    );
    const vendorRegionId =
      vendorProfile?.region_id ||
      (vendorUser as any)?.region_id ||
      derivedVendorRegion?.id ||
      null;

    let regionName: string | null = null;
    let regionEventsByDate: Record<
      string,
      Array<{
        id: string;
        eventName: string | null;
        venue: string | null;
        city: string | null;
        state: string | null;
        startTime: string | null;
        endTime: string | null;
      }>
    > = {};

    if (vendorRegionId) {
      const activeRegion = activeRegions.find((region) => region.id === vendorRegionId) || null;
      regionName = activeRegion?.name ?? null;

      if (!venuesError) {
        const venues = (venuesRaw || []).filter((venue: any) => {
          if (venue?.region_id && String(venue.region_id) === vendorRegionId) {
            return true;
          }

          const derivedRegion = getUserRegion(
            toFiniteNumber(venue?.latitude),
            toFiniteNumber(venue?.longitude),
            activeRegions
          );

          return derivedRegion?.id === vendorRegionId;
        });

        const venueNames = Array.from(
          new Set(
            venues
              .map((venue: any) => String(venue?.venue_name || "").trim())
              .filter(Boolean)
          )
        );

        if (venueNames.length > 0) {
          let eventsQuery = supabaseAdmin
            .from("events")
            .select(
              "id, event_name, event_date, start_time, end_time, venue, city, state"
            )
            .eq("is_active", true)
            .gte("event_date", startDate)
            .lte("event_date", endDate)
            .in("venue", venueNames)
            .order("event_date", { ascending: true })
            .order("start_time", { ascending: true });

          const { data: regionEvents, error: regionEventsError } = await eventsQuery;

          if (regionEventsError) {
            console.error("Error loading region events:", regionEventsError);
          } else {
            const normalizedVenueCounts = new Map<string, number>();
            const venueKeySet = new Set<string>();
            const venueNameSet = new Set<string>();

            for (const venue of venues) {
              const normalizedName = normalizeText((venue as any)?.venue_name);
              if (normalizedName) {
                venueNameSet.add(normalizedName);
                normalizedVenueCounts.set(
                  normalizedName,
                  (normalizedVenueCounts.get(normalizedName) || 0) + 1
                );
              }
              venueKeySet.add(
                createVenueKey(
                  (venue as any)?.venue_name,
                  (venue as any)?.city,
                  (venue as any)?.state
                )
              );
            }

            for (const event of regionEvents || []) {
              const normalizedEventVenue = normalizeText((event as any)?.venue);
              if (!normalizedEventVenue) continue;
              const eventCity = normalizeText((event as any)?.city);
              const eventState = normalizeText((event as any)?.state);

              const hasUniqueVenueName =
                (normalizedVenueCounts.get(normalizedEventVenue) || 0) === 1;
              const matchesVenueRegion =
                hasUniqueVenueName ||
                (venueNameSet.has(normalizedEventVenue) && !eventCity && !eventState) ||
                venueKeySet.has(
                  createVenueKey(
                    (event as any)?.venue,
                    (event as any)?.city,
                    (event as any)?.state
                  )
                );

              if (!matchesVenueRegion) continue;
              addEventToDateMap(regionEventsByDate, event);
            }
          }
        }
      }
    }

    if (invitationEvent?.id) {
      addEventToDateMap(regionEventsByDate, invitationEvent);
    }

    Object.values(regionEventsByDate).forEach((events) => {
      events.sort((a, b) => {
        const aTime = String(a.startTime || "");
        const bTime = String(b.startTime || "");
        if (aTime !== bTime) return aTime.localeCompare(bTime);
        return String(a.eventName || "").localeCompare(String(b.eventName || ""));
      });
    });

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        type: invitationType,
        eventName: (invitationEvent as any)?.event_name ?? null,
        eventDate: (invitationEvent as any)?.event_date ?? null,
        venue: (invitationEvent as any)?.venue ?? null,
        status: invitation.status,
        expiresAt: invitation.expires_at,
        startDate,
        endDate,
        durationWeeks: invitation.duration_weeks ?? null,
        regionId: vendorRegionId,
        regionName,
      },
      availability: invitation.availability || null,
      notes: invitation.notes || '',
      regionEventsByDate,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error fetching invitation:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch invitation'
    }, { status: 500 });
  }
}

/**
 * POST /api/invitations/[token]
 * Save vendor's availability response
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    const body = await req.json();
    const { availability } = body;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    if (!availability) {
      return NextResponse.json({ error: 'Availability data is required' }, { status: 400 });
    }

    // Look up the invitation
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('vendor_invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 });
    }

    // Check if any days are marked as available
    const hasAvailability = availability.some((day: any) => day.available === true);
    const newStatus = hasAvailability ? 'accepted' : 'declined';

    // Update invitation with availability and status
    const { error: updateError } = await supabaseAdmin
      .from('vendor_invitations')
      .update({
        availability: availability,
        status: newStatus,
        responded_at: new Date().toISOString()
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation:', updateError);
      return NextResponse.json({ error: 'Failed to save availability' }, { status: 500 });
    }

    // Also persist per-day availability into vendor_availability table (idempotent upsert)
    try {
      const rows = (availability as any[])
        .filter((d) => d && typeof d.date === 'string')
        .map((d) => ({
          vendor_id: invitation.vendor_id,
          date: d.date,
          available: !!d.available,
          notes: d.notes || null,
          updated_at: new Date().toISOString()
        }));
      if (rows.length > 0) {
        // Upsert on (vendor_id, date)
        await supabaseAdmin
          .from('vendor_availability')
          .upsert(rows, { onConflict: 'vendor_id,date' });
      }
    } catch (e) {
      console.warn('vendor_availability upsert failed (non-fatal):', e);
    }

    return NextResponse.json({
      success: true,
      message: 'Availability saved successfully',
      status: newStatus
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error saving availability:', error);
    return NextResponse.json({
      error: error.message || 'Failed to save availability'
    }, { status: 500 });
  }
}
