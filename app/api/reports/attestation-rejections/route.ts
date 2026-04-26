// app/api/reports/attestation-rejections/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_ROLES = ["manager", "supervisor", "supervisor2", "hr", "exec"];

type MaybeArray<T> = T | T[] | null | undefined;

type RejectionQueryRow = {
  id: string;
  rejection_reason: string;
  rejection_notes: string | null;
  created_at: string;
  user_id: string;
  event_id: string | null;
  time_entry_id: string;
  time_entries: MaybeArray<{
    id: string;
    user_id: string | null;
    event_id: string | null;
    action: string | null;
    timestamp: string | null;
  }>;
  events: MaybeArray<{
    event_name: string | null;
    venue: string | null;
    city: string | null;
    state: string | null;
    event_date: string | null;
  }>;
  users: MaybeArray<{
    email: string | null;
    role: string | null;
    division: string | null;
    profiles: MaybeArray<{
      first_name: string | null;
      last_name: string | null;
    }>;
  }>;
};

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

function dec(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try { return safeDecrypt(value.trim()); } catch { return value.trim(); }
}

function one<T>(value: MaybeArray<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * GET /api/reports/attestation-rejections
 * Query params:
 *   from = YYYY-MM-DD (filter by created_at start)
 *   to   = YYYY-MM-DD (filter by created_at end)
 */
export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", authedUser.id)
      .maybeSingle();

    const role = (userData?.role || "").toLowerCase().trim();
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    let query = supabaseAdmin
      .from("attestation_rejections")
      .select(`
        id,
        rejection_reason,
        rejection_notes,
        created_at,
        user_id,
        event_id,
        time_entry_id,
        time_entries (
          id,
          user_id,
          event_id,
          action,
          timestamp
        ),
        events (
          event_name,
          venue,
          city,
          state,
          event_date
        ),
        users (
          email,
          role,
          division,
          profiles (
            first_name,
            last_name
          )
        )
      `)
      .order("created_at", { ascending: false });

    if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const rejectionRows = (rows || []) as RejectionQueryRow[];
    const affectedUserIds = Array.from(new Set(rejectionRows.map((row) => row.user_id).filter(Boolean)));
    const clockOutTimestamps = rejectionRows
      .map((row) => one(row.time_entries)?.timestamp || null)
      .filter((timestamp): timestamp is string => typeof timestamp === "string" && timestamp.length > 0);

    const shiftByClockOutId = new Map<string, { clock_in: string | null; clock_out: string | null }>();

    if (affectedUserIds.length > 0 && clockOutTimestamps.length > 0) {
      const minClockOut = new Date(clockOutTimestamps.reduce((min, current) => (current < min ? current : min)));
      const maxClockOut = clockOutTimestamps.reduce((max, current) => (current > max ? current : max));
      minClockOut.setDate(minClockOut.getDate() - 2);

      const { data: timeEntries, error: timeEntriesError } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, event_id, action, timestamp")
        .in("user_id", affectedUserIds)
        .in("action", ["clock_in", "clock_out"])
        .gte("timestamp", minClockOut.toISOString())
        .lte("timestamp", maxClockOut)
        .order("timestamp", { ascending: true });

      if (timeEntriesError) throw new Error(timeEntriesError.message);

      const entriesByUser = new Map<string, any[]>();
      for (const entry of timeEntries || []) {
        if (!entry.user_id) continue;
        if (!entriesByUser.has(entry.user_id)) entriesByUser.set(entry.user_id, []);
        entriesByUser.get(entry.user_id)!.push(entry);
      }

      for (const userEntries of entriesByUser.values()) {
        let openClockIn: any = null;

        for (const entry of userEntries) {
          if (entry.action === "clock_in") {
            openClockIn = entry;
            continue;
          }

          if (entry.action === "clock_out") {
            shiftByClockOutId.set(entry.id, {
              clock_in: openClockIn?.timestamp || null,
              clock_out: entry.timestamp || null,
            });
            openClockIn = null;
          }
        }
      }
    }

    const mapped = rejectionRows.map((row) => {
      const worker = one(row.users);
      const profile = one(worker?.profiles);
      const event = one(row.events);
      const clockOutEntry = one(row.time_entries);
      const shift = shiftByClockOutId.get(row.time_entry_id);
      const firstName = dec(profile?.first_name);
      const lastName = dec(profile?.last_name);
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || worker?.email || row.user_id;

      return {
        id: row.id,
        user_id: row.user_id,
        worker_name: fullName,
        worker_email: worker?.email || "",
        worker_role: worker?.role || "",
        worker_division: worker?.division || "",
        event_id: row.event_id,
        event_name: event?.event_name || "",
        event_venue: event?.venue || "",
        event_city: event?.city || "",
        event_state: event?.state || "",
        event_date: event?.event_date || "",
        time_entry_id: row.time_entry_id,
        clock_in: shift?.clock_in || null,
        clock_out: shift?.clock_out || clockOutEntry?.timestamp || null,
        rejection_reason: row.rejection_reason,
        rejection_notes: row.rejection_notes || "",
        created_at: row.created_at,
      };
    });

    const uniqueWorkers = new Set(mapped.map((row) => row.user_id)).size;
    const uniqueEvents = new Set(mapped.filter((row) => row.event_id).map((row) => row.event_id)).size;

    const reasonCounts: Record<string, number> = {};
    for (const row of mapped) {
      const key = row.rejection_reason || "Unknown";
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    }

    return NextResponse.json({
      total: mapped.length,
      unique_workers: uniqueWorkers,
      unique_events: uniqueEvents,
      reason_counts: reasonCounts,
      rows: mapped,
    });
  } catch (err: any) {
    console.error("[attestation-rejections report]", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
