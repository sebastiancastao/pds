import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

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
          user = { id: tokenUser.user.id } as any;
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
    const artist_share_percent = body.artist_share_percent === undefined || body.artist_share_percent === "" ? 0 : Number(body.artist_share_percent);
    const venue_share_percent = body.venue_share_percent === undefined || body.venue_share_percent === "" ? 0 : Number(body.venue_share_percent);
    const pds_share_percent = body.pds_share_percent === undefined || body.pds_share_percent === "" ? 0 : Number(body.pds_share_percent);
    const commission_pool = body.commission_pool === undefined || body.commission_pool === "" ? null : Number(body.commission_pool);
    const ends_next_day = body.ends_next_day === undefined ? false : Boolean(body.ends_next_day);
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

    const event = {
      created_by,
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      start_time,
      end_time,
      ends_next_day,
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      is_active
    };
    const { data, error } = await supabaseAdmin.from("events").insert([event]).select();
    // Debug output for DB response/error
    if (error) {
      console.error('SUPABASE INSERT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }
    console.log('SUPABASE INSERT RESULT:', data);
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

    // Check if user is a supervisor — if so, also include their lead manager's events
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const userRole = userData?.role || '';

    // Collect all user IDs whose events this user can see
    const creatorIds: string[] = [user.id];

    if (userRole === 'supervisor' || userRole === 'supervisor2') {
      // Look up which managers this supervisor is assigned to
      const { data: teamLinks } = await supabaseAdmin
        .from('manager_team_members')
        .select('manager_id')
        .eq('member_id', user.id)
        .eq('is_active', true);

      if (teamLinks && teamLinks.length > 0) {
        for (const link of teamLinks) {
          if (!creatorIds.includes(link.manager_id)) {
            creatorIds.push(link.manager_id);
          }
        }
      }
    }

    // Filter events by the current user and their lead managers (for supervisors)
    let query = supabaseAdmin
      .from('events')
      .select('*')
      .in('created_by', creatorIds)
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: false });

    if (isActiveParam !== null) {
      query = query.eq('is_active', isActiveParam === 'true');
    }

    const { data, error } = await query;
    if (error) {
      console.error('SUPABASE SELECT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in events list:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
