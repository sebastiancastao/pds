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

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error("No authenticated user");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    // Check user role - admin and exec can view any event
    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const userRole = userData?.role as string;
    const isAdminOrExec = userRole === "admin" || userRole === "exec";

    // For supervisors/supervisor2, look up their lead manager(s) to grant access to those events
    let allowedCreatorIds: string[] = [user.id];
    if (userRole === "supervisor" || userRole === "supervisor2") {
      const { data: teamLinks } = await supabaseAdmin
        .from("manager_team_members")
        .select("manager_id")
        .eq("member_id", user.id)
        .eq("is_active", true);
      if (teamLinks) {
        for (const link of teamLinks) {
          if (!allowedCreatorIds.includes(link.manager_id)) {
            allowedCreatorIds.push(link.manager_id);
          }
        }
      }
    }

    // Build query - admin/exec can see any event, supervisors see own + manager's, others only their own
    let query = supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", eventId);

    if (!isAdminOrExec) {
      query = query.in("created_by", allowedCreatorIds);
    }

    const { data, error } = await query.single();

    if (error) {
      console.error("SUPABASE SELECT ERROR:", error);
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json({ error: error.message || error.code || (error as any) }, { status: 500 });
    }

    // Load merchandise (if exists)
    const { data: merch, error: merchErr } = await supabaseAdmin
      .from("event_merchandise")
      .select("apparel_gross,apparel_tax_rate,apparel_cc_fee_rate,apparel_artist_percent,other_gross,other_tax_rate,other_cc_fee_rate,other_artist_percent,music_gross,music_tax_rate,music_cc_fee_rate,music_artist_percent")
      .eq("event_id", eventId)
      .single();

    if (merchErr && merchErr.code !== 'PGRST116') {
      console.error("Load merchandise error:", merchErr);
    }

    return NextResponse.json({ event: data, merchandise: merch || null }, { status: 200 });
  } catch (err: any) {
    console.error("SERVER ERROR in event get:", err);
    return NextResponse.json({ error: err.message || (err as any) }, { status: 500 });
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

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error("No authenticated user");
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    // Check user role - admin and exec can edit any event
    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const userRole = userData?.role as string;
    const isAdminOrExec = userRole === "admin" || userRole === "exec";

    // For supervisors, look up their lead manager(s) to grant edit access
    let allowedCreatorIds: string[] = [user.id];
    if (userRole === "supervisor") {
      const { data: teamLinks } = await supabaseAdmin
        .from("manager_team_members")
        .select("manager_id")
        .eq("member_id", user.id)
        .eq("is_active", true);
      if (teamLinks) {
        for (const link of teamLinks) {
          if (!allowedCreatorIds.includes(link.manager_id)) {
            allowedCreatorIds.push(link.manager_id);
          }
        }
      }
    }

    const body = await req.json();

    // Core fields
    const event_name = body.event_name?.trim() || "";
    const artist = body.artist?.trim() || null;
    const venue = body.venue?.trim() || "";
    const city = body.city?.trim() || null;
    const state = body.state?.trim()?.toUpperCase() || null;
    const event_date = body.event_date || null;
    const start_time = body.start_time || null;
    const end_time = body.end_time || null;

    // Money / numbers
    const ticket_sales =
      body.ticket_sales === undefined || body.ticket_sales === "" ? null : Number(body.ticket_sales);

    // NEW: number of tickets
    const ticket_count =
      body.ticket_count === undefined || body.ticket_count === "" ? null : Number(body.ticket_count);

    // NEW: tax rate percent (0–100)
    const tax_rate_percent =
      body.tax_rate_percent === undefined || body.tax_rate_percent === "" ? 0 : Number(body.tax_rate_percent);

    const artist_share_percent =
      body.artist_share_percent === undefined || body.artist_share_percent === "" ? 0 : Number(body.artist_share_percent);

    const venue_share_percent =
      body.venue_share_percent === undefined || body.venue_share_percent === "" ? 0 : Number(body.venue_share_percent);

    const pds_share_percent =
      body.pds_share_percent === undefined || body.pds_share_percent === "" ? 0 : Number(body.pds_share_percent);

    const commission_pool =
      body.commission_pool === undefined || body.commission_pool === "" ? null : Number(body.commission_pool);

    const required_staff =
      body.required_staff === undefined || body.required_staff === "" ? null : Number(body.required_staff);

    const confirmed_staff =
      body.confirmed_staff === undefined || body.confirmed_staff === "" ? null : Number(body.confirmed_staff);

    const is_active = body.is_active === undefined ? true : Boolean(body.is_active);

    // Existing: tips
    const tips = body.tips === undefined || body.tips === "" ? null : Number(body.tips);

    // Debug
    console.log("EVENT UPDATE PAYLOAD:", {
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
      ticket_count,        // NEW
      tax_rate_percent,    // NEW
      artist_share_percent,
      venue_share_percent,
      pds_share_percent,
      commission_pool,
      required_staff,
      confirmed_staff,
      is_active,
      tips,
    });

    // Required fields
    if (!event_name || !venue || !event_date || !start_time || !end_time) {
      console.error("Event update: missing required fields");
      return NextResponse.json(
        { error: "Missing one or more required fields: event_name, venue, event_date, start_time, end_time" },
        { status: 400 }
      );
    }

    // Build payload, include tips/ticket_count/tax_rate_percent when provided
    const updatePayload: Record<string, any> = {
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
      updated_at: new Date().toISOString(),
    };

    if (ticket_count !== null && !Number.isNaN(ticket_count)) {
      updatePayload.ticket_count = ticket_count;
    }
    if (tax_rate_percent !== null && !Number.isNaN(tax_rate_percent)) {
      updatePayload.tax_rate_percent = tax_rate_percent;
    }
    if (tips !== null && !Number.isNaN(tips)) {
      updatePayload.tips = tips;
    }

    // Build update query - admin/exec can edit any event, supervisors own + manager's, others only their own
    let updateQuery = supabaseAdmin
      .from("events")
      .update(updatePayload)
      .eq("id", eventId);

    if (!isAdminOrExec) {
      updateQuery = updateQuery.in("created_by", allowedCreatorIds);
    }

    const { data, error } = await updateQuery.select();

    if (error) {
      console.error("SUPABASE UPDATE ERROR:", error);
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      return NextResponse.json({ error: error.message || error.code || (error as any) }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Event not found or you do not have permission to update it" },
        { status: 404 }
      );
    }

    // Upsert merchandise payload if provided
    if (body.merchandise && typeof body.merchandise === 'object') {
      const m = body.merchandise || {};
      const upsertPayload: any = {
        event_id: eventId,
        apparel_gross: m.apparel_gross !== undefined && m.apparel_gross !== '' ? Number(m.apparel_gross) : 0,
        apparel_tax_rate: m.apparel_tax_rate !== undefined && m.apparel_tax_rate !== '' ? Number(m.apparel_tax_rate) : 0,
        apparel_cc_fee_rate: m.apparel_cc_fee_rate !== undefined && m.apparel_cc_fee_rate !== '' ? Number(m.apparel_cc_fee_rate) : 0,
        apparel_artist_percent: m.apparel_artist_percent !== undefined && m.apparel_artist_percent !== '' ? Number(m.apparel_artist_percent) : 0,

        other_gross: m.other_gross !== undefined && m.other_gross !== '' ? Number(m.other_gross) : 0,
        other_tax_rate: m.other_tax_rate !== undefined && m.other_tax_rate !== '' ? Number(m.other_tax_rate) : 0,
        other_cc_fee_rate: m.other_cc_fee_rate !== undefined && m.other_cc_fee_rate !== '' ? Number(m.other_cc_fee_rate) : 0,
        other_artist_percent: m.other_artist_percent !== undefined && m.other_artist_percent !== '' ? Number(m.other_artist_percent) : 0,

        music_gross: m.music_gross !== undefined && m.music_gross !== '' ? Number(m.music_gross) : 0,
        music_tax_rate: m.music_tax_rate !== undefined && m.music_tax_rate !== '' ? Number(m.music_tax_rate) : 0,
        music_cc_fee_rate: m.music_cc_fee_rate !== undefined && m.music_cc_fee_rate !== '' ? Number(m.music_cc_fee_rate) : 0,
        music_artist_percent: m.music_artist_percent !== undefined && m.music_artist_percent !== '' ? Number(m.music_artist_percent) : 0,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabaseAdmin
        .from('event_merchandise')
        .upsert(upsertPayload, { onConflict: 'event_id' });

      if (upsertErr) {
        console.error('Merchandise upsert error:', upsertErr);
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    }

    console.log("SUPABASE UPDATE RESULT:", data);
    return NextResponse.json({ event: data[0] }, { status: 200 });
  } catch (err: any) {
    console.error("SERVER ERROR in event update:", err);
    return NextResponse.json({ error: err.message || (err as any) }, { status: 500 });
  }
}

