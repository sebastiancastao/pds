import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { canUserAccessEventById } from "@/lib/event-access";
import { fetchRestBreakCounts } from "@/lib/rest-breaks-server";
import { MAX_REST_BREAK_COUNT, normalizeRestBreakCount } from "@/lib/rest-breaks";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only managers and exec record rest breaks. Other staff who work the event
// dashboard can read them, since the Payment tab prices rest break pay from them.
const EDITOR_ROLES = new Set(["manager", "exec"]);
const VIEWER_ROLES = new Set([
  "manager",
  "exec",
  "admin",
  "hr",
  "supervisor",
  "supervisor2",
  "supervisor3",
  "supervisor4",
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

async function getRole(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.role || "").toLowerCase().trim();
}

// Recorded rest break counts for this event: { counts: { [userId]: number } }.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return json({ error: "Not authenticated" }, 401);

    const eventId = params.id;
    if (!eventId || !UUID_RE.test(eventId)) return json({ error: "Valid event ID is required" }, 400);

    const role = await getRole(user.id);
    if (!VIEWER_ROLES.has(role)) return json({ error: "Unauthorized" }, 403);
    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, { userId: user.id, role });
    if (!allowed) return json({ error: "Unauthorized" }, 403);

    const byEvent = await fetchRestBreakCounts(supabaseAdmin, [eventId]);
    return json({ counts: byEvent[eventId] || {} });
  } catch (err: any) {
    console.error("[rest-breaks GET] error:", err);
    return json({ error: err?.message || "Server error" }, 500);
  }
}

// Record (or clear) one worker's rest break count.
// Body: { userId: string, count: number | null }. A null/blank count removes the
// record, which puts that worker back on the flat per-shift schedule.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return json({ error: "Not authenticated" }, 401);

    const eventId = params.id;
    if (!eventId || !UUID_RE.test(eventId)) return json({ error: "Valid event ID is required" }, 400);

    const role = await getRole(user.id);
    if (!EDITOR_ROLES.has(role)) {
      return json({ error: "Only managers and exec can record rest breaks." }, 403);
    }
    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, { userId: user.id, role });
    if (!allowed) return json({ error: "Unauthorized" }, 403);

    const body = await req.json().catch(() => null);
    const targetUserId = String(body?.userId || "").trim();
    if (!UUID_RE.test(targetUserId)) return json({ error: "A valid worker ID is required." }, 400);

    const rawCount = body?.count;
    const clearing =
      rawCount === null ||
      rawCount === undefined ||
      (typeof rawCount === "string" && rawCount.trim() === "");
    const count = clearing ? null : normalizeRestBreakCount(rawCount);
    if (!clearing && count === null) {
      return json(
        { error: `Rest breaks must be a whole number from 0 to ${MAX_REST_BREAK_COUNT}.` },
        400
      );
    }

    // The worker must actually belong to this event (assigned to the team, or already
    // has payment/time records), so a stray id cannot create orphan rows.
    const { data: teamRow, error: teamErr } = await supabaseAdmin
      .from("event_teams")
      .select("vendor_id")
      .eq("event_id", eventId)
      .eq("vendor_id", targetUserId)
      .maybeSingle();
    if (teamErr) return json({ error: teamErr.message }, 500);
    if (!teamRow) return json({ error: "That worker is not on this event's team." }, 404);

    if (count === null) {
      const { error } = await supabaseAdmin
        .from("event_rest_breaks")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", targetUserId);
      if (error) return json({ error: error.message }, 500);
      return json({ userId: targetUserId, count: null });
    }

    const { error } = await supabaseAdmin
      .from("event_rest_breaks")
      .upsert(
        {
          event_id: eventId,
          user_id: targetUserId,
          rest_break_count: count,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,user_id" }
      );
    if (error) return json({ error: error.message }, 500);
    return json({ userId: targetUserId, count });
  } catch (err: any) {
    console.error("[rest-breaks PUT] error:", err);
    return json({ error: err?.message || "Server error" }, 500);
  }
}
