import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function isValidUuid(id: unknown) {
  if (typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * GET /api/check-in/shift-summary?workerId=<uuid>
 *
 * Returns a best-effort summary for the worker's current shift (since last clock_in),
 * including total meal time taken so far. Intended for the clock-out attestation UI.
 */
export async function GET(req: NextRequest) {
  try {
    const kioskUser = await getAuthedUser(req);
    if (!kioskUser?.id) return jsonError("Not authenticated", 401);

    const { searchParams } = new URL(req.url);
    const workerId = searchParams.get("workerId");
    if (!workerId || !isValidUuid(workerId)) return jsonError("Invalid workerId", 400);

    const now = new Date();

    const { data: lastClock, error: lastClockErr } = await supabaseAdmin
      .from("time_entries")
      .select("action, timestamp")
      .eq("user_id", workerId)
      .in("action", ["clock_in", "clock_out"] as any)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastClockErr) return jsonError(lastClockErr.message, 500);

    if (!lastClock || lastClock.action !== "clock_in" || !lastClock.timestamp) {
      return NextResponse.json({ active: false }, { status: 200 });
    }

    const clockInAt = String(lastClock.timestamp);

    const { data: mealRows, error: mealErr } = await supabaseAdmin
      .from("time_entries")
      .select("action, timestamp")
      .eq("user_id", workerId)
      .in("action", ["meal_start", "meal_end"] as any)
      .gte("timestamp", clockInAt)
      .order("timestamp", { ascending: true })
      .limit(500);

    if (mealErr) return jsonError(mealErr.message, 500);

    let mealMs = 0;
    let openMealStartMs: number | null = null;

    for (const row of mealRows || []) {
      const action = String((row as any).action || "");
      const tsStr = String((row as any).timestamp || "");
      const tsMs = Date.parse(tsStr);
      if (!tsStr || Number.isNaN(tsMs)) continue;

      if (action === "meal_start") {
        if (openMealStartMs === null) openMealStartMs = tsMs;
        continue;
      }

      if (action === "meal_end") {
        if (openMealStartMs === null) continue;
        if (tsMs >= openMealStartMs) mealMs += tsMs - openMealStartMs;
        openMealStartMs = null;
      }
    }

    if (openMealStartMs !== null) {
      mealMs += Math.max(0, now.getTime() - openMealStartMs);
    }

    if (!Number.isFinite(mealMs) || mealMs < 0) mealMs = 0;

    return NextResponse.json(
      {
        active: true,
        clockInAt,
        mealMs: Math.round(mealMs),
        serverNow: now.toISOString(),
        onMeal: openMealStartMs !== null,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error loading shift summary:", err);
    return jsonError(err?.message || "Internal server error", 500);
  }
}

