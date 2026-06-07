// Shared worked-hours computation from raw time_entries actions.
// Mirrors the pairing logic in app/api/employees/[id]/summary/route.ts so the
// "worked hours" figure is consistent across the app: global clock_in/clock_out
// pairing, meal-break deduction, and a 30-minute bonus per completed shift.

export type RawTimeEntry = {
  id: string;
  user_id?: string | null;
  event_id?: string | null;
  action: string;
  timestamp: string;
};

const HOUR_MS = 1000 * 60 * 60;
const SHIFT_BONUS_MS = 30 * 60 * 1000;

/**
 * Total worked hours for a single user's raw time entries.
 * Entries do NOT need to be pre-sorted.
 */
export function computeWorkedHours(entries: RawTimeEntry[]): number {
  const all = entries
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let total = 0;
  let clockIn: RawTimeEntry | null = null;

  for (const entry of all) {
    const action = (entry.action || "").toLowerCase();

    if (action === "clock_in") {
      if (!clockIn) clockIn = entry; // latch first clock_in only
      continue;
    }

    if (action === "clock_out" && clockIn) {
      const shiftStart = new Date(clockIn.timestamp).getTime();
      const shiftEnd = new Date(entry.timestamp).getTime();
      let shiftMs = shiftEnd - shiftStart;
      if (shiftMs <= 0) {
        clockIn = null;
        continue;
      }

      // Deduct paired meal breaks that fall within this shift window.
      const mealStarts: number[] = [];
      const mealEnds: number[] = [];
      for (const e of all) {
        const t = new Date(e.timestamp).getTime();
        if (t <= shiftStart || t >= shiftEnd) continue;
        const a = (e.action || "").toLowerCase();
        if (a === "meal_start") mealStarts.push(t);
        else if (a === "meal_end") mealEnds.push(t);
      }
      const paired = Math.min(mealStarts.length, mealEnds.length);
      for (let i = 0; i < paired; i++) {
        const overlapStart = Math.max(mealStarts[i], shiftStart);
        const overlapEnd = Math.min(mealEnds[i], shiftEnd);
        if (overlapEnd > overlapStart) shiftMs -= overlapEnd - overlapStart;
      }

      shiftMs += SHIFT_BONUS_MS; // 30-min bonus per shift
      total += Math.max(0, shiftMs) / HOUR_MS;
      clockIn = null;
    }
  }

  return Number(total.toFixed(2));
}

/** Group entries by user_id and compute worked hours for each. */
export function computeWorkedHoursByUser(
  entries: RawTimeEntry[]
): Map<string, number> {
  const byUser = new Map<string, RawTimeEntry[]>();
  for (const e of entries) {
    const uid = String(e.user_id || "");
    if (!uid) continue;
    const list = byUser.get(uid) || [];
    list.push(e);
    byUser.set(uid, list);
  }

  const result = new Map<string, number>();
  for (const [uid, list] of byUser) {
    result.set(uid, computeWorkedHours(list));
  }
  return result;
}
