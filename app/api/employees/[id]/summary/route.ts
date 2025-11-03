// app/api/employees/[id]/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";

// Optional admin + anon (token fallback if you use it elsewhere)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ---------- Utilities ----------
function toDateSafe(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function hoursBetween(clock_in: string | null, clock_out: string | null) {
  const a = toDateSafe(clock_in);
  const b = toDateSafe(clock_out);
  if (!a || !b) return 0;
  const ms = b.getTime() - a.getTime();
  return ms > 0 ? ms / (1000 * 60 * 60) : 0;
}

type ActionItem = {
  type?: string | null;
  action?: string | null;
  at?: string | null;
  ts?: string | number | null;
  timestamp?: string | null;
  time?: string | null;
  // other fields possible
};

type ActionsShape =
  | null
  | undefined
  | Record<string, any>
  | ActionItem[]
  | string;

/**
 * Derive clock-in / clock-out from "actions".
 * Supports:
 * 1) Object with {clock_in, clock_out}
 * 2) Array of items where an item indicates in/out via type/action fields, and time at at/ts/timestamp/time.
 *    - Picks earliest IN and latest OUT.
 */
function deriveInOutFromActions(actions: ActionsShape): {
  clock_in: string | null;
  clock_out: string | null;
} {
  if (!actions) return { clock_in: null, clock_out: null };

  // If it's a JSON string, try to parse
  if (typeof actions === "string") {
    try {
      const parsed = JSON.parse(actions);
      actions = parsed;
    } catch {
      return { clock_in: null, clock_out: null };
    }
  }

  // Case 1: object with fields
  if (!Array.isArray(actions) && typeof actions === "object") {
    const obj = actions as Record<string, any>;
    // Common field names
    const cin =
      obj.clock_in ??
      obj.check_in ??
      obj.in ??
      obj.start ??
      obj.clockIn ??
      null;
    const cout =
      obj.clock_out ??
      obj.check_out ??
      obj.out ??
      obj.end ??
      obj.clockOut ??
      null;

    const inStr = toDateSafe(cin)?.toISOString() ?? null;
    const outStr = toDateSafe(cout)?.toISOString() ?? null;
    return { clock_in: inStr, clock_out: outStr };
  }

  // Case 2: array of action items
  if (Array.isArray(actions)) {
    let earliestIn: Date | null = null;
    let latestOut: Date | null = null;

    for (const raw of actions as ActionItem[]) {
      const label = String((raw.type ?? raw.action ?? "")).toLowerCase();
      const whenRaw =
        raw.at ?? raw.timestamp ?? raw.time ?? (raw.ts != null ? raw.ts : null);
      let when: Date | null = null;

      // ts might be a number (epoch) or string
      if (typeof whenRaw === "number") {
        const d = new Date(whenRaw);
        when = isNaN(d.getTime()) ? null : d;
      } else {
        when = toDateSafe(String(whenRaw ?? ""));
      }

      if (!when) continue;

      const isIn =
        label.includes("clock_in") ||
        label === "in" ||
        label === "check_in" ||
        label === "start" ||
        label.includes("start");

      const isOut =
        label.includes("clock_out") ||
        label === "out" ||
        label === "check_out" ||
        label === "end" ||
        label.includes("end");

      if (isIn) {
        if (!earliestIn || when < earliestIn) earliestIn = when;
      }
      if (isOut) {
        if (!latestOut || when > latestOut) latestOut = when;
      }
    }

    return {
      clock_in: earliestIn ? earliestIn.toISOString() : null,
      clock_out: latestOut ? latestOut.toISOString() : null,
    };
  }

  return { clock_in: null, clock_out: null };
}

function startOfUTCMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}
function daysAgoUTC(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ---------- Route ----------
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // session via cookie
    let { data: { user: sessionUser } } = await supabase.auth.getUser();

    // Bearer fallback
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

    // ---- Get user from users table (has email) and join with profiles
    const { data: user, error: userErr } = await supabaseAdmin
      .from("users")
      .select(`
        id,
        email,
        role,
        created_at,
        profiles!inner (
          first_name,
          last_name,
          phone,
          city,
          state,
          profile_photo_data
        )
      `)
      .eq("id", userId)
      .maybeSingle();

    if (userErr) {
      console.error("users query error:", userErr);
      return NextResponse.json(
        { error: userErr.message || "Failed to load user" },
        { status: 500 }
      );
    }
    if (!user || !user.profiles) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // profiles is an array even with inner join, so we need to access the first element
    const profile = (user.profiles as any)?.[0] || user.profiles;

    // Safely decrypt names (handles both encrypted and non-encrypted data)
    const firstName = profile.first_name ? safeDecrypt(profile.first_name) : "N/A";
    const lastName = profile.last_name ? safeDecrypt(profile.last_name) : "N/A";

    // Combine user and profile data into employee object
    const employee = {
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      email: user.email,
      phone: profile.phone,
      city: profile.city,
      state: profile.state,
      profile_photo_url: null, // Binary data not exposed as URL
      department: "General",
      position: "Vendor",
      hire_date: user.created_at,
      status: "active" as const,
      salary: null,
    };

    // ---- Pull time_entries with action and timestamp columns
    const { data: rawEntries, error: teErr } = await supabaseAdmin
      .from("time_entries")
      .select("id, event_id, action, timestamp, created_at, user_id")
      .or(`user_id.eq.${userId}`)
      .order("timestamp", { ascending: false });

    if (teErr) {
      console.error("time_entries error:", teErr);
      return NextResponse.json(
        { error: teErr.message || "Failed to load time entries" },
        { status: 500 }
      );
    }

    // Group entries by event_id and pair clock_in/clock_out
    type TimeEntryRaw = {
      id: string;
      event_id: string | null;
      action: string;
      timestamp: string;
      created_at: string;
    };

    // Sort entries by event and timestamp to pair them
    const entriesByEvent = new Map<string, TimeEntryRaw[]>();
    for (const entry of (rawEntries ?? []) as TimeEntryRaw[]) {
      const key = entry.event_id || "unknown";
      if (!entriesByEvent.has(key)) {
        entriesByEvent.set(key, []);
      }
      entriesByEvent.get(key)!.push(entry);
    }

    // Pair clock_in and clock_out entries
    const normalized = [];
    for (const [eventId, entries] of entriesByEvent.entries()) {
      // Sort by timestamp ascending to match pairs
      entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      let clockIn: TimeEntryRaw | null = null;
      for (const entry of entries) {
        const action = (entry.action || "").toLowerCase();

        if (action === "clock_in") {
          clockIn = entry;
        } else if (action === "clock_out" && clockIn) {
          // Found a pair
          const duration_hours = Number(hoursBetween(clockIn.timestamp, entry.timestamp).toFixed(3));
          normalized.push({
            id: clockIn.id + "_" + entry.id,
            event_id: eventId === "unknown" ? null : eventId,
            clock_in: clockIn.timestamp,
            clock_out: entry.timestamp,
            duration_hours,
            created_at: clockIn.created_at,
          });
          clockIn = null; // Reset for next pair
        }
      }

      // Handle unpaired clock_in (no clock_out yet)
      if (clockIn) {
        normalized.push({
          id: clockIn.id,
          event_id: eventId === "unknown" ? null : eventId,
          clock_in: clockIn.timestamp,
          clock_out: null,
          duration_hours: 0,
          created_at: clockIn.created_at,
        });
      }
    }

    // Totals
    const total_hours = normalized.reduce((acc, r) => acc + (r.duration_hours || 0), 0);
    const monthStart = startOfUTCMonth(new Date());
    const last30 = daysAgoUTC(30);

    const month_hours = normalized
      .filter((r) => r.clock_in && new Date(r.clock_in) >= monthStart)
      .reduce((a, r) => a + r.duration_hours, 0);

    const last_30d_hours = normalized
      .filter((r) => r.clock_in && new Date(r.clock_in) >= last30)
      .reduce((a, r) => a + r.duration_hours, 0);

    // Group by event
    const byEventMap = new Map<
      string,
      { event_id: string; shifts: number; hours: number }
    >();
    for (const r of normalized) {
      const key = r.event_id || "unknown";
      const row = byEventMap.get(key) ?? { event_id: key, shifts: 0, hours: 0 };
      row.shifts += 1;
      row.hours += r.duration_hours || 0;
      byEventMap.set(key, row);
    }
    const by_event = Array.from(byEventMap.values()).sort((a, b) => b.hours - a.hours);

    // Enrich events (best-effort)
    let eventsMap: Record<string, { id: string; event_name: string; event_date: string | null; venue: string | null }> = {};
    const eventIds = by_event.map((x) => x.event_id).filter((x) => x !== "unknown");
    if (eventIds.length) {
      const { data: events, error: evErr } = await supabaseAdmin
        .from("events")
        .select("id, event_name, event_date, venue")
        .in("id", eventIds);
      if (!evErr && events) {
        eventsMap = Object.fromEntries(
          events.map((ev) => [
            ev.id,
            { id: ev.id, event_name: ev.event_name, event_date: ev.event_date, venue: ev.venue ?? null },
          ])
        );
      }
    }

    return NextResponse.json(
      {
        employee,
        summary: {
          total_hours: Number(total_hours.toFixed(3)),
          total_shifts: normalized.length,
          month_hours: Number(month_hours.toFixed(3)),
          last_30d_hours: Number(last_30d_hours.toFixed(3)),
          per_event: by_event.map((row) => ({
            ...row,
            hours: Number(row.hours.toFixed(3)),
            event: row.event_id !== "unknown" ? eventsMap[row.event_id] ?? null : null,
          })),
        },
        // Each entry now has clock_in/clock_out derived from actions for your UI column
        entries: normalized,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("employees/[id]/summary error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
