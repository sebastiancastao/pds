import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt, isEncrypted } from "@/lib/encryption";
import { isValidCheckinCode, normalizeCheckinCode } from "@/lib/checkin-code";

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

function decryptProfileNamePart(value: unknown, workerIdForLog: string): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  // If it's plain text, keep it.
  if (!isEncrypted(trimmed)) return trimmed;

  // If it's encrypted but we cannot decrypt (missing/wrong key, bad data), don't fail the request.
  // Returning an empty string avoids showing ciphertext in the kiosk UI.
  try {
    return decrypt(trimmed);
  } catch (err) {
    console.warn("Profile name decryption failed for worker", workerIdForLog);
    return "";
  }
}

const STATE_TIMEZONE_MAP: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
};

function getStateTimezone(state: string | null | undefined): string {
  if (!state) return "America/Los_Angeles";
  return STATE_TIMEZONE_MAP[state.toUpperCase().trim()] ?? "America/Los_Angeles";
}

// Converts an event's local date+time string into a UTC millisecond timestamp,
// correctly accounting for the event's state timezone (including DST).
function parseEventStartUtcMs(dateStr: string, timeStr: string, ianaTimezone: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const timeParts = timeStr.split(":");
  const h = Number(timeParts[0] ?? 0);
  const min = Number(timeParts[1] ?? 0);
  const s = Number(timeParts[2] ?? 0);
  // Start with a UTC guess treating the local digits as UTC
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, s));
  // Find what that UTC instant looks like in the target timezone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const tzHour = get("hour") === 24 ? 0 : get("hour");
  const tzUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), tzHour, get("minute"), get("second"));
  // Apply the offset to turn the local event time into real UTC
  return guess.getTime() + (guess.getTime() - tzUtcMs);
}

/**
 * POST /api/check-in/validate
 * body: { code: string }
 *
 * Validates a check-in code for the kiosk flow.
 * Returns the worker's name and current time-keeping status.
 */
export async function POST(req: NextRequest) {
  try {
    const kioskUser = await getAuthedUser(req);
    if (!kioskUser?.id) {
      return jsonError("Not authenticated", 401);
    }

    const body = await req.json();
    const code = normalizeCheckinCode(body.code);
    const eventId: string | undefined = body.eventId || undefined;

    if (!isValidCheckinCode(code)) {
      return jsonError("Invalid code format", 400);
    }

    // Find active code
    const { data: codeRecord } = await supabaseAdmin
      .from("checkin_codes")
      .select("id, code, is_active, target_user_id")
      .eq("code", code)
      .eq("is_active", true)
      .single();

    if (!codeRecord) {
      return jsonError("Invalid or expired code", 404);
    }

    // Kiosk flow must always resolve to a specific worker via a personal code.
    // Falling back to the kiosk operator user causes every code to act on the same account.
    if (!codeRecord.target_user_id) {
      return jsonError(
        "This code is not assigned to a worker. Generate a personal check-in code for the worker and try again.",
        400
      );
    }

    const workerId = codeRecord.target_user_id;

    // Block check-in if the worker is not a confirmed team member, or if it's too early
    if (eventId) {
      const [{ data: teamRecord }, { data: eventData }] = await Promise.all([
        supabaseAdmin
          .from("event_teams")
          .select("status")
          .eq("event_id", eventId)
          .eq("vendor_id", workerId)
          .maybeSingle(),
        supabaseAdmin
          .from("events")
          .select("event_date, start_time, state")
          .eq("id", eventId)
          .maybeSingle(),
      ]);

      if (!teamRecord || teamRecord.status !== "confirmed") {
        return NextResponse.json({ error: "REJECTED: NOT ON TEAM'S LIST." }, { status: 403 });
      }

      if (eventData?.event_date && eventData?.start_time) {
        const tz = getStateTimezone(eventData.state);
        const eventStartMs = parseEventStartUtcMs(
          String(eventData.event_date).split("T")[0],
          String(eventData.start_time),
          tz
        );
        const windowOpenMs = eventStartMs - 3 * 60 * 60 * 1000;
        const windowCloseMs = eventStartMs + 4 * 60 * 60 * 1000;
        const now = Date.now();
        if (now < windowOpenMs) {
          return jsonError("Check-in is not open yet. Check-in opens 3 hours before the event starts.", 403);
        }
        if (now > windowCloseMs) {
          return jsonError("Check-in is closed. This event has already passed.", 403);
        }
      }
    }

    // Get worker profile name
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", workerId)
      .single();

    let firstName = "";
    let lastName = "";
    if (profile) {
      firstName = decryptProfileNamePart(profile.first_name, workerId);
      lastName = decryptProfileNamePart(profile.last_name, workerId);
    }
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || "User";

    // Get the worker's current time-keeping status
    // Check last clock action (clock_in or clock_out)
    const { data: lastClockAction } = await supabaseAdmin
      .from("time_entries")
      .select("action, timestamp")
      .eq("user_id", workerId)
      .in("action", ["clock_in", "clock_out"])
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isClockedIn = !!lastClockAction && lastClockAction.action === "clock_in";

    // Check last overall action for meal status
    const { data: lastAction } = await supabaseAdmin
      .from("time_entries")
      .select("action, timestamp")
      .eq("user_id", workerId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isOnMeal = !!lastAction && lastAction.action === "meal_start";

    // Determine status
    let status: "not_clocked_in" | "clocked_in" | "on_meal" = "not_clocked_in";
    if (isClockedIn && isOnMeal) {
      status = "on_meal";
    } else if (isClockedIn) {
      status = "clocked_in";
    }

    // Get clock-in time if active
    let clockedInAt: string | null = null;
    if (isClockedIn && lastClockAction) {
      clockedInAt = lastClockAction.timestamp as string;
    }

    return NextResponse.json({
      valid: true,
      name: displayName,
      workerId,
      codeId: codeRecord.id,
      status,
      clockedInAt,
      mealStartedAt: isOnMeal ? (lastAction?.timestamp ?? null) : null,
    });
  } catch (err) {
    console.error("Error validating check-in code:", err);
    return jsonError("Internal server error", 500);
  }
}
