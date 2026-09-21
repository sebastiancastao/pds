// Server-only: load the rest break counts managers recorded on the /event-dashboard
// Timesheet tab (table event_rest_breaks). Payroll routes call this so every one of
// them prices rest breaks from the same numbers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRestBreakCount, type RestBreakCountsByEvent } from "@/lib/rest-breaks";

// Keep the .in() list short enough for the request URL and page through results so
// the API's default row cap never silently drops workers.
const EVENT_ID_CHUNK_SIZE = 100;
const PAGE_SIZE = 1000;

const isMissingTableError = (error: any): boolean => {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("event_rest_breaks") && (message.includes("does not exist") || message.includes("schema cache")))
  );
};

/**
 * Recorded rest break counts keyed by event id, then user id.
 * Pass `eventIds` to limit the lookup, or omit it to load every event's counts.
 * A missing table (migration not applied yet) reads as "nothing recorded"; any other
 * failure throws so payroll never quietly falls back to the flat schedule.
 */
export async function fetchRestBreakCounts(
  client: SupabaseClient<any, any, any>,
  eventIds?: ReadonlyArray<string | null | undefined> | null
): Promise<RestBreakCountsByEvent> {
  const result: RestBreakCountsByEvent = {};

  const ids = eventIds
    ? Array.from(new Set(eventIds.map((id) => (id || "").toString().trim()).filter(Boolean)))
    : null;
  if (ids && ids.length === 0) return result;

  const chunks: Array<string[] | null> = ids
    ? Array.from({ length: Math.ceil(ids.length / EVENT_ID_CHUNK_SIZE) }, (_, i) =>
        ids.slice(i * EVENT_ID_CHUNK_SIZE, (i + 1) * EVENT_ID_CHUNK_SIZE)
      )
    : [null];

  for (const chunk of chunks) {
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = client
        .from("event_rest_breaks")
        .select("event_id, user_id, rest_break_count")
        .order("event_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (chunk) query = query.in("event_id", chunk);

      const { data, error } = await query;
      if (error) {
        if (isMissingTableError(error)) {
          console.warn("[rest-breaks] event_rest_breaks table not available; treating as no counts recorded");
          return result;
        }
        throw new Error(`Failed to load rest break counts: ${error.message}`);
      }

      const rows = (data || []) as Array<{ event_id: string; user_id: string; rest_break_count: number }>;
      for (const row of rows) {
        const count = normalizeRestBreakCount(row.rest_break_count);
        if (!row.event_id || !row.user_id || count === null) continue;
        (result[row.event_id] ||= {})[row.user_id] = count;
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }

  return result;
}
