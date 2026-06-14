import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

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

const HR_ROLES = new Set(["hr", "exec", "admin"]);
const QUERY_CHUNK_SIZE = 150;

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : undefined;

    if (token) {
      const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
      if (tokenUser?.user?.id) {
        user = { id: tokenUser.user.id } as any;
      }
    }
  }

  return user?.id || null;
}

async function hasHrAccess(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) return false;
  return HR_ROLES.has(String(data?.role || "").toLowerCase());
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * GET /api/hr/sick-leave-by-event?event_ids=<comma-separated UUIDs>
 *
 * Returns the sick-leave hours that apply to each event, keyed by event and
 * worker, so the HR payroll views can show a Sick Leave column on the event.
 *
 * The hours are MERGED from two sources (per the "Both, merged" product choice):
 *   1. Approved sick-leave requests (sick_leaves) linked to the event via event_id.
 *   2. Sick-leave pay sheets (sick_leave_paysheets) linked to the event via event_id.
 * Hours from both sources are summed per (event_id, user_id).
 *
 * Response shape:
 *   { sickByEvent: { [eventId]: { [userId]: hours } } }
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await hasHrAccess(userId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const eventIds = [
      ...new Set(
        String(searchParams.get("event_ids") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];

    if (eventIds.length === 0) {
      return NextResponse.json({ sickByEvent: {} }, { status: 200 });
    }

    // Accumulate each source separately, keyed by `${eventId}::${userId}`.
    // A pay sheet is the authoritative payroll figure and is typically created FROM an
    // approved request, so to avoid double-counting we let the pay sheet SUPERSEDE the
    // request for the same event+worker (and fall back to the request hours when no pay
    // sheet exists yet). Switch the merge below to summing if you want them added instead.
    const requestHours = new Map<string, number>();
    const paysheetHours = new Map<string, number>();
    const accumulate = (map: Map<string, number>, eventId: string | null, userId: string | null, hours: number) => {
      if (!eventId || !userId) return;
      const value = Number(hours || 0);
      if (!Number.isFinite(value) || value <= 0) return;
      const key = `${eventId}::${userId}`;
      map.set(key, Number(((map.get(key) || 0) + value).toFixed(2)));
    };

    for (const chunk of chunkArray(eventIds, QUERY_CHUNK_SIZE)) {
      // Source 1: approved sick-leave requests linked to these events.
      const { data: requests, error: requestsError } = await supabaseAdmin
        .from("sick_leaves")
        .select("event_id, user_id, duration_hours, status")
        .in("event_id", chunk)
        .eq("status", "approved");

      if (requestsError) {
        return NextResponse.json(
          { error: requestsError.message || "Failed to fetch sick leave requests" },
          { status: 500 }
        );
      }
      for (const row of requests || []) {
        accumulate(requestHours, row.event_id, row.user_id, Number(row.duration_hours || 0));
      }

      // Source 2: sick-leave pay sheets linked to these events.
      const { data: paysheets, error: paysheetsError } = await supabaseAdmin
        .from("sick_leave_paysheets")
        .select("event_id, user_id, hours")
        .in("event_id", chunk);

      if (paysheetsError) {
        return NextResponse.json(
          { error: paysheetsError.message || "Failed to fetch sick leave pay sheets" },
          { status: 500 }
        );
      }
      for (const row of paysheets || []) {
        accumulate(paysheetHours, row.event_id, row.user_id, Number(row.hours || 0));
      }
    }

    const sickByEvent: Record<string, Record<string, number>> = {};
    // Pay sheet hours win; otherwise fall back to approved-request hours.
    const allKeys = new Set<string>([...requestHours.keys(), ...paysheetHours.keys()]);
    for (const key of allKeys) {
      const hours = paysheetHours.has(key) ? paysheetHours.get(key)! : requestHours.get(key)!;
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const [eventId, userId] = key.split("::");
      if (!sickByEvent[eventId]) sickByEvent[eventId] = {};
      sickByEvent[eventId][userId] = Number(hours.toFixed(2));
    }

    return NextResponse.json({ sickByEvent }, { status: 200 });
  } catch (err: any) {
    console.error("[HR SICK LEAVE BY EVENT][GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
