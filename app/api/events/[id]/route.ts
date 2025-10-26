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

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', eventId)
      .eq('created_by', user.id)
      .single();

    if (error) {
      console.error('SUPABASE SELECT ERROR:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    return NextResponse.json({ event: data }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in event get:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    const body = await req.json();
    const event_name = body.event_name?.trim() || "";
    const artist = body.artist?.trim() || null;
    const venue = body.venue?.trim() || "";
    const city = body.city?.trim() || null;
    const state = body.state?.trim()?.toUpperCase() || null;
    const event_date = body.event_date || null;
    const start_time = body.start_time || null;
    const end_time = body.end_time || null;
    const ticket_sales = body.ticket_sales === undefined || body.ticket_sales === "" ? null : Number(body.ticket_sales);
    const artist_share_percent = body.artist_share_percent === undefined || body.artist_share_percent === "" ? 0 : Number(body.artist_share_percent);
    const venue_share_percent = body.venue_share_percent === undefined || body.venue_share_percent === "" ? 0 : Number(body.venue_share_percent);
    const pds_share_percent = body.pds_share_percent === undefined || body.pds_share_percent === "" ? 0 : Number(body.pds_share_percent);
    const commission_pool = body.commission_pool === undefined || body.commission_pool === "" ? null : Number(body.commission_pool);
    const required_staff = body.required_staff === undefined || body.required_staff === "" ? null : Number(body.required_staff);
    const confirmed_staff = body.confirmed_staff === undefined || body.confirmed_staff === "" ? null : Number(body.confirmed_staff);
    const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

    // Debug output for all incoming data
    console.log('EVENT UPDATE PAYLOAD:', {
      eventId,
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      start_time,
      end_time,
      ticket_sales,
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      required_staff,
      confirmed_staff,
      is_active
    });

    // Required fields validation
    if (!event_name || !venue || !event_date || !start_time || !end_time) {
      console.error('Event update: missing required fields');
      return NextResponse.json({ error: "Missing one or more required fields: event_name, venue, event_date, start_time, end_time" }, { status: 400 });
    }

    const event = {
      event_name,
      artist,
      venue,
      city,
      state,
      event_date,
      start_time,
      end_time,
      ticket_sales,
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      required_staff,
      confirmed_staff,
      is_active,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from("events")
      .update(event)
      .eq('id', eventId)
      .eq('created_by', user.id)
      .select();

    // Debug output for DB response/error
    if (error) {
      console.error('SUPABASE UPDATE ERROR:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Event not found or you do not have permission to update it' }, { status: 404 });
    }

    console.log('SUPABASE UPDATE RESULT:', data);
    return NextResponse.json({ event: data[0] }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in event update:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}

