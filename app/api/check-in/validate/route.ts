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

    // Kiosk flow must always resolve to a specific worker via a personal code.
    // Falling back to the kiosk operator user causes every code to act on the same account.
    if (!codeRecord.target_user_id) {
      return jsonError(
        "This code is not assigned to a worker. Generate a personal check-in code for the worker and try again.",
        400
      );
    }

    const workerId = codeRecord.target_user_id;

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
    });
  } catch (err) {
    console.error("Error validating check-in code:", err);
    return jsonError("Internal server error", 500);
  }
}
