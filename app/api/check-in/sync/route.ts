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

type QueuedAction = {
  id: string;
  code: string;
  action: "clock_in" | "clock_out" | "meal_start" | "meal_end";
  timestamp: string;
  userName: string;
  signature?: string;
};

/**
 * POST /api/check-in/sync
 * body: { actions: QueuedAction[] }
 *
 * Batch syncs offline-queued time-keeping actions.
 * Actions are processed in order (by their original timestamps).
 * Returns which actions succeeded/failed.
 */
export async function POST(req: NextRequest) {
  try {
    const kioskUser = await getAuthedUser(req);
    if (!kioskUser?.id) {
      return jsonError("Not authenticated", 401);
    }

    const body = await req.json();
    const actions: QueuedAction[] = body.actions;

    if (!Array.isArray(actions) || actions.length === 0) {
      return jsonError("No actions to sync", 400);
    }

    // Sort by timestamp to process in chronological order
    actions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const item of actions) {
      try {
        if (!item.code || !/^\d{6}$/.test(item.code)) {
          results.push({ id: item.id, success: false, error: "Invalid code format" });
          continue;
        }

        // Find active code
        const { data: codeRecord } = await supabaseAdmin
          .from("checkin_codes")
          .select("id, target_user_id")
          .eq("code", item.code)
          .eq("is_active", true)
          .single();

        if (!codeRecord) {
          results.push({ id: item.id, success: false, error: "Invalid or expired code" });
          continue;
        }

        const workerId = codeRecord.target_user_id || kioskUser.id;
        const division = await getUserDivision(workerId);

        // Insert the time entry with the original offline timestamp
        const { error: insertErr } = await supabaseAdmin
          .from("time_entries")
          .insert({
            user_id: workerId,
            action: item.action,
            division,
            timestamp: item.timestamp,
            notes: `Offline kiosk sync (original: ${item.timestamp})`,
          });

        if (insertErr) {
          results.push({ id: item.id, success: false, error: insertErr.message });
          continue;
        }

        // Record in checkin_logs if clock_in
        if (item.action === "clock_in") {
          await supabaseAdmin
            .from("checkin_logs")
            .insert({ code_id: codeRecord.id, user_id: workerId });
        }

        results.push({ id: item.id, success: true });
      } catch (err: any) {
        results.push({ id: item.id, success: false, error: err.message || "Unknown error" });
      }
    }

    const synced = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({ synced, failed, results });
  } catch (err) {
    console.error("Error syncing check-in actions:", err);
    return jsonError("Internal server error", 500);
  }
}
