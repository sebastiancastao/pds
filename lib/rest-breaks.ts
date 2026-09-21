// Rest break pay, shared by the event dashboard Payment tab, /hr-dashboard payroll,
// the HR PDF export and /paystub-generator so they can never drift apart.
//
// Rule: $4.50 for every 4 hours worked, counting a partial 4 hours as a full one.
// A shift of up to 4 hours pays $4.50, up to 8 hours pays $9.00, and so on.
//
// Managers and exec can also enter how many rest breaks a worker actually took
// (Timesheet tab of /event-dashboard). When a count is entered, each break pays
// $4.50 regardless of shift length. With no count entered, the count is the number
// of 4-hour periods worked.

/** Dollars paid for each rest break. */
export const REST_BREAK_RATE = 4.5;

/** One rest break is paid for every this-many hours worked, counting a partial period as a full one. */
export const REST_BREAK_PERIOD_HOURS = 4;

/** Highest rest break count a manager can record for one worker on one event. */
export const MAX_REST_BREAK_COUNT = 10;

const roundCents = (value: number): number => Math.round((value + 1e-9) * 100) / 100;

// Hours reach this module rounded differently depending on the caller (some round to
// hundredths, some pass raw milliseconds / 3,600,000). Round here so every screen agrees
// and a few seconds of float noise at exactly 4 or 8 hours cannot add a whole break.
const roundHours = (hours: number): number => Math.round((hours + 1e-9) * 100) / 100;

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
 * Rest break pay for one worker on one event.
 * `count` is the number entered by a manager, or null/undefined when none was entered.
 * Callers still decide whether rest break pay applies at all (San Diego, non-event
 * timesheets and some states pay none) and skip this call when it does not.
 */
export function getRestBreakPay(hours: number, count?: number | null): number {
  if (!Number.isFinite(hours)) return 0;
  const worked = roundHours(hours);
  if (worked <= 0) return 0;
  const entered = normalizeRestBreakCount(count);
  const breaks = entered !== null ? entered : Math.ceil(worked / REST_BREAK_PERIOD_HOURS);
  return roundCents(breaks * REST_BREAK_RATE);
}

/** Counts keyed by event id, then worker (user) id. */
export type RestBreakCountsByEvent = Record<string, Record<string, number>>;
