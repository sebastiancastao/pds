// Shared, client-safe helpers for "available only during a time frame"
// availability answers. The vendor's own availability form stores these in
// vendor_invitations.availability as {available, allDay: false, startTime,
// endTime} ("HH:MM", 24h, end may be earlier than start when the window
// crosses midnight). Approved change requests store the same thing in
// vendor_availability_corrections (all_day / start_time / end_time), so
// /employees, the change-request API and /api/events/[id]/available-vendors
// (which feeds the /dashboard, /global-calendar and /event-dashboard team
// pickers) all describe and compare windows the same way.

export type AvailabilityAnswer = {
  available: boolean;
  /** false only when available during [startTime, endTime] only. */
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
};

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "9:00", "09:00" or "09:00:00" -> "09:00"; anything else -> null. */
export function normalizeTimeFrameTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const normalized = `${match[1].padStart(2, "0")}:${match[2]}`;
  return HH_MM.test(normalized) ? normalized : null;
}

/**
 * Builds a normalized answer. A time frame is kept only when the day is
 * available and both ends are valid, different times; otherwise the day
 * counts as all day (or simply unavailable).
 */
export function toAvailabilityAnswer(input: {
  available: boolean;
  allDay?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}): AvailabilityAnswer {
  const startTime = normalizeTimeFrameTime(input.startTime);
  const endTime = normalizeTimeFrameTime(input.endTime);
  const isWindow =
    input.available === true && input.allDay === false && !!startTime && !!endTime && startTime !== endTime;
  return {
    available: input.available === true,
    allDay: !isWindow,
    startTime: isWindow ? startTime : null,
    endTime: isWindow ? endTime : null,
  };
}

export function sameAvailabilityAnswer(a: AvailabilityAnswer | null, b: AvailabilityAnswer | null): boolean {
  if (!a || !b) return a === b;
  if (a.available !== b.available) return false;
  if (!a.available) return true;
  if (a.allDay !== b.allDay) return false;
  if (a.allDay) return true;
  return a.startTime === b.startTime && a.endTime === b.endTime;
}

/** "16:00" -> "4:00 PM" */
export function formatTimeFrameTime(value: string | null | undefined): string {
  const normalized = normalizeTimeFrameTime(value);
  if (!normalized) return "";
  const [h, m] = normalized.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "16:00" -> "4p", "16:30" -> "4:30p" (for tight calendar cells). */
export function formatTimeFrameTimeShort(value: string | null | undefined): string {
  const normalized = normalizeTimeFrameTime(value);
  if (!normalized) return "";
  const [h, m] = normalized.split(":").map(Number);
  const suffix = h >= 12 ? "p" : "a";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

export function crossesMidnight(startTime: string | null, endTime: string | null): boolean {
  const start = normalizeTimeFrameTime(startTime);
  const end = normalizeTimeFrameTime(endTime);
  return !!start && !!end && end < start;
}

/** "4:00 PM – 2:00 AM (next day)" */
export function formatTimeFrameRange(startTime: string | null, endTime: string | null): string {
  const label = `${formatTimeFrameTime(startTime)} – ${formatTimeFrameTime(endTime)}`;
  return crossesMidnight(startTime, endTime) ? `${label} (next day)` : label;
}

/** "No answer on record" / "Unavailable" / "Available all day" / "Available 4:00 PM – 2:00 AM (next day)" */
export function describeAvailabilityAnswer(answer: AvailabilityAnswer | null): string {
  if (!answer) return "No answer on record";
  if (!answer.available) return "Unavailable";
  if (answer.allDay) return "Available all day";
  return `Available ${formatTimeFrameRange(answer.startTime, answer.endTime)}`;
}
