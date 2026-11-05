// "Meal Premium" pay. An exec switches the Meal Premium toggle on for a worker on the
// /event-dashboard Timesheet tab (table event_meal_premiums) and picks which meal(s) it is for:
// Meal 1, Meal 2 and/or Meal 3. Each chosen meal pays that worker one extra hour at their
// Rate in Effect for the pay period, and never less than $28.50 an hour: a lower rate is
// overridden to $28.50. One meal = one hour (the old single toggle), two meals = two hours.
//
// The Rate in Effect is the one each payroll screen already shows for the row:
// - commission work in a period-rate state (CA, NV, WI): the pay period's rate in effect
//   (period commission / period hours, see lib/pay-period-commission);
// - other commission work (AZ, NY): the row's loaded rate;
// - hourly work (San Diego hourly, non-event timesheets, HR "Pay hourly"): the hourly rate.
// Shared by the event dashboard Payment tab, the HR dashboard Payroll tab and the paystub PDF.

/** Hours paid for each chosen meal. */
export const MEAL_PREMIUM_HOURS = 1;
export const MEAL_PREMIUM_MIN_RATE = 28.5;
/** Meals a premium can be for, matching the timesheet's M1 / M2 / M3 columns. */
export const MEAL_PREMIUM_MEAL_NUMBERS = [1, 2, 3] as const;

// eventId -> userId -> the meals the premium is for (sorted, at least one) for every worker
// whose Meal Premium toggle is on. Workers with it off are absent.
export type MealPremiumsByEvent = Record<string, Record<string, number[]>>;

const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

/**
 * The meals a premium is for: unique, sorted, only 1, 2 or 3. Anything else (null, a
 * non-array, out-of-range numbers) is dropped, so an empty result means "no meal premium".
 * `true` (an old-style on/off flag) reads as Meal 1, which is what the single toggle paid.
 */
export function normalizeMealPremiumMeals(value: unknown): number[] {
  if (value === true) return [1];
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/[{}]/g, "").split(",")
      : [];
  const meals = new Set<number>();
  for (const item of list) {
    const n = Number(typeof item === "string" ? item.trim() : item);
    if ((MEAL_PREMIUM_MEAL_NUMBERS as readonly number[]).includes(n)) meals.add(n);
  }
  return Array.from(meals).sort((a, b) => a - b);
}

/** Paid hours for these meals: one hour per chosen meal. */
export function getMealPremiumHours(meals: unknown): number {
  return normalizeMealPremiumMeals(meals).length * MEAL_PREMIUM_HOURS;
}

/** The hourly rate a meal premium is paid at: the Rate in Effect, or $28.50 when that is lower. */
export function getMealPremiumRate(rateInEffect: unknown): number {
  const rate = Number(rateInEffect);
  return roundMoney(Math.max(MEAL_PREMIUM_MIN_RATE, Number.isFinite(rate) ? rate : 0));
}

/**
 * Meal premium pay for one worker on one event: one hour at getMealPremiumRate for each chosen
 * meal, when the worker has hours on the event; otherwise 0.
 */
export function getMealPremiumPay({
  meals,
  hours,
  rateInEffect,
}: {
  meals: unknown;
  hours: unknown;
  rateInEffect: unknown;
}): number {
  const premiumHours = getMealPremiumHours(meals);
  if (premiumHours <= 0) return 0;
  const workedHours = Number(hours);
  if (!Number.isFinite(workedHours) || workedHours <= 0) return 0;
  return roundMoney(getMealPremiumRate(rateInEffect) * premiumHours);
}

/** "Meal 2", "Meals 1 & 2", "Meals 1, 2 & 3"; "" when there is no meal premium. */
export function formatMealPremiumMeals(meals: unknown): string {
  const list = normalizeMealPremiumMeals(meals);
  if (list.length === 0) return "";
  if (list.length === 1) return `Meal ${list[0]}`;
  return `Meals ${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`;
}

/** Short form for tight cells: "M2", "M1+M2". */
export function formatMealPremiumMealsShort(meals: unknown): string {
  return normalizeMealPremiumMeals(meals)
    .map((n) => `M${n}`)
    .join("+");
}

/** The meals this worker's premium is for on this event ([] when the toggle is off). */
export const getMealPremiumMeals = (
  premiums: MealPremiumsByEvent | null | undefined,
  eventId: unknown,
  userId: unknown
): number[] => {
  const e = (eventId ?? "").toString();
  const u = (userId ?? "").toString();
  if (!e || !u) return [];
  return normalizeMealPremiumMeals(premiums?.[e]?.[u]);
};

export const isMealPremiumOn = (
  premiums: MealPremiumsByEvent | null | undefined,
  eventId: unknown,
  userId: unknown
): boolean => getMealPremiumMeals(premiums, eventId, userId).length > 0;
