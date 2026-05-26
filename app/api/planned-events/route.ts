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

const ALLOWED_ROLES = ["admin", "exec", "manager", "supervisor", "supervisor2", "supervisor3", "supervisor4"];

const EVENT_SELECT = `
  id,
  event_name,
  event_date,
  start_time,
  end_time,
  created_at,
  updated_at,
  venue:venue_reference(
    id,
    venue_name,
    city,
    state,
    full_address
  )
`;

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
      }
    }
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users').select('role').eq('id', user.id).single();
    if (userError || !userData) return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });

    const role = userData.role as string;
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from("planned_calendar_events")
      .select(EVENT_SELECT)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      console.error("[PLANNED-EVENTS] Fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch planned events" }, { status: 500 });
    }

    return NextResponse.json({ events: data });
  } catch (err) {
    console.error("[PLANNED-EVENTS] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
      }
    }
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users').select('role').eq('id', user.id).single();
    if (userError || !userData) return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });

    const role = userData.role as string;
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const body = await req.json();
    const { event_name, event_date, start_time, end_time, venue_id } = body;

    if (!event_name || !event_date || !venue_id) {
      return NextResponse.json({ error: "event_name, event_date, and venue_id are required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("planned_calendar_events")
      .insert({ event_name, event_date, start_time: start_time || null, end_time: end_time || null, venue_id })
      .select(EVENT_SELECT)
      .single();

    if (error) {
      console.error("[PLANNED-EVENTS] Insert error:", error);
      return NextResponse.json({ error: "Failed to create planned event" }, { status: 500 });
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    console.error("[PLANNED-EVENTS] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
      }
    }
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users').select('role').eq('id', user.id).single();
    if (userError || !userData) return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });

    const role = userData.role as string;
    if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const body = await req.json();
    const { event_name, event_date, venue_id } = body;

    if (!event_name || !event_date || !venue_id) {
      return NextResponse.json({ error: "event_name, event_date, and venue_id are required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("planned_calendar_events")
      .update({ event_name, event_date, venue_id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(EVENT_SELECT)
      .single();

    if (error) {
      console.error("[PLANNED-EVENTS] Update error:", error);
      return NextResponse.json({ error: "Failed to update planned event" }, { status: 500 });
    }

    return NextResponse.json({ event: data });
  } catch (err) {
    console.error("[PLANNED-EVENTS] PATCH error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) user = { id: tokenUser.user.id } as any;
      }
    }
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users').select('role').eq('id', user.id).single();
    if (userError || !userData) return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });

    const role = userData.role as string;
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { error } = await supabaseAdmin
      .from("planned_calendar_events")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[PLANNED-EVENTS] Delete error:", error);
      return NextResponse.json({ error: "Failed to delete planned event" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PLANNED-EVENTS] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
