import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

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
    const code = body.code?.trim();
    const action: ActionType = body.action;
    const offlineTimestamp = body.timestamp; // ISO string from offline queue
    const signature = body.signature; // base64 signature for clock_out

    if (!code || !/^\d{6}$/.test(code)) {
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

    const workerId = codeRecord.target_user_id || kioskUser.id;

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
          .insert({ user_id: workerId, action: "meal_end", division, notes: "Auto-ended on clock out" });
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
