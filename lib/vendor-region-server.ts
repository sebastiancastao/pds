// Server-only: each vendor's home region name (profiles.region_id -> regions.name), keyed by
// user id. Payroll uses it to keep Los Angeles-region vendors on commission pay when they work
// a San Diego event (see usesSanDiegoHourlyPay in lib/commission-pool).
import type { SupabaseClient } from "@supabase/supabase-js";

// Keep the .in() list short enough for the request URL.
const USER_ID_CHUNK_SIZE = 100;

/**
 * Region name for every user in `userIds` that has a region assigned. Users with no region, or
 * whose region no longer exists, are left out. Throws on a query error so callers decide whether
 * a failed lookup is fatal for them.
 */
export async function fetchRegionNameByUserId(
  client: SupabaseClient<any, any, any>,
  userIds: ReadonlyArray<string | null | undefined>
): Promise<Record<string, string>> {
  const ids = Array.from(new Set(userIds.map((id) => (id || "").toString().trim()).filter(Boolean)));
  const result: Record<string, string> = {};
  if (ids.length === 0) return result;

  const { data: regions, error: regionsError } = await client.from("regions").select("id, name");
  if (regionsError) throw new Error(`Failed to load regions: ${regionsError.message}`);
  const regionNameById: Record<string, string> = {};
  for (const region of (regions || []) as Array<{ id: string; name: string | null }>) {
    if (region?.id && region?.name) regionNameById[region.id] = region.name;
  }

  for (let i = 0; i < ids.length; i += USER_ID_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + USER_ID_CHUNK_SIZE);
    const { data, error } = await client
      .from("profiles")
      .select("user_id, region_id")
      .in("user_id", chunk);
    if (error) throw new Error(`Failed to load vendor regions: ${error.message}`);
    for (const row of (data || []) as Array<{ user_id: string; region_id: string | null }>) {
      const name = row?.region_id ? regionNameById[row.region_id] : undefined;
      if (row?.user_id && name) result[row.user_id] = name;
    }
  }

  return result;
}
