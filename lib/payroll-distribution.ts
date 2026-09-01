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
  // The actual sum of amountsById, in dollars, after cent rounding. For an
  // hours-prorated split this always equals totalAmount (largest-remainder
  // rounding reconciles to it exactly). For a genuine equal split, every
  // member is rounded UP to the same per-cent share so nobody is shortchanged
  // relative to a peer — when the pool doesn't divide evenly among members,
  // that means distributedTotal can exceed totalAmount by a cent or two.
  // Callers that display or persist "the pool" should use distributedTotal,
  // not the original totalAmount, so the recorded pool always matches what
  // was actually paid out.
  distributedTotal: number;
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
  // shortShiftThresholdHours: 0 means every eligible member lands in
  // distributePoolByHoursRule's pure equal-split branch under "equal" mode
  // (no short-shift exception for tips — mode is the only lever), which
  // already rounds to cents (see ceilEqualSplit) and reports the true
  // distributedTotal, so no extra rounding pass is needed here.
  return distributePoolByHoursRule({
    totalAmount,
    members,
    // Even split is the default; only an explicit "prorated" opts into hours-based.
    mode: mode === "prorated" ? "hours" : "equal",
    shortShiftThresholdHours: 0,
  });
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

const sumAmounts = (amountsById: Record<string, number>): number =>
  roundMoney(
    Object.values(amountsById).reduce((sum, amount) => sum + (Number.isFinite(amount) ? amount : 0), 0)
  );

/**
 * Split `totalAmount` evenly across `memberIds`, rounding every member's
 * share UP to the same next cent so all of them are paid an identical
 * amount — nobody gets shortchanged, and nobody gets paid more than a peer.
 * When the pool doesn't divide evenly among members, the ceiling means the
 * summed `distributedTotal` can exceed `totalAmount` by up to
 * (memberIds.length - 1) cents; callers should treat distributedTotal as
 * the real pool that was paid out and use it wherever "the pool" is shown
 * or saved, instead of quietly paying some members more than others just
 * to keep the total pinned at the original, non-divisible pool amount.
 */
export function ceilEqualSplit(
  totalAmount: number,
  memberIds: string[]
): { amountsById: Record<string, number>; distributedTotal: number } {
  const ids = Array.from(new Set(memberIds.filter((id) => !!id)));
  if (ids.length === 0) return { amountsById: {}, distributedTotal: 0 };

  const totalCents = Math.round(roundMoney(toPositiveNumber(totalAmount)) * 100);
  const perMemberCents = Math.ceil(totalCents / ids.length);
  const amountsById = Object.fromEntries(ids.map((id) => [id, perMemberCents / 100]));

  return { amountsById, distributedTotal: (perMemberCents * ids.length) / 100 };
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
      distributedTotal: 0,
    };
  }

  if (mode === "hours") {
    // Hours-prorated shares are already unequal by design, so reconciling
    // rounding drift back to the pool via largest-remainder (rather than
    // growing the pool) doesn't create any unfairness between members.
    const roundedAmounts = roundAmountsToCents(
      Object.fromEntries(
        eligibleMembers.map((member) => [member.id, safeTotalAmount * (member.hours / totalEligibleHours)])
      ),
      safeTotalAmount
    );
    return {
      amountsById: roundedAmounts,
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: false,
      distributedTotal: sumAmounts(roundedAmounts),
    };
  }

  const isShortShift = (member: { hours: number; forceEvenSplit?: boolean }) => {
    if (member.forceEvenSplit === true) return false;
    if (member.forceEvenSplit === false) return true;
    return member.hours < shortShiftThresholdHours;
  };
  const shortShiftMembers = eligibleMembers.filter(isShortShift);

  if (shortShiftMembers.length === 0) {
    const { amountsById, distributedTotal } = ceilEqualSplit(
      safeTotalAmount,
      eligibleMembers.map((member) => member.id)
    );
    return {
      amountsById,
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: false,
      distributedTotal,
    };
  }

  const hourlyRate = safeTotalAmount / totalEligibleHours;

  if (shortShiftMembers.length === eligibleMembers.length) {
    if (allShortShiftMode === "equal") {
      const { amountsById, distributedTotal } = ceilEqualSplit(
        safeTotalAmount,
        eligibleMembers.map((member) => member.id)
      );
      return {
        amountsById,
        eligibleCount: eligibleMembers.length,
        totalHours: totalEligibleHours,
        usedShortShiftRule: false,
        distributedTotal,
      };
    }

    const roundedAmounts = roundAmountsToCents(
      Object.fromEntries(eligibleMembers.map((member) => [member.id, hourlyRate * member.hours])),
      safeTotalAmount
    );
    return {
      amountsById: roundedAmounts,
      eligibleCount: eligibleMembers.length,
      totalHours: totalEligibleHours,
      usedShortShiftRule: true,
      distributedTotal: sumAmounts(roundedAmounts),
    };
  }

  // Mixed shift lengths: short-shift members are hours-prorated (unequal by
  // design, so reconciled to their own subtotal via largest-remainder, same
  // as the pure "hours" mode above) while full-shift members split whatever
  // remains evenly among themselves (ceil-rounded, so the pool grows by a
  // cent or two rather than paying one full-shift member more than another).
  const rawShortShiftTotal = shortShiftMembers.reduce((sum, member) => sum + hourlyRate * member.hours, 0);
  const roundedShortShiftAmounts = roundAmountsToCents(
    Object.fromEntries(shortShiftMembers.map((member) => [member.id, hourlyRate * member.hours])),
    rawShortShiftTotal
  );
  const shortShiftDistributedTotal = sumAmounts(roundedShortShiftAmounts);
  const fullShiftMembers = eligibleMembers.filter((member) => !isShortShift(member));
  const remainingAmount = Math.max(0, safeTotalAmount - shortShiftDistributedTotal);
  const { amountsById: fullShiftAmounts, distributedTotal: fullShiftDistributedTotal } = ceilEqualSplit(
    remainingAmount,
    fullShiftMembers.map((member) => member.id)
  );

  return {
    amountsById: { ...roundedShortShiftAmounts, ...fullShiftAmounts },
    eligibleCount: eligibleMembers.length,
    totalHours: totalEligibleHours,
    usedShortShiftRule: true,
    distributedTotal: roundMoney(shortShiftDistributedTotal + fullShiftDistributedTotal),
  };
}
