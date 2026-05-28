import { distributePoolByHoursRule, shortShiftModeForDate } from "./payroll-distribution";

export type LinkedCommissionWorkerInput = {
  userId: string;
  division?: string | null;
  hours: number;
  commissionDeleted?: boolean;
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
    const totalHoursByUserId: Record<string, number> = {};
    const eventHoursByEventIdByUserId: Record<string, Record<string, number>> = {};

    for (const event of groupEvents) {
      const eventId = normalizeId(event.eventId);
      for (const worker of Array.isArray(event.workers) ? event.workers : []) {
        if (!isEligibleCommissionWorker(worker)) continue;
        const userId = normalizeId(worker.userId);
        const hours = Number(worker.hours || 0);
        totalHoursByUserId[userId] = Number(totalHoursByUserId[userId] || 0) + hours;
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

    const commissionShareByUserId = Object.fromEntries(
      Object.entries(
        distributePoolByHoursRule({
          totalAmount: totalCommissionPoolDollars,
          members: Object.entries(totalHoursByUserId).map(([userId, hours]) => ({
            id: userId,
            hours,
          })),
          allShortShiftMode: shortShiftModeForDate(groupDate),
        }).amountsById
      ).map(([userId, share]) => [userId, roundMoney(Number(share || 0))])
    );

    const commissionShareByEventIdForGroup: Record<string, Record<string, number>> = {};
    for (const eventId of eventIds) {
      commissionShareByEventIdForGroup[eventId] = {};
    }

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
