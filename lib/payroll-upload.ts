// Shared field definitions and helpers for the HR dashboard "Upload Payroll"
// panel (app/hr-dashboard/PayrollUploadPanel.tsx) and its API routes
// (app/api/hr/payroll-uploads). Row keys match the columns of
// public.payroll_period_upload_rows so no mapping layer is needed.
//
// The parser accepts this dashboard's own "Export to Excel" workbook (the
// "Vendor Payments" sheet, per-vendor TOTAL rows skipped), HR's final payroll
// workbooks (one sheet per region or event, the header repeated above each
// employee, "Rate in effect" / "Variable incentive" / "Total" helper rows under
// an employee, a sick leave sheet, a reimbursements sheet) and simpler sheets
// with columns like "Employee Name", "Email", "Hours", "Gross Pay". Sheets
// from several files can be combined into one upload.

export const PAYROLL_UPLOAD_TEXT_FIELDS = [
  { key: "first_name", label: "First Name", aliases: ["first name", "firstname", "first", "employee first name"] },
  { key: "last_name", label: "Last Name", aliases: ["last name", "lastname", "last", "surname", "employee last name"] },
  { key: "email", label: "Email", aliases: ["vendor email", "email", "employee email", "e mail", "email address"] },
  { key: "category", label: "Category", aliases: ["category", "pay type", "type"] },
  { key: "venue", label: "Venue", aliases: ["venue", "location"] },
  { key: "city", label: "City", aliases: ["city"] },
  { key: "state", label: "State", aliases: ["state"] },
  { key: "event_name", label: "Event", aliases: ["event name", "event", "artist show", "show"] },
  { key: "event_date", label: "Event Date", aliases: ["event date", "show date", "date", "work date"] },
] as const;

export const PAYROLL_UPLOAD_NUMERIC_FIELDS = [
  { key: "reg_rate", label: "Reg Rate", money: true, aliases: ["reg rate", "regular rate", "pay rate", "hourly rate", "rate"] },
  { key: "rate_in_effect", label: "Rate in Effect", money: true, aliases: ["rate in effect", "loaded rate", "effective rate"] },
  { key: "hours", label: "Hours", money: false, aliases: ["hours in decimal", "decimal hours", "total hours", "hours worked", "hours"] },
  { key: "regular_hours", label: "Reg Hours", money: false, aliases: ["regular time hours", "regular hours", "reg hours", "regular hrs", "reg hrs"] },
  { key: "regular_pay", label: "Reg Pay", money: true, aliases: ["regular time pay", "regular pay", "reg pay", "reg hrs pay", "regular hrs pay", "reg hours pay"] },
  { key: "overtime_hours", label: "OT Hours", money: false, aliases: ["overtime hours", "ot hours", "overtime hrs", "ot hrs"] },
  { key: "overtime_pay", label: "OT Pay", money: true, aliases: ["overtime pay", "ot pay"] },
  { key: "doubletime_hours", label: "DT Hours", money: false, aliases: ["double time hours", "doubletime hours", "dt hours", "dt hrs", "double time hrs"] },
  { key: "doubletime_pay", label: "DT Pay", money: true, aliases: ["double time pay", "doubletime pay", "dt pay"] },
  { key: "commission_pay", label: "Commission", money: true, aliases: ["commission pay", "commission"] },
  { key: "variable_incentive", label: "Var. Incentive", money: true, aliases: ["variable incentive", "incentive"] },
  { key: "tips", label: "Tips", money: true, aliases: ["tips", "credit card tips"] },
  { key: "rest_break", label: "Rest Break", money: true, aliases: ["rest break", "rest break pay", "rest breaks"] },
  { key: "mileage_miles", label: "Miles", money: false, aliases: ["mileage miles", "miles"] },
  { key: "mileage_pay", label: "Mileage Pay", money: true, aliases: ["mileage pay", "mileage"] },
  { key: "travel_pay", label: "Travel Pay", money: true, aliases: ["travel pay"] },
  { key: "reimbursement", label: "Reimbursement", money: true, aliases: ["reimbursement", "reimbursements"] },
  { key: "other", label: "Other", money: true, aliases: ["other", "adjustment", "adjustments"] },
  { key: "bonus", label: "Bonus", money: true, aliases: ["bonus", "bonus pay"] },
  { key: "sick_pay", label: "Sick Pay", money: true, aliases: ["sick pay", "sick leave pay", "sick leave", "sick"] },
  { key: "total_gross_pay", label: "Total Gross", money: true, aliases: ["total gross pay", "gross pay", "total gross", "gross", "total pay"] },
] as const;

export type PayrollUploadTextKey = (typeof PAYROLL_UPLOAD_TEXT_FIELDS)[number]["key"];
export type PayrollUploadNumericKey = (typeof PAYROLL_UPLOAD_NUMERIC_FIELDS)[number]["key"];
export type PayrollUploadFieldKey = PayrollUploadTextKey | PayrollUploadNumericKey;

export const PAYROLL_UPLOAD_FIELD_KEYS: PayrollUploadFieldKey[] = [
  ...PAYROLL_UPLOAD_TEXT_FIELDS.map((f) => f.key),
  ...PAYROLL_UPLOAD_NUMERIC_FIELDS.map((f) => f.key),
];

const NUMERIC_KEY_SET = new Set<string>(PAYROLL_UPLOAD_NUMERIC_FIELDS.map((f) => f.key));
export const PAYROLL_FIELD_LABELS = Object.fromEntries(
  [...PAYROLL_UPLOAD_TEXT_FIELDS, ...PAYROLL_UPLOAD_NUMERIC_FIELDS].map((f) => [f.key, f.label])
) as Record<PayrollUploadFieldKey, string>;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isNumericPayrollField = (key: string): key is PayrollUploadNumericKey => NUMERIC_KEY_SET.has(key);

export type PayrollUploadFields = { [K in PayrollUploadTextKey]: string | null } & {
  [K in PayrollUploadNumericKey]: number | null;
};

export type PayrollUploadRow = PayrollUploadFields & {
  id: string;
  sort_order: number;
  // File, sheet and row the line came from (null for lines added by hand).
  source_file: string | null;
  source_sheet: string | null;
  source_row: number | null;
  user_id: string | null;
  extra: Record<string, string | number | boolean | null>;
  // Values as first uploaded; null for lines added by hand during review.
  original: Partial<PayrollUploadFields> | null;
};

export type PayrollUploadSummary = {
  id: string;
  period_start: string;
  period_end: string;
  file_name: string | null;
  sheet_name: string | null;
  status: "draft" | "reviewed";
  // True when this upload replaces the system payroll for its exact period.
  is_active: boolean;
  notes: string | null;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  row_count: number;
  total_gross_pay: number;
  total_hours: number;
};

// Pay columns that add up to Total Gross Pay in this dashboard's exports.
export const GROSS_COMPONENT_KEYS: PayrollUploadNumericKey[] = [
  "regular_pay",
  "overtime_pay",
  "doubletime_pay",
  "commission_pay",
  "variable_incentive",
  "tips",
  "rest_break",
  "mileage_pay",
  "travel_pay",
  "reimbursement",
  "other",
  "bonus",
  "sick_pay",
];

export const GROSS_MISMATCH_TOLERANCE = 0.05;

export const emptyPayrollFields = (): PayrollUploadFields => {
  const out: Record<string, null> = {};
  PAYROLL_UPLOAD_FIELD_KEYS.forEach((k) => {
    out[k] = null;
  });
  return out as unknown as PayrollUploadFields;
};

export const pickPayrollFields = (row: Partial<PayrollUploadFields>): PayrollUploadFields => {
  const out = emptyPayrollFields() as Record<string, string | number | null>;
  PAYROLL_UPLOAD_FIELD_KEYS.forEach((k) => {
    const v = (row as Record<string, unknown>)[k];
    out[k] = v === undefined ? null : (v as string | number | null);
  });
  return out as unknown as PayrollUploadFields;
};

export const normalizeHeader = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Parses a spreadsheet or typed value into a number. Accepts "$1,234.50",
// "(12.00)" for negatives and "H:MM" durations (hours fields only).
// Returns null for blanks and markers like "N/A"; undefined when unreadable.
export const parsePayrollNumber = (value: unknown, allowDuration = false): number | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return undefined;
  let raw = String(value).trim();
  // Accounting number format shows zero as "$ -".
  if (/^\$\s*-+$/.test(raw)) return 0;
  if (raw === "" || /^(n\/?a|none|-+|—)$/i.test(raw)) return null;
  if (allowDuration && /^\d{1,3}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":").map(Number);
    return Math.round((h + m / 60) * 100) / 100;
  }
  let negative = false;
  if (/^\(.*\)$/.test(raw)) {
    negative = true;
    raw = raw.slice(1, -1);
  }
  raw = raw.replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(raw)) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return negative ? -num : num;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

// Excel stores dates as serial numbers (days since 1899-12-30).
const excelSerialToIso = (serial: number): string | null => {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

export const parsePayrollText = (value: unknown, key?: string): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // A time with no date comes back as a day in December 1899.
    if (value.getFullYear() < 1900) return `${value.getHours()}:${pad2(value.getMinutes())}`;
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  if (key === "event_date" && typeof value === "number") {
    return excelSerialToIso(value) ?? String(value);
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
};

type HeaderMapping = {
  // column index -> field key, or "__full_name" for a single name column
  byColumn: Record<number, PayrollUploadFieldKey | "__full_name">;
  recognized: string[];
  unrecognized: string[];
  // "reimbursements" = the reimbursement export (Vendor, Event, Requested, Approved …).
  layout: "payroll" | "reimbursements";
  hasTotalColumn: boolean;
};

const FULL_NAME_ALIASES = ["employee name", "name", "employee", "vendor name", "vendor", "full name", "worker"];

export const mapPayrollHeaders = (headerRow: unknown[]): HeaderMapping => {
  const normalized = headerRow.map(normalizeHeader);
  const claimed = new Set<number>();
  const byColumn: HeaderMapping["byColumn"] = {};

  const claim = (aliases: readonly string[]): number => {
    for (const alias of aliases) {
      const idx = normalized.findIndex((h, i) => h !== "" && h === alias && !claimed.has(i));
      if (idx >= 0) {
        claimed.add(idx);
        return idx;
      }
    }
    return -1;
  };

  // Numeric fields first so "Total Gross Pay" wins over a looser text alias.
  for (const field of PAYROLL_UPLOAD_NUMERIC_FIELDS) {
    const idx = claim(field.aliases);
    if (idx >= 0) byColumn[idx] = field.key;
  }
  for (const field of PAYROLL_UPLOAD_TEXT_FIELDS) {
    const idx = claim(field.aliases);
    if (idx >= 0) byColumn[idx] = field.key;
  }
  const hasSplitName = Object.values(byColumn).some((k) => k === "first_name" || k === "last_name");
  if (!hasSplitName) {
    const idx = claim(FULL_NAME_ALIASES);
    if (idx >= 0) byColumn[idx] = "__full_name";
  }
  // Reimbursement export: the "Approved" amount is what gets paid.
  const layout: HeaderMapping["layout"] =
    normalized.includes("approved") && (normalized.includes("requested") || normalized.includes("receipt")) ? "reimbursements" : "payroll";
  if (layout === "reimbursements" && !Object.values(byColumn).includes("reimbursement")) {
    const idx = claim(["approved"]);
    if (idx >= 0) byColumn[idx] = "reimbursement";
  }

  const recognized: string[] = [];
  const unrecognized: string[] = [];
  headerRow.forEach((h, i) => {
    const label = String(h ?? "").trim();
    if (!label) return;
    if (byColumn[i]) recognized.push(label);
    else unrecognized.push(label);
  });
  return { byColumn, recognized, unrecognized, layout, hasTotalColumn: Object.values(byColumn).includes("total_gross_pay") };
};

// Finds the header row within the first rows of a sheet: the row that maps
// to the most payroll fields (at least two, one of them a name or email).
export const detectPayrollHeaderRow = (rows: unknown[][]): { index: number; score: number } => {
  let best = { index: -1, score: 0 };
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] || [];
    const mapping = mapPayrollHeaders(row);
    const keys = Object.values(mapping.byColumn);
    const hasIdentity = keys.some((k) => k === "email" || k === "first_name" || k === "last_name" || k === "__full_name");
    const score = hasIdentity ? keys.length : 0;
    if (score >= 2 && score > best.score) best = { index: i, score };
  }
  return best;
};

const splitFullName = (full: string): { first: string | null; last: string | null } => {
  const text = full.replace(/\s+/g, " ").trim();
  if (!text) return { first: null, last: null };
  if (text.includes(",")) {
    const [last, ...rest] = text.split(",");
    return { first: rest.join(",").trim() || null, last: last.trim() || null };
  }
  const parts = text.split(" ");
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
};

export type SheetNote = { row: number; text: string };

export type ParsedPayrollSheet = {
  // Unique across files: "<file>::<sheet>", or just the sheet name with no file.
  key: string;
  fileName: string;
  sheetName: string;
  headerRowNumber: number; // 1-based, as Excel shows it
  layout: "payroll" | "reimbursements";
  rows: PayrollUploadRow[];
  totalGross: number;
  // TOTAL/subtotal rows and other rows with amounts but no employee.
  skippedRows: number;
  // Header rows repeated further down the sheet (a new block of employees).
  repeatedHeaders: number;
  // Employee blocks whose last line was adjusted to match the block's "Total" row
  // (usually a variable-incentive top-up to the hourly floor).
  totalRowAdjustments: number;
  // Rows with text the parser doesn't understand, such as "paid" or "short".
  notes: SheetNote[];
  unreadableCells: number;
  recognizedColumns: string[];
  unrecognizedColumns: string[];
};

let tempIdCounter = 0;
export const newTempRowId = () => `tmp-${Date.now().toString(36)}-${(tempIdCounter += 1)}`;
export const isTempRowId = (id: string) => id.startsWith("tmp-");

const IDENTITY_KEYS = new Set(["email", "first_name", "last_name", "__full_name"]);

// A row is a (repeated) header when it names at least three payroll columns,
// one of them an employee column.
const headerScore = (cells: unknown[]): number => {
  if (!cells.some((c) => typeof c === "string" && c.trim() !== "")) return 0;
  const keys = Object.values(mapPayrollHeaders(cells).byColumn);
  return keys.some((k) => IDENTITY_KEYS.has(k)) ? keys.length : 0;
};

// Labels found in the name/email columns of helper rows under an employee.
type HelperKind = "rate" | "vi" | "total";
const helperKindOf = (text: string): HelperKind | null => {
  const t = normalizeHeader(text);
  if (t === "rate in effect" || t === "rate") return "rate";
  if (t === "variable incentive" || t === "variable" || t === "vi") return "vi";
  if (t === "total" || t === "totals" || t === "subtotal" || t === "sub total" || t === "grand total") return "total";
  return null;
};

// Words that show up in these workbooks as layout, not as notes about pay.
const IGNORED_NOTE_WORDS = new Set(["rates", "rate", "hourly", "commission"]);

const cellText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (parsePayrollNumber(t, true) !== undefined) return null; // numbers, "$ -", "N/A"
  return t;
};

// Amount columns reconciled against an employee block's "Total" row.
const TOTAL_ROW_KEYS: PayrollUploadNumericKey[] = [
  "regular_pay",
  "overtime_pay",
  "doubletime_pay",
  "commission_pay",
  "variable_incentive",
  "tips",
  "rest_break",
  "mileage_pay",
  "travel_pay",
  "reimbursement",
  "other",
  "bonus",
  "sick_pay",
  "total_gross_pay",
];

// Turns a sheet (as an array of rows from XLSX.utils.sheet_to_json with
// header: 1) into payroll lines. Handles what HR's payroll workbooks contain:
// - the header repeated above each employee block, sometimes with different columns;
// - TOTAL / subtotal rows, which are skipped;
// - helper rows under an employee ("Rate in effect", "Variable incentive",
//   "Total"), where the "Total" row is the final pay for that employee's block;
// - reimbursement exports, where each record takes two rows (name, then email).
export const parsePayrollSheet = (sheetName: string, rows: unknown[][], fileName = ""): ParsedPayrollSheet | null => {
  const header = detectPayrollHeaderRow(rows);
  if (header.index < 0) return null;

  let headerCells: unknown[] = rows[header.index] || [];
  let mapping = mapPayrollHeaders(headerCells);
  const firstMapping = mapping;
  const recognized = new Set<string>(mapping.recognized);
  const unrecognized = new Set<string>(mapping.unrecognized);
  const out: PayrollUploadRow[] = [];
  const notes: SheetNote[] = [];
  let skipped = 0;
  let unreadable = 0;
  let repeatedHeaders = 0;
  let totalRowAdjustments = 0;

  // Lines of the employee block being read, and a "Variable incentive" helper
  // row waiting for the block's "Total" row.
  let block: PayrollUploadRow[] = [];
  let pendingVi = null as { amount: number; gross: number; row: number } | null;

  const refreshOriginal = (line: PayrollUploadRow) => {
    line.original = pickPayrollFields(line);
  };
  const closeBlock = () => {
    // No "Total" row came: add the variable-incentive helper row to the last line.
    if (pendingVi && block.length > 0) {
      const last = block[block.length - 1];
      last.variable_incentive = roundMoney(Number(last.variable_incentive || 0) + pendingVi.amount);
      last.total_gross_pay = roundMoney(Number(last.total_gross_pay || 0) + pendingVi.gross);
      last.extra["Variable incentive top-up"] = roundMoney(pendingVi.amount);
      last.extra["Top-up from sheet row"] = pendingVi.row;
      refreshOriginal(last);
      totalRowAdjustments += 1;
    }
    pendingVi = null;
    block = [];
  };
  const noteOnBlock = (row: number, text: string) => {
    notes.push({ row, text });
    block.forEach((line) => {
      const prior = line.extra["Notes in file"];
      line.extra["Notes in file"] = prior ? `${prior}; ${text}` : text;
    });
  };

  for (let r = header.index + 1; r < rows.length; r += 1) {
    const cells = rows[r] || [];
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;

    if (headerScore(cells) >= 3) {
      closeBlock();
      headerCells = cells;
      mapping = mapPayrollHeaders(cells);
      mapping.recognized.forEach((h) => recognized.add(h));
      mapping.unrecognized.forEach((h) => unrecognized.add(h));
      repeatedHeaders += 1;
      continue;
    }

    const fields = emptyPayrollFields() as Record<string, string | number | null>;
    const extra: PayrollUploadRow["extra"] = {};
    let hasAmount = false;
    let hasAnyValue = false;
    let fullName = null as string | null;
    let emailCellText = null as string | null;
    const texts: string[] = [];

    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c];
      if (cell === null || cell === undefined || String(cell).trim() === "") continue;
      hasAnyValue = true;
      const key = mapping.byColumn[c];
      const text = cellText(cell);
      if (!key) {
        const headerLabel = String(headerCells[c] ?? "").trim();
        if (text) texts.push(text);
        if (headerLabel) extra[headerLabel] = cell instanceof Date ? parsePayrollText(cell) : (cell as string | number | boolean);
        continue;
      }
      if (key === "__full_name") {
        fullName = parsePayrollText(cell);
        continue;
      }
      if (isNumericPayrollField(key)) {
        const num = parsePayrollNumber(cell, key.endsWith("hours"));
        if (num === undefined) {
          unreadable += 1;
          if (text) texts.push(text);
          extra[`${String(headerCells[c] ?? key).trim()} (unreadable)`] = String(cell);
          continue;
        }
        fields[key] = num;
        if (num !== null && key !== "reg_rate" && key !== "rate_in_effect" && key !== "hours") hasAmount = true;
      } else {
        if ((key === "first_name" || key === "last_name") && (cell instanceof Date || typeof cell === "number")) {
          // A date or number in a name column is a note, not a name.
          const headerLabel = String(headerCells[c] ?? key).trim();
          extra[headerLabel] = cell instanceof Date ? parsePayrollText(cell) : (cell as number);
          continue;
        }
        const value = parsePayrollText(cell, key);
        if (key === "email") {
          emailCellText = value;
          fields.email = value && EMAIL_RE.test(value) ? value.toLowerCase() : null;
          if (text && !fields.email && !helperKindOf(text)) texts.push(text);
        } else {
          fields[key] = value;
          if (text && key !== "event_name" && key !== "venue" && key !== "category" && key !== "city" && key !== "state") texts.push(text);
        }
      }
    }
    if (!hasAnyValue) continue;

    if (fullName) {
      if (EMAIL_RE.test(fullName)) {
        fields.email = fullName.toLowerCase();
      } else {
        const { first, last } = splitFullName(fullName);
        fields.first_name = first;
        fields.last_name = last;
      }
    }
    const nameText = `${fields.first_name ?? ""} ${fields.last_name ?? ""}`.trim();
    const email = fields.email as string | null;

    // ---- rows without an employee: helper, continuation, subtotal or note rows ----
    if (!nameText && !email) {
      const helper = helperKindOf(emailCellText || "") || helperKindOf(String(fields.first_name || ""));
      const otherTexts = texts.filter((t) => !helperKindOf(t) && !IGNORED_NOTE_WORDS.has(normalizeHeader(t)));
      if (helper === "rate") {
        if (otherTexts.length) noteOnBlock(r + 1, otherTexts.join(", "));
        continue;
      }
      if (helper === "vi" && block.length > 0) {
        const amount = Number(fields.variable_incentive ?? fields.total_gross_pay ?? 0);
        const gross = Number(fields.total_gross_pay ?? amount);
        pendingVi = { amount: (pendingVi?.amount || 0) + amount, gross: (pendingVi?.gross || 0) + gross, row: r + 1 };
        continue;
      }
      if (helper === "total" && block.length > 0) {
        // The block's final figures: move any difference onto its last line.
        const last = block[block.length - 1];
        const changes: string[] = [];
        TOTAL_ROW_KEYS.forEach((k) => {
          const target = fields[k];
          if (typeof target !== "number") return;
          const current = block.reduce((sum, line) => sum + Number(line[k] || 0), 0);
          const delta = roundMoney(target - current);
          if (Math.abs(delta) < 0.005) return;
          last[k] = roundMoney(Number(last[k] || 0) + delta);
          changes.push(`${PAYROLL_FIELD_LABELS[k]} ${delta > 0 ? "+" : ""}${delta.toFixed(2)}`);
        });
        if (changes.length > 0) {
          last.extra["Adjusted to Total row"] = `Row ${r + 1}: ${changes.join(", ")}`;
          refreshOriginal(last);
          totalRowAdjustments += 1;
        }
        pendingVi = null;
        block = [];
        if (otherTexts.length) notes.push({ row: r + 1, text: otherTexts.join(", ") });
        continue;
      }
      if (otherTexts.length) noteOnBlock(r + 1, otherTexts.join(", "));
      if (hasAmount) skipped += 1;
      continue;
    }

    // ---- second row of a two-row record (reimbursement exports): email only ----
    if (!nameText && email && !hasAmount && out.length > 0 && !out[out.length - 1].email) {
      const prev = out[out.length - 1];
      prev.email = email;
      Object.entries(extra).forEach(([k, v]) => {
        if (v !== null && v !== "") prev.extra[`${k} (2nd row)`] = v;
      });
      if (fields.event_name) prev.extra["Event (2nd row)"] = fields.event_name;
      refreshOriginal(prev);
      continue;
    }

    // ---- TOTAL rows from this dashboard's own export ("TOTAL - Name") ----
    const isTotalRow = /^(grand\s+)?(sub)?totals?\b/i.test(nameText) || /^(grand\s+)?(sub)?totals?\b/i.test(String(fields.venue ?? ""));
    if (isTotalRow) {
      closeBlock();
      skipped += 1;
      continue;
    }

    // ---- an employee line ----
    if (emailCellText && !email) {
      // The Email column holds something else: the row's columns may be shifted.
      const found = cells.map((c) => (typeof c === "string" ? c.trim() : "")).find((c) => EMAIL_RE.test(c));
      extra["Email column had"] = emailCellText;
      if (found) extra["Email found in another column"] = found.toLowerCase();
    }
    if (mapping.layout === "reimbursements" && fields.event_name && !fields.event_date) {
      // Keep the record readable: "Standalone" reimbursement with its description.
      const description = extra["Description"];
      if (typeof description === "string" && description.trim()) fields.event_name = `${fields.event_name}: ${description.trim()}`;
    }
    const typed = fields as unknown as PayrollUploadFields;
    if (!mapping.hasTotalColumn && typed.total_gross_pay === null && hasAnyGrossComponent(typed)) {
      typed.total_gross_pay = grossComponentSum(typed);
      extra["Total Gross Pay"] = "computed from the pay columns";
    }

    const line: PayrollUploadRow = {
      ...typed,
      id: newTempRowId(),
      sort_order: out.length,
      source_file: fileName || null,
      source_sheet: sheetName,
      source_row: r + 1,
      user_id: null,
      extra,
      original: { ...typed },
    };
    const lastInBlock = block[block.length - 1];
    if (lastInBlock && payrollRowPersonKey(lastInBlock) !== payrollRowPersonKey(line)) closeBlock();
    block.push(line);
    out.push(line);
  }
  closeBlock();

  return {
    key: fileName ? `${fileName}::${sheetName}` : sheetName,
    fileName,
    sheetName,
    headerRowNumber: header.index + 1,
    layout: firstMapping.layout,
    rows: out,
    totalGross: roundMoney(out.reduce((s, l) => s + Number(l.total_gross_pay || 0), 0)),
    skippedRows: skipped,
    repeatedHeaders,
    totalRowAdjustments,
    notes,
    unreadableCells: unreadable,
    recognizedColumns: Array.from(recognized),
    unrecognizedColumns: Array.from(unrecognized).filter((h) => !recognized.has(h)),
  };
};

// Which sheets to include by default, per file: this dashboard's own export
// keeps its "Vendor Payments" sheet (the other sheets repeat the same lines);
// any other workbook includes every sheet that has payroll lines.
export const defaultPayrollSheetSelection = (sheets: ParsedPayrollSheet[]): string[] => {
  const byFile = new Map<string, ParsedPayrollSheet[]>();
  sheets.forEach((sheet) => byFile.set(sheet.fileName, [...(byFile.get(sheet.fileName) || []), sheet]));
  const keys: string[] = [];
  byFile.forEach((fileSheets) => {
    const vendorPayments = fileSheets.find((sh) => sh.sheetName.trim().toLowerCase() === "vendor payments");
    if (vendorPayments) keys.push(vendorPayments.key);
    else fileSheets.forEach((sh) => keys.push(sh.key));
  });
  return keys;
};

// Lines from the chosen sheets (by key), in file and sheet order, numbered for review.
export const combinePayrollSheets = (sheets: ParsedPayrollSheet[], selectedKeys: string[], startAt = 0): PayrollUploadRow[] => {
  const chosen = new Set(selectedKeys);
  const rows: PayrollUploadRow[] = [];
  sheets.forEach((sheet) => {
    if (!chosen.has(sheet.key)) return;
    sheet.rows.forEach((row) => rows.push({ ...row, id: newTempRowId(), sort_order: startAt + rows.length }));
  });
  return rows;
};

export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const grossComponentSum = (row: Partial<PayrollUploadFields>): number =>
  roundMoney(GROSS_COMPONENT_KEYS.reduce((sum, k) => sum + Number(row[k] ?? 0), 0));

export const hasAnyGrossComponent = (row: Partial<PayrollUploadFields>): boolean =>
  GROSS_COMPONENT_KEYS.some((k) => row[k] !== null && row[k] !== undefined);

export const payrollRowName = (row: Partial<PayrollUploadFields>): string =>
  `${row.first_name ?? ""} ${row.last_name ?? ""}`.replace(/\s+/g, " ").trim();

// Key used to group lines per employee: email when present, otherwise name.
export const payrollRowPersonKey = (row: Partial<PayrollUploadFields>): string => {
  const email = (row.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  return `name:${payrollRowName(row).toLowerCase()}`;
};

export type PayrollRowIssue = { code: string; message: string };

export const payrollRowIssues = (row: PayrollUploadRow, opts?: { duplicate?: boolean }): PayrollRowIssue[] => {
  const issues: PayrollRowIssue[] = [];
  if (!payrollRowName(row)) issues.push({ code: "no-name", message: "No employee name" });
  if (!row.email) issues.push({ code: "no-email", message: "No email, so the line can't be matched to an employee" });
  else if (!EMAIL_RE.test(row.email)) issues.push({ code: "bad-email", message: "Email doesn't look valid" });
  if (row.total_gross_pay === null) {
    issues.push({ code: "no-total", message: "No Total Gross Pay" });
  } else {
    if (row.total_gross_pay < 0) issues.push({ code: "negative", message: "Total Gross Pay is negative" });
    if (hasAnyGrossComponent(row)) {
      const diff = roundMoney(row.total_gross_pay - grossComponentSum(row));
      if (Math.abs(diff) > GROSS_MISMATCH_TOLERANCE) {
        issues.push({
          code: "total-mismatch",
          message: `Total Gross Pay is ${diff > 0 ? "$" + diff.toFixed(2) + " more" : "$" + Math.abs(diff).toFixed(2) + " less"} than the sum of the pay columns (${grossComponentSum(row).toFixed(2)})`,
        });
      }
    }
  }
  const negativeField = PAYROLL_UPLOAD_NUMERIC_FIELDS.find(
    (f) => f.key !== "total_gross_pay" && f.key !== "other" && Number(row[f.key] ?? 0) < 0
  );
  if (negativeField) issues.push({ code: "negative-field", message: `${negativeField.label} is negative` });
  if (row.hours !== null && row.hours > 24 * 16) issues.push({ code: "hours-high", message: "Hours look too high for one pay period" });
  if (opts?.duplicate) issues.push({ code: "duplicate", message: "Same employee, event and date appear on another line" });
  const shiftedEmail = row.extra?.["Email found in another column"];
  if (typeof shiftedEmail === "string" && shiftedEmail && !row.email) {
    issues.push({
      code: "shifted",
      message: `Columns look shifted on this line: the Email column had "${row.extra?.["Email column had"] ?? ""}" and ${shiftedEmail} is in another column. Check it against the file.`,
    });
  }
  const fileNotes = row.extra?.["Notes in file"];
  if (typeof fileNotes === "string" && fileNotes) {
    issues.push({ code: "file-notes", message: `The file has notes next to this line: ${fileNotes}` });
  }
  if (row.user_id === null && row.email && EMAIL_RE.test(row.email) && row.id && !isTempRowId(row.id)) {
    issues.push({ code: "unmatched", message: "Email doesn't match any employee account" });
  }
  return issues;
};

export const duplicateLineIds = (rows: PayrollUploadRow[]): Set<string> => {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  rows.forEach((row) => {
    if (!row.event_name && !row.event_date) return;
    const key = `${payrollRowPersonKey(row)}|${(row.event_name || "").toLowerCase()}|${row.event_date || ""}`;
    const prior = seen.get(key);
    if (prior) {
      dupes.add(prior);
      dupes.add(row.id);
    } else {
      seen.set(key, row.id);
    }
  });
  return dupes;
};

export const isPayrollFieldEdited = (row: PayrollUploadRow, key: PayrollUploadFieldKey): boolean => {
  if (!row.original) return false;
  const before = row.original[key] ?? null;
  const after = row[key] ?? null;
  if (typeof before === "number" || typeof after === "number") {
    if (before === null || after === null) return before !== after;
    return Math.abs(Number(before) - Number(after)) > 0.0001;
  }
  return (before || "") !== (after || "");
};

export const isPayrollRowEdited = (row: PayrollUploadRow): boolean =>
  row.original === null || PAYROLL_UPLOAD_FIELD_KEYS.some((k) => isPayrollFieldEdited(row, k));

// Server-side: coerce an untrusted row body into DB-safe field values.
export const sanitizePayrollFields = (
  input: Record<string, unknown>
): { fields: PayrollUploadFields } | { error: string } => {
  const fields = emptyPayrollFields() as Record<string, string | number | null>;
  for (const f of PAYROLL_UPLOAD_TEXT_FIELDS) {
    const v = input[f.key];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v !== "string" && typeof v !== "number") return { error: `${f.label} must be text` };
    const text = String(v).replace(/\s+/g, " ").trim().slice(0, 300);
    fields[f.key] = f.key === "email" ? text.toLowerCase() || null : text || null;
  }
  for (const f of PAYROLL_UPLOAD_NUMERIC_FIELDS) {
    const v = input[f.key];
    const num = parsePayrollNumber(v, f.key.endsWith("hours"));
    if (num === undefined) return { error: `${f.label} "${String(v)}" is not a number` };
    if (num !== null && Math.abs(num) > 10_000_000) return { error: `${f.label} is out of range` };
    fields[f.key] = num;
  }
  return { fields: fields as unknown as PayrollUploadFields };
};

export const sanitizePayrollExtra = (input: unknown): PayrollUploadRow["extra"] => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: PayrollUploadRow["extra"] = {};
  Object.entries(input as Record<string, unknown>)
    .slice(0, 60)
    .forEach(([k, v]) => {
      const key = String(k).slice(0, 120);
      if (v === null || typeof v === "number" || typeof v === "boolean") out[key] = v as number | boolean | null;
      else out[key] = String(v).slice(0, 500);
    });
  return out;
};

// Column headers used when downloading uploaded payroll. They match the
// Payroll tab's own "Export to Excel" ("Vendor Payments" sheet), and every one
// is recognized by the parser above, so a download can be edited and re-uploaded.
export const PAYROLL_EXPORT_HEADERS: Record<PayrollUploadFieldKey, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Vendor Email",
  category: "Category",
  venue: "Venue",
  city: "City",
  state: "State",
  event_name: "Event Name",
  event_date: "Event Date",
  reg_rate: "Reg Rate",
  rate_in_effect: "Rate in Effect",
  hours: "Hours in Decimal",
  regular_hours: "Regular Time Hours",
  regular_pay: "Regular Time Pay",
  overtime_hours: "Overtime Hours",
  overtime_pay: "Overtime Pay",
  doubletime_hours: "Double Time Hours",
  doubletime_pay: "Double Time Pay",
  commission_pay: "Commission Pay",
  variable_incentive: "Variable Incentive",
  tips: "Tips",
  rest_break: "Rest Break",
  mileage_miles: "Mileage Miles",
  mileage_pay: "Mileage Pay",
  travel_pay: "Travel Pay",
  reimbursement: "Reimbursement",
  other: "Other",
  bonus: "Bonus",
  sick_pay: "Sick Pay",
  total_gross_pay: "Total Gross Pay",
};

// Rows (as header -> value objects) for a payroll download, with a TOTAL row
// at the end. Columns with no value on any line are left out; the name, email
// and Total Gross Pay columns are always included. Extra columns kept from the
// original file follow the known ones.
export const buildPayrollExportRows = (
  rows: PayrollUploadRow[]
): { header: string[]; data: Array<Record<string, string | number | boolean | null>> } => {
  const always = new Set<PayrollUploadFieldKey>(["first_name", "last_name", "email", "total_gross_pay"]);
  const keys = PAYROLL_UPLOAD_FIELD_KEYS.filter(
    (k) => always.has(k) || rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== "")
  );
  const known = new Set<string>(keys.map((k) => PAYROLL_EXPORT_HEADERS[k]));
  const extraKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.extra || {})))).filter((k) => !known.has(k));
  const header = [...keys.map((k) => PAYROLL_EXPORT_HEADERS[k]), ...extraKeys];

  const data: Array<Record<string, string | number | boolean | null>> = rows.map((row) => {
    const out: Record<string, string | number | boolean | null> = {};
    keys.forEach((k) => {
      out[PAYROLL_EXPORT_HEADERS[k]] = row[k] ?? null;
    });
    extraKeys.forEach((k) => {
      out[k] = row.extra?.[k] ?? null;
    });
    return out;
  });

  const summable = new Set<PayrollUploadNumericKey>([
    "hours", "regular_hours", "regular_pay", "overtime_hours", "overtime_pay", "doubletime_hours", "doubletime_pay",
    "commission_pay", "variable_incentive", "tips", "rest_break", "mileage_pay", "travel_pay", "reimbursement", "other", "bonus", "sick_pay", "total_gross_pay",
  ]);
  if (rows.length > 0) {
    const total: Record<string, string | number | boolean | null> = {};
    header.forEach((h) => {
      total[h] = null;
    });
    total[PAYROLL_EXPORT_HEADERS.first_name] = "TOTAL";
    keys.forEach((k) => {
      if (isNumericPayrollField(k) && summable.has(k)) {
        total[PAYROLL_EXPORT_HEADERS[k]] = roundMoney(rows.reduce((sum, r) => sum + Number(r[k] ?? 0), 0));
      }
    });
    data.push(total);
  }
  return { header, data };
};
