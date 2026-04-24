import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt, isEncrypted } from "@/lib/encryption";
import { isValidCheckinCode, normalizeCheckinCode } from "@/lib/checkin-code";
import { extractUuid, isValidUuid } from "@/lib/uuid";

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

function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

/** Converts a wall-clock date+time in Pacific time to UTC milliseconds. */
function parseEventMs(dateStr: string, timeStr: string): number {
  const naiveUtcMs = Date.parse(`${dateStr}T${timeStr}Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(naiveUtcMs));
  const get = (t: string) => {
    const v = parts.find(p => p.type === t)?.value ?? "00";
    return t === "hour" && v === "24" ? "00" : v;
  };
  const pacificAsUtcMs = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
  return naiveUtcMs + (naiveUtcMs - pacificAsUtcMs);
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
    const eventId = extractUuid(body.eventId) ?? "";

    if (!isValidCheckinCode(code)) {
      return jsonError("Invalid code format", 400);
    }

    if (!isValidUuid(eventId)) {
      return jsonError(
        "This kiosk session is missing an event. Open check-in from a specific event and try again.",
        400
      );
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
    console.log("[validate] eventId from request:", eventId);
    if (isValidUuid(eventId)) {
      const [{ data: teamRecord }, { data: eventData }] = await Promise.all([
        supabaseAdmin
          .from("event_teams")
          .select("status")
          .eq("event_id", eventId)
          .eq("vendor_id", workerId)
          .maybeSingle(),
        supabaseAdmin
          .from("events")
          .select("event_date, start_time, end_time, ends_next_day, state")
          .eq("id", eventId)
          .maybeSingle(),
      ]);

      console.log("[validate] teamRecord:", teamRecord);
      console.log("[validate] eventData:", eventData);

      if (!teamRecord || teamRecord.status !== "confirmed") {
        return NextResponse.json({ error: "REJECTED: NOT ON TEAM'S LIST." }, { status: 403 });
      }

      if (!eventData?.event_date || !eventData?.start_time) {
        console.log("[validate] eventData missing date/time — blocking");
        return jsonError("Check-in is closed. This event has already passed.", 403);
      }

      if (eventData?.event_date && eventData?.start_time) {
        const dateStr = String(eventData.event_date).split("T")[0];
        const eventStartMs = parseEventMs(dateStr, String(eventData.start_time));

        const windowOpenMs = eventStartMs - 3 * 60 * 60 * 1000;

        // Close window: 4 hours after event end time (or start time if no end time).
        // Mirror computeEventWindow: treat as next-day if ends_next_day OR end <= start.
        let windowCloseMs: number;
        if (eventData.end_time) {
          let eventEndMs = parseEventMs(dateStr, String(eventData.end_time));
          if (eventData.ends_next_day || eventEndMs <= eventStartMs) {
            eventEndMs = parseEventMs(addOneDay(dateStr), String(eventData.end_time));
          }
          windowCloseMs = eventEndMs + 4 * 60 * 60 * 1000;
        } else {
          windowCloseMs = eventStartMs + 4 * 60 * 60 * 1000;
        }

        if (!Number.isFinite(eventStartMs) || !Number.isFinite(windowOpenMs) || !Number.isFinite(windowCloseMs)) {
          console.error("[validate] invalid event window:", {
            eventId,
            dateStr,
            start: eventData.start_time,
            end: eventData.end_time,
            ends_next_day: eventData.ends_next_day,
            eventStartMs,
            windowOpenMs,
            windowCloseMs,
          });
          return jsonError("Event check-in window is misconfigured. Please contact an administrator.", 500);
        }

        const now = Date.now();
        console.log("[validate] now:", new Date(now).toISOString(), "| windowOpen:", new Date(windowOpenMs).toISOString(), "| windowClose:", new Date(windowCloseMs).toISOString(), "| dateStr:", dateStr, "| start:", eventData.start_time, "| end:", eventData.end_time, "| ends_next_day:", eventData.ends_next_day);

        if (now < windowOpenMs) {
          return jsonError("Check-in is not open yet. Check-in opens 3 hours before the event starts.", 403);
        }
        if (now > windowCloseMs) {
          return jsonError("Check-in is closed. This event has already passed.", 403);
        }
      }
    } else {
      console.log("[validate] NO eventId in request — window check skipped");
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
