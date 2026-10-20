// Event types stored in events.event_type. The events_event_type_check constraint lists the
// same values (supabase/migrations/20261020000001_add_count_in_setup_event_type.sql).
//
//   - "normal":         Event Time Keeping. A regular show with sales and a commission pool.
//   - "count_in_setup": Count In Setup Day. A count-in / set-up shift for a show. It is timed
//                       and paid exactly like "normal": every Non Event rule in the app checks
//                       for "special" only, so this type just names the day so it can be told
//                       apart and filtered. With no sales its pool is $0, so the flat $150
//                       no-commission shift rule on paystubs applies as before.
//   - "special":        Non Event Time Sheet. Hourly work outside an event (may span days).
export const EVENT_TYPES = ["normal", "count_in_setup", "special"] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  normal: "Event Time Keeping",
  count_in_setup: "Count In Setup Day",
  special: "Non Event Time Sheet",
};

/** Maps any stored or submitted value to a known event type; unknown values become "normal". */
export function normalizeEventType(value: unknown): EventType {
  const v = String(value ?? "").trim().toLowerCase();
  return (EVENT_TYPES as readonly string[]).includes(v) ? (v as EventType) : "normal";
}

export function getEventTypeLabel(value: unknown): string {
  return EVENT_TYPE_LABELS[normalizeEventType(value)];
}

// Flat commission share paid to each vendor who clocked hours at a Count In Setup Day, which
// has no sales of its own. On by default (events.count_in_flat_pay_enabled); an exec can switch
// it off per event on the HR dashboard Payroll tab. Like the paystub rule for $0-pool shifts,
// it is paid in the period-rate states (CA, NV, WI) only.
export const COUNT_IN_SETUP_FLAT_PAY = 150;

/** True for a Count In Setup Day whose flat $150 has not been switched off. */
export function isCountInFlatPayOn(
  event: { event_type?: unknown; count_in_flat_pay_enabled?: unknown } | null | undefined
): boolean {
  return normalizeEventType(event?.event_type) === "count_in_setup" && event?.count_in_flat_pay_enabled !== false;
}
