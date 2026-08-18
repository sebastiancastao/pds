export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendNonEventTimesheetCreatedNotification } from "@/lib/email";
import { getEventAssociationMap } from "@/lib/event-associations";
import { MAX_NON_EVENT_TIMESHEET_DAYS, getMaxNonEventEndDate } from "@/lib/non-event-timesheets";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token> header for SSR/API contexts
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = tokenUser.user as any;
        }
      }
    }
    if (!user || !user.id) {
      console.error('No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const created_by = user.id;
    const event_name = body.event_name?.trim() || "";
    const artist = body.artist?.trim() || null;
    const venue = body.venue?.trim() || "";
    const city = body.city?.trim() || null;
    const state = body.state?.trim()?.toUpperCase() || null;
    const event_date = body.event_date || null;
    const start_time = body.start_time || null;
    const end_time = body.end_time || null;
    const event_type = body.event_type === "special" ? "special" : "normal";
    // CW events (created from /cw-calendar) belong to the trailers division; everything else is vendor
    const division = body.division === "trailers" ? "trailers" : "vendor";
    // end_date only applies to multi-day Non Event Time Sheets; ignore it for normal events
    const end_date = event_type === "special" && body.end_date ? body.end_date : null;
    // work_details is a required description of the work performed on Non Event Time Sheets
    const work_details = body.work_details?.trim() || null;
    const artist_share_percent = body.artist_share_percent === undefined || body.artist_share_percent === "" ? 0 : Number(body.artist_share_percent);
    const venue_share_percent = body.venue_share_percent === undefined || body.venue_share_percent === "" ? 0 : Number(body.venue_share_percent);
    const pds_share_percent = body.pds_share_percent === undefined || body.pds_share_percent === "" ? 0 : Number(body.pds_share_percent);
    const commission_pool = body.commission_pool === undefined || body.commission_pool === "" ? null : Number(body.commission_pool);
    // Derive ends_next_day from the dates when an end date is provided (YYYY-MM-DD strings compare lexicographically)
    const ends_next_day = end_date && event_date
      ? end_date > event_date
      : (body.ends_next_day === undefined ? false : Boolean(body.ends_next_day));
    const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

    // Debug output for all incoming data
    console.log('EVENT CREATE PAYLOAD:', {
      created_by,
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      end_date,
      start_time,
      end_time,
      ends_next_day,
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      is_active
    });

    // Required fields validation
    if (!event_name || !venue || !event_date || !start_time || !end_time) {
      console.error('Event creation: missing required fields');
      return NextResponse.json({ error: "Missing one or more required fields: event_name, venue, event_date, start_time, end_time" }, { status: 400 });
    }

    // Non Event Time Sheets must describe the work being performed
    if (event_type === "special" && !work_details) {
      console.error('Event creation: missing work_details for Non Event Time Sheet');
      return NextResponse.json({ error: "Detail of Work is required for Non Event Time Sheets" }, { status: 400 });
    }

    // A multi-day Non Event Time Sheet's end date cannot precede its start date
    if (end_date && event_date && end_date < event_date) {
      console.error('Event creation: end_date before event_date');
      return NextResponse.json({ error: "end_date must be on or after event_date" }, { status: 400 });
    }
    const maxEndDate = end_date ? getMaxNonEventEndDate(event_date) : null;
    if (end_date && maxEndDate && end_date > maxEndDate) {
      console.error('Event creation: end_date exceeds one-week limit');
      return NextResponse.json(
        { error: `Non Event Time Sheets cannot span more than ${MAX_NON_EVENT_TIMESHEET_DAYS} days.` },
        { status: 400 }
      );
    }

    const event = {
      created_by,
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      end_date,
      start_time,
      end_time,
      ends_next_day,
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      is_active,
      event_type,
      division,
      work_details,
      tips_distribution_mode: "equal",
    };
    const { data, error } = await supabaseAdmin.from("events").insert([event]).select();
    // Debug output for DB response/error
    if (error) {
      console.error('SUPABASE INSERT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }
    console.log('SUPABASE INSERT RESULT:', data);

    if (event_type === "special") {
      try {
        const notificationResult = await sendNonEventTimesheetCreatedNotification({
          eventId: data?.[0]?.id ?? null,
          eventName: event_name,
          artist,
          venue,
          city,
          state,
          eventDate: event_date,
          endDate: end_date,
          startTime: start_time,
          endTime: end_time,
          endsNextDay: ends_next_day,
          createdByEmail: (user as any)?.email || null,
          createdById: user.id,
        });

        if (!notificationResult.success) {
          console.error('NON EVENT TIME SHEET NOTIFICATION FAILED:', notificationResult.error);
        } else {
          console.log('NON EVENT TIME SHEET NOTIFICATION SENT:', notificationResult.messageId);
        }
      } catch (notificationError: any) {
        console.error('NON EVENT TIME SHEET NOTIFICATION ERROR:', notificationError);
      }
    }

    return NextResponse.json({ event: data[0] }, { status: 201 });
  } catch (err: any) {
    console.error('SERVER ERROR in event create:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
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

    // Optional filters
    const { searchParams } = new URL(req.url);
    const isActiveParam = searchParams.get('is_active');

    // Check user role to determine event visibility scope
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const userRole = userData?.role || '';

    // admin and exec can see every event, matching the single-event GET in [id]/route.ts
    const isAdminOrExec = userRole === 'admin' || userRole === 'exec';

    // Collect all user IDs whose events this user can see
    const creatorIds: string[] = [user.id];

    // Include all events at venues this user is assigned to in venue management.
    // venue_managers can hold managers, supervisors, and execs, so don't gate on role.
    const assignedVenueNameSet = new Set<string>();

    const addVenueNames = (rows: Array<{ venue_name?: unknown } | null | undefined>) => {
      // Match both the stored and trimmed names: events.venue is trimmed at
      // creation, but venue_reference names have historically had stray spaces.
      for (const row of rows) {
        const raw = typeof row?.venue_name === 'string' ? row.venue_name : '';
        if (raw) assignedVenueNameSet.add(raw);
        if (raw.trim()) assignedVenueNameSet.add(raw.trim());
      }
    };

    const { data: venueLinks } = await supabaseAdmin
      .from('venue_managers')
      .select('venue_id')
      .eq('manager_id', user.id)
      .eq('is_active', true);

    if (venueLinks && venueLinks.length > 0) {
      const venueIds = venueLinks.map((v: any) => v.venue_id);
      const { data: venueRefs } = await supabaseAdmin
        .from('venue_reference')
        .select('venue_name')
        .in('id', venueIds);

      if (venueRefs) addVenueNames(venueRefs);
    }

    if (userRole === 'supervisor' || userRole === 'supervisor2' || userRole === 'supervisor3') {
      // Look up which managers this supervisor is assigned to
      const { data: teamLinks } = await supabaseAdmin
        .from('manager_team_members')
        .select('manager_id')
        .eq('member_id', user.id)
        .eq('is_active', true);

      if (teamLinks && teamLinks.length > 0) {
        const managerIds: string[] = [];
        for (const link of teamLinks) {
          if (!creatorIds.includes(link.manager_id)) {
            creatorIds.push(link.manager_id);
            managerIds.push(link.manager_id);
          }
        }

        // Also include co-supervisors (other active members under the same managers)
        if (managerIds.length > 0) {
          const { data: groupMembers } = await supabaseAdmin
            .from('manager_team_members')
            .select('member_id')
            .in('manager_id', managerIds)
            .eq('is_active', true);

          if (groupMembers) {
            for (const member of groupMembers) {
              if (!creatorIds.includes(member.member_id)) {
                creatorIds.push(member.member_id);
              }
            }
          }

          // Supervisors also see events at the venues their lead manager(s) oversee,
          // not just events that manager personally created — mirrors the manager's
          // own venue-based access above.
          const { data: managerVenueLinks } = await supabaseAdmin
            .from('venue_managers')
            .select('venue_id')
            .in('manager_id', managerIds)
            .eq('is_active', true);

          if (managerVenueLinks && managerVenueLinks.length > 0) {
            const managerVenueIds = managerVenueLinks.map((v: any) => v.venue_id);
            const { data: managerVenueRefs } = await supabaseAdmin
              .from('venue_reference')
              .select('venue_name')
              .in('id', managerVenueIds);

            if (managerVenueRefs) addVenueNames(managerVenueRefs);
          }
        }
      }
    }

    const assignedVenueNames = Array.from(assignedVenueNameSet);

    // Build query: filter by creator IDs, plus venue names for managers
    let data: any[] | null = null;
    let error: any = null;

    if (isAdminOrExec) {
      // No creator/venue restriction - admin and exec see every event
      let query = supabaseAdmin
        .from('events')
        .select('*')
        .order('event_date', { ascending: false })
        .order('start_time', { ascending: false });

      if (isActiveParam !== null) {
        query = query.eq('is_active', isActiveParam === 'true');
      }

      ({ data, error } = await query);
    } else if (assignedVenueNames.length > 0) {
      // User sees events they created OR events at their assigned venues
      // Use two queries and merge to avoid PostgREST string escaping issues with venue names
      const [byCreator, byVenue] = await Promise.all([
        (() => {
          let q = supabaseAdmin.from('events').select('*').in('created_by', creatorIds);
          if (isActiveParam !== null) q = q.eq('is_active', isActiveParam === 'true');
          return q;
        })(),
        (() => {
          let q = supabaseAdmin.from('events').select('*').in('venue', assignedVenueNames);
          if (isActiveParam !== null) q = q.eq('is_active', isActiveParam === 'true');
          return q;
        })(),
      ]);

      if (byCreator.error) { error = byCreator.error; }
      else if (byVenue.error) { error = byVenue.error; }
      else {
        const merged = new Map<string, any>();
        for (const e of [...(byCreator.data ?? []), ...(byVenue.data ?? [])]) {
          merged.set(e.id, e);
        }
        data = Array.from(merged.values()).sort((a, b) => {
          if (a.event_date !== b.event_date) return b.event_date.localeCompare(a.event_date);
          return (b.start_time ?? '').localeCompare(a.start_time ?? '');
        });
      }
    } else {
      let query = supabaseAdmin
        .from('events')
        .select('*')
        .in('created_by', creatorIds)
        .order('event_date', { ascending: false })
        .order('start_time', { ascending: false });

      if (isActiveParam !== null) {
        query = query.eq('is_active', isActiveParam === 'true');
      }

      ({ data, error } = await query);
    }
    if (error) {
      console.error('SUPABASE SELECT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    const events = data ?? [];
    if (events.length === 0) {
      return NextResponse.json({ events: [] }, { status: 200 });
    }

    const eventIds = events
      .map((event: any) => event?.id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

    if (eventIds.length === 0) {
      return NextResponse.json({ events }, { status: 200 });
    }

    const associationByEventId = await getEventAssociationMap(supabaseAdmin, eventIds);

    const eventsWithEmptyFlag = events.map((event: any) => ({
      ...event,
      is_empty: associationByEventId.get(event.id)?.isEmpty ?? true,
    }));

    return NextResponse.json({ events: eventsWithEmptyFlag }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in events list:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
