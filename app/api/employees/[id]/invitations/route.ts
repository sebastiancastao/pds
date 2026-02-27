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

type AvailabilityDay = {
  date: string;
  available: boolean;
  notes: string | null;
};

const normalizeAvailabilityPayload = (payload: unknown): AvailabilityDay[] => {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (
          day
        ): day is { date: string; available?: unknown; notes?: unknown } =>
          !!day &&
          typeof day === "object" &&
          typeof (day as { date?: unknown }).date === "string"
      )
      .map((day) => ({
        date: day.date.slice(0, 10),
        available: day.available === true,
        notes: typeof day.notes === "string" ? day.notes : null,
      }));
  }

  if (payload && typeof payload === "object") {
    return Object.entries(payload as Record<string, unknown>).map(
      ([date, available]) => ({
        date: date.slice(0, 10),
        available: available === true,
        notes: null,
      })
    );
  }

  return [];
};

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

    const [
      { data: teamRows, error: teamErr },
      { data: locationRows, error: locationErr },
      { data: availabilityRows, error: availabilityErr },
    ] = await Promise.all([
      // Fetch team invitations from event_teams
      supabaseAdmin
        .from("event_teams")
        .select(`
        id,
        event_id,
        status,
        confirmation_token,
        created_at,
        events (
          event_name,
          event_date,
          start_time,
          venue,
          city,
          state
        )
      `)
        .eq("vendor_id", userId)
        .order("created_at", { ascending: false }),

      // Fetch location invitations from event_location_assignments
      supabaseAdmin
        .from("event_location_assignments")
        .select(`
        id,
        event_id,
        created_at,
        event_locations (
          name,
          call_time
        ),
        events (
          event_name,
          event_date,
          start_time,
          venue,
          city,
          state
        )
      `)
        .eq("vendor_id", userId)
        .order("created_at", { ascending: false }),

      // Fetch submitted availability from vendor invitations
      supabaseAdmin
        .from("vendor_invitations")
        .select("availability, responded_at, updated_at, created_at")
        .eq("vendor_id", userId)
        .not("availability", "is", null)
        .order("responded_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false }),
    ]);

    if (teamErr) {
      console.error("event_teams query error:", teamErr);
      return NextResponse.json({ error: teamErr.message }, { status: 500 });
    }

    if (locationErr) {
      console.error("event_location_assignments query error:", locationErr);
      return NextResponse.json({ error: locationErr.message }, { status: 500 });
    }

    if (availabilityErr) {
      console.error("vendor_invitations query error:", availabilityErr);
      return NextResponse.json({ error: availabilityErr.message }, { status: 500 });
    }

    // Build a latest-per-date view of submitted availability.
    const availabilityByDate = new Map<
      string,
      {
        available: boolean;
        notes: string | null;
        submitted_at: string | null;
      }
    >();
    const latestSubmission =
      (availabilityRows || [])
        .map(
          (row: any) =>
            row.responded_at || row.updated_at || row.created_at || null
        )
        .find((value: string | null): value is string => typeof value === "string") ||
      null;

    for (const row of availabilityRows || []) {
      const submittedAt =
        row.responded_at || row.updated_at || row.created_at || null;
      const days = normalizeAvailabilityPayload(row.availability);

      for (const day of days) {
        if (!day.date || availabilityByDate.has(day.date)) continue;
        availabilityByDate.set(day.date, {
          available: day.available,
          notes: day.notes,
          submitted_at: submittedAt,
        });
      }
    }

    const availabilitySubmissions = Array.from(availabilityByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date,
        available: value.available,
        notes: value.notes,
        submitted_at: value.submitted_at,
      }));

    // Normalize team rows
    const teamInvitations = (teamRows || []).map((row: any) => {
      const ev = Array.isArray(row.events) ? row.events[0] : row.events;
      return {
        id: row.id,
        event_id: row.event_id,
        event_name: ev?.event_name ?? null,
        event_date: ev?.event_date ?? null,
        start_time: ev?.start_time ?? null,
        venue: ev?.venue ?? null,
        city: ev?.city ?? null,
        state: ev?.state ?? null,
        status: row.status ?? "assigned",
        source: "team" as const,
        location_name: null,
        assigned_at: row.created_at,
        confirmation_token: row.confirmation_token ?? null,
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
        start_time: loc?.call_time ?? ev?.start_time ?? null,
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

    return NextResponse.json({
      invitations: all,
      availability_submissions: availabilitySubmissions,
      availability_last_submitted_at: latestSubmission,
    });
  } catch (err: any) {
    console.error("invitations route error:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
