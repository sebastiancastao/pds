import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";

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

/**
 * POST /api/check-in/validate
 * body: { code: string }
 *
 * Validates a 6-digit check-in code for the kiosk flow.
 * Returns the worker's name and current time-keeping status.
 */
export async function POST(req: NextRequest) {
  try {
    const kioskUser = await getAuthedUser(req);
    if (!kioskUser?.id) {
      return jsonError("Not authenticated", 401);
    }

    const body = await req.json();
    const code = body.code?.trim();

    if (!code || !/^\d{6}$/.test(code)) {
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

    // Determine the worker: use target_user_id if set, otherwise fall back to kiosk user
    const workerId = codeRecord.target_user_id || kioskUser.id;

    // Get worker profile name
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", workerId)
      .single();

    let firstName = "";
    let lastName = "";
    if (profile) {
      firstName = profile.first_name ? decrypt(profile.first_name) : "";
      lastName = profile.last_name ? decrypt(profile.last_name) : "";
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
    });
  } catch (err) {
    console.error("Error validating check-in code:", err);
    return jsonError("Internal server error", 500);
  }
}
