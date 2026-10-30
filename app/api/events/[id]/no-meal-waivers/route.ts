import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { canUserAccessEventById } from "@/lib/event-access";

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
const TABLE = "event_no_meal_waivers";

// The same roles that record rest breaks on the Timesheet tab can mark "No Meal Waiver".
// Everyone else who opens the event dashboard sees the marks read-only.
const EDITOR_ROLES = new Set(["manager", "exec", "supervisor3", "supervisor6"]);
const VIEWER_ROLES = new Set([
  "manager",
  "exec",
  "admin",
  "hr",
  "supervisor",
  "supervisor2",
  "supervisor3",
  "supervisor4",
  "supervisor5",
  "supervisor6",
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const isMissingTableError = (error: any): boolean => {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes(TABLE) && (message.includes("does not exist") || message.includes("schema cache")))
  );
};

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

// Vendors marked "No Meal Waiver" on this event: { userIds: string[] }.
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

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("user_id")
      .eq("event_id", eventId);
    if (error) {
      // Migration not applied yet: nothing is marked.
      if (isMissingTableError(error)) return json({ userIds: [] });
      return json({ error: error.message }, 500);
    }
    const userIds = Array.from(
      new Set((data || []).map((row: any) => String(row?.user_id || "")).filter(Boolean))
    );
    return json({ userIds });
  } catch (err: any) {
    console.error("[no-meal-waivers GET] error:", err);
    return json({ error: err?.message || "Server error" }, 500);
  }
}

// Mark or unmark one vendor. Body: { userId: string, marked: boolean }.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return json({ error: "Not authenticated" }, 401);

    const eventId = params.id;
    if (!eventId || !UUID_RE.test(eventId)) return json({ error: "Valid event ID is required" }, 400);

    const role = await getRole(user.id);
    if (!EDITOR_ROLES.has(role)) {
      return json({ error: "Only managers, exec, supervisor3 and supervisor6 can mark No Meal Waiver." }, 403);
    }
    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, { userId: user.id, role });
    if (!allowed) return json({ error: "Unauthorized" }, 403);

    const body = await req.json().catch(() => null);
    const targetUserId = String(body?.userId || "").trim();
    if (!UUID_RE.test(targetUserId)) return json({ error: "A valid vendor ID is required." }, 400);
    if (typeof body?.marked !== "boolean") return json({ error: "marked must be true or false." }, 400);
    const marked: boolean = body.marked;

    // The vendor must be on this event's team, so a stray id cannot create orphan rows.
    const { data: teamRow, error: teamErr } = await supabaseAdmin
      .from("event_teams")
      .select("vendor_id")
      .eq("event_id", eventId)
      .eq("vendor_id", targetUserId)
      .maybeSingle();
    if (teamErr) return json({ error: teamErr.message }, 500);
    if (!teamRow) return json({ error: "That vendor is not on this event's team." }, 404);

    const { error } = marked
      ? await supabaseAdmin
          .from(TABLE)
          .upsert(
            { event_id: eventId, user_id: targetUserId, marked_by: user.id },
            { onConflict: "event_id,user_id", ignoreDuplicates: true }
          )
      : await supabaseAdmin
          .from(TABLE)
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", targetUserId);
    if (error) {
      if (isMissingTableError(error)) {
        return json({ error: "No Meal Waiver is not set up in the database yet." }, 503);
      }
      return json({ error: error.message }, 500);
    }
    return json({ userId: targetUserId, marked });
  } catch (err: any) {
    console.error("[no-meal-waivers PUT] error:", err);
    return json({ error: err?.message || "Server error" }, 500);
  }
}
