import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createHash } from "crypto";
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

async function getUserDivision(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("division")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.division || "vendor";
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

function parseEventStartUtcMs(dateStr: string, timeStr: string, ianaTimezone: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const timeParts = timeStr.split(":");
  const h = Number(timeParts[0] ?? 0);
  const min = Number(timeParts[1] ?? 0);
  const s = Number(timeParts[2] ?? 0);
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, s));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const tzHour = get("hour") === 24 ? 0 : get("hour");
  const tzUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), tzHour, get("minute"), get("second"));
  return guess.getTime() + (guess.getTime() - tzUtcMs);
}

type ActionType = "clock_in" | "clock_out" | "meal_start" | "meal_end";

/**
 * POST /api/check-in/action
 * body: {
 *   code: string;
 *   action: ActionType;
 *   timestamp?: string;
 *   signature?: string;
 *   attestationAccepted?: boolean;
 * }
 *
 * Performs a time-keeping action for the worker identified by the check-in code.
 * Optionally accepts a timestamp for offline-queued actions.
 */
export async function POST(req: NextRequest) {
  try {
    const kioskUser = await getAuthedUser(req);
    if (!kioskUser?.id) {
      return jsonError("Not authenticated", 401);
    }

    const body = await req.json();
    const code = normalizeCheckinCode(body.code);
    const action: ActionType = body.action;
    const offlineTimestamp = body.timestamp; // ISO string from offline queue
    const signature = body.signature; // base64 signature for clock_out
    const attestationAccepted =
      typeof body.attestationAccepted === "boolean" ? body.attestationAccepted : undefined;
    const rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim() : undefined;
    const rejectionNotes  = typeof body.rejectionNotes  === "string" ? body.rejectionNotes.trim()  : undefined;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : undefined;

    const isValidUuid = (id: unknown) =>
      typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!isValidCheckinCode(code)) {
      return jsonError("Invalid code format", 400);
    }

    const validActions: ActionType[] = ["clock_in", "clock_out", "meal_start", "meal_end"];
    if (!validActions.includes(action)) {
      return jsonError("Invalid action. Must be one of: clock_in, clock_out, meal_start, meal_end", 400);
    }

    // Find active code and get the worker
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

    // Validate the action against the worker's current state
    const { data: lastEntry, error: lastErr } = await supabaseAdmin
      .from("time_entries")
      .select("action, timestamp")
      .eq("user_id", workerId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) return jsonError(lastErr.message, 500);

    const lastAction = lastEntry?.action as string | undefined;

    // State validation
    if (action === "clock_in") {
      // Check last clock action specifically (ignore meal actions)
      const { data: lastClock } = await supabaseAdmin
        .from("time_entries")
        .select("action")
        .eq("user_id", workerId)
        .in("action", ["clock_in", "clock_out"])
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastClock && lastClock.action === "clock_in") {
        return jsonError("Worker is already clocked in", 409);
      }
    } else if (action === "clock_out") {
      const { data: lastClock } = await supabaseAdmin
        .from("time_entries")
        .select("action")
        .eq("user_id", workerId)
        .in("action", ["clock_in", "clock_out"])
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastClock || lastClock.action !== "clock_in") {
        return jsonError("Worker is not clocked in", 409);
      }

      if (attestationAccepted === true && !signature) {
        return jsonError("Signature is required when accepting attestation", 400);
      }

      // If on a meal, auto-end it before clocking out
      if (lastAction === "meal_start") {
        const division = await getUserDivision(workerId);
        await supabaseAdmin
          .from("time_entries")
          .insert({
            user_id: workerId,
            action: "meal_end",
            division,
            notes: "Auto-ended on clock out",
            ...(isValidUuid(eventId) ? { event_id: eventId } : {}),
          });
      }
    } else if (action === "meal_start") {
      if (!lastAction || (lastAction !== "clock_in" && lastAction !== "meal_end")) {
        return jsonError("Worker must be clocked in to start a meal", 409);
      }
    } else if (action === "meal_end") {
      if (lastAction !== "meal_start") {
        return jsonError("Worker is not on a meal break", 409);
      }
      // Enforce 30-minute minimum meal break
      const mealStartMs = new Date(lastEntry!.timestamp).getTime();
      const elapsedMs = Date.now() - mealStartMs;
      const THIRTY_MINUTES_MS = 30 * 60 * 1000;
      if (elapsedMs < THIRTY_MINUTES_MS) {
        const remainingMins = Math.ceil((THIRTY_MINUTES_MS - elapsedMs) / 60000);
        return jsonError(
          `Meal break must be at least 30 minutes. ${remainingMins} minute(s) remaining.`,
          409
        );
      }
    }
    

    // Block clock_in if the worker is not a confirmed team member, or if it's too early
    if (action === "clock_in" && isValidUuid(eventId)) {
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
        if (Date.now() < windowOpenMs) {
          return jsonError("Check-in is not open yet. Check-in opens 3 hours before the event starts.", 403);
        }
      }
    }

    // Insert the time entry
    const division = await getUserDivision(workerId);
    const insertData: any = {
      user_id: workerId,
      action,
      division,
      notes:
        action === "clock_out"
          ? attestationAccepted === false
            ? "Clocked out via kiosk - attestation rejected"
            : signature
              ? "Signed clock-out via kiosk"
              : "Clocked out via kiosk"
          : "Kiosk check-in",
    };
    if (action === "clock_out" && typeof attestationAccepted === "boolean") {
      insertData.attestation_accepted = attestationAccepted;
    }

    // Use offline timestamp if provided (for synced actions)
    if (offlineTimestamp) {
      insertData.timestamp = offlineTimestamp;
    }
    if (isValidUuid(eventId)) {
      insertData.event_id = eventId;
    }

    const { data, error } = await supabaseAdmin
      .from("time_entries")
      .insert(insertData)
      .select("id, timestamp, notes")
      .single();

    if (error) return jsonError(error.message, 500);

    // Also record in checkin_logs if this is a clock_in
    if (action === "clock_in") {
      await supabaseAdmin
        .from("checkin_logs")
        .insert({ code_id: codeRecord.id, user_id: workerId });
    }

    // Save rejection reason + signature to attestation_rejections on rejected clock_out
    if (action === "clock_out" && attestationAccepted === false && rejectionReason) {
      try {
        await supabaseAdmin.from("attestation_rejections").insert({
          time_entry_id: data.id,
          user_id: workerId,
          ...(isValidUuid(eventId) ? { event_id: eventId } : {}),
          rejection_reason: rejectionReason,
          ...(rejectionNotes  ? { rejection_notes:  rejectionNotes  } : {}),
          ...(signature       ? { signature_data:   signature       } : {}),
        });
      } catch (rejErr) {
        console.error("Failed to save attestation rejection:", rejErr);
      }
    }

    // Save attestation signature to form_signatures on clock_out
    if (action === "clock_out" && attestationAccepted !== false && signature) {
      try {
        const ipAddress =
          req.headers.get("x-forwarded-for") ||
          req.headers.get("x-real-ip") ||
          "unknown";
        const userAgent = req.headers.get("user-agent") || "unknown";
        const signedAt = data.timestamp || new Date().toISOString();

        const formId = `clock-out-${data.id}`;
        const formType = "clock_out_attestation";

        const formDataString = JSON.stringify({
          entryId: data.id,
          workerId,
          action: "clock_out",
          timestamp: signedAt,
        });

        const formDataHash = createHash("sha256").update(formDataString).digest("hex");
        const signatureHash = createHash("sha256")
          .update(`${signature}${signedAt}${workerId}${ipAddress}`)
          .digest("hex");
        const bindingHash = createHash("sha256")
          .update(`${formDataHash}${signatureHash}${workerId}`)
          .digest("hex");

        await supabaseAdmin.from("form_signatures").insert({
          form_id: formId,
          form_type: formType,
          user_id: workerId,
          signature_role: "employee",
          signature_data: signature,
          signature_type: "drawn",
          form_data_hash: formDataHash,
          signature_hash: signatureHash,
          binding_hash: bindingHash,
          ip_address: ipAddress,
          user_agent: userAgent,
          signed_at: signedAt,
          is_valid: true,
        });
      } catch (sigErr) {
        console.error("Failed to save clock-out attestation signature:", sigErr);
      }
    }

    return NextResponse.json({
      success: true,
      action,
      timestamp: data.timestamp,
      entryId: data.id,
      attestationAccepted:
        action === "clock_out" && typeof attestationAccepted === "boolean"
          ? attestationAccepted
          : null,
    }, { status: 201 });
  } catch (err) {
    console.error("Error performing check-in action:", err);
    return jsonError("Internal server error", 500);
  }
}
