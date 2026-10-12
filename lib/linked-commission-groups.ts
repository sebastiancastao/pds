import type { SupabaseClient } from "@supabase/supabase-js";

// Shared/linked commission groups.
//
// events.linked_commission_event_id is a single column, so a group of N events is
// stored as a ring: every member points at the next one (A -> B -> C -> A). A ring of
// two is exactly the original mutual pair (A -> B, B -> A), so pairs saved before
// groups existed are already valid groups. Readers never depend on the ring shape:
// a group is every event connected through the column in either direction, which is
// what buildLinkedCommissionDistribution (lib/linked-commission.ts) also uses.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY_CHUNK_SIZE = 100;
const MAX_TRAVERSAL_ROUNDS = 25;

// Upper bound on how many events one shared commission pool may span.
export const MAX_LINKED_COMMISSION_GROUP_SIZE = 20;

export const normalizeLinkedCommissionIds = (values: unknown): string[] => {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(",")
      : [];
  return Array.from(
    new Set(
      list
        .map((value) => (value ?? "").toString().trim())
        .filter((id) => UUID_RE.test(id))
    )
  );
};

export type LinkedCommissionGroups = {
  // Every event found (the seeds plus all events connected to them) -> the sorted ids
  // of its whole group, itself included. A standalone event maps to [itself].
  groupIdsByEventId: Record<string, string[]>;
  // Every event found, seeds included (only ids that exist in the events table).
  eventIds: string[];
};

export async function fetchLinkedCommissionGroups(
  supabase: SupabaseClient,
  seedIds: unknown
): Promise<LinkedCommissionGroups> {
  const seeds = normalizeLinkedCommissionIds(seedIds);
  const linkById = new Map<string, string | null>();
  const expanded = new Set<string>();
  let frontier = seeds;

  for (let round = 0; round < MAX_TRAVERSAL_ROUNDS && frontier.length > 0; round += 1) {
    for (const id of frontier) expanded.add(id);
    const discovered = new Set<string>();

    for (let index = 0; index < frontier.length; index += QUERY_CHUNK_SIZE) {
      const list = frontier.slice(index, index + QUERY_CHUNK_SIZE).join(",");
      // Both directions: the frontier events' own links, and events pointing at them.
      const { data, error } = await supabase
        .from("events")
        .select("id, linked_commission_event_id")
        .or(`id.in.(${list}),linked_commission_event_id.in.(${list})`);
      if (error) throw error;

      for (const row of (data || []) as Array<{ id?: string | null; linked_commission_event_id?: string | null }>) {
        const id = (row?.id || "").toString();
        if (!id) continue;
        const linkedId = (row?.linked_commission_event_id || "").toString() || null;
        linkById.set(id, linkedId);
        if (!expanded.has(id)) discovered.add(id);
        if (linkedId && !expanded.has(linkedId)) discovered.add(linkedId);
      }
    }

    frontier = Array.from(discovered).filter((id) => !expanded.has(id));
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) && parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const id of linkById.keys()) parent.set(id, id);
  for (const [id, linkedId] of linkById.entries()) {
    if (!linkedId || !linkById.has(linkedId)) continue;
    const rootA = find(id);
    const rootB = find(linkedId);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  const membersByRoot = new Map<string, string[]>();
  for (const id of linkById.keys()) {
    const root = find(id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, []);
    membersByRoot.get(root)!.push(id);
  }

  const groupIdsByEventId: Record<string, string[]> = {};
  for (const members of membersByRoot.values()) {
    const sorted = members.slice().sort();
    for (const id of sorted) groupIdsByEventId[id] = sorted;
  }

  return {
    groupIdsByEventId,
    eventIds: Array.from(linkById.keys()).sort(),
  };
}

// The linked_commission_event_id value each member should hold so the members form
// one ring. A single member (or none) means "not shared": that event points nowhere.
export function buildLinkedCommissionRing(memberIds: string[]): Record<string, string | null> {
  const members = Array.from(
    new Set((memberIds || []).map((id) => (id || "").toString().trim()).filter(Boolean))
  );
  if (members.length === 0) return {};
  if (members.length === 1) return { [members[0]]: null };
  return Object.fromEntries(
    members.map((id, index) => [id, members[(index + 1) % members.length]])
  );
}
