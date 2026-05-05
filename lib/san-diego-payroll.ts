type SanDiegoHourSplit = {
  regularHours: number;
  overtimeHours: number;
  doubletimeHours: number;
};

export type SanDiegoHourlyBreakdown = SanDiegoHourSplit & {
  regularPay: number;
  overtimePay: number;
  doubletimePay: number;
  totalPay: number;
  blendedRate: number;
  weeklyOvertimeHoursConverted: number;
};

const roundHours = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

const roundMoney = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

export function splitSanDiegoHours(hours: number): SanDiegoHourSplit {
  const safeHours = Math.max(0, Number.isFinite(hours) ? hours : 0);
  return {
    regularHours: roundHours(Math.min(safeHours, 8)),
    overtimeHours: roundHours(Math.max(0, Math.min(safeHours, 12) - 8)),
    doubletimeHours: roundHours(Math.max(0, safeHours - 12)),
  };
}

export function getSanDiegoWeeklyOvertimeHoursToConvert(
  priorWeeklyHours: number,
  currentShiftHours: number
): number {
  const safePriorWeeklyHours = Math.max(0, Number.isFinite(priorWeeklyHours) ? priorWeeklyHours : 0);
  const safeCurrentShiftHours = Math.max(0, Number.isFinite(currentShiftHours) ? currentShiftHours : 0);
  const { regularHours } = splitSanDiegoHours(safeCurrentShiftHours);
  const weeklyOverage = Math.max(0, safePriorWeeklyHours + safeCurrentShiftHours - 40);
  return roundHours(Math.min(regularHours, weeklyOverage));
}

export function computeSanDiegoHourlyBreakdown(
  hours: number,
  baseRate: number,
  priorWeeklyHours = 0
): SanDiegoHourlyBreakdown {
  const safeHours = Math.max(0, Number.isFinite(hours) ? hours : 0);
  const safeBaseRate = Math.max(0, Number.isFinite(baseRate) ? baseRate : 0);
  const { regularHours, overtimeHours, doubletimeHours } = splitSanDiegoHours(safeHours);
  const weeklyOvertimeHoursConverted = getSanDiegoWeeklyOvertimeHoursToConvert(
    priorWeeklyHours,
    safeHours
  );

  const finalRegularHours = roundHours(Math.max(0, regularHours - weeklyOvertimeHoursConverted));
  const finalOvertimeHours = roundHours(overtimeHours + weeklyOvertimeHoursConverted);
  const regularPay = roundMoney(finalRegularHours * safeBaseRate);
  const overtimePay = roundMoney(finalOvertimeHours * safeBaseRate * 1.5);
  const doubletimePay = roundMoney(doubletimeHours * safeBaseRate * 2);
  const totalPay = roundMoney(regularPay + overtimePay + doubletimePay);

  return {
    regularHours: finalRegularHours,
    overtimeHours: finalOvertimeHours,
    doubletimeHours,
    regularPay,
    overtimePay,
    doubletimePay,
    totalPay,
    blendedRate: safeHours > 0 ? roundMoney(totalPay / safeHours) : safeBaseRate,
    weeklyOvertimeHoursConverted,
  };
}
