// Rest break pay, shared by the event dashboard Payment tab, /hr-dashboard payroll,
// the HR PDF export and /paystub-generator so they can never drift apart.
//
// Two rules apply depending on the event's date, so the newer rule is not retroactive:
//   - On or after REST_BREAK_RATE_CHANGE_DATE: $4.50 for every 4 hours worked, counting a
//     partial 4 hours as a full one. A manager-entered count (Timesheet tab of
//     /event-dashboard) pays $4.50 per break instead, regardless of shift length.
//   - Before that date: the older flat per-shift amount ($9 under 10h, $12.50 for 10-14h,
//     $17 for 14h+). A count has no effect here — the count feature did not exist for
//     events that old, so one is not expected and is ignored if present.
// Every caller must pass the event's date so the right rule is picked automatically.

/** Dollars paid for each rest break, for events on or after REST_BREAK_RATE_CHANGE_DATE. */
export const REST_BREAK_RATE = 4.5;

/** One rest break is paid for every this-many hours worked, counting a partial period as a full one. */
export const REST_BREAK_PERIOD_HOURS = 4;

/** First event date (YYYY-MM-DD, inclusive) the $4.50-per-4-hours rule applies to. Earlier events keep the old flat schedule. */
export const REST_BREAK_RATE_CHANGE_DATE = "2026-09-13";

/** Highest rest break count a manager can record for one worker on one event. */
export const MAX_REST_BREAK_COUNT = 10;

/** Flat per-shift schedule used for events before REST_BREAK_RATE_CHANGE_DATE. */
const LEGACY_SCHEDULE: ReadonlyArray<{ minHours: number; amount: number }> = [
  { minHours: 14, amount: 17 },
  { minHours: 10, amount: 12.5 },
  { minHours: 0, amount: 9 },
];

const roundCents = (value: number): number => Math.round((value + 1e-9) * 100) / 100;

// Hours reach this module rounded differently depending on the caller (some round to
// hundredths, some pass raw milliseconds / 3,600,000). Round here so every screen agrees
// and a few seconds of float noise at exactly 4 or 8 hours cannot add a whole break.
const roundHours = (hours: number): number => Math.round((hours + 1e-9) * 100) / 100;

// Event dates arrive as "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss..."; compare on the date part
// only. ISO-formatted YYYY-MM-DD strings sort correctly with plain string comparison.
const toDateOnly = (value: unknown): string => (value ?? "").toString().trim().slice(0, 10);

/**
 * True when an event on this date is priced with the current $4.50-per-4-hours rule.
 * A missing or unparseable date is treated as "before the change" (the older, more
 * conservative rule), so a caller that fails to look up a date never overcharges an
 * event that turns out to be old.
 */
export function usesCurrentRestBreakRule(eventDate: unknown): boolean {
  const d = toDateOnly(eventDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= REST_BREAK_RATE_CHANGE_DATE;
}

/**
 * Coerce a stored or typed value to a valid rest break count.
 * Returns null for anything that is not a whole number from 0 to MAX_REST_BREAK_COUNT,
 * including blank input, which means "no count recorded".
 */
export function normalizeRestBreakCount(value: unknown): number | null {
  // Only real numbers and plain digit text count; Number() would also turn true, [], [3] and "0x2" into counts.
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\s*\d+\s*$/.test(value)) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_REST_BREAK_COUNT) return null;
  return n;
}

/**
 * Rest break pay for one worker's shift on one event.
 * `eventDate` (the event's date, e.g. "2026-09-13") picks which rule applies — required,
 * since the rule is not the same for every event. `count` is the number of breaks a
 * manager entered, or null/undefined when none was entered; it is only used under the
 * current rule. Callers still decide whether rest break pay applies at all (San Diego,
 * non-event timesheets and some states pay none) and skip this call when it does not.
 */
export function getRestBreakPay(hours: number, count: number | null | undefined, eventDate: unknown): number {
  if (!Number.isFinite(hours)) return 0;
  const worked = roundHours(hours);
  if (worked <= 0) return 0;

  if (!usesCurrentRestBreakRule(eventDate)) {
    const tier = LEGACY_SCHEDULE.find((t) => worked >= t.minHours);
    return tier ? tier.amount : 0;
  }

  const entered = normalizeRestBreakCount(count);
  const breaks = entered !== null ? entered : Math.ceil(worked / REST_BREAK_PERIOD_HOURS);
  return roundCents(breaks * REST_BREAK_RATE);
}

/** Counts keyed by event id, then worker (user) id. */
export type RestBreakCountsByEvent = Record<string, Record<string, number>>;

/**
 * Number of rest breaks to show next to rest break pay on a paystub.
 * A manager-entered count wins; otherwise one break per 4 hours worked, counting a partial
 * 4 hours as a full one (the same number the current pay rule uses). Events on the older
 * flat schedule are counted the same way so the paystub always shows a number.
 */
export function getRestBreakCount(hours: number, count: number | null | undefined): number {
  const entered = normalizeRestBreakCount(count);
  if (entered !== null) return entered;
  if (!Number.isFinite(hours)) return 0;
  const worked = roundHours(hours);
  if (worked <= 0) return 0;
  return Math.ceil(worked / REST_BREAK_PERIOD_HOURS);
}
