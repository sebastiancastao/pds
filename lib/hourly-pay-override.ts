import { getSanDiegoWeeklyOvertimeHoursToConvert, splitSanDiegoHours } from "./san-diego-payroll";

// "Pay hourly instead of commission" on the /hr-dashboard Payroll tab. HR switches it on for
// a vendor whose Commission Pay is under 50% of Commission Pay + Variable Incentive, and that
// vendor's commission events in the loaded period are then paid hourly like a San Diego shift:
// no pool share, no variable incentive top-up, no separate rest break pay. Saved per event and
// vendor in public.payroll_hourly_overrides with the rate in force when HR switched it on.
//
// California pays $28.50/hr (user rule, 2026-10-29) with daily overtime (over 8h at 1.5x,
// over 12h at 2x) plus weekly overtime past 40h, the same split San Diego hourly shifts use.
// Other states use the wage floor the commission calculation already guarantees there
// ($25.92) with weekly overtime past 40h only.

export const HOURLY_OVERRIDE_RATE_CA = 28.5;
export const HOURLY_OVERRIDE_RATE_OTHER_STATES = 25.92;

const normalizeState = (value?: string | null): string => (value || "").toString().trim().toUpperCase();

export function getHourlyOverrideRate(state?: string | null): number {
  return normalizeState(state) === "CA" ? HOURLY_OVERRIDE_RATE_CA : HOURLY_OVERRIDE_RATE_OTHER_STATES;
}

export type HourlyOverrideBreakdown = {
  regularHours: number;
  overtimeHours: number;
  doubletimeHours: number;
  regularPay: number;
  overtimePay: number;
  doubletimePay: number;
  totalPay: number;
  blendedRate: number;
};

const roundHours = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;
const roundMoney = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

// `priorWeeklyHours` = hours already worked Monday through the day before this shift
// (from /api/weekly-hours), so weekly overtime past 40h lands on the right shift.
export function computeHourlyOverrideBreakdown(
  hours: number,
  rate: number,
  priorWeeklyHours: number,
  state?: string | null
): HourlyOverrideBreakdown {
  const safeHours = Math.max(0, Number.isFinite(hours) ? hours : 0);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : getHourlyOverrideRate(state);
  const safePrior = Math.max(0, Number.isFinite(priorWeeklyHours) ? priorWeeklyHours : 0);

  let regularHours: number;
  let overtimeHours: number;
  let doubletimeHours: number;
  if (normalizeState(state) === "CA") {
    const split = splitSanDiegoHours(safeHours);
    const weeklyConverted = getSanDiegoWeeklyOvertimeHoursToConvert(safePrior, safeHours);
    regularHours = roundHours(Math.max(0, split.regularHours - weeklyConverted));
    overtimeHours = roundHours(split.overtimeHours + weeklyConverted);
    doubletimeHours = split.doubletimeHours;
  } else {
    regularHours = roundHours(Math.min(safeHours, Math.max(0, 40 - safePrior)));
    overtimeHours = roundHours(safeHours - regularHours);
    doubletimeHours = 0;
  }

  const regularPay = roundMoney(regularHours * safeRate);
  const overtimePay = roundMoney(overtimeHours * safeRate * 1.5);
  const doubletimePay = roundMoney(doubletimeHours * safeRate * 2);
  const totalPay = roundMoney(regularPay + overtimePay + doubletimePay);
  return {
    regularHours,
    overtimeHours,
    doubletimeHours,
    regularPay,
    overtimePay,
    doubletimePay,
    totalPay,
    blendedRate: safeHours > 0 ? roundMoney(totalPay / safeHours) : safeRate,
  };
}
