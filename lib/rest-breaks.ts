// Rest break pay, shared by the event dashboard Payment tab, /hr-dashboard payroll,
// the HR PDF export and /paystub-generator so they can never drift apart.
//
// Rest break pay is a flat per-shift premium that depends on how long the shift was.
// Managers and exec can also record how many rest breaks a worker actually took
// (Timesheet tab of /event-dashboard). When a count is recorded, the premium is
// scaled by that count relative to the number of breaks the flat schedule assumes
// for the shift. Recording exactly the assumed number reproduces the flat amount.
// When no count is recorded the flat schedule applies unchanged.

/** Highest rest break count a manager can record for one worker on one event. */
export const MAX_REST_BREAK_COUNT = 10;

/** Flat schedule: shift length in hours (inclusive lower bound) -> premium and assumed break count. */
const REST_BREAK_SCHEDULE: ReadonlyArray<{ minHours: number; amount: number; standardBreaks: number }> = [
  { minHours: 14, amount: 17, standardBreaks: 4 },
  { minHours: 10, amount: 12.5, standardBreaks: 3 },
  { minHours: 0, amount: 9, standardBreaks: 2 },
];

const roundCents = (value: number): number => Math.round((value + 1e-9) * 100) / 100;

const scheduleFor = (hours: number) => {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return REST_BREAK_SCHEDULE.find((tier) => hours >= tier.minHours) ?? null;
};

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

/** Flat premium for a shift of this length, ignoring any recorded count. */
export function getFlatRestBreakAmount(hours: number): number {
  return scheduleFor(hours)?.amount ?? 0;
}

/** Number of rest breaks the flat schedule assumes for a shift of this length. */
export function getStandardRestBreakCount(hours: number): number {
  return scheduleFor(hours)?.standardBreaks ?? 0;
}

/**
 * Rest break pay for one worker on one event.
 * `count` is the number recorded by a manager, or null/undefined when none was recorded.
 * Callers still decide whether rest break pay applies at all (San Diego, non-event
 * timesheets and some states pay none) and skip this call when it does not.
 */
export function getRestBreakPay(hours: number, count?: number | null): number {
  const tier = scheduleFor(hours);
  if (!tier) return 0;
  const recorded = normalizeRestBreakCount(count);
  if (recorded === null) return tier.amount;
  return roundCents((tier.amount * recorded) / tier.standardBreaks);
}

/**
 * Number of rest breaks the pay above covers: the recorded count, or the
 * schedule's assumed count when none was recorded. Zero when there is no shift.
 */
export function getPaidRestBreakCount(hours: number, count?: number | null): number {
  const tier = scheduleFor(hours);
  if (!tier) return 0;
  const recorded = normalizeRestBreakCount(count);
  return recorded === null ? tier.standardBreaks : recorded;
}

/** Counts keyed by event id, then worker (user) id. */
export type RestBreakCountsByEvent = Record<string, Record<string, number>>;
