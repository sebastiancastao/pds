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

const CLIENT_ACTION_ID_MARKER = "clientActionId:";

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function isValidUuid(id: unknown): id is string {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
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

function appendClientActionId(note: string, clientActionId?: string) {
  return clientActionId ? `${note} | ${CLIENT_ACTION_ID_MARKER}${clientActionId}` : note;
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
  const get = (t: string) => { const v = parts.find(p => p.type === t)?.value ?? "00"; return v === "24" ? "00" : v; };
  const pacificAsUtcMs = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
  return naiveUtcMs + (naiveUtcMs - pacificAsUtcMs);
}

async function findExistingTimeEntry(workerId: string, clientActionId?: string) {
  if (!clientActionId) return null;

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .select("id, timestamp")
    .eq("user_id", workerId)
    .like("notes", `%${CLIENT_ACTION_ID_MARKER}${clientActionId}%`)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

type QueuedAction = {
  id: string;
  code: string;
  action: "clock_in" | "clock_out" | "meal_start" | "meal_end";
  timestamp: string;
  userName: string;
  signature?: string;
  attestationAccepted?: boolean;
  eventId?: string;
  clientActionId?: string;
  rejectionReason?: string;
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

        const itemTimestampMs = new Date(item.timestamp).getTime();
        if (Number.isNaN(itemTimestampMs)) {
          results.push({ id: item.id, success: false, error: "Invalid offline timestamp" });
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
        const clientActionId =
          typeof item.clientActionId === "string" && item.clientActionId.trim()
            ? item.clientActionId.trim()
            : item.id;
        const existingEntry = await findExistingTimeEntry(workerId, clientActionId);

        if (!isValidUuid(item.eventId)) {
          results.push({
            id: item.id,
            success: false,
            error: "This kiosk session is missing an event. Open check-in from a specific event and try again.",
          });
          continue;
        }

        if (existingEntry?.id) {
          results.push({ id: item.id, success: true });
          continue;
        }

        if (item.action === "clock_out" && item.attestationAccepted === true && !item.signature) {
          results.push({
            id: item.id,
            success: false,
            error: "Signature is required when accepting attestation",
          });
          continue;
        }

        const { data: lastClock } = await supabaseAdmin
          .from("time_entries")
          .select("action, timestamp")
          .eq("user_id", workerId)
          .in("action", ["clock_in", "clock_out"])
          .lte("timestamp", item.timestamp)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: lastEntry } = await supabaseAdmin
          .from("time_entries")
          .select("action, timestamp")
          .eq("user_id", workerId)
          .lte("timestamp", item.timestamp)
          .order("timestamp", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (item.action === "clock_in") {
          if (lastClock && lastClock.action === "clock_in") {
            results.push({ id: item.id, success: false, error: "Worker is already clocked in" });
            continue;
          }
        } else if (item.action === "clock_out") {
          if (!lastClock || lastClock.action !== "clock_in") {
            results.push({ id: item.id, success: false, error: "Worker is not clocked in" });
            continue;
          }

          if (lastEntry?.action === "meal_start") {
            const { error: autoMealErr } = await supabaseAdmin
              .from("time_entries")
              .insert({
                user_id: workerId,
                action: "meal_end",
                division,
                timestamp: item.timestamp,
                notes: "Auto-ended on clock out (offline sync)",
                event_id: item.eventId,
              });
            if (autoMealErr) {
              results.push({ id: item.id, success: false, error: autoMealErr.message });
              continue;
            }
          }
        } else if (item.action === "meal_start") {
          if (!lastEntry || (lastEntry.action !== "clock_in" && lastEntry.action !== "meal_end")) {
            results.push({ id: item.id, success: false, error: "Worker must be clocked in to start a meal" });
            continue;
          }
        } else if (item.action === "meal_end") {
          if (!lastEntry || lastEntry.action !== "meal_start") {
            results.push({ id: item.id, success: false, error: "Worker is not on a meal break" });
            continue;
          }
          const mealStartMs = new Date(lastEntry.timestamp as string).getTime();
          const elapsedMs = itemTimestampMs - mealStartMs;
          const THIRTY_MINUTES_MS = 30 * 60 * 1000;
          if (elapsedMs < THIRTY_MINUTES_MS) {
            const remainingMins = Math.ceil((THIRTY_MINUTES_MS - elapsedMs) / 60000);
            results.push({
              id: item.id,
              success: false,
              error: `Meal break must be at least 30 minutes. ${remainingMins} minute(s) remaining.`,
            });
            continue;
          }
        }

        // Block clock_in for workers not confirmed on the event team, or outside the event window.
        if (item.action === "clock_in") {
          const [{ data: teamRecord }, { data: eventData }] = await Promise.all([
            supabaseAdmin
              .from("event_teams")
              .select("status")
              .eq("event_id", item.eventId)
              .eq("vendor_id", workerId)
              .maybeSingle(),
            supabaseAdmin
              .from("events")
              .select("event_date, start_time, end_time, ends_next_day, state")
              .eq("id", item.eventId)
              .maybeSingle(),
          ]);

          if (!teamRecord || teamRecord.status !== "confirmed") {
            results.push({ id: item.id, success: false, error: "REJECTED: NOT ON TEAM'S LIST." });
            continue;
          }

          if (!eventData?.event_date || !eventData?.start_time) {
            results.push({
              id: item.id,
              success: false,
              error: "Check-in is closed. This event has already passed.",
            });
            continue;
          }

          const dateStr = String(eventData.event_date).split("T")[0];
          const eventStartMs = parseEventMs(dateStr, String(eventData.start_time));
          const windowOpenMs = eventStartMs - 3 * 60 * 60 * 1000;

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

          if (itemTimestampMs < windowOpenMs) {
            results.push({
              id: item.id,
              success: false,
              error: "Check-in is not open yet. Check-in opens 3 hours before the event starts.",
            });
            continue;
          }

          if (itemTimestampMs > windowCloseMs) {
            results.push({
              id: item.id,
              success: false,
              error: "Check-in is closed. This event has already passed.",
            });
            continue;
          }
        }

        const baseNote = `Offline kiosk sync (original: ${item.timestamp})`;
        const clockOutNote =
          item.attestationAccepted === false
            ? `${baseNote} - attestation rejected`
            : item.signature
              ? `${baseNote} - signed clock-out attestation`
              : baseNote;

        // Insert the time entry with the original offline timestamp
        const { data: entryData, error: insertErr } = await supabaseAdmin
          .from("time_entries")
          .insert({
            user_id: workerId,
            action: item.action,
            division,
            timestamp: item.timestamp,
            notes: appendClientActionId(item.action === "clock_out" ? clockOutNote : baseNote, clientActionId),
            ...(item.action === "clock_out" && typeof item.attestationAccepted === "boolean"
              ? { attestation_accepted: item.attestationAccepted }
              : {}),
            event_id: item.eventId,
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

        if (item.action === "clock_out" && item.attestationAccepted === false && item.rejectionReason && entryData?.id) {
          try {
            await supabaseAdmin.from("attestation_rejections").insert({
              time_entry_id: entryData.id,
              user_id: workerId,
              event_id: item.eventId,
              rejection_reason: item.rejectionReason,
              ...(item.signature ? { signature_data: item.signature } : {}),
            });
          } catch (rejErr) {
            console.error("Failed to save offline attestation rejection:", rejErr);
          }
        }

        // Save attestation signature to form_signatures on clock_out
        if (item.action === "clock_out" && item.attestationAccepted !== false && item.signature && entryData?.id) {
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
