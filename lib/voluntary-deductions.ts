// lib/voluntary-deductions.ts
//
// Voluntary deductions other than CalSavers / Misc Non Taxable (which have their own fields),
// e.g. ADP's "Creditor 1" wage garnishment. They travel the paystub pipeline like this:
//
//   ADP PDF  --/pdf-reader-->  payrollData.otherVoluntaryDeductions (parseOtherVoluntaryDeductions)
//            --Excel export-->  one "Voluntary: <label>" + "Voluntary: <label> YTD" column pair per label
//            --/paystub-generator import-->  voluntaryDeductionsFromRow
//            --/api/generate-paystub-->  one line each under Voluntary Deductions, subtracted from net pay
//
// Pure functions only, so the server route, the browser reader and both pages can share them.

export type VoluntaryDeductionLine = {
  label: string;
  /** This period as printed (ADP prints deductions negative); 0 when the column is blank. */
  thisPeriod: number;
  /** Year to date as printed; null when the line has no YTD. */
  yearToDate: number | null;
};

/** What /api/generate-paystub takes: positive amounts, YTD including this period. */
export type VoluntaryDeductionInput = { label: string; thisPeriod: number; ytd: number | null };

// Lines with a field of their own elsewhere in the pipeline.
const DEDICATED_LINE = /cal\s*savers|roth\s*ret|misc\s+non\s+taxable/i;
const SECTION_START = /^voluntary deductions\b/i;
const SECTION_END = /^(net pay|deposits|important notes|statutory deductions|other benefits|earnings?\b|gross pay)/i;
const AMOUNT_TOKEN = /^\(?-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?$/;
const MAX_LABEL_LENGTH = 40;

const parseAmount = (token: string): number => {
  const negative = token.includes('-') || /^\(.*\)$/.test(token);
  const value = Number.parseFloat(token.replace(/[()$,\-]/g, ''));
  return negative ? -Math.abs(value) : value;
};

/**
 * One statement line: a label, then a run of amounts. On ADP statements a $0 this-period
 * column is left blank, so the LAST amount is always year to date and the one before it
 * (when present) is this period. Anything after the run is the statement's right-hand
 * column and is ignored. "Creditor 1" keeps its 1: only amounts with cents count.
 */
function parseLine(rawLine: string): VoluntaryDeductionLine | null {
  const tokens = rawLine.replace(/\s+/g, ' ').trim().split(' ');
  const firstAmount = tokens.findIndex((token) => AMOUNT_TOKEN.test(token));
  if (firstAmount <= 0) return null;
  const label = tokens.slice(0, firstAmount).join(' ').trim();
  if (!/[A-Za-z]/.test(label) || label.length > MAX_LABEL_LENGTH) return null;
  const run: number[] = [];
  for (let i = firstAmount; i < tokens.length && AMOUNT_TOKEN.test(tokens[i]); i++) {
    run.push(parseAmount(tokens[i]));
  }
  if (run.length === 0) return null;
  return {
    label,
    thisPeriod: run.length >= 2 ? run[run.length - 2] : 0,
    yearToDate: run[run.length - 1],
  };
}

/** The lines of a paystub's "Voluntary Deductions" section, minus CalSavers / Misc Non Taxable. */
export function parseOtherVoluntaryDeductions(text: string): VoluntaryDeductionLine[] {
  const lines = (text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const found: VoluntaryDeductionLine[] = [];
  let inSection = false;
  for (const line of lines) {
    if (SECTION_START.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (SECTION_END.test(line)) {
      inSection = false;
      continue;
    }
    if (/^(this period|year to date)\b/i.test(line) || DEDICATED_LINE.test(line)) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const existing = found.find((entry) => entry.label.toLowerCase() === parsed.label.toLowerCase());
    if (!existing) found.push(parsed);
  }
  return found;
}

// ---- Excel columns (/pdf-reader export <-> /paystub-generator import) ----

export const VOLUNTARY_COLUMN_PREFIX = 'Voluntary: ';

export const voluntaryColumnHeaders = (label: string): { thisPeriod: string; ytd: string } => ({
  thisPeriod: `${VOLUNTARY_COLUMN_PREFIX}${label}`,
  ytd: `${VOLUNTARY_COLUMN_PREFIX}${label} YTD`,
});

const columnNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = typeof value === 'number' ? value : parseAmount(String(value).trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * The voluntary deductions of one Excel row, from its "Voluntary: <label>" column pairs.
 * Amounts come back positive; lines with no amount this period and no YTD are left out.
 */
export function voluntaryDeductionsFromRow(headers: unknown[], row: unknown[]): VoluntaryDeductionInput[] {
  const names = headers.map((header) => String(header ?? '').trim());
  const out: VoluntaryDeductionInput[] = [];
  names.forEach((header, index) => {
    if (!header.toLowerCase().startsWith(VOLUNTARY_COLUMN_PREFIX.toLowerCase())) return;
    if (/\s+ytd$/i.test(header)) return;
    const label = header.slice(VOLUNTARY_COLUMN_PREFIX.length).trim();
    if (!label) return;
    const ytdIndex = names.findIndex((name) => name.toLowerCase() === `${header} ytd`.toLowerCase());
    const thisPeriod = Math.abs(columnNumber(row[index]) ?? 0);
    const ytdRaw = ytdIndex >= 0 ? columnNumber(row[ytdIndex]) : null;
    const ytd = ytdRaw === null ? null : Math.abs(ytdRaw);
    if (thisPeriod === 0 && !ytd) return;
    out.push({ label, thisPeriod, ytd });
  });
  return out;
}

/** Request field for /api/generate-paystub, cleaned: at most 6 lines, positive cents. */
export function sanitizeVoluntaryDeductions(input: unknown): VoluntaryDeductionInput[] {
  if (!Array.isArray(input)) return [];
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return input
    .map((entry: any) => {
      const label = String(entry?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH);
      const thisPeriod = Math.abs(Number(entry?.thisPeriod));
      const ytdNumber = entry?.ytd === null || entry?.ytd === undefined || entry?.ytd === '' ? NaN : Math.abs(Number(entry.ytd));
      return {
        label,
        thisPeriod: Number.isFinite(thisPeriod) ? round2(thisPeriod) : 0,
        ytd: Number.isFinite(ytdNumber) ? round2(ytdNumber) : null,
      };
    })
    .filter((entry) => entry.label && !DEDICATED_LINE.test(entry.label) && (entry.thisPeriod > 0 || (entry.ytd ?? 0) > 0))
    .slice(0, 6);
}
