// app/api/employees/[id]/invitations/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { getMergedVendorAvailability } from "@/lib/vendorAvailability";

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

    const [
      { data: teamRows, error: teamErr },
      { data: locationRows, error: locationErr },
      { days: availabilitySubmissions, lastSubmittedAt: latestSubmission },
    ] = await Promise.all([
      // Fetch team invitations from event_teams
      supabaseAdmin
        .from("event_teams")
        .select(`
        id,
        event_id,
        status,
        stand_leader,
        confirmation_token,
        created_at,
        events (
          event_name,
          event_date,
          end_date,
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
          end_date,
          start_time,
          venue,
          city,
          state
        )
      `)
        .eq("vendor_id", userId)
        .order("created_at", { ascending: false }),

      // Merged, latest-per-date availability (submissions + approved corrections)
      getMergedVendorAvailability(supabaseAdmin, userId),
    ]);

    if (teamErr) {
      console.error("event_teams query error:", teamErr);
      return NextResponse.json({ error: teamErr.message }, { status: 500 });
    }

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
        end_date: ev?.end_date ?? null,
        start_time: ev?.start_time ?? null,
        venue: ev?.venue ?? null,
        city: ev?.city ?? null,
        state: ev?.state ?? null,
        status: row.status ?? "assigned",
        source: "team" as const,
        location_name: null,
        assigned_at: row.created_at,
        confirmation_token: row.confirmation_token ?? null,
        stand_leader: row.stand_leader === true,
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
        end_date: ev?.end_date ?? null,
        start_time: loc?.call_time ?? ev?.start_time ?? null,
        venue: ev?.venue ?? null,
        city: ev?.city ?? null,
        state: ev?.state ?? null,
        status: "assigned" as const,
        source: "location" as const,
        location_name: loc?.name ?? null,
        assigned_at: row.created_at,
        stand_leader: false,
      };
    });

    // Status priority: team entries (with real statuses) win over location "assigned"
    const STATUS_PRIORITY: Record<string, number> = {
      confirmed: 5,
      declined: 4,
      pending_confirmation: 3,
      pending: 2,
      assigned: 1,
    };

    // Merge, then deduplicate by event_id keeping the highest-priority status
    const merged = [...teamInvitations, ...locationInvitations].sort(
      (a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime()
    );

    const seen = new Map<string, typeof merged[0]>();
    for (const inv of merged) {
      const existing = seen.get(inv.event_id);
      if (!existing) {
        seen.set(inv.event_id, inv);
      } else {
        const existingPriority = STATUS_PRIORITY[existing.status] ?? 0;
        const newPriority = STATUS_PRIORITY[inv.status] ?? 0;
        // Stand leader is a team-level flag that must survive dedup regardless of
        // which entry wins on status priority.
        const standLeader = Boolean(existing.stand_leader || inv.stand_leader);
        if (newPriority > existingPriority) {
          seen.set(inv.event_id, { ...inv, stand_leader: standLeader });
        } else if (standLeader !== existing.stand_leader) {
          seen.set(inv.event_id, { ...existing, stand_leader: standLeader });
        }
      }
    }

    const all = Array.from(seen.values()).sort(
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
