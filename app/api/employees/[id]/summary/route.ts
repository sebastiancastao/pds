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

const SICK_LEAVE_ACCRUAL_HOURS_WORKED = 30;
const HOURS_PER_WORKDAY = 8;

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

function fullMonthsBetween(start?: string | null, end = new Date()) {
  if (!start) return 0;
  const startDate = toDateSafe(start);
  if (!startDate) return 0;
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const startUTC = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  let months =
    (endDate.getUTCFullYear() - startUTC.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startUTC.getUTCMonth());
  if (endDate.getUTCDate() < startUTC.getUTCDate()) {
    months -= 1;
  }
  return Math.max(0, months);
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
          profile_photo_data,
          region_id,
          regions ( id, name )
        )
      `)
      .eq("id", userId)
      .maybeSingle();

    if (userErr) {
      console.error("users query error:", userErr);
    }

    let profile: any = null;
    let employeeEmail: string | null = null;
    let employeeCreatedAt: string | null = null;

    if (user && user.profiles) {
      // Found in users table with profiles join
      profile = (user.profiles as any)?.[0] || user.profiles;
      employeeEmail = user.email;
      employeeCreatedAt = user.created_at;
    } else {
      // Fall back: query profiles directly (user may exist only in profiles table)
      const { data: profileData, error: profileErr } = await supabaseAdmin
        .from("profiles")
        .select(`
          first_name,
          last_name,
          phone,
          city,
          state,
          profile_photo_data,
          region_id,
          regions ( id, name )
        `)
        .eq("user_id", userId)
        .maybeSingle();

      if (profileErr) {
        console.error("profiles fallback query error:", profileErr);
      }

      if (!profileData) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }

      profile = profileData;
    }

    // Safely decrypt names (handles both encrypted and non-encrypted data)
    const firstName = profile.first_name ? safeDecrypt(profile.first_name) : "N/A";
    const lastName = profile.last_name ? safeDecrypt(profile.last_name) : "N/A";

    // Combine user and profile data into employee object
    const region = (profile.regions as any)?.[0] || profile.regions || null;
    const employee = {
      id: userId,
      first_name: firstName,
      last_name: lastName,
      email: employeeEmail,
      phone: profile.phone,
      city: profile.city,
      state: profile.state,
      profile_photo_url: null, // Binary data not exposed as URL
      department: "General",
      position: "Vendor",
      hire_date: employeeCreatedAt,
      status: "active" as const,
      salary: null,
      region_id: profile.region_id || null,
      region_name: region?.name || null,
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

    // Pair clock_in/clock_out entries, deduct meal breaks, add 30 min bonus
    type TimeEntryRaw = {
      id: string;
      event_id: string | null;
      action: string;
      timestamp: string;
      created_at: string;
    };

    // Sort ALL entries globally by timestamp ascending.
    // This ensures correct pairing even when clock_in/clock_out and meal entries
    // have different (or null) event_ids due to being recorded via different apps.
    const allEntries = ((rawEntries ?? []) as TimeEntryRaw[]).slice().sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Pair clock_in/clock_out globally (not per-event) to handle mismatched event_ids
    const normalized = [];
    let clockIn: TimeEntryRaw | null = null;
    for (const entry of allEntries) {
      const action = (entry.action || "").toLowerCase();

      if (action === "clock_in") {
        // Only latch the FIRST clock_in; don't overwrite an open one.
        // This prevents orphaned/duplicate clock_in entries from displacing the
        // correct clock_in and showing a wrong hour in the sub-row.
        if (!clockIn) clockIn = entry;
      } else if (action === "clock_out" && clockIn) {
        const shiftStart = new Date(clockIn.timestamp).getTime();
        const shiftEnd   = new Date(entry.timestamp).getTime();
        let shiftMs = shiftEnd - shiftStart;
        if (shiftMs <= 0) { clockIn = null; continue; }

        // Determine event_id: prefer clock_in's, then clock_out's.
        // Meal event_id is used as a last-resort fallback (assigned below after
        // meals are collected) for cases where both clock entries have null event_id
        // but the meal was recorded via the kiosk (which does set event_id).
        let eventId = clockIn.event_id || entry.event_id || null;

        // Find all meal entries whose timestamp falls within this shift window,
        // regardless of their event_id (handles meals recorded via different app)
        const mealsInShift = allEntries.filter(e => {
          const t = new Date(e.timestamp).getTime();
          return t > shiftStart && t < shiftEnd &&
            ((e.action || "").toLowerCase() === "meal_start" ||
             (e.action || "").toLowerCase() === "meal_end");
        });
        const mealStarts = mealsInShift.filter(e => (e.action || "").toLowerCase() === "meal_start");
        const mealEnds   = mealsInShift.filter(e => (e.action || "").toLowerCase() === "meal_end");

        // Fall back to a meal entry's event_id when both clock entries have none
        if (!eventId) {
          eventId = mealStarts[0]?.event_id || mealEnds[0]?.event_id || null;
        }

        const mealBreaks: Array<{ start: number; end: number }> = [];
        const pairedMeals = Math.min(mealStarts.length, mealEnds.length);
        for (let i = 0; i < pairedMeals; i++) {
          mealBreaks.push({
            start: new Date(mealStarts[i].timestamp).getTime(),
            end:   new Date(mealEnds[i].timestamp).getTime(),
          });
        }

        // Deduct meal break time that falls within this shift
        for (const meal of mealBreaks) {
          const overlapStart = Math.max(meal.start, shiftStart);
          const overlapEnd   = Math.min(meal.end, shiftEnd);
          if (overlapEnd > overlapStart) shiftMs -= (overlapEnd - overlapStart);
        }

        // Add 30-minute bonus per shift
        shiftMs += 30 * 60 * 1000;

        const duration_hours = Number(Math.max(0, shiftMs / (1000 * 60 * 60)).toFixed(3));
        normalized.push({
          id: clockIn.id + "_" + entry.id,
          event_id: eventId,
          clock_in: clockIn.timestamp,
          clock_out: entry.timestamp,
          duration_hours,
          created_at: clockIn.created_at,
        });
        clockIn = null;
      }
    }

    // Handle unpaired clock_in (no clock_out yet)
    if (clockIn) {
      normalized.push({
        id: clockIn.id,
        event_id: clockIn.event_id ?? null,
        clock_in: clockIn.timestamp,
        clock_out: null,
        duration_hours: 0,
        created_at: clockIn.created_at,
      });
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

    // First, get all events this vendor is part of from event_teams
    const { data: eventTeams, error: eventTeamsErr } = await supabaseAdmin
      .from("event_teams")
      .select("event_id")
      .eq("vendor_id", userId);

    console.log("🔵 [DEBUG] Event teams for vendor:", eventTeams);
    console.log("🔵 [DEBUG] Event teams query error:", eventTeamsErr);

    // Get unique event IDs from event_teams
    const vendorEventIds = eventTeams ? [...new Set(eventTeams.map(et => et.event_id).filter(Boolean))] : [];

    // Fetch event details from events table
    let eventsMap: Record<string, { id: string; event_name: string | null; event_date: string | null; venue: string | null }> = {};
    if (vendorEventIds.length > 0) {
      const { data: events, error: evErr } = await supabaseAdmin
        .from("events")
        .select("id, event_name, event_date, venue")
        .in("id", vendorEventIds);

      console.log("🔵 [DEBUG] Queried event IDs from event_teams:", vendorEventIds);
      console.log("🔵 [DEBUG] Events returned from DB:", events);
      console.log("🔵 [DEBUG] Query error:", evErr);

      if (!evErr && events) {
        eventsMap = Object.fromEntries(
          events.map((ev) => [
            ev.id,
            { id: ev.id, event_name: ev.event_name, event_date: ev.event_date, venue: ev.venue ?? null },
          ])
        );
      }
    }

    // Group time entries by event
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

    // Build per_event array from event_teams (not just time_entries)
    const by_event = vendorEventIds.map(eventId => {
      const timeData = byEventMap.get(eventId);
      return {
        event_id: eventId,
        shifts: timeData?.shifts || 0,
        hours: timeData?.hours || 0,
      };
    }).sort((a, b) => b.hours - a.hours);

    // Calculate totals based only on events in event_teams
    const totalShiftsForTeamEvents = by_event.reduce((sum, e) => sum + e.shifts, 0);
    const totalHoursForTeamEvents = by_event.reduce((sum, e) => sum + e.hours, 0);

    const { data: sickLeaveRows, error: sickLeaveErr } = await supabaseAdmin
      .from("sick_leaves")
      .select("id, start_date, end_date, duration_hours, status, reason, approved_at, approved_by, created_at")
      .eq("user_id", userId)
      .order("start_date", { ascending: false });

    if (sickLeaveErr) {
      console.error("sick_leaves query error:", sickLeaveErr);
      return NextResponse.json(
        { error: sickLeaveErr.message || "Failed to load sick leave data" },
        { status: 500 }
      );
    }

    const sickLeaveEntries = (sickLeaveRows ?? []).map((row: any) => ({
      id: row.id,
      start_date: row.start_date,
      end_date: row.end_date,
      duration_hours: Number(row.duration_hours ?? 0),
      status: String(row.status ?? "pending").toLowerCase(),
      reason: row.reason ?? null,
      approved_at: row.approved_at ?? null,
      approved_by: row.approved_by ?? null,
      created_at: row.created_at ?? null,
    }));

    const totalSickHours = sickLeaveEntries.reduce((sum, entry) => sum + (entry.duration_hours || 0), 0);
    const tenureMonths = fullMonthsBetween(employee.hire_date);
    const accruedHours = Number(
      (totalHoursForTeamEvents / SICK_LEAVE_ACCRUAL_HOURS_WORKED).toFixed(2)
    );
    const accruedDays = Number((accruedHours / HOURS_PER_WORKDAY).toFixed(2));
    const availableHours = Number(Math.max(0, accruedHours - totalSickHours).toFixed(2));
    const availableDays = Number((availableHours / HOURS_PER_WORKDAY).toFixed(2));
    const sickLeaveSummary = {
      total_hours: Number(totalSickHours.toFixed(2)),
      total_days: Number((totalSickHours / HOURS_PER_WORKDAY).toFixed(2)),
      entries: sickLeaveEntries,
      accrued_months: tenureMonths,
      accrued_hours: accruedHours,
      accrued_days: accruedDays,
      balance_hours: availableHours,
      balance_days: availableDays,
    };

    return NextResponse.json(
      {
        employee,
        summary: {
          total_hours: Number(totalHoursForTeamEvents.toFixed(3)),
          total_shifts: totalShiftsForTeamEvents,
          month_hours: Number(month_hours.toFixed(3)),
          last_30d_hours: Number(last_30d_hours.toFixed(3)),
          per_event: by_event.map((row) => {
              const eventData = eventsMap[row.event_id] ?? null;
              return {
                event_id: row.event_id,
                shifts: row.shifts,
                hours: Number(row.hours.toFixed(3)),
                event_name: eventData?.event_name || row.event_id,
                event_date: eventData?.event_date ?? null,
                venue: eventData?.venue ?? null,
              };
            }),
          sick_leave: sickLeaveSummary,
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
