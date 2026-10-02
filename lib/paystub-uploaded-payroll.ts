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
// - Total Gross is what was paid. When it is more (or less) than the line's
//   pay columns, the difference is kept: as Regular pay on hourly and salaried
//   lines (ADP Payroll Summary lines have only a total), as Commission on a
//   "Commission" line with no commission columns, and as Bonus otherwise.

import {
  GROSS_COMPONENT_KEYS,
  GROSS_MISMATCH_TOLERANCE,
  NOT_ON_REGISTER_KEY,
  REGISTER_KEY,
  REGISTER_PAID_KEY,
  payrollNameKey,
  payrollRowName,
  roundMoney,
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
    const extra = body.extra && typeof body.extra === "object" && !Array.isArray(body.extra) ? (body.extra as Record<string, unknown>) : {};
    out.push({
      ...cleaned.fields,
      id: typeof body.id === "string" ? body.id.slice(0, 64) : `line-${i + 1}`,
      user_id: typeof body.user_id === "string" ? body.user_id : null,
      source_sheet: typeof body.source_sheet === "string" ? body.source_sheet.slice(0, 120) : null,
      extra: {
        [REGISTER_KEY]: extra[REGISTER_KEY] === true,
        ...(typeof extra[REGISTER_PAID_KEY] === "number" ? { [REGISTER_PAID_KEY]: extra[REGISTER_PAID_KEY] } : {}),
      },
    });
  });
  return out;
}

export function toPaystubUploadLine(row: UploadedPayrollLineInput, index = 0): PaystubUploadLine {
  const commission = num(row.commission_pay);
  const variableIncentive = num(row.variable_incentive);
  const overtimeHours = num(row.overtime_hours);
  const doubletimeHours = num(row.doubletime_hours);
  const overtimePay = num(row.overtime_pay);
  const doubletimePay = num(row.doubletime_pay);
  let regularPay = num(row.regular_pay);
  const hoursGiven = hasValue(row.hours) ? num(row.hours) : null;
  let regularHours = hasValue(row.regular_hours)
    ? num(row.regular_hours)
    : regularPay !== 0 && hoursGiven !== null
      ? Math.max(0, hoursGiven - overtimeHours - doubletimeHours)
      : 0;
  const hours = hoursGiven !== null ? hoursGiven : regularHours + overtimeHours + doubletimeHours;

  const categoryIsCommission = /commission/i.test(text(row.category));
  const hasCommissionPay = commission !== 0 || variableIncentive !== 0;
  let bonus = num(row.bonus) + num(row.other);
  let commissionOut = commission;

  // Total Gross is what was paid; keep any difference from the pay columns.
  const componentSum = roundMoney(GROSS_COMPONENT_KEYS.reduce((s, k) => s + num(row[k]), 0));
  const totalGrossPay = hasValue(row.total_gross_pay) ? roundMoney(num(row.total_gross_pay)) : componentSum;
  const rawGap = roundMoney(totalGrossPay - componentSum);
  const gap = Math.abs(rawGap) > GROSS_MISMATCH_TOLERANCE ? rawGap : 0;
  let gapTo: PaystubUploadLine["gapTo"] = null;
  if (gap !== 0) {
    if (hasCommissionPay) {
      bonus += gap;
      gapTo = "bonus";
    } else if (categoryIsCommission) {
      commissionOut += gap;
      gapTo = "commission";
    } else {
      regularPay += gap;
      if (regularHours === 0) regularHours = Math.max(0, hours - overtimeHours - doubletimeHours);
      gapTo = "regular";
    }
  }

  const tips = num(row.tips);
  const restBreak = num(row.rest_break);
  const sick = num(row.sick_pay);
  const travel = num(row.travel_pay);
  const reimbursement = num(row.reimbursement);
  const mileage = num(row.mileage_pay);
  const taxableGross = roundMoney(
    regularPay + overtimePay + doubletimePay + commissionOut + variableIncentive + tips + restBreak + bonus + sick + travel
  );
  // Sick leave lines list the sick hours; those are not hours worked.
  const sickOnly = sick !== 0 && Math.abs(taxableGross - sick) < 0.005;

  return {
    id: text(row.id) || `line-${index + 1}`,
    eventName: text(row.event_name),
    eventDate: isoDate(row.event_date),
    venue: text(row.venue),
    city: text(row.city),
    state: text(row.state),
    sourceSheet: row.source_sheet ? text(row.source_sheet) : null,
    isCommission: hasCommissionPay || categoryIsCommission,
    isRegister: row.extra?.[REGISTER_KEY] === true,
    hours: sickOnly ? 0 : roundMoney(hours),
    regularHours: roundMoney(regularHours),
    regularPay: roundMoney(regularPay),
    overtimeHours: roundMoney(overtimeHours),
    overtimePay: roundMoney(overtimePay),
    doubletimeHours: roundMoney(doubletimeHours),
    doubletimePay: roundMoney(doubletimePay),
    commission: roundMoney(commissionOut),
    variableIncentive: roundMoney(variableIncentive),
    tips: roundMoney(tips),
    restBreak: roundMoney(restBreak),
    bonus: roundMoney(bonus),
    sick: roundMoney(sick),
    travel: roundMoney(travel),
    reimbursement: roundMoney(reimbursement),
    mileage: roundMoney(mileage),
    gap,
    gapTo,
    regRate: hasValue(row.reg_rate) ? num(row.reg_rate) : null,
    rateInEffect: hasValue(row.rate_in_effect) ? num(row.rate_in_effect) : null,
    taxableGross,
    totalGrossPay,
  };
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

export function buildPaystubFromUploadedLines(rows: UploadedPayrollLineInput[]): {
  lines: PaystubUploadLine[];
  totals: PaystubUploadTotals;
} {
  const lines = rows.map((r, i) => toPaystubUploadLine(r, i));
  return { lines, totals: summarizePaystubUploadLines(lines) };
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
  const paidByName = new Map<string, number>();
  rows.forEach((r) => {
    const paid = r.extra?.[REGISTER_PAID_KEY];
    if (typeof paid === "number") paidByName.set(payrollNameKey(r), paid);
  });
  const registerLinesTotal = roundMoney(rows.filter((r) => r.extra?.[REGISTER_KEY] === true).reduce((s, r) => s + num(r.total_gross_pay), 0));
  if (paidByName.size > 0) {
    const paid = roundMoney(Array.from(paidByName.values()).reduce((s, v) => s + v, 0) + registerLinesTotal);
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
