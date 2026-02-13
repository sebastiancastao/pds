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

type QueuedAction = {
  id: string;
  code: string;
  action: "clock_in" | "clock_out" | "meal_start" | "meal_end";
  timestamp: string;
  userName: string;
  signature?: string;
  eventId?: string;
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
        const normalizedCode = normalizeCheckinCode(item.code);

        if (!isValidCheckinCode(normalizedCode)) {
          results.push({ id: item.id, success: false, error: "Invalid code format" });
          continue;
        }

        // Find active code
        const { data: codeRecord } = await supabaseAdmin
          .from("checkin_codes")
          .select("id, target_user_id")
          .eq("code", normalizedCode)
          .eq("is_active", true)
          .single();

        if (!codeRecord) {
          results.push({ id: item.id, success: false, error: "Invalid or expired code" });
          continue;
        }

        // Kiosk offline sync must always resolve to a specific worker via a personal code.
        if (!codeRecord.target_user_id) {
          results.push({
            id: item.id,
            success: false,
            error:
              "This code is not assigned to a worker. Generate a personal check-in code for the worker and try again.",
          });
          continue;
        }

        const workerId = codeRecord.target_user_id;
        const division = await getUserDivision(workerId);

        const isValidUuid = (id: unknown) =>
          typeof id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

        // Insert the time entry with the original offline timestamp
        const { data: entryData, error: insertErr } = await supabaseAdmin
          .from("time_entries")
          .insert({
            user_id: workerId,
            action: item.action,
            division,
            timestamp: item.timestamp,
            notes: `Offline kiosk sync (original: ${item.timestamp})`,
            ...(isValidUuid(item.eventId) ? { event_id: item.eventId } : {}),
          })
          .select("id, timestamp")
          .single();

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

        // Save attestation signature to form_signatures on clock_out
        if (item.action === "clock_out" && item.signature && entryData?.id) {
          try {
            const ipAddress =
              req.headers.get("x-forwarded-for") ||
              req.headers.get("x-real-ip") ||
              "unknown";
            const userAgent = req.headers.get("user-agent") || "unknown";
            const signedAt = item.timestamp;

            const formId = `clock-out-${entryData.id}`;
            const formType = "clock_out_attestation";

            const formDataString = JSON.stringify({
              entryId: entryData.id,
              workerId,
              action: "clock_out",
              timestamp: signedAt,
            });

            const formDataHash = createHash("sha256").update(formDataString).digest("hex");
            const signatureHash = createHash("sha256")
              .update(`${item.signature}${signedAt}${workerId}${ipAddress}`)
              .digest("hex");
            const bindingHash = createHash("sha256")
              .update(`${formDataHash}${signatureHash}${workerId}`)
              .digest("hex");

            await supabaseAdmin.from("form_signatures").insert({
              form_id: formId,
              form_type: formType,
              user_id: workerId,
              signature_role: "employee",
              signature_data: item.signature,
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
            console.error("Failed to save offline clock-out attestation signature:", sigErr);
          }
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
