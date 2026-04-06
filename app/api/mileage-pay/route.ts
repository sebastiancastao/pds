import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { calculateDistanceMiles, geocodeAddress, delay } from "@/lib/geocoding";

export const dynamic = 'force-dynamic';

const MILEAGE_RATE = 1.71;

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
    let { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
        if (tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
      }
    }

    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const role = (userData?.role || '').toLowerCase();
    if (!['admin', 'exec', 'hr', 'manager', 'supervisor3'].includes(role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const eventIdsParam = searchParams.get('event_ids');
    if (!eventIdsParam) return NextResponse.json({ mileage: {} });

    const eventIds = eventIdsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (eventIds.length === 0) return NextResponse.json({ mileage: {} });

    // 1. Get events with venue names
    const { data: events } = await supabaseAdmin
      .from('events')
      .select('id, venue, city, state')
      .in('id', eventIds);

    if (!events || events.length === 0) return NextResponse.json({ mileage: {} });

    // 2. Fetch ALL venues from venue_reference (need them for both event venues and home venues)
    const { data: allVenues } = await supabaseAdmin
      .from('venue_reference')
      .select('id, venue_name, city, state, full_address, latitude, longitude');

    const venueById: Record<string, any> = {};
    const venueByNameExact: Record<string, any> = {};
    const venueByNameLower: Record<string, any> = {};
    (allVenues || []).forEach((v: any) => {
      venueById[v.id] = v;
      venueByNameExact[v.venue_name || ''] = v;
      venueByNameLower[(v.venue_name || '').toLowerCase().trim()] = v;
    });

    const getVenueByName = (name: string) =>
      venueByNameExact[name] || venueByNameLower[(name || '').toLowerCase().trim()] || null;

    // Geocode any event venues missing coordinates
    const geocodeDelay = { needed: false };
    const eventVenueNames = [...new Set(events.map((e: any) => e.venue).filter(Boolean))];
    for (const name of eventVenueNames) {
      const v = getVenueByName(name);
      if (!v || (v.latitude && v.longitude)) continue;
      const address = v.full_address || '';
      const city = v.city || '';
      const state = v.state || '';
      if (!city && !state && !address) continue;
      if (geocodeDelay.needed) await delay(1100);
      geocodeDelay.needed = true;
      const result = await geocodeAddress(address, city, state);
      if (result) {
        v.latitude = result.latitude;
        v.longitude = result.longitude;
        try {
          await supabaseAdmin.from('venue_reference')
            .update({ latitude: result.latitude, longitude: result.longitude })
            .eq('id', v.id);
        } catch (_) {}
      }
    }

    // 3. Get user IDs per event from event_vendor_payments + event_teams
    const { data: vendorPayments } = await supabaseAdmin
      .from('event_vendor_payments')
      .select('event_id, user_id')
      .in('event_id', eventIds);

    const { data: eventTeams } = await supabaseAdmin
      .from('event_teams')
      .select('event_id, vendor_id')
      .in('event_id', eventIds);

    const paymentUsersByEvent: Record<string, Set<string>> = {};
    (vendorPayments || []).forEach((vp: any) => {
      if (!vp.event_id || !vp.user_id) return;
      if (!paymentUsersByEvent[vp.event_id]) paymentUsersByEvent[vp.event_id] = new Set();
      paymentUsersByEvent[vp.event_id].add(vp.user_id);
    });
    (eventTeams || []).forEach((et: any) => {
      if (!et.event_id || !et.vendor_id) return;
      if (!paymentUsersByEvent[et.event_id]) paymentUsersByEvent[et.event_id] = new Set();
      paymentUsersByEvent[et.event_id].add(et.vendor_id);
    });

    const userIds = [...new Set(Object.values(paymentUsersByEvent).flatMap(s => [...s]))];
    if (userIds.length === 0) return NextResponse.json({ mileage: {} });

    // 4. Get each user's profile coordinates (home address) + assigned home venue
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('user_id, latitude, longitude')
      .in('user_id', userIds);

    const profileByUserId: Record<string, any> = {};
    (profiles || []).forEach((p: any) => { profileByUserId[p.user_id] = p; });

    const { data: homeVenueRows } = await supabaseAdmin
      .from('vendor_venue_assignments')
      .select('vendor_id, venue_id')
      .in('vendor_id', userIds);

    // A user can have multiple assignments — use the first as their home venue
    const homeVenueIdByUser: Record<string, string> = {};
    (homeVenueRows || []).forEach((row: any) => {
      if (!homeVenueIdByUser[row.vendor_id]) {
        homeVenueIdByUser[row.vendor_id] = row.venue_id;
      }
    });

    // 5. Calculate differential miles:
    //    distToEventVenue  = distance(user home address → event venue)  [same as team tab]
    //    distToHomeVenue   = distance(user home address → user's home venue)
    //    differential miles = max(0, distToEventVenue - distToHomeVenue)
    const mileage: Record<string, Record<string, { miles: number | null; mileagePay: number; differentialMiles: number }>> = {};

    for (const event of events) {
      const eventVenue = getVenueByName(event.venue || '');
      if (!eventVenue?.latitude || !eventVenue?.longitude) continue;

      const evLat = Number(eventVenue.latitude);
      const evLng = Number(eventVenue.longitude);
      if (!Number.isFinite(evLat) || !Number.isFinite(evLng)) continue;

      const eventUserIds = [...(paymentUsersByEvent[event.id] || [])];

      for (const userId of eventUserIds) {
        const profile = profileByUserId[userId];
        if (!profile?.latitude || !profile?.longitude) continue;

        const userLat = Number(profile.latitude);
        const userLng = Number(profile.longitude);
        if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) continue;

        // Distance from user's home address to the event venue (matches team tab)
        const distToEventVenue = calculateDistanceMiles(userLat, userLng, evLat, evLng);

        // Distance from user's home address to their assigned home venue
        const homeVenueId = homeVenueIdByUser[userId];
        const homeVenue = homeVenueId ? venueById[homeVenueId] : null;
        let distToHomeVenue = 0;
        if (homeVenue?.latitude && homeVenue?.longitude) {
          const hvLat = Number(homeVenue.latitude);
          const hvLng = Number(homeVenue.longitude);
          if (Number.isFinite(hvLat) && Number.isFinite(hvLng)) {
            distToHomeVenue = calculateDistanceMiles(userLat, userLng, hvLat, hvLng);
          }
        }

        const differentialMiles = Math.max(0, distToEventVenue - distToHomeVenue);
        const mileagePay = distToEventVenue * 2 * MILEAGE_RATE;

        if (!mileage[event.id]) mileage[event.id] = {};
        mileage[event.id][userId] = {
          miles: Math.round(distToEventVenue * 10) / 10,       // actual distance home → event venue
          mileagePay: Math.round(mileagePay * 100) / 100,      // based on actual distance
          differentialMiles: Math.round(differentialMiles * 10) / 10, // extra miles beyond home venue
        };
      }
    }

    return NextResponse.json({ mileage });
  } catch (e: any) {
    console.error('[MILEAGE-PAY]', e.message);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
