import { TIMESHEET_PAY_DATE_OFFSET_DAYS, TIMESHEET_PAY_PERIOD_ANCHOR } from "./timesheet-pay-periods";

// Equipment reimbursement: a flat $20 a month for each checked vendor, paid on
// one of that month's pay dates. Pay dates follow the bi-weekly timesheet pay
// periods (Monday to Sunday, anchor Feb 2, 2026, paid 5 days after the period
// ends), e.g. Sep 28 - Oct 11, 2026 is paid Fri Oct 16. HR picks the pay date;
// the work period behind it is still stored so the Payroll tab can find the
// rows for the dates it loads. A reimbursement belongs to the month of its pay
// date, so October 2026 has three pay dates: Oct 2, Oct 16 and Oct 30.

export const EQUIPMENT_REIMBURSEMENT_AMOUNT = 20;
export const EQUIPMENT_REIMBURSEMENT_DESCRIPTION = "Equipment reimbursement";

export type EquipmentPayPeriod = {
  start: string; // YYYY-MM-DD, Monday
  end: string; // YYYY-MM-DD, Sunday 13 days later
  payDate: string; // YYYY-MM-DD, `end` + 5 days
  month: string; // YYYY-MM of `payDate`
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
  const payDate = toIso(endMs + TIMESHEET_PAY_DATE_OFFSET_DAYS * DAY_MS);
  return {
    start: toIso(startMs),
    end: toIso(endMs),
    payDate,
    month: payDate.slice(0, 7),
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

/** The pay period paid on `payDate`, or null when `payDate` is not a pay date. */
export function payPeriodFromPayDate(payDate: string): EquipmentPayPeriod | null {
  const ms = toMs(payDate);
  if (ms == null) return null;
  return payPeriodFromStart(toIso(ms - (PERIOD_DAYS - 1 + TIMESHEET_PAY_DATE_OFFSET_DAYS) * DAY_MS));
}

/** The pay date of a stored row, from the last day of its pay period. */
export function payDateOf(row: { pay_period_end: string }): string {
  const ms = toMs(String(row.pay_period_end || "").slice(0, 10));
  return ms == null ? "" : toIso(ms + TIMESHEET_PAY_DATE_OFFSET_DAYS * DAY_MS);
}

/** Every pay period paid in `month` (YYYY-MM), oldest first. */
export function payPeriodsInMonth(month: string): EquipmentPayPeriod[] {
  const out: EquipmentPayPeriod[] = [];
  const firstDay = `${month}-01`;
  if (toMs(firstDay) == null) return out;
  // A period is paid 18 days after it starts, so start two periods back to
  // catch one that began last month but is paid this month.
  for (let i = Math.max(0, indexContaining(firstDay) - 2), guard = 0; guard < 8; i++, guard++) {
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

/** "Oct 16, 2026", or "Oct 16" without the year, or "Fri, Oct 16, 2026" with the weekday. */
export function formatPayDate(iso: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const ms = toMs(String(iso || "").slice(0, 10));
  if (ms == null) return String(iso || "");
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.year === false ? {} : { year: "numeric" }),
    ...(opts.weekday ? { weekday: "short" } : {}),
    timeZone: "UTC",
  });
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

/** "Paid Oct 16, 2026" for one pay date, or each distinct pay date joined. */
export function formatPayDatesOf(rows: Array<Pick<PayrollEquipmentRow, "pay_period_end">>): string {
  const dates = Array.from(new Set(rows.map((r) => payDateOf(r)).filter(Boolean))).sort();
  return dates.length ? `Paid ${dates.map((d) => formatPayDate(d)).join(", ")}` : "";
}
