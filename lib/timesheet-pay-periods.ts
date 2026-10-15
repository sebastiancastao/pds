import { generateCycleWindows } from "@/lib/payment-cycles";

// Bi-weekly pay periods (Monday to Sunday), paid on the Friday after the period
// ends. Anchored on the first period HR listed: Feb 2 - Feb 15, 2026, paid
// Feb 20, 2026. Every later period follows the same 14-day cadence
// (e.g. Sep 28 - Oct 11, 2026 is paid Oct 16, 2026).
export const TIMESHEET_PAY_PERIOD_ANCHOR = "2026-02-02";
export const TIMESHEET_PAY_DATE_OFFSET_DAYS = 5;

export type TimesheetPayPeriod = {
  start: string; // YYYY-MM-DD, first day (inclusive)
  end: string; // YYYY-MM-DD, last day (inclusive)
  payDate: string; // YYYY-MM-DD
  inProgress: boolean; // today falls inside the period
};

export function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Every pay period from the anchor through the one that contains `today`,
 * newest first.
 */
export function listTimesheetPayPeriods(today: string = localTodayIso()): TimesheetPayPeriod[] {
  if (today < TIMESHEET_PAY_PERIOD_ANCHOR) return [];

  const windows = generateCycleWindows(
    {
      frequency: "biweekly",
      anchor_date: TIMESHEET_PAY_PERIOD_ANCHOR,
      pay_offset_days: TIMESHEET_PAY_DATE_OFFSET_DAYS,
    },
    { backCount: 10_000, forwardCount: 0, today }
  );

  return windows
    .filter((window) => window.start_date <= today)
    .map((window) => ({
      start: window.start_date,
      end: window.end_date,
      payDate: window.pay_date,
      inProgress: window.start_date <= today && today <= window.end_date,
    }))
    .reverse();
}
