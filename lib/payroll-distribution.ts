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
  return distributePoolByHoursRule({
    totalAmount,
    members,
    // Even split is the default; only an explicit "prorated" opts into hours-based.
    mode: mode === "prorated" ? "hours" : "equal",
    // No short-shift exception for tips; the mode above is the only lever.
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
