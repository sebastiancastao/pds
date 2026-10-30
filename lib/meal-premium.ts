// "Meal Premium" pay. An exec switches the Meal Premium toggle on for a worker on the
// /event-dashboard Timesheet tab (table event_meal_premiums). Each event where it is on pays
// that worker one extra hour at their Rate in Effect for the pay period, and never less than
// $28.50 an hour: a lower rate is overridden to $28.50.
//
// The Rate in Effect is the one each payroll screen already shows for the row:
// - commission work in a period-rate state (CA, NV, WI): the pay period's rate in effect
//   (period commission / period hours, see lib/pay-period-commission);
// - other commission work (AZ, NY): the row's loaded rate;
// - hourly work (San Diego hourly, non-event timesheets, HR "Pay hourly"): the hourly rate.
// Shared by the event dashboard Payment tab, the HR dashboard Payroll tab and the paystub PDF.

export const MEAL_PREMIUM_HOURS = 1;
export const MEAL_PREMIUM_MIN_RATE = 28.5;

// eventId -> userId -> true for every worker whose Meal Premium toggle is on.
export type MealPremiumsByEvent = Record<string, Record<string, true>>;

const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

/** The hourly rate a meal premium is paid at: the Rate in Effect, or $28.50 when that is lower. */
export function getMealPremiumRate(rateInEffect: unknown): number {
  const rate = Number(rateInEffect);
  return roundMoney(Math.max(MEAL_PREMIUM_MIN_RATE, Number.isFinite(rate) ? rate : 0));
}

/**
 * Meal premium pay for one worker on one event: one hour at getMealPremiumRate when the toggle
 * is on and the worker has hours on the event, otherwise 0.
 */
export function getMealPremiumPay({
  on,
  hours,
  rateInEffect,
}: {
  on: unknown;
  hours: unknown;
  rateInEffect: unknown;
}): number {
  if (on !== true) return 0;
  const workedHours = Number(hours);
  if (!Number.isFinite(workedHours) || workedHours <= 0) return 0;
  return roundMoney(getMealPremiumRate(rateInEffect) * MEAL_PREMIUM_HOURS);
}

export const isMealPremiumOn = (
  premiums: MealPremiumsByEvent | null | undefined,
  eventId: unknown,
  userId: unknown
): boolean => {
  const e = (eventId ?? "").toString();
  const u = (userId ?? "").toString();
  if (!e || !u) return false;
  return premiums?.[e]?.[u] === true;
};
