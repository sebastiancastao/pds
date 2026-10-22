import { TIMESHEET_PAY_DATE_OFFSET_DAYS, TIMESHEET_PAY_PERIOD_ANCHOR } from "./timesheet-pay-periods";

// Equipment reimbursement: a flat $20 a month for each checked vendor, booked in
// one of that month's bi-weekly pay periods. Pay periods follow the same
// Monday-to-Sunday cadence as the timesheet pay periods (anchor Feb 2, 2026,
// e.g. Sep 28 - Oct 11, 2026, paid Oct 16). A period belongs to the month its
// last day falls in, so October 2026 has Sep 28 - Oct 11 and Oct 12 - Oct 25.

export const EQUIPMENT_REIMBURSEMENT_AMOUNT = 20;
export const EQUIPMENT_REIMBURSEMENT_DESCRIPTION = "Equipment reimbursement";

export type EquipmentPayPeriod = {
  start: string; // YYYY-MM-DD, Monday
  end: string; // YYYY-MM-DD, Sunday 13 days later
  payDate: string; // YYYY-MM-DD
  month: string; // YYYY-MM of `end`
};

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 14;

const toMs = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
};

const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const ANCHOR_MS = toMs(TIMESHEET_PAY_PERIOD_ANCHOR) as number;

function periodAt(index: number): EquipmentPayPeriod {
  const startMs = ANCHOR_MS + index * PERIOD_DAYS * DAY_MS;
  const endMs = startMs + (PERIOD_DAYS - 1) * DAY_MS;
  const end = toIso(endMs);
  return {
    start: toIso(startMs),
    end,
    payDate: toIso(endMs + TIMESHEET_PAY_DATE_OFFSET_DAYS * DAY_MS),
    month: end.slice(0, 7),
  };
}

function indexContaining(date: string): number {
  const ms = toMs(date);
  if (ms == null) return 0;
  return Math.max(0, Math.floor((ms - ANCHOR_MS) / (PERIOD_DAYS * DAY_MS)));
}

/** The pay period that starts on `start`, or null when `start` is not a period start. */
export function payPeriodFromStart(start: string): EquipmentPayPeriod | null {
  const ms = toMs(start);
  if (ms == null || ms < ANCHOR_MS) return null;
  const days = Math.round((ms - ANCHOR_MS) / DAY_MS);
  if (days % PERIOD_DAYS !== 0) return null;
  return periodAt(days / PERIOD_DAYS);
}

/** Every pay period whose last day falls in `month` (YYYY-MM), oldest first. */
export function payPeriodsInMonth(month: string): EquipmentPayPeriod[] {
  const out: EquipmentPayPeriod[] = [];
  const firstDay = `${month}-01`;
  if (toMs(firstDay) == null) return out;
  // Start one period back so a period that began last month but ends this month is included.
  for (let i = Math.max(0, indexContaining(firstDay) - 1), guard = 0; guard < 6; i++, guard++) {
    const p = periodAt(i);
    if (p.month === month) out.push(p);
    else if (p.month > month) break;
  }
  return out;
}

/** The most recent pay period that has already ended on `today`. */
export function lastCompletedPayPeriod(today: string): EquipmentPayPeriod {
  const current = periodAt(indexContaining(today));
  return current.end < today ? current : periodAt(Math.max(0, indexContaining(today) - 1));
}

/** Pay periods from the anchor through `forward` periods after the one containing `today`, newest first. */
export function listEquipmentPayPeriods(today: string, forward = 2): EquipmentPayPeriod[] {
  const last = indexContaining(today) + Math.max(0, forward);
  const out: EquipmentPayPeriod[] = [];
  for (let i = last; i >= 0; i--) out.push(periodAt(i));
  return out;
}

const SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };

export function formatPayPeriod(p: Pick<EquipmentPayPeriod, "start" | "end">, withYear = true): string {
  const s = new Date(`${p.start}T00:00:00Z`).toLocaleDateString("en-US", SHORT);
  const e = new Date(`${p.end}T00:00:00Z`).toLocaleDateString("en-US", withYear ? { ...SHORT, year: "numeric" } : SHORT);
  return `${s} – ${e}`;
}

export function formatPayMonth(month: string): string {
  const ms = toMs(`${month}-01`);
  if (ms == null) return month;
  return new Date(ms).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** One equipment reimbursement inside the loaded payroll dates (GET ?range_start&range_end). */
export type PayrollEquipmentRow = {
  id: string;
  user_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  state: string;
  role: string;
  pay_period_start: string;
  pay_period_end: string;
  amount: number;
};

/** "Sep 28 – Oct 11, 2026" for one period, or each distinct period joined. */
export function formatPayPeriodsOf(rows: Array<Pick<PayrollEquipmentRow, "pay_period_start" | "pay_period_end">>): string {
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (!seen.has(r.pay_period_start)) seen.set(r.pay_period_start, formatPayPeriod({ start: r.pay_period_start, end: r.pay_period_end }));
  }
  return Array.from(seen.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, label]) => label)
    .join(", ");
}
