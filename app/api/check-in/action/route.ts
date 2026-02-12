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

type ActionType = "clock_in" | "clock_out" | "meal_start" | "meal_end";

/**
 * POST /api/check-in/action
 * body: { code: string, action: ActionType, timestamp?: string, signature?: string }
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
    }

    // Insert the time entry
    const division = await getUserDivision(workerId);
    const insertData: any = {
      user_id: workerId,
      action,
      division,
      notes: action === "clock_out" && signature ? "Signed clock-out via kiosk" : "Kiosk check-in",
    };

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

    // Save attestation signature to form_signatures on clock_out
    if (action === "clock_out" && signature) {
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
    }, { status: 201 });
  } catch (err) {
    console.error("Error performing check-in action:", err);
    return jsonError("Internal server error", 500);
  }
}
