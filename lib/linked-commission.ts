import { distributePoolByHoursRule, roundAmountsToCents, shortShiftModeForDate } from "./payroll-distribution";

export type LinkedCommissionWorkerInput = {
  userId: string;
  division?: string | null;
  hours: number;
  commissionDeleted?: boolean;
  // Manual per-vendor override: true forces this worker into the equal-split
  // bucket, false forces the hours-prorated bucket, undefined is auto.
  forceEvenSplit?: boolean;
};

export type LinkedCommissionEventInput = {
  eventId: string;
  linkedCommissionEventId?: string | null;
  eventDate?: string | null;
  commissionPoolDollars: number;
  workers: LinkedCommissionWorkerInput[];
};

export type LinkedCommissionGroupResult = {
  eventIds: string[];
  totalCommissionPoolDollars: number;
  commissionShareByUserId: Record<string, number>;
  commissionShareByEventId: Record<string, Record<string, number>>;
  totalHoursByUserId: Record<string, number>;
};

export type LinkedCommissionDistributionResult = {
  groupsByKey: Record<string, LinkedCommissionGroupResult>;
  groupKeyByEventId: Record<string, string>;
  groupEventIdsByEventId: Record<string, string[]>;
  groupPoolByEventId: Record<string, number>;
  commissionShareByEventId: Record<string, Record<string, number>>;
};

const roundMoney = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;

const toCents = (value: number): number =>
  Math.round(roundMoney(value) * 100);

const fromCents = (value: number): number =>
  roundMoney(value / 100);

const normalizeId = (value?: string | null): string =>
  (value || "").toString().trim();

const normalizeDivision = (value?: string | null): string =>
  (value || "").toString().trim().toLowerCase();

const isVendorDivision = (value?: string | null): boolean => {
  const division = normalizeDivision(value);
  return division === "vendor" || division === "both";
};

const isEligibleCommissionWorker = (worker: LinkedCommissionWorkerInput): boolean => {
  const userId = normalizeId(worker?.userId);
  const hours = Number(worker?.hours || 0);
  return (
    userId.length > 0 &&
    isVendorDivision(worker?.division) &&
    worker?.commissionDeleted !== true &&
    hours > 0
  );
};

const buildConnectedGroups = (events: LinkedCommissionEventInput[]): string[][] => {
  const eventIds = events.map((event) => normalizeId(event?.eventId)).filter(Boolean);
  const eventIdSet = new Set(eventIds);
  const adjacency = new Map<string, Set<string>>();

  for (const eventId of eventIds) {
    adjacency.set(eventId, new Set([eventId]));
  }

  for (const event of events) {
    const eventId = normalizeId(event?.eventId);
    const linkedEventId = normalizeId(event?.linkedCommissionEventId);
    if (!eventId || !linkedEventId || !eventIdSet.has(linkedEventId) || linkedEventId === eventId) {
      continue;
    }
    adjacency.get(eventId)?.add(linkedEventId);
    adjacency.get(linkedEventId)?.add(eventId);
  }

  const visited = new Set<string>();
  const groups: string[][] = [];

  for (const eventId of eventIds) {
    if (visited.has(eventId)) continue;
    const stack = [eventId];
    const group = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      group.add(current);

      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }

    groups.push(Array.from(group).sort());
  }

  return groups;
};

const allocateShareAcrossEvents = (
  totalShare: number,
  eventHoursByEventId: Record<string, number>
): Record<string, number> => {
  const entries = Object.entries(eventHoursByEventId).filter(([, hours]) => Number(hours) > 0);
  if (entries.length === 0) return {};
  if (entries.length === 1) {
    return { [entries[0][0]]: roundMoney(totalShare) };
  }

  const totalCents = toCents(totalShare);
  const totalHours = entries.reduce((sum, [, hours]) => sum + Number(hours || 0), 0);
  if (totalCents <= 0 || totalHours <= 0) {
    return Object.fromEntries(entries.map(([eventId]) => [eventId, 0]));
  }

  const allocations = entries.map(([eventId, hours]) => {
    const weight = Number(hours || 0);
    const rawCents = (totalCents * weight) / totalHours;
    const floorCents = Math.floor(rawCents);
    return {
      eventId,
      floorCents,
      remainder: rawCents - floorCents,
    };
  });

  let remainingCents = totalCents - allocations.reduce((sum, entry) => sum + entry.floorCents, 0);
  allocations.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.eventId.localeCompare(b.eventId);
  });

  for (let index = 0; index < allocations.length && remainingCents > 0; index += 1) {
    allocations[index].floorCents += 1;
    remainingCents -= 1;
  }

  return Object.fromEntries(
    allocations.map((entry) => [entry.eventId, fromCents(entry.floorCents)])
  );
};

export function buildLinkedCommissionDistribution({
  events,
}: {
  events: LinkedCommissionEventInput[];
}): LinkedCommissionDistributionResult {
  const normalizedEvents = (Array.isArray(events) ? events : []).filter(
    (event) => normalizeId(event?.eventId).length > 0
  );

  const eventById = new Map<string, LinkedCommissionEventInput>(
    normalizedEvents.map((event) => [normalizeId(event.eventId), event])
  );

  const groupsByKey: Record<string, LinkedCommissionGroupResult> = {};
  const groupKeyByEventId: Record<string, string> = {};
  const groupEventIdsByEventId: Record<string, string[]> = {};
  const groupPoolByEventId: Record<string, number> = {};
  const commissionShareByEventId: Record<string, Record<string, number>> = {};

  for (const event of normalizedEvents) {
    commissionShareByEventId[normalizeId(event.eventId)] = {};
  }

  for (const eventIds of buildConnectedGroups(normalizedEvents)) {
    const groupEvents = eventIds
      .map((eventId) => eventById.get(eventId))
      .filter((event): event is LinkedCommissionEventInput => Boolean(event));
    const groupKey = eventIds.join(":");
    const totalCommissionPoolDollars = roundMoney(
      groupEvents.reduce((sum, event) => sum + Number(event?.commissionPoolDollars || 0), 0)
    );
    const isSharedCommissionGroup = eventIds.length > 1;

    const totalHoursByUserId: Record<string, number> = {};
    const commissionShareByEventIdForGroup: Record<string, Record<string, number>> = {};
    for (const eventId of eventIds) {
      commissionShareByEventIdForGroup[eventId] = {};
    }
    let commissionShareByUserId: Record<string, number> = {};

    if (isSharedCommissionGroup) {
      // Shared/linked commission: every eligible (event, vendor) SLOT across the combined
      // group gets an equal flat dollar amount — sharedPool / totalSlotCount — not a
      // per-user total that then gets re-allocated across that user's events by hours. A
      // vendor working both linked events therefore gets paid twice (once per event they
      // worked), each time the same flat per-slot amount, rather than one combined total
      // split between the two rows by hours worked. An explicit per-row "Prorated" override
      // (forceEvenSplit === false, set via the event-dashboard Payment tab toggle) carves
      // just that one slot out into hours-prorated pay at the group's blended hourly rate;
      // the remaining pool is still split flatly among every other slot.
      type Slot = { eventId: string; userId: string; hours: number; forceEvenSplit?: boolean };
      const slots: Slot[] = [];
      for (const event of groupEvents) {
        const eventId = normalizeId(event.eventId);
        for (const worker of Array.isArray(event.workers) ? event.workers : []) {
          if (!isEligibleCommissionWorker(worker)) continue;
          const userId = normalizeId(worker.userId);
          const hours = Number(worker.hours || 0);
          totalHoursByUserId[userId] = Number(totalHoursByUserId[userId] || 0) + hours;
          slots.push({ eventId, userId, hours, forceEvenSplit: worker.forceEvenSplit });
        }
      }

      const totalHours = slots.reduce((sum, slot) => sum + slot.hours, 0);
      const blendedHourlyRate = totalHours > 0 ? totalCommissionPoolDollars / totalHours : 0;

      const slotKey = (slot: Slot): string => `${slot.eventId}::${slot.userId}`;
      const slotAmountsByKey: Record<string, number> = {};
      let proratedTotal = 0;
      const evenSlotKeys: string[] = [];
      for (const slot of slots) {
        if (slot.forceEvenSplit === false) {
          const amount = blendedHourlyRate * slot.hours;
          slotAmountsByKey[slotKey(slot)] = amount;
          proratedTotal += amount;
        } else {
          evenSlotKeys.push(slotKey(slot));
        }
      }
      const remainingForEvenSlots = Math.max(0, totalCommissionPoolDollars - proratedTotal);
      const perSlotEvenShare = evenSlotKeys.length > 0 ? remainingForEvenSlots / evenSlotKeys.length : 0;
      for (const key of evenSlotKeys) {
        slotAmountsByKey[key] = perSlotEvenShare;
      }

      // Round to cents via largest-remainder across every slot so the group's shares
      // always sum to exactly totalCommissionPoolDollars.
      const roundedSlotAmountsByKey = roundAmountsToCents(slotAmountsByKey, totalCommissionPoolDollars);

      for (const slot of slots) {
        const amount = roundedSlotAmountsByKey[slotKey(slot)] || 0;
        commissionShareByEventIdForGroup[slot.eventId][slot.userId] = amount;
        commissionShareByEventId[slot.eventId] = {
          ...(commissionShareByEventId[slot.eventId] || {}),
          [slot.userId]: amount,
        };
        commissionShareByUserId[slot.userId] = roundMoney(
          Number(commissionShareByUserId[slot.userId] || 0) + amount
        );
      }
    } else {
      // Standalone (unlinked) event: unchanged hours-threshold hybrid rule — 8+ hour
      // workers split the pool evenly among themselves, under-8h workers are
      // hours-prorated, both subject to the per-vendor Even/Prorated override.
      const eventHoursByEventIdByUserId: Record<string, Record<string, number>> = {};
      const forceEvenSplitByUserId: Record<string, boolean | undefined> = {};

      for (const event of groupEvents) {
        const eventId = normalizeId(event.eventId);
        for (const worker of Array.isArray(event.workers) ? event.workers : []) {
          if (!isEligibleCommissionWorker(worker)) continue;
          const userId = normalizeId(worker.userId);
          const hours = Number(worker.hours || 0);
          totalHoursByUserId[userId] = Number(totalHoursByUserId[userId] || 0) + hours;
          if (worker.forceEvenSplit === true) {
            forceEvenSplitByUserId[userId] = true;
          } else if (worker.forceEvenSplit === false && forceEvenSplitByUserId[userId] !== true) {
            forceEvenSplitByUserId[userId] = false;
          }
          if (!eventHoursByEventIdByUserId[userId]) {
            eventHoursByEventIdByUserId[userId] = {};
          }
          eventHoursByEventIdByUserId[userId][eventId] =
            Number(eventHoursByEventIdByUserId[userId][eventId] || 0) + hours;
        }
      }

      const groupDate = groupEvents
        .map((event) => (event?.eventDate || "").toString().split("T")[0])
        .filter(Boolean)
        .sort()[0];

      const rawCommissionSharesByUserId = distributePoolByHoursRule({
        totalAmount: totalCommissionPoolDollars,
        members: Object.entries(totalHoursByUserId).map(([userId, hours]) => ({
          id: userId,
          hours,
          forceEvenSplit: forceEvenSplitByUserId[userId],
        })),
        allShortShiftMode: shortShiftModeForDate(groupDate),
      }).amountsById;
      // Round to cents via largest-remainder so per-user shares always sum to
      // exactly totalCommissionPoolDollars — rounding each user's share
      // independently (roundMoney per entry) can drift the total by a few cents,
      // which surfaced as the commission split not matching the pool percentage.
      commissionShareByUserId = roundAmountsToCents(rawCommissionSharesByUserId, totalCommissionPoolDollars);

      for (const [userId, totalShare] of Object.entries(commissionShareByUserId)) {
        const allocatedShares = allocateShareAcrossEvents(
          totalShare,
          eventHoursByEventIdByUserId[userId] || {}
        );
        for (const [eventId, eventShare] of Object.entries(allocatedShares)) {
          commissionShareByEventIdForGroup[eventId][userId] = eventShare;
          commissionShareByEventId[eventId] = {
            ...(commissionShareByEventId[eventId] || {}),
            [userId]: eventShare,
          };
        }
      }
    }

    groupsByKey[groupKey] = {
      eventIds,
      totalCommissionPoolDollars,
      commissionShareByUserId,
      commissionShareByEventId: commissionShareByEventIdForGroup,
      totalHoursByUserId: Object.fromEntries(
        Object.entries(totalHoursByUserId).map(([userId, hours]) => [userId, roundMoney(hours)])
      ),
    };

    for (const eventId of eventIds) {
      groupKeyByEventId[eventId] = groupKey;
      groupEventIdsByEventId[eventId] = eventIds;
      groupPoolByEventId[eventId] = totalCommissionPoolDollars;
    }
  }

  return {
    groupsByKey,
    groupKeyByEventId,
    groupEventIdsByEventId,
    groupPoolByEventId,
    commissionShareByEventId,
  };
}
