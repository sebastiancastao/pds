// Uploaded payroll (HR dashboard Payroll tab > "Upload Payroll", see
// lib/payroll-upload.ts) as paystub figures for /paystub-generator and
// /api/generate-paystub.
//
// When the upload in use for a pay period has lines for an employee, their
// paystub earnings come from those lines instead of the system calculation.
// Pure functions, shared by the page (to pick an employee's lines and warn
// about them) and the PDF route (to turn the lines into earnings).
//
// How a line maps onto the paystub:
// - Reg/OT/DT pay, Commission, Variable Incentive, Tips, Rest Break and Sick Pay
//   go to their own earnings rows; Bonus and Other go to the Bonus row.
// - Reimbursement and Mileage Pay are not wages: they are added to Net Pay,
//   never to Gross Pay (the uploaded Total Gross includes them).
// - Total Gross is what was paid. A line whose Total Gross differs from its pay
//   columns by more than 5 cents keeps the difference: as Regular pay on hourly
//   and salaried lines (ADP Payroll Summary lines have only a total), as
//   Commission on a "Commission" line with no commission columns, and as Bonus
//   otherwise.
// - Cents are settled per employee, not per line: the paystub adds up exactly to
//   what the ADP Payroll Summary paid (when the upload has it and the lines are
//   within 5 cents of it), otherwise to the lines' Total Gross added up and
//   rounded once, the way the workbook and ADP round. Leftover cents go to the
//   pay column whose rounding left them (else the largest), never to a new row.
// - Amounts round half up after dropping float noise: 115.42499999999997 is
//   115.425, which pays 115.43.

import {
  GROSS_MISMATCH_TOLERANCE,
  NOT_ON_REGISTER_KEY,
  REGISTER_KEY,
  REGISTER_PAID_KEY,
  payrollNameKey,
  payrollRowName,
  roundMoney,
  sanitizePayrollExtra,
  sanitizePayrollFields,
  type PayrollUploadFields,
} from "./payroll-upload";

// One uploaded line as the page sends it to /api/generate-paystub.
export type UploadedPayrollLineInput = Partial<PayrollUploadFields> & {
  id?: string | null;
  user_id?: string | null;
  source_sheet?: string | null;
  extra?: Record<string, unknown> | null;
};

// What the page sends along with a paystub request.
export type UploadedPayrollPayload = {
  uploadId: string;
  periodStart: string;
  periodEnd: string;
  fileName?: string | null;
  lines: UploadedPayrollLineInput[];
};

export type PaystubUploadLine = {
  id: string;
  eventName: string;
  // YYYY-MM-DD, or null when the line has none (or a value that isn't a date).
  eventDate: string | null;
  venue: string;
  city: string;
  state: string;
  sourceSheet: string | null;
  isCommission: boolean;
  // From the ADP Payroll Summary (one total per employee, no breakdown).
  isRegister: boolean;
  // Hours worked on the line. A line that only pays sick leave has none (its
  // hours are sick hours, not hours worked).
  hours: number;
  regularHours: number;
  regularPay: number;
  overtimeHours: number;
  overtimePay: number;
  doubletimeHours: number;
  doubletimePay: number;
  commission: number;
  variableIncentive: number;
  tips: number;
  restBreak: number;
  // Bonus + Other (+ the Total Gross difference on commission lines).
  bonus: number;
  sick: number;
  travel: number;
  // Not wages: added to Net Pay.
  reimbursement: number;
  mileage: number;
  // Total Gross minus the pay columns, and where it was put.
  gap: number;
  gapTo: "regular" | "commission" | "bonus" | null;
  regRate: number | null;
  rateInEffect: number | null;
  // Wages on this line (Gross Pay), without reimbursement and mileage.
  taxableGross: number;
  // The line's Total Gross as uploaded (includes reimbursement and mileage).
  totalGrossPay: number;
};

export type PaystubUploadTotals = {
  lines: number;
  // Hours worked (sick-only lines excluded).
  hours: number;
  commissionHours: number;
  regularHours: number;
  regularPay: number;
  overtimeHours: number;
  overtimePay: number;
  doubletimeHours: number;
  doubletimePay: number;
  commission: number;
  variableIncentive: number;
  tips: number;
  restBreak: number;
  bonus: number;
  sick: number;
  travel: number;
  reimbursement: number;
  mileage: number;
  taxableGross: number;
  totalGrossPay: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const isoDate = (v: unknown): string | null => {
  const raw = text(v).slice(0, 10);
  return ISO_DATE.test(raw) ? raw : null;
};
const hasValue = (v: unknown) => v !== null && v !== undefined && v !== "";

export const emptyPaystubUploadTotals = (): PaystubUploadTotals => ({
  lines: 0,
  hours: 0,
  commissionHours: 0,
  regularHours: 0,
  regularPay: 0,
  overtimeHours: 0,
  overtimePay: 0,
  doubletimeHours: 0,
  doubletimePay: 0,
  commission: 0,
  variableIncentive: 0,
  tips: 0,
  restBreak: 0,
  bonus: 0,
  sick: 0,
  travel: 0,
  reimbursement: 0,
  mileage: 0,
  taxableGross: 0,
  totalGrossPay: 0,
});

// Server side: untrusted request lines -> clean field values (numbers parsed,
// text trimmed), the same rules as saving an upload. Unreadable lines are dropped.
export function sanitizeUploadedPayrollLines(input: unknown): UploadedPayrollLineInput[] {
  if (!Array.isArray(input)) return [];
  const out: UploadedPayrollLineInput[] = [];
  input.slice(0, 500).forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const body = raw as Record<string, unknown>;
    const cleaned = sanitizePayrollFields(body);
    if ("error" in cleaned) return;
    const extra = sanitizePayrollExtra(body.extra);
    out.push({
      ...cleaned.fields,
      id: typeof body.id === "string" ? body.id.slice(0, 64) : `line-${i + 1}`,
      user_id: typeof body.user_id === "string" ? body.user_id : null,
      source_sheet: typeof body.source_sheet === "string" ? body.source_sheet.slice(0, 120) : null,
      extra: {
        ...extra,
        [REGISTER_KEY]: extra[REGISTER_KEY] === true,
        ...(typeof extra[REGISTER_PAID_KEY] === "number" ? { [REGISTER_PAID_KEY]: extra[REGISTER_PAID_KEY] } : {}),
      },
    });
  });
  return out;
}

// Money as whole cents: snapped to 1/10000 first to drop float noise, then
// rounded half away from zero (115.42499999999997 -> 115.425 -> 11543 cents).
export const toCents = (value: number): number => {
  if (!Number.isFinite(value) || value === 0) return 0;
  const tenThousandths = Math.round(Math.abs(value) * 10000);
  const cents = Math.round(tenThousandths / 100);
  return value < 0 ? -cents : cents;
};

// What rounding to cents left behind, in 1/10000 dollars (positive = rounded down).
const roundingLeftover = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 10000) - toCents(value) * 100 : 0;

type WageKey =
  | "regularPay"
  | "overtimePay"
  | "doubletimePay"
  | "commission"
  | "variableIncentive"
  | "tips"
  | "restBreak"
  | "bonus"
  | "sick"
  | "travel";

const WAGE_COLUMNS: Array<[WageKey, Array<keyof PayrollUploadFields>]> = [
  ["regularPay", ["regular_pay"]],
  ["overtimePay", ["overtime_pay"]],
  ["doubletimePay", ["doubletime_pay"]],
  ["commission", ["commission_pay"]],
  ["variableIncentive", ["variable_incentive"]],
  ["tips", ["tips"]],
  ["restBreak", ["rest_break"]],
  ["bonus", ["bonus", "other"]],
  ["sick", ["sick_pay"]],
  ["travel", ["travel_pay"]],
];

// One line before cents are settled for the employee: amounts in cents, with
// what rounding left behind on each pay column (1/10000 dollars).
type LineWork = {
  row: UploadedPayrollLineInput;
  index: number;
  wages: Record<WageKey, number>;
  leftover: Record<WageKey, number>;
  reimbursement: number;
  mileage: number;
  // Line Total Gross in 1/10000 dollars, so an employee's lines can be added up
  // before rounding (several 0.5-cent lines must not round up one by one).
  totalTenThousandths: number;
  // Total Gross minus the pay columns, in cents, when 5 cents or less (rounding).
  smallGap: number;
  gap: number;
  gapTo: PaystubUploadLine["gapTo"];
  hours: number;
  regularHours: number;
  overtimeHours: number;
  doubletimeHours: number;
  isCommission: boolean;
};

const tenThousandthsOf = (value: number) => (Number.isFinite(value) ? Math.round(value * 10000) : 0);
const centsFromTenThousandths = (tt: number) => (tt < 0 ? -Math.round(-tt / 100) : Math.round(tt / 100));
const sumWageCents = (wages: Record<WageKey, number>) => WAGE_COLUMNS.reduce((sum, [key]) => sum + wages[key], 0);

function lineWork(row: UploadedPayrollLineInput, index: number): LineWork {
  const raw = (key: keyof PayrollUploadFields) => num(row[key]);

  const wages = {} as Record<WageKey, number>;
  const leftover = {} as Record<WageKey, number>;
  WAGE_COLUMNS.forEach(([key, fields]) => {
    wages[key] = fields.reduce((sum, f) => sum + toCents(raw(f)), 0);
    leftover[key] = fields.reduce((sum, f) => sum + roundingLeftover(raw(f)), 0);
  });
  const reimbursement = toCents(raw("reimbursement"));
  const mileage = toCents(raw("mileage_pay"));

  const overtimeHours = num(row.overtime_hours);
  const doubletimeHours = num(row.doubletime_hours);
  const hoursGiven = hasValue(row.hours) ? num(row.hours) : null;
  let regularHours = hasValue(row.regular_hours)
    ? num(row.regular_hours)
    : wages.regularPay !== 0 && hoursGiven !== null
      ? Math.max(0, hoursGiven - overtimeHours - doubletimeHours)
      : 0;
  const hours = hoursGiven !== null ? hoursGiven : regularHours + overtimeHours + doubletimeHours;

  const categoryIsCommission = /commission/i.test(text(row.category));
  const hasCommissionPay = wages.commission !== 0 || wages.variableIncentive !== 0;

  const componentTenThousandths =
    WAGE_COLUMNS.reduce((sum, [, fields]) => sum + fields.reduce((s2, f) => s2 + tenThousandthsOf(raw(f)), 0), 0) +
    tenThousandthsOf(raw("reimbursement")) +
    tenThousandthsOf(raw("mileage_pay"));
  const totalTenThousandths = hasValue(row.total_gross_pay) ? tenThousandthsOf(raw("total_gross_pay")) : componentTenThousandths;
  const gapCents = toCents(totalTenThousandths / 10000) - (sumWageCents(wages) + reimbursement + mileage);
  const toleranceCents = Math.round(GROSS_MISMATCH_TOLERANCE * 100);

  let gap = 0;
  let gapTo: PaystubUploadLine["gapTo"] = null;
  let smallGap = 0;
  if (Math.abs(gapCents) > toleranceCents) {
    gap = gapCents / 100;
    if (hasCommissionPay) {
      wages.bonus += gapCents;
      gapTo = "bonus";
    } else if (categoryIsCommission) {
      wages.commission += gapCents;
      gapTo = "commission";
    } else {
      wages.regularPay += gapCents;
      if (regularHours === 0) regularHours = Math.max(0, hours - overtimeHours - doubletimeHours);
      gapTo = "regular";
    }
  } else {
    smallGap = gapCents;
  }

  return {
    row,
    index,
    wages,
    leftover,
    reimbursement,
    mileage,
    totalTenThousandths,
    smallGap,
    gap,
    gapTo,
    hours,
    regularHours,
    overtimeHours,
    doubletimeHours,
    isCommission: hasCommissionPay || categoryIsCommission,
  };
}

// Moves cents between an employee's lines so that wages + reimbursement +
// mileage add up to targetCents. Each cent goes to the pay column whose rounding
// left the most behind in that direction, then to a line whose own Total Gross
// asked for it, then to the largest pay column.
function settleCents(works: LineWork[], targetCents: number): void {
  const current = works.reduce((sum, w) => sum + sumWageCents(w.wages) + w.reimbursement + w.mileage, 0);
  let diff = targetCents - current;
  if (diff === 0 || works.length === 0) return;
  const step = diff > 0 ? 1 : -1;
  for (let guard = 0; diff !== 0 && guard < 10000; guard += 1) {
    let best: { work: LineWork; key: WageKey; score: [number, number, number] } | null = null;
    works.forEach((work) => {
      WAGE_COLUMNS.forEach(([key]) => {
        if (work.wages[key] === 0) return;
        const score: [number, number, number] = [step * work.leftover[key], step * work.smallGap, Math.abs(work.wages[key])];
        if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) {
          best = { work, key, score };
        }
      });
    });
    const pick = best as { work: LineWork; key: WageKey } | null;
    if (pick) {
      pick.work.wages[pick.key] += step;
      pick.work.leftover[pick.key] -= step * 100;
      pick.work.smallGap -= step;
    } else {
      // No wages at all (reimbursement or mileage lines only).
      const work = works.find((w) => w.reimbursement !== 0) || works.find((w) => w.mileage !== 0) || works[0];
      if (work.reimbursement !== 0 || work.mileage === 0) work.reimbursement += step;
      else work.mileage += step;
    }
    diff -= step;
  }
}

function finishLine(work: LineWork): PaystubUploadLine {
  const { row, wages } = work;
  const taxableCents = sumWageCents(wages);
  // Sick leave lines list the sick hours; those are not hours worked.
  const sickOnly = wages.sick !== 0 && taxableCents === wages.sick;
  const dollars = (cents: number) => cents / 100;
  return {
    id: text(row.id) || `line-${work.index + 1}`,
    eventName: text(row.event_name),
    eventDate: isoDate(row.event_date),
    venue: text(row.venue),
    city: text(row.city),
    state: text(row.state),
    sourceSheet: row.source_sheet ? text(row.source_sheet) : null,
    isCommission: work.isCommission,
    isRegister: row.extra?.[REGISTER_KEY] === true,
    hours: sickOnly ? 0 : roundMoney(work.hours),
    regularHours: roundMoney(work.regularHours),
    regularPay: dollars(wages.regularPay),
    overtimeHours: roundMoney(work.overtimeHours),
    overtimePay: dollars(wages.overtimePay),
    doubletimeHours: roundMoney(work.doubletimeHours),
    doubletimePay: dollars(wages.doubletimePay),
    commission: dollars(wages.commission),
    variableIncentive: dollars(wages.variableIncentive),
    tips: dollars(wages.tips),
    restBreak: dollars(wages.restBreak),
    bonus: dollars(wages.bonus),
    sick: dollars(wages.sick),
    travel: dollars(wages.travel),
    reimbursement: dollars(work.reimbursement),
    mileage: dollars(work.mileage),
    gap: work.gap,
    gapTo: work.gapTo,
    regRate: hasValue(row.reg_rate) ? num(row.reg_rate) : null,
    rateInEffect: hasValue(row.rate_in_effect) ? num(row.rate_in_effect) : null,
    taxableGross: dollars(taxableCents),
    totalGrossPay: toCents(work.totalTenThousandths / 10000) / 100,
  };
}

// What the ADP Payroll Summary paid this employee, in cents, when the upload
// included it: the Total Paid kept on their lines (one per name on the summary)
// plus their own Payroll Summary lines. ADP's Total Paid includes reimbursements.
export function adpPaidCents(rows: UploadedPayrollLineInput[]): number | null {
  const paidByName = new Map<string, number>();
  rows.forEach((r) => {
    const paid = r.extra?.[REGISTER_PAID_KEY];
    if (typeof paid === "number") paidByName.set(payrollNameKey(r), paid);
  });
  if (paidByName.size === 0) return null;
  const registerLines = rows
    .filter((r) => r.extra?.[REGISTER_KEY] === true)
    .reduce((sum, r) => sum + toCents(num(r.total_gross_pay)), 0);
  return Array.from(paidByName.values()).reduce((sum, v) => sum + toCents(v), 0) + registerLines;
}

// One line on its own (its cents settled against its own Total Gross).
export function toPaystubUploadLine(row: UploadedPayrollLineInput, index = 0): PaystubUploadLine {
  const work = lineWork(row, index);
  settleCents([work], centsFromTenThousandths(work.totalTenThousandths));
  return finishLine(work);
}

export function summarizePaystubUploadLines(lines: PaystubUploadLine[]): PaystubUploadTotals {
  const t = emptyPaystubUploadTotals();
  lines.forEach((l) => {
    t.lines += 1;
    t.hours += l.hours;
    if (l.isCommission) t.commissionHours += l.hours;
    t.regularHours += l.regularHours;
    t.regularPay += l.regularPay;
    t.overtimeHours += l.overtimeHours;
    t.overtimePay += l.overtimePay;
    t.doubletimeHours += l.doubletimeHours;
    t.doubletimePay += l.doubletimePay;
    t.commission += l.commission;
    t.variableIncentive += l.variableIncentive;
    t.tips += l.tips;
    t.restBreak += l.restBreak;
    t.bonus += l.bonus;
    t.sick += l.sick;
    t.travel += l.travel;
    t.reimbursement += l.reimbursement;
    t.mileage += l.mileage;
    t.taxableGross += l.taxableGross;
    t.totalGrossPay += l.totalGrossPay;
  });
  (Object.keys(t) as Array<keyof PaystubUploadTotals>).forEach((k) => {
    if (k !== "lines") t[k] = roundMoney(t[k]);
  });
  return t;
}

// One employee's uploaded lines as paystub lines and totals. The paystub adds up
// to what ADP paid when that is within 5 cents of the lines, otherwise to the
// lines' Total Gross added up and rounded once. totals.totalGrossPay is always
// the lines' own total (what the ADP check compares against).
export function buildPaystubFromUploadedLines(rows: UploadedPayrollLineInput[]): {
  lines: PaystubUploadLine[];
  totals: PaystubUploadTotals;
} {
  const works = rows.map((r, i) => lineWork(r, i));
  const linesTotalCents = centsFromTenThousandths(works.reduce((sum, w) => sum + w.totalTenThousandths, 0));
  const adp = adpPaidCents(rows);
  const toleranceCents = Math.round(GROSS_MISMATCH_TOLERANCE * 100);
  const target = adp !== null && Math.abs(adp - linesTotalCents) <= toleranceCents ? adp : linesTotalCents;
  settleCents(works, target);
  const lines = works.map(finishLine);
  const totals = summarizePaystubUploadLines(lines);
  totals.totalGrossPay = linesTotalCents / 100;
  return { lines, totals };
}

// ---------- picking an employee's lines (page side) ----------

export type UploadedLineMatch = "account" | "email" | "shifted-email";

export type UploadedLinesForEmployee<R> = {
  lines: R[];
  // How lines were tied to this employee, beyond their linked account.
  matchedBy: UploadedLineMatch[];
};

type MatchableRow = Partial<PayrollUploadFields> & { user_id?: string | null; extra?: Record<string, unknown> | null };

// Lines that belong to one employee: lines linked to their account, plus
// unlinked lines whose email (or an email found in a shifted column) is the
// employee's. Lines linked to another account are never taken. No matching by
// name here: the upload already links lines by name when it is confident.
export function selectUploadedLinesForEmployee<R extends MatchableRow>(
  rows: R[],
  who: { userId?: string | null; emails?: Array<string | null | undefined> }
): UploadedLinesForEmployee<R> {
  const userId = (who.userId || "").trim();
  const emails = new Set((who.emails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean));
  const lines: R[] = [];
  const matchedBy = new Set<UploadedLineMatch>();
  rows.forEach((row) => {
    if (row.user_id) {
      if (userId && row.user_id === userId) {
        lines.push(row);
        matchedBy.add("account");
      }
      return;
    }
    const email = String(row.email || "").trim().toLowerCase();
    if (email && emails.has(email)) {
      lines.push(row);
      matchedBy.add("email");
      return;
    }
    const shifted = String(row.extra?.["Email found in another column"] || "").trim().toLowerCase();
    if (!email && shifted && emails.has(shifted)) {
      lines.push(row);
      matchedBy.add("shifted-email");
    }
  });
  return { lines, matchedBy: Array.from(matchedBy) };
}

// ---------- warnings shown before a paystub is made from uploaded lines ----------

export type UploadedPayrollWarning = {
  code:
    | "register-mismatch"
    | "not-on-register"
    | "outside-period"
    | "file-notes"
    | "gap"
    | "shifted-email"
    | "email-only"
    | "no-wages";
  message: string;
  // Serious enough to ask before generating, distributing or emailing.
  confirm: boolean;
};

const money = (n: number) => `$${roundMoney(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function uploadedPayrollWarnings(
  rows: Array<MatchableRow & { source_sheet?: string | null }>,
  opts: { periodStart: string; periodEnd: string; matchedBy?: UploadedLineMatch[] }
): UploadedPayrollWarning[] {
  const warnings: UploadedPayrollWarning[] = [];
  if (rows.length === 0) return warnings;
  const { lines, totals } = buildPaystubFromUploadedLines(rows);

  // What the ADP Payroll Summary paid this employee (kept on their lines when
  // the upload included it), against what their lines add up to. ADP's Total
  // Paid includes reimbursements, like the lines' Total Gross.
  const adpCents = adpPaidCents(rows);
  if (adpCents !== null) {
    const paid = adpCents / 100;
    const diff = roundMoney(totals.totalGrossPay - paid);
    if (Math.abs(diff) > GROSS_MISMATCH_TOLERANCE) {
      warnings.push({
        code: "register-mismatch",
        message: `The ADP Payroll Summary paid ${money(paid)}, but the uploaded lines add up to ${money(totals.totalGrossPay)} (${diff > 0 ? `${money(diff)} more` : `${money(-diff)} less`}). Fix the upload on the HR dashboard or this paystub will not match what was paid.`,
        confirm: true,
      });
    }
  } else if (rows.some((r) => r.extra?.[NOT_ON_REGISTER_KEY] === true)) {
    warnings.push({ code: "not-on-register", message: "Not on the ADP Payroll Summary in the upload.", confirm: true });
  }

  // ADP Payroll Summary lines carry the check (pay) date, not a work date.
  const outside = lines.filter(
    (l) => !l.isRegister && l.eventDate && opts.periodStart && opts.periodEnd && (l.eventDate < opts.periodStart || l.eventDate > opts.periodEnd)
  );
  if (outside.length > 0) {
    const dates = Array.from(new Set(outside.map((l) => l.eventDate))).sort();
    warnings.push({
      code: "outside-period",
      message: `${outside.length} line${outside.length === 1 ? " is" : "s are"} dated outside the pay period (${dates.join(", ")}), worth ${money(outside.reduce((s, l) => s + l.totalGrossPay, 0))}. They are included.`,
      confirm: false,
    });
  }

  const notes = Array.from(new Set(rows.map((r) => text(r.extra?.["Notes in file"])).filter(Boolean)));
  if (notes.length > 0) {
    const paidNote = notes.some((n) => /\b(paid|short)\b/i.test(n));
    warnings.push({ code: "file-notes", message: `The file has notes next to these lines: ${notes.join("; ")}.`, confirm: paidNote });
  }

  const gaps = lines.filter((l) => l.gap !== 0);
  if (gaps.length > 0) {
    const where = Array.from(new Set(gaps.map((l) => (l.gapTo === "regular" ? "Regular" : l.gapTo === "commission" ? "Commission" : "Bonus"))));
    const onlyRegister = gaps.every((l) => l.isRegister);
    warnings.push({
      code: "gap",
      message: onlyRegister
        ? `Paid per the ADP Payroll Summary with no breakdown: ${money(gaps.reduce((s, l) => s + l.gap, 0))} shown as ${where.join(" and ")} pay.`
        : `Total Gross on ${gaps.length} line${gaps.length === 1 ? "" : "s"} differs from the pay columns by ${money(gaps.reduce((s, l) => s + l.gap, 0))}; the difference is shown as ${where.join(" and ")}.`,
      confirm: false,
    });
  }

  if (opts.matchedBy?.includes("shifted-email")) {
    warnings.push({ code: "shifted-email", message: "Some lines had shifted columns and were matched by an email found in another column.", confirm: true });
  } else if (opts.matchedBy?.includes("email")) {
    warnings.push({ code: "email-only", message: "Some lines are not linked to the account and were matched by email.", confirm: false });
  }

  if (totals.taxableGross === 0 && (totals.reimbursement !== 0 || totals.mileage !== 0)) {
    warnings.push({ code: "no-wages", message: `Only reimbursements are uploaded (${money(totals.reimbursement + totals.mileage)}), no wages.`, confirm: true });
  }
  return warnings;
}

// ---------- matching uploaded lines to the system events sent with a request ----------

export type MatchableEvent = {
  id?: string | null;
  event_date?: string | null;
  venue?: string | null;
  name?: string | null;
  event_name?: string | null;
  artist?: string | null;
};

const normText = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
// Multi-day export rows are named "Event - 2026-07-10"; match on the base name.
const normEventName = (v: unknown) => normText(String(v ?? "").replace(/\s+-\s+\d{4}-\d{2}-\d{2}\s*$/, ""));

// The system event a line is for, among one employee's events: same date and
// venue, else same date and name, else the only event that day. null when unsure.
export function matchUploadLineToEvent<E extends MatchableEvent>(line: PaystubUploadLine, events: E[]): E | null {
  if (!line.eventDate) return null;
  const sameDay = events.filter((e) => String(e.event_date || "").slice(0, 10) === line.eventDate);
  if (sameDay.length === 0) return null;
  const venue = normText(line.venue);
  const name = normEventName(line.eventName);
  const byVenue = venue ? sameDay.filter((e) => normText(e.venue) === venue) : [];
  if (byVenue.length === 1) return byVenue[0];
  const nameOf = (e: E) => [e.event_name, e.name, e.artist].map(normEventName).filter(Boolean);
  const byName = name ? (byVenue.length > 1 ? byVenue : sameDay).filter((e) => nameOf(e).includes(name)) : [];
  if (byName.length === 1) return byName[0];
  return sameDay.length === 1 ? sameDay[0] : null;
}

export const uploadedLineLabel = (row: MatchableRow): string => payrollRowName(row) || String(row.email || "") || "(no name)";
