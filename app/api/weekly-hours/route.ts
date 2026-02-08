import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { getMondayOfWeek } from "@/lib/utils";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

/**
 * GET /api/weekly-hours?events=JSON
 *
 * Accepts a JSON-encoded array of { event_id, event_date, user_ids } objects.
 * For each event, returns accumulated hours from Monday of that week up to
 * (but not including) the event date, for each user.
 *
 * Response: { [event_id]: { [user_id]: prior_weekly_hours } }
 */
export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const eventsParam = searchParams.get("events");
  if (!eventsParam) {
    return NextResponse.json({ error: "Missing events param" }, { status: 400 });
  }

  let eventRequests: Array<{ event_id: string; event_date: string; user_ids: string[] }>;
  try {
    eventRequests = JSON.parse(eventsParam);
  } catch {
    return NextResponse.json({ error: "Invalid events JSON" }, { status: 400 });
  }

  const result: Record<string, Record<string, number>> = {};

  for (const eventReq of eventRequests) {
    const dateStr = (eventReq.event_date || "").split("T")[0];
    if (!dateStr) {
      result[eventReq.event_id] = {};
      continue;
    }

    const monday = getMondayOfWeek(dateStr);

    // If the event IS on Monday, no prior days in the week
    if (monday === dateStr) {
      const zeros: Record<string, number> = {};
      for (const uid of eventReq.user_ids) zeros[uid] = 0;
      result[eventReq.event_id] = zeros;
      continue;
    }

    const startIso = new Date(`${monday}T00:00:00Z`).toISOString();
    const endIso = new Date(`${dateStr}T00:00:00Z`).toISOString();

    // Query time_entries for these users from Monday to start of event day
    const { data: entries } = await supabaseAdmin
      .from("time_entries")
      .select("user_id, action, timestamp")
      .in("user_id", eventReq.user_ids)
      .gte("timestamp", startIso)
      .lt("timestamp", endIso)
      .in("action", ["clock_in", "clock_out"])
      .order("timestamp", { ascending: true });

    // Pair clock_in/clock_out per user to compute hours
    const hoursByUser: Record<string, number> = {};
    for (const uid of eventReq.user_ids) hoursByUser[uid] = 0;

    const entriesByUser: Record<string, any[]> = {};
    for (const uid of eventReq.user_ids) entriesByUser[uid] = [];
    for (const entry of entries || []) {
      if (entriesByUser[entry.user_id]) {
        entriesByUser[entry.user_id].push(entry);
      }
    }

    for (const uid of eventReq.user_ids) {
      let currentIn: string | null = null;
      let ms = 0;
      for (const row of entriesByUser[uid]) {
        if (row.action === "clock_in") {
          if (!currentIn) currentIn = row.timestamp;
        } else if (row.action === "clock_out") {
          if (currentIn) {
            const dur = new Date(row.timestamp).getTime() - new Date(currentIn).getTime();
            if (dur > 0) ms += dur;
            currentIn = null;
          }
        }
      }
      hoursByUser[uid] = ms / (1000 * 60 * 60);
    }

    result[eventReq.event_id] = hoursByUser;
  }

  return NextResponse.json(result);
}
