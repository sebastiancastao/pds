import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Vendors exempt from the same-day double-booking guard and the
 * out-of-venue restriction: supervisor3 accounts themselves, plus any
 * worker linked to a supervisor3 via an active manager_team_members row
 * (assigned from Role Management > Teams). The link lets a manager grant
 * a specific worker the same add+confirm behavior as a supervisor3
 * without changing that worker's own role.
 */
export async function getSupervisor3BypassVendorIds(
  supabase: SupabaseClient,
  vendors: Array<{ id: string; role?: string | null }>
): Promise<Set<string>> {
  const bypassIds = new Set<string>();
  const remainingIds: string[] = [];

  for (const vendor of vendors) {
    const id = String(vendor?.id || "").trim();
    if (!id) continue;
    if (String(vendor?.role || "").toLowerCase().trim() === "supervisor3") {
      bypassIds.add(id);
    } else {
      remainingIds.push(id);
    }
  }

  if (remainingIds.length === 0) return bypassIds;

  const { data: links, error: linksError } = await supabase
    .from("manager_team_members")
    .select("manager_id, member_id")
    .in("member_id", remainingIds)
    .eq("is_active", true);

  if (linksError || !links || links.length === 0) return bypassIds;

  const managerIds = Array.from(
    new Set(links.map((link: any) => String(link?.manager_id || "").trim()).filter(Boolean))
  );
  if (managerIds.length === 0) return bypassIds;

  const { data: managers, error: managersError } = await supabase
    .from("users")
    .select("id, role")
    .in("id", managerIds)
    .eq("role", "supervisor3");

  if (managersError || !managers || managers.length === 0) return bypassIds;

  const supervisor3ManagerIds = new Set(managers.map((m: any) => String(m.id)));
  for (const link of links) {
    const managerId = String((link as any)?.manager_id || "").trim();
    const memberId = String((link as any)?.member_id || "").trim();
    if (memberId && supervisor3ManagerIds.has(managerId)) {
      bypassIds.add(memberId);
    }
  }

  return bypassIds;
}
