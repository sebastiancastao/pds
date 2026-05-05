import { distributePoolByHoursRule } from "./payroll-distribution";

export const PERIOD_RATE_MINIMUM = 28.5;
export const PERIOD_RATE_STATES = ["CA", "NV", "WI"] as const;
export const PERIOD_RATE_MINIMUM_BY_STATE: Record<PeriodRateState, number> = {
  CA: 28.5,
  NV: 25.92,
  WI: 25.92,
};

export type PeriodRateState = (typeof PERIOD_RATE_STATES)[number];

export type PayPeriodCommissionWorkerInput = {
  userId: string;
  division?: string | null;
  hours: number;
  commissionDeleted?: boolean;
  commissionOverride?: number | null;
};

export type PayPeriodCommissionEventInput = {
  eventId: string;
  state?: string | null;
  commissionPoolDollars: number;
  workers: PayPeriodCommissionWorkerInput[];
};

export type PayPeriodCommissionWorkerResult = {
  stateCode: string;
  usesPeriodRate: boolean;
  isVendor: boolean;
  isTrailers: boolean;
  eligibleForPeriodRate: boolean;
  commissionDeleted: boolean;
  commissionOverride: number | null;
  hours: number;
  commissionShare: number;
  rateInEffect: number;
  commissionPay: number;
  baseCommissionPay: number;
  variableIncentive: number;
  commissionPaidTotal: number;
};

export type PayPeriodCommissionUserTotals = {
  rateInEffect: number;
  totalHours: number;
  totalCommissionShare: number;
  totalCommissionPay: number;
  totalVariableIncentive: number;
  totalCommissionPaidTotal: number;
};

export type PayPeriodCommissionResult = {
  byEvent: Record<string, Record<string, PayPeriodCommissionWorkerResult>>;
  byUser: Record<string, PayPeriodCommissionUserTotals>;
};

type EligiblePeriodRow = {
  eventId: string;
  userId: string;
  hours: number;
  commissionShare: number;
};

const roundMoney = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

const toCents = (value: number): number => Math.round(roundMoney(value) * 100);
const fromCents = (value: number): number => roundMoney(value / 100);

const normalizeState = (value?: string | null): string =>
  (value || "").toString().trim().toUpperCase();

const normalizeDivision = (value?: string | null): string =>
  (value || "").toString().trim().toLowerCase();

export const isPeriodRateState = (value?: string | null): value is PeriodRateState =>
  PERIOD_RATE_STATES.includes(normalizeState(value) as PeriodRateState);

export const getPeriodRateMinimum = (
  value?: string | null,
  fallback = PERIOD_RATE_MINIMUM
): number => {
  const stateCode = normalizeState(value);
  return isPeriodRateState(stateCode)
    ? PERIOD_RATE_MINIMUM_BY_STATE[stateCode]
    : fallback;
};

export const isTrailersDivision = (value?: string | null): boolean =>
  normalizeDivision(value) === "trailers";

export const isVendorDivision = (value?: string | null): boolean => {
  const division = normalizeDivision(value);
  return division === "vendor" || division === "both";
};

const allocateRoundedAmounts = (
  entries: Array<{ key: string; amount: number }>
): Record<string, number> => {
  if (entries.length === 0) return {};

  const normalized = entries.map((entry, index) => {
    const exactCents = Math.max(0, Number(entry.amount || 0)) * 100;
    const floorCents = Math.floor(exactCents + 1e-9);
    return {
      key: entry.key,
      index,
      exactCents,
      floorCents,
      remainder: exactCents - floorCents,
    };
  });

  const targetCents = Math.max(
    0,
    Math.round(
      normalized.reduce((sum, entry) => sum + entry.exactCents, 0) + 1e-9
    )
  );
  const floorTotal = normalized.reduce((sum, entry) => sum + entry.floorCents, 0);
  let centsToDistribute = Math.max(0, targetCents - floorTotal);

  normalized.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  });

  const result: Record<string, number> = {};
  for (const entry of normalized) {
    const extraCent = centsToDistribute > 0 ? 1 : 0;
    if (centsToDistribute > 0) centsToDistribute -= 1;
    result[entry.key] = fromCents(entry.floorCents + extraCent);
  }

  return result;
};

export function computePayPeriodCommission({
  events,
  minimumRate = PERIOD_RATE_MINIMUM,
}: {
  events: PayPeriodCommissionEventInput[];
  minimumRate?: number;
}): PayPeriodCommissionResult {
  const byEvent: Record<string, Record<string, PayPeriodCommissionWorkerResult>> = {};
  const eligiblePeriodRowsByUser: Record<string, EligiblePeriodRow[]> = {};

  for (const event of events) {
    const eventId = (event?.eventId || "").toString();
    if (!eventId) continue;

    const stateCode = normalizeState(event.state);
    const usesPeriodRate = isPeriodRateState(stateCode);
    const members = Array.isArray(event.workers) ? event.workers : [];

    const commissionSharesByUser = distributePoolByHoursRule({
      totalAmount: Number(event.commissionPoolDollars || 0),
      members: members.flatMap((worker) => {
        const userId = (worker?.userId || "").toString();
        const hours = Number(worker?.hours || 0);
        if (
          !userId ||
          !isVendorDivision(worker?.division) ||
          isTrailersDivision(worker?.division) ||
          worker?.commissionDeleted === true ||
          hours <= 0
        ) {
          return [];
        }

        return [{ id: userId, hours }];
      }),
      allShortShiftMode: "equal",
    }).amountsById;

    byEvent[eventId] = {};

    for (const worker of members) {
      const userId = (worker?.userId || "").toString();
      if (!userId) continue;

      const hours = roundMoney(Number(worker?.hours || 0));
      const commissionDeleted = worker?.commissionDeleted === true;
      const commissionOverride =
        worker?.commissionOverride != null &&
        Number.isFinite(Number(worker.commissionOverride))
          ? roundMoney(Number(worker.commissionOverride))
          : null;
      const isVendor = isVendorDivision(worker?.division);
      const isTrailers = isTrailersDivision(worker?.division);
      const commissionShare = roundMoney(Number(commissionSharesByUser[userId] || 0));
      const eligibleForPeriodRate =
        usesPeriodRate &&
        isVendor &&
        !isTrailers &&
        !commissionDeleted &&
        hours > 0 &&
        commissionShare > 0;

      byEvent[eventId][userId] = {
        stateCode,
        usesPeriodRate,
        isVendor,
        isTrailers,
        eligibleForPeriodRate,
        commissionDeleted,
        commissionOverride,
        hours,
        commissionShare,
        rateInEffect: 0,
        commissionPay: 0,
        baseCommissionPay: 0,
        variableIncentive: 0,
        commissionPaidTotal: 0,
      };

      if (eligibleForPeriodRate) {
        if (!eligiblePeriodRowsByUser[userId]) eligiblePeriodRowsByUser[userId] = [];
        eligiblePeriodRowsByUser[userId].push({
          eventId,
          userId,
          hours,
          commissionShare,
        });
      }
    }
  }

  const byUser: Record<string, PayPeriodCommissionUserTotals> = {};

  for (const [userId, rows] of Object.entries(eligiblePeriodRowsByUser)) {
    const totalHours = roundMoney(rows.reduce((sum, row) => sum + row.hours, 0));
    const totalCommissionShare = roundMoney(
      rows.reduce((sum, row) => sum + row.commissionShare, 0)
    );
    const rateInEffect = totalHours > 0 ? totalCommissionShare / totalHours : 0;

    const baseVariableIncentiveByEvent = allocateRoundedAmounts(
      rows.map((row) => {
        const eventEntry = byEvent[row.eventId]?.[userId];
        const minimumRateForEvent = getPeriodRateMinimum(eventEntry?.stateCode, minimumRate);
        return {
          key: row.eventId,
          amount: Math.max(0, (minimumRateForEvent - rateInEffect) * row.hours),
        };
      })
    );

    let totalCommissionPay = 0;
    let totalVariableIncentive = 0;

    for (const row of rows) {
      const eventEntry = byEvent[row.eventId]?.[userId];
      if (!eventEntry) continue;

      // Keep the actual event commission share intact.
      // Only the minimum-rate shortfall is spread by event hours across the period.
      const baseCommissionPay = roundMoney(row.commissionShare);
      const commissionPayCents = toCents(baseCommissionPay);
      const baseVariableCents = toCents(
        Number(baseVariableIncentiveByEvent[row.eventId] || 0)
      );
      const overrideCents =
        eventEntry.commissionOverride != null ? toCents(eventEntry.commissionOverride) : 0;
      const variableIncentive = fromCents(baseVariableCents + overrideCents);
      const commissionPay = fromCents(commissionPayCents);
      const commissionPaidTotal = roundMoney(commissionPay + variableIncentive);

      eventEntry.rateInEffect = rateInEffect;
      eventEntry.baseCommissionPay = baseCommissionPay;
      eventEntry.commissionPay = commissionPay;
      eventEntry.variableIncentive = variableIncentive;
      eventEntry.commissionPaidTotal = commissionPaidTotal;

      totalCommissionPay += commissionPay;
      totalVariableIncentive += variableIncentive;
    }

    byUser[userId] = {
      rateInEffect,
      totalHours,
      totalCommissionShare,
      totalCommissionPay: roundMoney(totalCommissionPay),
      totalVariableIncentive: roundMoney(totalVariableIncentive),
      totalCommissionPaidTotal: roundMoney(totalCommissionPay + totalVariableIncentive),
    };
  }

  for (const eventWorkers of Object.values(byEvent)) {
    for (const [userId, workerResult] of Object.entries(eventWorkers)) {
      if (!workerResult.usesPeriodRate) continue;

      const userTotals = byUser[userId];
      workerResult.rateInEffect = userTotals?.rateInEffect || 0;

      if (workerResult.commissionDeleted) {
        workerResult.baseCommissionPay = 0;
        workerResult.commissionPay = 0;
        workerResult.variableIncentive = 0;
        workerResult.commissionPaidTotal = 0;
        continue;
      }

      if (!workerResult.eligibleForPeriodRate) {
        const minimumRateForEvent = getPeriodRateMinimum(workerResult.stateCode, minimumRate);
        const isMinimumGuaranteeRow =
          workerResult.isVendor &&
          !workerResult.isTrailers &&
          workerResult.hours > 0 &&
          workerResult.commissionShare <= 0;

        if (isMinimumGuaranteeRow) {
          const guaranteedCommissionPay = roundMoney(minimumRateForEvent * workerResult.hours);
          const overrideCents =
            workerResult.commissionOverride != null ? toCents(workerResult.commissionOverride) : 0;
          const variableIncentive = fromCents(overrideCents);

          workerResult.rateInEffect = minimumRateForEvent;
          workerResult.baseCommissionPay = guaranteedCommissionPay;
          workerResult.commissionPay = guaranteedCommissionPay;
          workerResult.variableIncentive = variableIncentive;
          workerResult.commissionPaidTotal = roundMoney(
            guaranteedCommissionPay + variableIncentive
          );
          continue;
        }

        workerResult.baseCommissionPay = 0;
        workerResult.commissionPay = 0;
        workerResult.variableIncentive = 0;
        workerResult.commissionPaidTotal = 0;
      }
    }
  }

  return { byEvent, byUser };
}
