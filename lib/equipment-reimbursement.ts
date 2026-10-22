import { TIMESHEET_PAY_DATE_OFFSET_DAYS, TIMESHEET_PAY_PERIOD_ANCHOR } from "./timesheet-pay-periods";

// Equipment reimbursement: a flat $20 a month for each checked vendor, paid on
// a pay date HR types or picks (any date, nothing preselected). A person can be
// paid once per calendar month of the pay date. Each row also records the
// bi-weekly work period the pay date belongs to (Monday to Sunday, anchor
// Feb 2, 2026): the latest period that ended before the pay date, so Oct 16,
// 2026 belongs to Sep 28 - Oct 11. The Payroll tab includes the row when it
// loads those work dates.

export const EQUIPMENT_REIMBURSEMENT_AMOUNT = 20;
export const EQUIPMENT_REIMBURSEMENT_DESCRIPTION = "Equipment reimbursement";

export type EquipmentPayPeriod = {
  payDate: string; // YYYY-MM-DD, the date HR picked
  start: string; // YYYY-MM-DD, Monday of the work period it pays
  end: string; // YYYY-MM-DD, Sunday 13 days later, before payDate
  month: string; // YYYY-MM of `payDate`
};

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 14;
const LATEST_PAY_DATE = "2100-12-31";

const toMs = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
};

const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const ANCHOR_MS = toMs(TIMESHEET_PAY_PERIOD_ANCHOR) as number;

/** The earliest pay date: the day after the first work period ends. */
export const EARLIEST_EQUIPMENT_PAY_DATE = toIso(ANCHOR_MS + PERIOD_DAYS * DAY_MS);

/**
 * The pay date with the work period it pays (the latest one that ended before
 * it), or null when `payDate` is not a real date between the first period and 2100.
 */
export function payPeriodForPayDate(payDate: string): EquipmentPayPeriod | null {
  const ms = toMs(payDate);
  if (ms == null || payDate < EARLIEST_EQUIPMENT_PAY_DATE || payDate > LATEST_PAY_DATE) return null;
  const days = Math.round((ms - ANCHOR_MS) / DAY_MS);
  const index = Math.floor((days - PERIOD_DAYS) / PERIOD_DAYS);
  if (index < 0) return null;
  const startMs = ANCHOR_MS + index * PERIOD_DAYS * DAY_MS;
  return {
    payDate,
    start: toIso(startMs),
    end: toIso(startMs + (PERIOD_DAYS - 1) * DAY_MS),
    month: payDate.slice(0, 7),
  };
}

/** The pay date of a stored row (rows saved before pay_date existed used the period end + 5 days). */
export function payDateOf(row: { pay_date?: string | null; pay_period_end?: string | null }): string {
  const saved = String(row.pay_date || "").slice(0, 10);
  if (saved) return saved;
  const ms = toMs(String(row.pay_period_end || "").slice(0, 10));
  return ms == null ? "" : toIso(ms + TIMESHEET_PAY_DATE_OFFSET_DAYS * DAY_MS);
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
  pay_date: string;
  pay_period_start: string;
  pay_period_end: string;
  amount: number;
};

/** "Paid Oct 16, 2026" for one pay date, or each distinct pay date joined. */
export function formatPayDatesOf(rows: Array<Pick<PayrollEquipmentRow, "pay_date" | "pay_period_end">>): string {
  const dates = Array.from(new Set(rows.map((r) => payDateOf(r)).filter(Boolean))).sort();
  return dates.length ? `Paid ${dates.map((d) => formatPayDate(d)).join(", ")}` : "";
}
