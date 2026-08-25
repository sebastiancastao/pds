export type PoolDistributionMode = "equal" | "hours";
export type AllShortShiftMode = "equal" | "hours";

export const ALL_SHORT_SHIFT_EQUAL_DATE = "2025-05-11";

export function shortShiftModeForDate(eventDate?: string | null): AllShortShiftMode {
  if (!eventDate) return "hours";
  return eventDate.toString().split("T")[0] >= ALL_SHORT_SHIFT_EQUAL_DATE ? "equal" : "hours";
}

export type PoolDistributionMember = {
  id: string;
  hours: number;
  // Manual per-member override of the short-shift proration rule: true forces
  // this member into the equal-split bucket, false forces them into the
  // hours-prorated bucket, undefined defers to the hours-vs-threshold rule.
  forceEvenSplit?: boolean;
};

export type PoolDistributionResult = {
  amountsById: Record<string, number>;
  eligibleCount: number;
  totalHours: number;
  usedShortShiftRule: boolean;
};

type DistributePoolArgs = {
  totalAmount: number;
  members: PoolDistributionMember[];
  mode?: PoolDistributionMode;
  shortShiftThresholdHours?: number;
  allShortShiftMode?: AllShortShiftMode;
};

// Tips distribution is a manual per-event choice (events.tips_distribution_mode),
// independent of the short-shift proration rule used for commissions above.
// "equal" (default): pool split evenly among eligible staff, regardless of hours.
// "prorated": pool split proportionally by hours worked — an explicit opt-in.
export type TipsDistributionMode = "equal" | "prorated";

type DistributeTipsArgs = {
  totalAmount: number;
  members: PoolDistributionMember[];
  mode?: TipsDistributionMode | string | null;
};

export function distributeTipsPool({ totalAmount, members, mode }: DistributeTipsArgs): PoolDistributionResult {
  const result = distributePoolByHoursRule({
    totalAmount,
    members,
    // Even split is the default; only an explicit "prorated" opts into hours-based.
    mode: mode === "prorated" ? "hours" : "equal",
    // No short-shift exception for tips; the mode above is the only lever.
    shortShiftThresholdHours: 0,
  });
  // Reconcile independent per-member cents back to the pool total via the same
  // largest-remainder rounding already used for commission splits (see
  // roundAmountsToCents). Without this, every caller rounds each member's raw
  // share to cents on its own, which can drift the displayed/saved total a few
  // cents from totalAmount — most visibly under Even Split, where every
  // member's raw share is identical so the drift compounds in one direction
  // instead of partially canceling like a prorated split's varied shares do.
  const safeTotal = toPositiveNumber(totalAmount);
  return {
    ...result,
    amountsById: safeTotal > 0 ? roundAmountsToCents(result.amountsById, safeTotal) : result.amountsById,
  };
}

export function tipsDistributionModeLabel(mode?: string | null): "Even Split" | "Prorated" {
  return mode === "prorated" ? "Prorated" : "Even Split";
}

const toPositiveNumber = (value: number): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

const roundMoney = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

/**
 * Round a set of dollar amounts (e.g. distributePoolByHoursRule's per-member
 * shares) to the nearest cent so they sum to exactly `totalAmount` (rounded to
 * cents), using a largest-remainder allocation. Rounding each member's share
 * independently (plain Math.round per entry) can drift the summed total away
 * from the pool by a few cents once there are more than a couple of members —
 * this is what showed up as the commission split total not matching the pool
 * percentage on the sales tab.
 */
export function roundAmountsToCents(
  amountsById: Record<string, number>,
  totalAmount: number
): Record<string, number> {
  const entries = Object.entries(amountsById);
  if (entries.length === 0) return {};

  const totalCents = Math.round(roundMoney(totalAmount) * 100);

  if (entries.length === 1) {
    return { [entries[0][0]]: totalCents / 100 };
  }

  const withCents = entries.map(([id, amount]) => {
    const rawCents = (Number.isFinite(amount) ? amount : 0) * 100;
    const floorCents = Math.floor(rawCents);
    return { id, floorCents, remainder: rawCents - floorCents };
  });

  let remainingCents = totalCents - withCents.reduce((sum, entry) => sum + entry.floorCents, 0);
  const order = [...withCents].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.id.localeCompare(b.id);
  });

  if (remainingCents > 0) {
    for (let index = 0; index < order.length && remainingCents > 0; index += 1) {
      order[index].floorCents += 1;
      remainingCents -= 1;
    }
  } else if (remainingCents < 0) {
    // Only reachable via floating-point noise (floors should never exceed the
    // total in the common case); take back cents from the smallest remainders.
    for (let index = order.length - 1; index >= 0 && remainingCents < 0; index -= 1) {
      order[index].floorCents -= 1;
      remainingCents += 1;
    }
  }

  return Object.fromEntries(withCents.map((entry) => [entry.id, entry.floorCents / 100]));
}

export function distributePoolByHoursRule({
  totalAmount,
  members,
  mode = "equal",
  shortShiftThresholdHours = 8,
  allShortShiftMode = "hours",
}: DistributePoolArgs): PoolDistributionResult {
  const mergedMembers = new Map<string, { hours: number; forceEvenSplit?: boolean }>();

  for (const member of members) {
    const memberId = (member?.id || "").toString().trim();
    const memberHours = toPositiveNumber(member?.hours ?? 0);
    if (!memberId || memberHours <= 0) continue;
    const existing = mergedMembers.get(memberId);
    // Tri-state merge across duplicate entries for the same member: an explicit
    // "force even" anywhere wins, otherwise an explicit "force prorated" wins,
    // otherwise defer to auto (undefined).
    const mergedOverride =
      existing?.forceEvenSplit === true || member?.forceEvenSplit === true
        ? true
        : existing?.forceEvenSplit === false || member?.forceEvenSplit === false
        ? false
        : undefined;
    mergedMembers.set(memberId, {
      hours: (existing?.hours || 0) + memberHours,
      forceEvenSplit: mergedOverride,
    });
  }

  const eligibleMembers = Array.from(mergedMembers.entries()).map(([id, value]) => ({
    id,
    hours: value.hours,
    forceEvenSplit: value.forceEvenSplit,
  }));
  const totalEligibleHours = eligibleMembers.reduce((sum, member) => sum + member.hours, 0);
  const safeTotalAmount = toPositiveNumber(totalAmount);
  const zeroAmounts = Object.fromEntries(eligibleMembers.map((member) => [member.id, 0]));

  if (safeTotalAmount <= 0 || eligibleMembers.length === 0 || totalEligibleHours <= 0) {
    return {
      amountsById: zeroAmounts,
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: false,
    };
  }

  if (mode === "hours") {
    return {
      amountsById: Object.fromEntries(
        eligibleMembers.map((member) => [member.id, safeTotalAmount * (member.hours / totalEligibleHours)])
      ),
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: false,
    };
  }

  const isShortShift = (member: { hours: number; forceEvenSplit?: boolean }) => {
    if (member.forceEvenSplit === true) return false;
    if (member.forceEvenSplit === false) return true;
    return member.hours < shortShiftThresholdHours;
  };
  const shortShiftMembers = eligibleMembers.filter(isShortShift);

  if (shortShiftMembers.length === 0) {
    const equalShare = safeTotalAmount / eligibleMembers.length;
    return {
      amountsById: Object.fromEntries(eligibleMembers.map((member) => [member.id, equalShare])),
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: false,
    };
  }

  const hourlyRate = safeTotalAmount / totalEligibleHours;

  if (shortShiftMembers.length === eligibleMembers.length) {
    if (allShortShiftMode === "equal") {
      const equalShare = safeTotalAmount / eligibleMembers.length;
      return {
        amountsById: Object.fromEntries(eligibleMembers.map((member) => [member.id, equalShare])),
        eligibleCount: eligibleMembers.length,
        totalHours: totalEligibleHours,
        usedShortShiftRule: false,
      };
    }

    return {
      amountsById: Object.fromEntries(eligibleMembers.map((member) => [member.id, hourlyRate * member.hours])),
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: true,
    };
  }

  const shortShiftAmounts = Object.fromEntries(
    shortShiftMembers.map((member) => [member.id, hourlyRate * member.hours])
  );
  const shortShiftTotal = Object.values(shortShiftAmounts).reduce((sum, amount) => sum + amount, 0);
  const fullShiftMembers = eligibleMembers.filter((member) => !isShortShift(member));
  const remainingAmount = Math.max(0, safeTotalAmount - shortShiftTotal);
  const fullShiftShare = fullShiftMembers.length > 0 ? remainingAmount / fullShiftMembers.length : 0;

  return {
    amountsById: Object.fromEntries(
      eligibleMembers.map((member) => [
        member.id,
        isShortShift(member) ? shortShiftAmounts[member.id] || 0 : fullShiftShare,
      ])
    ),
    eligibleCount: eligibleMembers.length,
    totalHours: totalEligibleHours,
    usedShortShiftRule: true,
  };
}
