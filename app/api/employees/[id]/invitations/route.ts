// app/api/employees/[id]/invitations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

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

    let { data: { user: sessionUser } } = await supabase.auth.getUser();

    if (!sessionUser) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
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

    // Fetch team invitations from event_teams
    const { data: teamRows, error: teamErr } = await supabaseAdmin
      .from("event_teams")
      .select(`
        id,
        event_id,
        status,
        created_at,
        events (
          event_name,
          event_date,
          venue,
          city,
          state
        )
      `)
      .eq("vendor_id", userId)
      .order("created_at", { ascending: false });

    if (teamErr) {
      console.error("event_teams query error:", teamErr);
      return NextResponse.json({ error: teamErr.message }, { status: 500 });
    }

    // Fetch location invitations from event_location_assignments
    const { data: locationRows, error: locationErr } = await supabaseAdmin
      .from("event_location_assignments")
      .select(`
        id,
        event_id,
        created_at,
        event_locations (
          name
        ),
        events (
          event_name,
          event_date,
          venue,
          city,
          state
        )
      `)
      .eq("vendor_id", userId)
      .order("created_at", { ascending: false });

    if (locationErr) {
      console.error("event_location_assignments query error:", locationErr);
      return NextResponse.json({ error: locationErr.message }, { status: 500 });
    }

    // Normalize team rows
    const teamInvitations = (teamRows || []).map((row: any) => {
      const ev = Array.isArray(row.events) ? row.events[0] : row.events;
      return {
        id: row.id,
        event_id: row.event_id,
        event_name: ev?.event_name ?? null,
        event_date: ev?.event_date ?? null,
        venue: ev?.venue ?? null,
        city: ev?.city ?? null,
        state: ev?.state ?? null,
        status: row.status ?? "assigned",
        source: "team" as const,
        location_name: null,
        assigned_at: row.created_at,
      };
    });

    // Normalize location rows
    const locationInvitations = (locationRows || []).map((row: any) => {
      const ev = Array.isArray(row.events) ? row.events[0] : row.events;
      const loc = Array.isArray(row.event_locations) ? row.event_locations[0] : row.event_locations;
      return {
        id: row.id,
        event_id: row.event_id,
        event_name: ev?.event_name ?? null,
        event_date: ev?.event_date ?? null,
        venue: ev?.venue ?? null,
        city: ev?.city ?? null,
        state: ev?.state ?? null,
        status: "assigned" as const,
        source: "location" as const,
        location_name: loc?.name ?? null,
        assigned_at: row.created_at,
      };
    });

    // Merge and sort by assigned_at descending
    const all = [...teamInvitations, ...locationInvitations].sort(
      (a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime()
    );

    return NextResponse.json({ invitations: all });
  } catch (err: any) {
    console.error("invitations route error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
