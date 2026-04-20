export type PoolDistributionMode = "equal" | "hours";

export type PoolDistributionMember = {
  id: string;
  hours: number;
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
};

const toPositiveNumber = (value: number): number => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

export function distributePoolByHoursRule({
  totalAmount,
  members,
  mode = "equal",
  shortShiftThresholdHours = 8,
}: DistributePoolArgs): PoolDistributionResult {
  const mergedMembers = new Map<string, number>();

  for (const member of members) {
    const memberId = (member?.id || "").toString().trim();
    const memberHours = toPositiveNumber(member?.hours ?? 0);
    if (!memberId || memberHours <= 0) continue;
    mergedMembers.set(memberId, (mergedMembers.get(memberId) || 0) + memberHours);
  }

  const eligibleMembers = Array.from(mergedMembers.entries()).map(([id, hours]) => ({ id, hours }));
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

  const shortShiftMembers = eligibleMembers.filter((member) => member.hours < shortShiftThresholdHours);

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
  const fullShiftMembers = eligibleMembers.filter((member) => member.hours >= shortShiftThresholdHours);
  const remainingAmount = Math.max(0, safeTotalAmount - shortShiftTotal);
  const fullShiftShare = fullShiftMembers.length > 0 ? remainingAmount / fullShiftMembers.length : 0;

  return {
    amountsById: Object.fromEntries(
      eligibleMembers.map((member) => [
        member.id,
        member.hours < shortShiftThresholdHours ? shortShiftAmounts[member.id] || 0 : fullShiftShare,
      ])
    ),
    eligibleCount: eligibleMembers.length,
    totalHours: totalEligibleHours,
    usedShortShiftRule: true,
  };
}
