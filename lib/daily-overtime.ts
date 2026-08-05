// California daily overtime: 1.5x for hours worked 8-12 in a single calendar
// day, 2x beyond 12 in that day. Used for non-event ("special") timesheets,
// which are paid straight hourly with no commission pool, so overtime has to
// be computed per day from the actual clock-in/out data rather than derived
// from a weekly total.
export type DailyHourSplit = {
  regularHours: number;
  overtimeHours: number;
  doubletimeHours: number;
};

export type DailyPayBreakdown = DailyHourSplit & {
  date: string;
  hours: number;
  regularPay: number;
  overtimePay: number;
  doubletimePay: number;
  totalPay: number;
};

const roundHours = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

const roundMoney = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

export function splitDailyHours(hours: number): DailyHourSplit {
  const safeHours = Math.max(0, Number.isFinite(hours) ? hours : 0);
  return {
    regularHours: roundHours(Math.min(safeHours, 8)),
    overtimeHours: roundHours(Math.max(0, Math.min(safeHours, 12) - 8)),
    doubletimeHours: roundHours(Math.max(0, safeHours - 12)),
  };
}

export function computeDailyPayBreakdown(date: string, hours: number, baseRate: number): DailyPayBreakdown {
  const safeBaseRate = Number.isFinite(baseRate) ? baseRate : 0;
  const { regularHours, overtimeHours, doubletimeHours } = splitDailyHours(hours);
  const regularPay = roundMoney(regularHours * safeBaseRate);
  const overtimePay = roundMoney(overtimeHours * safeBaseRate * 1.5);
  const doubletimePay = roundMoney(doubletimeHours * safeBaseRate * 2);
  return {
    date,
    hours: roundHours(hours),
    regularHours,
    overtimeHours,
    doubletimeHours,
    regularPay,
    overtimePay,
    doubletimePay,
    totalPay: roundMoney(regularPay + overtimePay + doubletimePay),
  };
}

export function computeDailyBreakdownList(
  days: Array<{ date: string; hours: number }>,
  baseRate: number
): DailyPayBreakdown[] {
  return days.map((d) => computeDailyPayBreakdown(d.date, d.hours, baseRate));
}

export function sumDailyBreakdown(days: DailyPayBreakdown[]) {
  return days.reduce(
    (acc, d) => ({
      hours: roundHours(acc.hours + d.hours),
      regularHours: roundHours(acc.regularHours + d.regularHours),
      overtimeHours: roundHours(acc.overtimeHours + d.overtimeHours),
      doubletimeHours: roundHours(acc.doubletimeHours + d.doubletimeHours),
      regularPay: roundMoney(acc.regularPay + d.regularPay),
      overtimePay: roundMoney(acc.overtimePay + d.overtimePay),
      doubletimePay: roundMoney(acc.doubletimePay + d.doubletimePay),
      totalPay: roundMoney(acc.totalPay + d.totalPay),
    }),
    {
      hours: 0,
      regularHours: 0,
      overtimeHours: 0,
      doubletimeHours: 0,
      regularPay: 0,
      overtimePay: 0,
      doubletimePay: 0,
      totalPay: 0,
    }
  );
}
