// Shared field definitions and helpers for the HR dashboard "Upload Payroll"
// panel (app/hr-dashboard/PayrollUploadPanel.tsx) and its API routes
// (app/api/hr/payroll-uploads). Row keys match the columns of
// public.payroll_period_upload_rows so no mapping layer is needed.
//
// The parser accepts this dashboard's own "Export to Excel" workbook (the
// "Vendor Payments" sheet, per-vendor TOTAL rows skipped) as well as simpler
// sheets with columns like "Employee Name", "Email", "Hours", "Gross Pay".

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
  { key: "regular_hours", label: "Reg Hours", money: false, aliases: ["regular time hours", "regular hours", "reg hours", "regular hrs"] },
  { key: "regular_pay", label: "Reg Pay", money: true, aliases: ["regular time pay", "regular pay", "reg pay"] },
  { key: "overtime_hours", label: "OT Hours", money: false, aliases: ["overtime hours", "ot hours", "overtime hrs"] },
  { key: "overtime_pay", label: "OT Pay", money: true, aliases: ["overtime pay", "ot pay"] },
  { key: "doubletime_hours", label: "DT Hours", money: false, aliases: ["double time hours", "doubletime hours", "dt hours"] },
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
export const isNumericPayrollField = (key: string): key is PayrollUploadNumericKey => NUMERIC_KEY_SET.has(key);

export type PayrollUploadFields = { [K in PayrollUploadTextKey]: string | null } & {
  [K in PayrollUploadNumericKey]: number | null;
};

export type PayrollUploadRow = PayrollUploadFields & {
  id: string;
  sort_order: number;
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

  const recognized: string[] = [];
  const unrecognized: string[] = [];
  headerRow.forEach((h, i) => {
    const label = String(h ?? "").trim();
    if (!label) return;
    if (byColumn[i]) recognized.push(label);
    else unrecognized.push(label);
  });
  return { byColumn, recognized, unrecognized };
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

export type ParsedPayrollSheet = {
  sheetName: string;
  headerRowNumber: number; // 1-based, as Excel shows it
  rows: PayrollUploadRow[];
  skippedRows: number;
  unreadableCells: number;
  recognizedColumns: string[];
  unrecognizedColumns: string[];
};

let tempIdCounter = 0;
export const newTempRowId = () => `tmp-${Date.now().toString(36)}-${(tempIdCounter += 1)}`;
export const isTempRowId = (id: string) => id.startsWith("tmp-");

// Turns a sheet (as an array of rows from XLSX.utils.sheet_to_json with
// header: 1) into payroll lines. Blank rows and TOTAL/subtotal rows are skipped.
export const parsePayrollSheet = (sheetName: string, rows: unknown[][]): ParsedPayrollSheet | null => {
  const header = detectPayrollHeaderRow(rows);
  if (header.index < 0) return null;
  const mapping = mapPayrollHeaders(rows[header.index] || []);
  const out: PayrollUploadRow[] = [];
  let skipped = 0;
  let unreadable = 0;

  for (let r = header.index + 1; r < rows.length; r += 1) {
    const cells = rows[r] || [];
    const fields = emptyPayrollFields() as Record<string, string | number | null>;
    const extra: PayrollUploadRow["extra"] = {};
    let hasAnyValue = false;
    let fullName = null as string | null;

    const headerCells = rows[header.index] || [];
    for (let c = 0; c < cells.length; c += 1) {
      const cell = cells[c];
      const key = mapping.byColumn[c];
      if (!key) {
        const headerLabel = String(headerCells[c] ?? "").trim();
        if (headerLabel && cell !== null && cell !== undefined && String(cell).trim() !== "") {
          extra[headerLabel] = cell instanceof Date ? parsePayrollText(cell) : (cell as string | number | boolean);
        }
        continue;
      }
      if (key === "__full_name") {
        fullName = parsePayrollText(cell);
        if (fullName) hasAnyValue = true;
        continue;
      }
      if (isNumericPayrollField(key)) {
        const num = parsePayrollNumber(cell, key.endsWith("hours"));
        if (num === undefined) {
          unreadable += 1;
          extra[`${String(headerCells[c] ?? key).trim()} (unreadable)`] = String(cell);
          continue;
        }
        fields[key] = num;
        if (num !== null) hasAnyValue = true;
      } else {
        const text = parsePayrollText(cell, key);
        fields[key] = key === "email" && text ? text.toLowerCase() : text;
        if (text) hasAnyValue = true;
      }
    }

    if (fullName) {
      const { first, last } = splitFullName(fullName);
      fields.first_name = first;
      fields.last_name = last;
    }

    const nameText = `${fields.first_name ?? ""} ${fields.last_name ?? ""}`.trim();
    const isTotalRow = /^(grand\s+)?(sub)?totals?\b/i.test(nameText) || /^(grand\s+)?(sub)?totals?\b/i.test(String(fields.venue ?? ""));
    const hasIdentity = Boolean(nameText || fields.email);
    if (!hasAnyValue) continue;
    if (isTotalRow || !hasIdentity) {
      skipped += 1;
      continue;
    }

    const typed = fields as unknown as PayrollUploadFields;
    out.push({
      ...typed,
      id: newTempRowId(),
      sort_order: out.length,
      source_row: r + 1,
      user_id: null,
      extra,
      original: { ...typed },
    });
  }

  return {
    sheetName,
    headerRowNumber: header.index + 1,
    rows: out,
    skippedRows: skipped,
    unreadableCells: unreadable,
    recognizedColumns: mapping.recognized,
    unrecognizedColumns: mapping.unrecognized,
  };
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    "commission_pay", "variable_incentive", "tips", "rest_break", "mileage_pay", "travel_pay", "reimbursement", "other", "total_gross_pay",
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
