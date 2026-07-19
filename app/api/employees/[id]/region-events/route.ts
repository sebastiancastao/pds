// app/api/employees/[id]/region-events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const normalizeText = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase();

const createVenueKey = (venue: unknown, city: unknown, state: unknown): string =>
  [normalizeText(venue), normalizeText(city), normalizeText(state)].join("|");

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    if (!sessionUser) {
      const authHeader =
        req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.substring(7)
        : undefined;
      if (token) {
        const { data } = await supabaseAnon.auth.getUser(token);
        if (data?.user) sessionUser = data.user;
      }
    }

    if (!sessionUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = params.id;
    if (!userId) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const [
      { data: profile, error: profileError },
      { data: venuesRaw, error: venuesError },
      { data: userRow },
    ] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("region_id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("venue_reference")
        .select("venue_name, city, state, region_id"),
      supabaseAdmin
        .from("users")
        .select("division")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    if (profileError) {
      console.error("region-events profile query error:", profileError);
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (venuesError) {
      console.error("region-events venues query error:", venuesError);
      return NextResponse.json({ error: venuesError.message }, { status: 500 });
    }

    const regionId = profile?.region_id || null;

    if (!regionId) {
      return NextResponse.json({ region_id: null, events: [] });
    }

    const regionVenues = (venuesRaw || []).filter((venue: any) => {
      return venue?.region_id && String(venue.region_id) === String(regionId);
    });

    const venueNames = Array.from(
      new Set(
        regionVenues
          .map((venue: any) => String(venue?.venue_name || "").trim())
          .filter(Boolean)
      )
    );

    if (venueNames.length === 0) {
      return NextResponse.json({
        region_id: regionId,
        events: [],
      });
    }

    // CW (trailers division) employees only see CW events; everyone else only sees
    // non-CW events, so trailers events never leak into normal profiles.
    const isTrailersUser =
      String(userRow?.division || "").trim().toLowerCase() === "trailers";

    let eventsQuery = supabaseAdmin
      .from("events")
      .select("id, event_name, event_date, start_time, venue, city, state, division")
      .eq("is_active", true)
      .in("venue", venueNames)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true });

    eventsQuery = isTrailersUser
      ? eventsQuery.eq("division", "trailers")
      : eventsQuery.neq("division", "trailers");

    const { data: events, error: eventsError } = await eventsQuery;

    if (eventsError) {
      console.error("region-events query error:", eventsError);
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    const normalizedVenueCounts = new Map<string, number>();
    const venueKeySet = new Set<string>();
    const venueNameSet = new Set<string>();

    for (const venue of regionVenues) {
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

    const filteredEvents = (events || []).filter((event: any) => {
      const normalizedEventVenue = normalizeText(event?.venue);
      if (!normalizedEventVenue) return false;

      const eventCity = normalizeText(event?.city);
      const eventState = normalizeText(event?.state);

      const hasUniqueVenueName =
        (normalizedVenueCounts.get(normalizedEventVenue) || 0) === 1;
      const matchesVenueRegion =
        hasUniqueVenueName ||
        (venueNameSet.has(normalizedEventVenue) && !eventCity && !eventState) ||
        venueKeySet.has(createVenueKey(event?.venue, event?.city, event?.state));

      return matchesVenueRegion;
    });

    return NextResponse.json({
      region_id: regionId,
      events: filteredEvents,
    });
  } catch (err: any) {
    console.error("region-events route error:", err);
    return NextResponse.json(
      { error: err.message || "Internal error" },
      { status: 500 }
    );
  }
}
