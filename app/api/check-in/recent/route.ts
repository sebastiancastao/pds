import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt, isEncrypted } from "@/lib/encryption";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function getAuthedUser(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

function computeEventWindow(event: any): { startIso: string; endIso: string } | null {
  const dateStr = String(event?.event_date || "").split("T")[0];
  const startTime = String(event?.start_time || "");
  const endTime = String(event?.end_time || "");
  if (!dateStr || !startTime || !endTime) return null;

  const start = new Date(`${dateStr}T${startTime}`);
  const end = new Date(`${dateStr}T${endTime}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const endsNextDay = Boolean(event?.ends_next_day);
  if (endsNextDay || end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function decryptProfileNamePart(value: unknown, userIdForLog: string): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isEncrypted(trimmed)) return trimmed;
  try {
    return decrypt(trimmed);
  } catch {
    console.warn("Profile name decryption failed for user", userIdForLog);
    return "";
  }
}

function isValidUuid(id: unknown) {
  if (typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * GET /api/check-in/recent?eventId=<uuid>
 *
 * Returns recent activity from time_entries for the active event window.
 * When the event ends, activity naturally disappears.
 */
export async function GET(req: NextRequest) {
  try {
    const kioskUser = await getAuthedUser(req);
    if (!kioskUser?.id) return jsonError("Not authenticated", 401);

    const { searchParams } = new URL(req.url);
    const requestedEventId = searchParams.get("eventId");

    const now = new Date();
    const today = toLocalDateStr(now);
    const yesterday = addDays(today, -1);

    let event: any = null;
    if (requestedEventId && isValidUuid(requestedEventId)) {
      const { data: evt, error: evtErr } = await supabaseAdmin
        .from("events")
        .select("id, event_name, event_date, start_time, end_time, ends_next_day, is_active")
        .eq("id", requestedEventId)
        .maybeSingle();
      if (evtErr) return jsonError(evtErr.message, 500);
      event = evt || null;
    } else {
      // Auto-pick the currently active event (today or a yesterday event that ends after midnight).
      const { data: candidates, error: candErr } = await supabaseAdmin
        .from("events")
        .select("id, event_name, event_date, start_time, end_time, ends_next_day, is_active")
        .eq("is_active", true)
        .in("event_date", [today, yesterday]);
      if (candErr) return jsonError(candErr.message, 500);

      const active = (candidates || [])
        .map((e: any) => {
          const window = computeEventWindow(e);
          if (!window) return null;
          return { e, window };
        })
        .filter(Boolean) as Array<{ e: any; window: { startIso: string; endIso: string } }>;

      const nowMs = now.getTime();
      const activeNow = active.filter(({ window }) => {
        const startMs = new Date(window.startIso).getTime();
        const endMs = new Date(window.endIso).getTime();
        return startMs <= nowMs && nowMs <= endMs;
      });

      // Pick the most recently started active event.
      activeNow.sort((a, b) => new Date(b.window.startIso).getTime() - new Date(a.window.startIso).getTime());
      event = activeNow[0]?.e || null;
    }

    if (!event) {
      return NextResponse.json({ event: null, entries: [], checkedInUsers: [] }, { status: 200 });
    }

    const window = computeEventWindow(event);
    if (!window) {
      return NextResponse.json({ event: null, entries: [], checkedInUsers: [] }, { status: 200 });
    }

    // If the event is over, clear the activity.
    if (new Date(window.endIso).getTime() < now.getTime()) {
      return NextResponse.json({ event: null, entries: [], checkedInUsers: [] }, { status: 200 });
    }

    // Slight pre-start buffer so early clock-ins still appear during the event.
    const windowStart = new Date(window.startIso);
    windowStart.setHours(windowStart.getHours() - 6);
    const startIso = windowStart.toISOString();
    const endIso = window.endIso;

    // Prefer event_id filtering when we have an eventId; fall back to timestamp window if data isn't tagged.
    let entries: any[] = [];
    if (isValidUuid(event.id)) {
      const { data: byEventId, error: byEventErr } = await supabaseAdmin
        .from("time_entries")
        .select("user_id, action, timestamp, notes, event_id")
        .eq("event_id", event.id)
        .gte("timestamp", startIso)
        .lte("timestamp", endIso)
        .order("timestamp", { ascending: false })
        .limit(50);

      if (!byEventErr && Array.isArray(byEventId) && byEventId.length > 0) {
        entries = byEventId;
      }
    }

    if (entries.length === 0) {
      const { data: byTimestamp, error: tsErr } = await supabaseAdmin
        .from("time_entries")
        .select("user_id, action, timestamp, notes, event_id")
        .gte("timestamp", startIso)
        .lte("timestamp", endIso)
        .order("timestamp", { ascending: false })
        .limit(50);

      if (tsErr) return jsonError(tsErr.message, 500);
      entries = byTimestamp || [];
    }

    // Clock-in/out activity for "who checked in" list (needs more than the last 50 actions)
    const clockActionTypes = ["clock_in", "clock_out"];
    let clockActions: any[] = [];
    if (isValidUuid(event.id)) {
      const { data: byEventClock, error: byEventClockErr } = await supabaseAdmin
        .from("time_entries")
        .select("user_id, action, timestamp, notes, event_id")
        .eq("event_id", event.id)
        .in("action", clockActionTypes as any)
        .gte("timestamp", startIso)
        .lte("timestamp", endIso)
        .order("timestamp", { ascending: true })
        .limit(2000);

      if (!byEventClockErr && Array.isArray(byEventClock) && byEventClock.length > 0) {
        clockActions = byEventClock;
      }
    }

    if (clockActions.length === 0) {
      const { data: byTimestampClock, error: byTimestampClockErr } = await supabaseAdmin
        .from("time_entries")
        .select("user_id, action, timestamp, notes, event_id")
        .in("action", clockActionTypes as any)
        .gte("timestamp", startIso)
        .lte("timestamp", endIso)
        .order("timestamp", { ascending: true })
        .limit(2000);

      if (byTimestampClockErr) return jsonError(byTimestampClockErr.message, 500);
      clockActions = byTimestampClock || [];
    }

    const userIds = Array.from(
      new Set(
        [...(entries || []), ...(clockActions || [])]
          .map((r: any) => r?.user_id)
          .filter(Boolean)
      )
    );
    const profileMap = new Map<string, { first: string; last: string }>();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", userIds);
      if (profErr) return jsonError(profErr.message, 500);

      for (const p of profiles || []) {
        const first = decryptProfileNamePart((p as any).first_name, (p as any).user_id);
        const last = decryptProfileNamePart((p as any).last_name, (p as any).user_id);
        profileMap.set(String((p as any).user_id), { first, last });
      }
    }

    const actionLabel: Record<string, string> = {
      clock_in: "Checked In",
      clock_out: "Clocked Out",
      meal_start: "Meal Started",
      meal_end: "Meal Ended",
    };

    const mapped = (entries || []).map((r: any) => {
      const uid = String(r.user_id || "");
      const p = profileMap.get(uid);
      const name = [p?.first, p?.last].filter(Boolean).join(" ").trim() || "User";
      const offline = String(r.notes || "").toLowerCase().includes("offline kiosk sync");
      const action = actionLabel[String(r.action || "")] || String(r.action || "");
      return {
        user_id: uid,
        name,
        action,
        timestamp: r.timestamp,
        offline,
      };
    });

    const checkedInByUser = new Map<
      string,
      { firstClockInAt: string | null; lastClockAction: "clock_in" | "clock_out" | null; lastClockAt: string | null }
    >();

    for (const row of clockActions || []) {
      const uid = String(row.user_id || "");
      if (!uid) continue;
      const action = String(row.action || "");
      const ts = String(row.timestamp || "");
      if (!ts) continue;

      const current =
        checkedInByUser.get(uid) || { firstClockInAt: null, lastClockAction: null, lastClockAt: null };

      if (action === "clock_in" && !current.firstClockInAt) {
        current.firstClockInAt = ts;
      }
      if (action === "clock_in" || action === "clock_out") {
        current.lastClockAction = action as any;
        current.lastClockAt = ts;
      }

      checkedInByUser.set(uid, current);
    }

    const checkedInUsers = Array.from(checkedInByUser.entries())
      .filter(([, v]) => Boolean(v.firstClockInAt))
      .map(([uid, v]) => {
        const p = profileMap.get(uid);
        const name = [p?.first, p?.last].filter(Boolean).join(" ").trim() || "User";
        return {
          user_id: uid,
          name,
          firstClockInAt: v.firstClockInAt,
          isClockedIn: v.lastClockAction === "clock_in",
          lastClockAt: v.lastClockAt,
        };
      })
      .sort((a, b) => new Date(String(a.firstClockInAt)).getTime() - new Date(String(b.firstClockInAt)).getTime());

    return NextResponse.json(
      {
        event: {
          id: event.id,
          name: event.event_name || null,
          startIso: window.startIso,
          endIso: window.endIso,
        },
        entries: mapped,
        checkedInUsers,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error loading recent check-in activity:", err);
    return jsonError(err?.message || "Internal server error", 500);
  }
}
