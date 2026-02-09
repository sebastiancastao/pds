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

function decryptProfileNamePart(value: unknown, userIdForLog: string): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!isEncrypted(trimmed)) return trimmed;
  try {
    return decrypt(trimmed);
  } catch {
    console.warn("Profile name decryption failed for user", userIdForLog);
    return "";
  }
}

function isValidUuid(id: unknown) {
  if (typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * POST /api/admin/check-in-monitor
 *
 * Kiosk heartbeat — records that a kiosk page is open.
 * Any authenticated user can send this (kiosk operators are usually managers).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return jsonError("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const eventId = typeof body.eventId === "string" && isValidUuid(body.eventId)
      ? body.eventId
      : null;

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = (req.headers.get("user-agent") || "unknown").substring(0, 500);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: user.id,
      action: "kiosk.heartbeat",
      resource_type: "kiosk",
      resource_id: eventId,
      ip_address: ipAddress,
      user_agent: userAgent,
      metadata: { eventId },
      success: true,
      error_message: null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Heartbeat error:", err);
    return NextResponse.json({ ok: true }); // Don't fail the kiosk
  }
}

/**
 * GET /api/admin/check-in-monitor
 *
 * Returns aggregated monitoring data for the admin dashboard.
 * Only admin/exec/hr/manager roles can access.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return jsonError("Not authenticated", 401);

    // Role check
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = (userData?.role || "").toString().trim().toLowerCase();
    if (!["admin", "exec", "hr", "manager"].includes(role)) {
      return jsonError("Unauthorized", 403);
    }

    const now = new Date();
    const sixtySecondsAgo = new Date(now.getTime() - 60_000);
    const twentyFourHoursAgo = new Date(now.getTime() - 86_400_000);
    const today = toLocalDateStr(now);
    const yesterday = toLocalDateStr(new Date(now.getTime() - 86_400_000));

    // Run all four queries in parallel
    const [heartbeatsResult, activeEventsResult, timeEntriesResult, attestationsResult] =
      await Promise.all([
        // 1. Active kiosk heartbeats (last 60s)
        supabaseAdmin
          .from("audit_logs")
          .select("user_id, ip_address, user_agent, resource_id, created_at")
          .eq("action", "kiosk.heartbeat")
          .gte("created_at", sixtySecondsAgo.toISOString())
          .order("created_at", { ascending: false })
          .limit(200),

        // 2. Active events (today + yesterday for overnight events)
        supabaseAdmin
          .from("events")
          .select("id, event_name, venue, city, state, event_date, start_time, end_time, ends_next_day, is_active")
          .eq("is_active", true)
          .in("event_date", [today, yesterday]),

        // 3. Recent time entries (clock_in/clock_out for status determination)
        supabaseAdmin
          .from("time_entries")
          .select("user_id, action, timestamp, event_id, division")
          .in("action", ["clock_in", "clock_out"] as any)
          .gte("timestamp", `${yesterday}T00:00:00`)
          .order("timestamp", { ascending: true })
          .limit(5000),

        // 4. Recent clock-out attestations (last 24h)
        supabaseAdmin
          .from("form_signatures")
          .select("id, user_id, ip_address, user_agent, signed_at, is_valid, form_id")
          .eq("form_type", "clock_out_attestation")
          .gte("signed_at", twentyFourHoursAgo.toISOString())
          .order("signed_at", { ascending: false })
          .limit(200),
      ]);

    // Collect all user IDs for profile name resolution
    const allUserIds = new Set<string>();
    for (const hb of heartbeatsResult.data || []) if (hb.user_id) allUserIds.add(hb.user_id);
    for (const te of timeEntriesResult.data || []) if (te.user_id) allUserIds.add(te.user_id);
    for (const fs of attestationsResult.data || []) if (fs.user_id) allUserIds.add(fs.user_id);

    // Batch-fetch profiles and decrypt names
    const profileMap = new Map<string, { firstName: string; lastName: string }>();
    if (allUserIds.size > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", Array.from(allUserIds));

      for (const p of profiles || []) {
        const uid = String((p as any).user_id);
        profileMap.set(uid, {
          firstName: decryptProfileNamePart((p as any).first_name, uid),
          lastName: decryptProfileNamePart((p as any).last_name, uid),
        });
      }
    }

    const getName = (userId: string): string => {
      const p = profileMap.get(userId);
      return [p?.firstName, p?.lastName].filter(Boolean).join(" ") || "Unknown";
    };

    // Process heartbeats → active kiosks (deduplicate by IP, keep most recent)
    const kiosksByIp = new Map<string, any>();
    for (const hb of heartbeatsResult.data || []) {
      const ip = String(hb.ip_address || "unknown");
      if (!kiosksByIp.has(ip)) {
        kiosksByIp.set(ip, {
          ipAddress: ip,
          userAgent: String(hb.user_agent || ""),
          operatorUserId: hb.user_id,
          operatorName: getName(hb.user_id),
          eventId: hb.resource_id || null,
          lastSeen: hb.created_at,
        });
      }
    }

    // Build events map
    const eventsMap = new Map<string, any>();
    for (const evt of activeEventsResult.data || []) {
      eventsMap.set(evt.id, {
        id: evt.id,
        name: (evt as any).event_name || null,
        venue: evt.venue || null,
        city: evt.city || null,
        state: evt.state || null,
        date: evt.event_date,
        startTime: evt.start_time,
        endTime: evt.end_time,
        checkedInCount: 0,
        checkedInUsers: [] as Array<{ userId: string; name: string; clockedInAt: string; division: string }>,
      });
    }

    // Process time entries → determine who is currently clocked in
    // Walk entries chronologically; last clock_in/clock_out determines status
    const userClockStatus = new Map<string, {
      lastAction: string;
      lastTimestamp: string;
      eventId: string | null;
      division: string;
    }>();

    for (const te of timeEntriesResult.data || []) {
      const uid = String(te.user_id || "");
      if (!uid) continue;
      userClockStatus.set(uid, {
        lastAction: te.action,
        lastTimestamp: te.timestamp,
        eventId: te.event_id || null,
        division: te.division || "",
      });
    }

    const checkedInUsers: Array<{
      userId: string;
      name: string;
      eventId: string | null;
      eventName: string | null;
      venue: string | null;
      clockedInAt: string;
      division: string;
    }> = [];

    for (const [userId, status] of userClockStatus) {
      if (status.lastAction === "clock_in") {
        const evt = status.eventId ? eventsMap.get(status.eventId) : null;
        const entry = {
          userId,
          name: getName(userId),
          eventId: status.eventId,
          eventName: evt?.name || null,
          venue: evt?.venue || null,
          clockedInAt: status.lastTimestamp,
          division: status.division,
        };
        checkedInUsers.push(entry);

        // Increment event counters
        if (status.eventId && eventsMap.has(status.eventId)) {
          const evtData = eventsMap.get(status.eventId);
          evtData.checkedInCount++;
          evtData.checkedInUsers.push({
            userId,
            name: getName(userId),
            clockedInAt: status.lastTimestamp,
            division: status.division,
          });
        }
      }
    }

    // Process attestations
    const attestations = (attestationsResult.data || []).map((sig: any) => ({
      id: sig.id,
      userId: sig.user_id,
      name: getName(sig.user_id),
      signedAt: sig.signed_at,
      ipAddress: sig.ip_address,
      isValid: sig.is_valid,
      formId: sig.form_id,
    }));

    return NextResponse.json({
      timestamp: now.toISOString(),
      activeKiosks: Array.from(kiosksByIp.values()),
      activeEvents: Array.from(eventsMap.values()),
      checkedInUsers,
      attestations,
      summary: {
        totalActiveKiosks: kiosksByIp.size,
        totalCheckedIn: checkedInUsers.length,
        totalAttestationsToday: attestations.length,
        totalActiveEvents: eventsMap.size,
      },
    });
  } catch (err: any) {
    console.error("Error loading check-in monitor data:", err);
    return jsonError(err?.message || "Internal server error", 500);
  }
}
