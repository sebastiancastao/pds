import type { SupabaseClient } from "@supabase/supabase-js";

export type LockedAvailabilityDate = {
  date: string;
  available: boolean;
  status: "confirmed" | "declined";
  eventId: string;
  eventName: string | null;
  teamMemberId: string;
};

/**
 * Dates a vendor cannot freely resubmit availability for because they've
 * already confirmed or declined an actual event invitation on that date.
 * The lock value mirrors the commitment: confirmed -> available, declined ->
 * unavailable. If both a confirmed and a declined event land on the same
 * date, confirmed wins — they're committed to work that day regardless of
 * the other event's outcome.
 *
 * To change a locked date, the vendor has to request cancellation of the
 * underlying event_teams invitation (existing /api/invitation-cancellation-requests
 * flow); once approved and the row is removed, the lock lifts on its own.
 */
export async function getLockedAvailabilityDates(
  supabaseAdmin: SupabaseClient,
  vendorId: string
): Promise<Map<string, LockedAvailabilityDate>> {
  const locked = new Map<string, LockedAvailabilityDate>();
  if (!vendorId) return locked;

  const { data, error } = await supabaseAdmin
    .from("event_teams")
    .select("id, status, event_id, events (id, event_name, event_date)")
    .eq("vendor_id", vendorId)
    .in("status", ["confirmed", "declined"]);

  if (error || !data) return locked;

  for (const row of data as any[]) {
    const event = Array.isArray(row.events) ? row.events[0] : row.events;
    const dateKey = String(event?.event_date || "").slice(0, 10);
    if (!dateKey) continue;

    const status = String(row.status || "").toLowerCase() as "confirmed" | "declined";
    const existing = locked.get(dateKey);
    if (existing && existing.status === "confirmed" && status !== "confirmed") continue;

    locked.set(dateKey, {
      date: dateKey,
      available: status === "confirmed",
      status,
      eventId: String(row.event_id || event?.id || ""),
      eventName: event?.event_name ?? null,
      teamMemberId: String(row.id),
    });
  }

  return locked;
}
