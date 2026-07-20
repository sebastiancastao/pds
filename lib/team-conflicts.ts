import type { SupabaseClient } from "@supabase/supabase-js";

/** Team statuses that hold a vendor's spot on an event. */
export const ACTIVE_TEAM_STATUSES = ["confirmed", "pending_confirmation", "pending"] as const;

export type SameDayConflict = {
  vendorId: string;
  eventId: string;
  eventName: string;
  venue: string | null;
  status: string;
};

/**
 * Finds each vendor's booking on a *different* event that shares this event's
 * date. By default any active status counts — a pending invite holds a spot
 * just like a confirmed one, otherwise a vendor who is slow to confirm can be
 * double-invited before the first booking becomes visible. Pass
 * `statuses: ["confirmed"]` to only treat locked-in bookings as conflicts.
 *
 * Non Event Time Sheets (event_type "special") never conflict in either
 * direction: they are timesheet containers, not real bookings.
 */
export async function findSameDayConflicts(
  supabase: SupabaseClient,
  options: {
    eventId: string;
    eventDate: string | null | undefined;
    eventType?: string | null;
    vendorIds: string[];
    statuses?: readonly string[];
  }
): Promise<Map<string, SameDayConflict>> {
  const conflicts = new Map<string, SameDayConflict>();
  const { eventId, eventDate, eventType, vendorIds } = options;
  const statuses = options.statuses ?? ACTIVE_TEAM_STATUSES;

  if (String(eventType || "").toLowerCase() === "special") return conflicts;

  const eventDateKey = typeof eventDate === "string" ? eventDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDateKey) || vendorIds.length === 0) return conflicts;

  const { data: sameDateEvents, error: eventsError } = await supabase
    .from("events")
    .select("id, event_name, venue, event_type")
    .eq("event_date", eventDateKey)
    .eq("is_active", true)
    .neq("id", eventId);

  if (eventsError) {
    throw new Error(`Failed to load same-date events: ${eventsError.message}`);
  }

  const candidateEvents = (sameDateEvents || []).filter(
    (e: any) => String(e.event_type || "").toLowerCase() !== "special"
  );
  if (candidateEvents.length === 0) return conflicts;

  const eventById = new Map<string, any>(candidateEvents.map((e: any) => [String(e.id), e]));
  const candidateEventIds = Array.from(eventById.keys());

  const BATCH_SIZE = 200;
  const rows: Array<{ vendor_id: string; event_id: string; status: string }> = [];
  for (let i = 0; i < vendorIds.length; i += BATCH_SIZE) {
    const batch = vendorIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("event_teams")
      .select("vendor_id, event_id, status")
      .in("event_id", candidateEventIds)
      .in("vendor_id", batch)
      .in("status", statuses as string[]);

    if (error) {
      throw new Error(`Failed to load same-date team bookings: ${error.message}`);
    }
    if (data) rows.push(...(data as any[]));
  }

  // When a vendor has several same-date bookings, report the confirmed one.
  for (const row of rows) {
    const vendorId = String(row.vendor_id);
    const existing = conflicts.get(vendorId);
    if (existing && (existing.status === "confirmed" || row.status !== "confirmed")) continue;

    const event = eventById.get(String(row.event_id));
    if (!event) continue;

    conflicts.set(vendorId, {
      vendorId,
      eventId: String(event.id),
      eventName: String(event.event_name || "another event"),
      venue: event.venue ? String(event.venue) : null,
      status: String(row.status),
    });
  }

  return conflicts;
}
