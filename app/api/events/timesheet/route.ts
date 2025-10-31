// app/api/events/[id]/timesheet/route.ts
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export const runtime = "nodejs";

function jsonError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/events/:id/timesheet
 * Returns:
 * {
 *   totals: { [user_id]: totalMillisecondsWorked },
 *   spans:  { [user_id]: { firstIn: string|null, lastOut: string|null } },
 *   entriesCount: number
 * }
 */
export async function GET(
  _req: Request,
  ctx: { params: { id: string } }
) {
  try {
    const eventId = ctx.params?.id;
    if (!eventId) return jsonError("Missing event id", 400);

    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) return jsonError(authError.message, 500);
    if (!user) return jsonError("Unauthorized", 401);

    // Pull all time entries for this event
    const { data: entries, error } = await supabase
      .from("time_entries")
      .select("id,user_id,started_at,ended_at,event_id")
      .eq("event_id", eventId);

    if (error) return jsonError(error.message, 500);

    const totals: Record<string, number> = {};
    const spans: Record<string, { firstIn: string | null; lastOut: string | null }> = {};

    for (const te of entries ?? []) {
      const uid = te.user_id;
      const start = te.started_at ? new Date(te.started_at) : null;
      const end = te.ended_at ? new Date(te.ended_at) : null;

      // Track firstIn / lastOut per user
      if (!spans[uid]) spans[uid] = { firstIn: null, lastOut: null };
      if (start) {
        if (!spans[uid].firstIn || new Date(spans[uid].firstIn) > start) {
          spans[uid].firstIn = start.toISOString();
        }
      }
      if (end) {
        if (!spans[uid].lastOut || new Date(spans[uid].lastOut) < end) {
          spans[uid].lastOut = end.toISOString();
        }
      }

      // Sum only finished intervals (ignore open intervals)
      if (start && end) {
        const ms = Math.max(end.getTime() - start.getTime(), 0);
        totals[uid] = (totals[uid] || 0) + ms;
      }
    }

    return NextResponse.json({
      totals,
      spans,
      entriesCount: entries?.length ?? 0,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Unhandled timesheet GET error", 500);
  }
}
