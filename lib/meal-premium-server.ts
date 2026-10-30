// Server-only: load the Meal Premium toggles an exec switched on in the /event-dashboard
// Timesheet tab (table event_meal_premiums). Payroll routes call this so every one of them
// pays meal premiums from the same rows (see lib/meal-premium for the pay rule).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MealPremiumsByEvent } from "@/lib/meal-premium";

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
    (message.includes("event_meal_premiums") && (message.includes("does not exist") || message.includes("schema cache")))
  );
};

/**
 * Workers with the Meal Premium toggle on, keyed by event id, then user id.
 * Pass `eventIds` to limit the lookup, or omit it to load every event's toggles.
 * A missing table reads as "no meal premiums"; any other failure throws so payroll never
 * quietly drops a meal premium that was switched on.
 */
export async function fetchMealPremiums(
  client: SupabaseClient<any, any, any>,
  eventIds?: ReadonlyArray<string | null | undefined> | null
): Promise<MealPremiumsByEvent> {
  const result: MealPremiumsByEvent = {};

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
        .from("event_meal_premiums")
        .select("event_id, user_id")
        .order("event_id", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (chunk) query = query.in("event_id", chunk);

      const { data, error } = await query;
      if (error) {
        if (isMissingTableError(error)) {
          console.warn("[meal-premiums] event_meal_premiums table not available; treating as no meal premiums");
          return result;
        }
        throw new Error(`Failed to load meal premiums: ${error.message}`);
      }

      const rows = (data || []) as Array<{ event_id: string; user_id: string }>;
      for (const row of rows) {
        if (!row.event_id || !row.user_id) continue;
        (result[row.event_id] ||= {})[row.user_id] = true;
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }

  return result;
}
