import * as XLSX from "xlsx";
import {
  PAYROLL_EXPORT_HEADERS,
  PAYROLL_UPLOAD_FIELD_KEYS,
  grossComponentSum,
  hasAnyGrossComponent,
  isNumericPayrollField,
  isRegisterLine,
  looksLikePayColumn,
  payrollNameKey,
  payrollRegisterChecks,
  payrollRowName,
  payrollRowPersonKey,
  roundMoney,
  unreadAmountColumns,
  type ParsedPayrollSheet,
  type PayrollRowIssue,
  type PayrollUploadFieldKey,
  type PayrollUploadRow,
} from "@/lib/payroll-upload";

// "Download Problems Report" on the Upload Payroll panel (HR dashboard Payroll
// tab). HR can't review hundreds of lines one by one, so this lists what went
// wrong in their spreadsheet, with the file, sheet and row number of each line
// so it can be found in the original file:
// - Summary: counts, problems by type, columns of the file that were not read
//   as pay (a pay column under a name the upload doesn't know), rows not read,
//   sheets left out;
// - Problems: one row per line that needs a look;
// - Employees: each employee's uploaded total next to what the ADP Payroll
//   Summary and the system payroll (when loaded on the tab) paid;
// - All Lines: every line as read, in file order, with a Status to filter on;
// - Rows Not Read: rows with amounts that did not become a line (subtotals,
//   rows with no employee). Only known right after reading the files.

export type ReportSystemLine = {
  key: string;
  name: string;
  email: string;
  uploadedGross: number | null;
  systemGross: number | null;
  uploadedHours: number | null;
  systemHours: number | null;
  diff: number;
  status: "match" | "different" | "uploadOnly" | "systemOnly";
};

export type PayrollProblemsReportInput = {
  rows: PayrollUploadRow[];
  issuesFor: (row: PayrollUploadRow) => PayrollRowIssue[];
  periodStart: string;
  periodEnd: string;
  fileNames: string[];
  // Only right after the files were read (not for a saved upload).
  sheets?: ParsedPayrollSheet[] | null;
  selectedSheets?: string[] | null;
  ignoredSheets?: string[] | null;
  // Per-employee comparison with the payroll loaded on the tab, when loaded.
  system?: ReportSystemLine[] | null;
};

export const ISSUE_LABELS: Record<string, string> = {
  "no-name": "No employee name",
  "no-email": "No email, so the line can't be matched to an employee",
  "bad-email": "Email doesn't look valid",
  "no-total": "No Total Gross Pay",
  negative: "Total Gross Pay is negative",
  "total-mismatch": "Total Gross Pay doesn't equal the sum of the pay columns",
  "negative-field": "A pay column is negative",
  "hours-high": "Hours look too high for one pay period",
  duplicate: "Same employee, event and date on another line",
  "register-mismatch": "The ADP Payroll Summary paid a different amount than the employee's lines add up to",
  "not-on-register": "Employee isn't on the ADP Payroll Summary",
  "register-similar": "Matched to the ADP Payroll Summary by a similar name",
  "register-ambiguous": "ADP Payroll Summary name fits more than one employee",
  "shifted-fixed": "Columns were shifted in the file; name and event were re-read",
  shifted: "Columns look shifted (the email is in another column)",
  "file-notes": "The file has notes next to the line (such as paid or short)",
  unmatched: "Email doesn't match any employee account",
};

export type UnreadColumnTotal = { label: string; lines: number; amount: number; looksLikePay: boolean };

// Columns of the file that were kept on lines but not read as pay, with how
// many lines have an amount in them and the amounts added up. Columns that
// sound like pay come first.
export function unreadColumnTotals(rows: PayrollUploadRow[]): UnreadColumnTotal[] {
  const byLabel = new Map<string, UnreadColumnTotal>();
  rows.forEach((row) => {
    unreadAmountColumns(row).forEach(({ label, value }) => {
      const cur = byLabel.get(label) || { label, lines: 0, amount: 0, looksLikePay: looksLikePayColumn(label) };
      cur.lines += 1;
      cur.amount = roundMoney(cur.amount + value);
      byLabel.set(label, cur);
    });
  });
  return Array.from(byLabel.values()).sort(
    (a, b) => Number(b.looksLikePay) - Number(a.looksLikePay) || b.lines - a.lines || a.label.localeCompare(b.label)
  );
}

const MONEY_FORMAT = "#,##0.00";

// Applies the money format to the given columns, from the given row down.
function formatMoney(ws: XLSX.WorkSheet, cols: number[], fromRow: number) {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = fromRow; r <= range.e.r; r += 1) {
    cols.forEach((c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = MONEY_FORMAT;
    });
  }
}

function tableSheet(header: string[], body: Array<Array<string | number | null>>, widths: number[], moneyCols: string[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  if (body.length > 0) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
  formatMoney(
    ws,
    moneyCols.map((h) => header.indexOf(h)).filter((i) => i >= 0),
    1
  );
  return ws;
}

const sheetName = (row: PayrollUploadRow) => (row.source_sheet || "").trim() || (row.source_file ? "" : "Added by hand");
const dollars = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// "$18.00 more than" / "$18.00 less than", for upload minus the other side.
const moreOrLess = (diff: number) => `${dollars(diff)} ${diff > 0 ? "more" : "less"} than`;

export function buildPayrollProblemsWorkbook(input: PayrollProblemsReportInput): XLSX.WorkBook {
  const rows = [...input.rows].sort((a, b) => a.sort_order - b.sort_order);
  const issuesByRow = new Map(rows.map((r) => [r, input.issuesFor(r)]));
  const problemRows = rows.filter((r) => (issuesByRow.get(r) || []).length > 0);
  const gross = roundMoney(rows.reduce((s, r) => s + Number(r.total_gross_pay || 0), 0));
  // Same count as the panel: lines with and without an email land together by name.
  const people = new Set(rows.map(payrollNameKey));
  const multiFile = new Set(rows.map((r) => r.source_file || "")).size > 1;

  const issueCounts = new Map<string, number>();
  problemRows.forEach((r) =>
    (issuesByRow.get(r) || []).forEach((i) => issueCounts.set(i.code, (issueCounts.get(i.code) || 0) + 1))
  );
  const unread = unreadColumnTotals(rows);

  // Rows of the chosen sheets that had amounts but did not become a line.
  const chosenSheets = (input.sheets || []).filter((sh) => !input.selectedSheets || input.selectedSheets.includes(sh.key));
  const skipped = chosenSheets.flatMap((sh) =>
    sh.skipped.filter((s) => s.amount !== null && Math.abs(s.amount) >= 0.005).map((s) => ({ ...s, file: sh.fileName, sheet: sh.sheetName.trim() }))
  );
  const leftOut = (input.sheets || []).filter((sh) => input.selectedSheets && !input.selectedSheets.includes(sh.key));

  // ----- Employees -----
  const registerChecks = payrollRegisterChecks(rows);
  const systemByKey = new Map((input.system || []).map((s) => [s.key, s]));
  // One row per employee (by name, like the panel). The system comparison is
  // keyed by email or name, so an employee can match it under any of their keys.
  type Emp = { personKeys: Set<string>; name: string; email: string; lines: number; problemLines: number; hours: number; gross: number; adp: number | null };
  const emps = new Map<string, Emp>();
  rows.forEach((r) => {
    const key = payrollNameKey(r);
    const e = emps.get(key) || { personKeys: new Set<string>(), name: payrollRowName(r), email: r.email || "", lines: 0, problemLines: 0, hours: 0, gross: 0, adp: null };
    e.personKeys.add(payrollRowPersonKey(r));
    e.lines += 1;
    if ((issuesByRow.get(r) || []).length > 0) e.problemLines += 1;
    e.hours = roundMoney(e.hours + Number(r.hours || 0));
    e.gross = roundMoney(e.gross + Number(r.total_gross_pay || 0));
    const check = registerChecks.get(payrollNameKey(r));
    if (check) e.adp = check.paid;
    else if (isRegisterLine(r)) e.adp = roundMoney((e.adp || 0) + Number(r.total_gross_pay || 0));
    if (!e.name) e.name = payrollRowName(r);
    if (!e.email && r.email) e.email = r.email;
    emps.set(key, e);
  });
  const employeeBody: Array<Array<string | number | null>> = [];
  emps.forEach((e) => {
    const sysLines = Array.from(e.personKeys).map((k) => systemByKey.get(k)).filter((x): x is ReportSystemLine => Boolean(x));
    const sys = sysLines.find((x) => x.systemGross !== null) || sysLines[0] || null;
    const adpDiff = e.adp === null ? null : roundMoney(e.gross - e.adp);
    const sysGross = input.system ? (sys && sys.systemGross !== null ? sys.systemGross : null) : null;
    const sysDiff = sysGross === null ? null : roundMoney(e.gross - sysGross);
    const notes: string[] = [];
    if (e.problemLines > 0) notes.push(`${e.problemLines} line${e.problemLines === 1 ? " needs" : "s need"} a look`);
    if (adpDiff !== null && Math.abs(adpDiff) > 0.05) notes.push(`Upload is ${moreOrLess(adpDiff)} the ADP Payroll Summary`);
    if (input.system && (!sys || sys.status === "uploadOnly")) notes.push("Not in the system payroll");
    if (sysDiff !== null && Math.abs(sysDiff) > 0.05) notes.push(`Upload is ${moreOrLess(sysDiff)} the system payroll`);
    employeeBody.push([
      notes.length ? "Needs a look" : "OK",
      e.name || "(no name)",
      e.email,
      e.lines,
      e.problemLines,
      e.hours,
      e.gross,
      e.adp,
      adpDiff,
      sysGross,
      sysDiff,
      notes.join("; "),
    ]);
  });
  (input.system || [])
    .filter((s) => s.status === "systemOnly")
    .forEach((s) => {
      employeeBody.push(["Needs a look", s.name, s.email, 0, 0, 0, 0, null, null, s.systemGross, s.systemGross === null ? null : roundMoney(-s.systemGross), "In the system payroll but not in the upload"]);
    });
  employeeBody.sort((a, b) => (a[0] === b[0] ? String(a[1]).localeCompare(String(b[1])) : a[0] === "Needs a look" ? -1 : 1));

  // ----- Summary -----
  const summary: Array<Array<string | number | null>> = [
    ["Payroll upload problems report"],
    ["Files", input.fileNames.filter(Boolean).join(", ") || "(none)"],
    ["Pay period", `${input.periodStart || "?"} to ${input.periodEnd || "?"}`],
    ["Created", new Date().toLocaleString("en-US")],
    [],
    ["Lines read", rows.length],
    ["Employees", people.size],
    ["Total Gross Pay", gross],
    ["Lines OK", rows.length - problemRows.length],
    ["Lines that need a look", problemRows.length],
    [],
    ["Problems found", "Lines"],
  ];
  if (issueCounts.size === 0) summary.push(["No problems found"]);
  Array.from(issueCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([code, count]) => summary.push([ISSUE_LABELS[code] || code, count]));
  summary.push([]);
  summary.push(["Columns in the file that are not read as pay", "Lines with an amount", "Amount", "Sounds like pay"]);
  if (unread.length === 0) summary.push(["None"]);
  unread.forEach((c) => summary.push([c.label, c.lines, c.amount, c.looksLikePay ? "Yes: not in the pay columns of any line" : "No"]));
  summary.push([]);
  if (input.sheets) {
    summary.push(["Rows in the file with amounts that did not become lines", skipped.length]);
    if (leftOut.length > 0) {
      summary.push(["Sheets left out of the upload (unchecked)", "Lines", "Total Gross Pay"]);
      leftOut.forEach((sh) => summary.push([`${multiFile ? `${sh.fileName} › ` : ""}${sh.sheetName.trim()}`, sh.rows.length, sh.totalGross]));
    }
    if (input.ignoredSheets && input.ignoredSheets.length > 0) summary.push(["Sheets with no employee lines (not used)", input.ignoredSheets.join(", ")]);
  } else {
    summary.push(["Rows not read", "Only listed right after the files are read. Upload the files again to see them."]);
  }
  summary.push([]);
  const adpDiffs = employeeBody.filter((e) => typeof e[8] === "number" && Math.abs(e[8] as number) > 0.05);
  if (registerChecks.size > 0 || rows.some(isRegisterLine)) {
    summary.push(["Employees paid differently than the ADP Payroll Summary", adpDiffs.length]);
  }
  if (input.system) {
    const counts = { match: 0, different: 0, uploadOnly: 0, systemOnly: 0 };
    input.system.forEach((s) => (counts[s.status] += 1));
    summary.push(["Compared with the system payroll loaded on the Payroll tab"]);
    summary.push(["Same total", counts.match]);
    summary.push(["Different total or hours", counts.different]);
    summary.push(["Only in the upload", counts.uploadOnly]);
    summary.push(["Only in the system payroll", counts.systemOnly]);
  } else {
    summary.push(["System payroll", "Not loaded. Load Payments for these dates on the Payroll tab to compare each employee with it."]);
  }
  summary.push([]);
  summary.push(["How to read this report"]);
  summary.push(["Problems", "One row per line that needs a look, with the file, sheet and row number to find it in your spreadsheet."]);
  summary.push(["Employees", "Each employee's total in the upload, next to the ADP Payroll Summary and the system payroll."]);
  summary.push(["All Lines", "Every line as it was read, in file order. Filter the Status column for Needs a look."]);
  if (input.sheets) summary.push(["Rows Not Read", "Rows with amounts that did not become a line, such as subtotal rows or rows with no employee."]);

  const summaryWs = XLSX.utils.aoa_to_sheet(summary);
  summaryWs["!cols"] = [{ wch: 62 }, { wch: 22 }, { wch: 16 }, { wch: 40 }];
  summary.forEach((line, r) => {
    line.forEach((v, c) => {
      if (typeof v !== "number" || c === 0) return;
      const label = String(line[0] || "");
      const isMoney = label === "Total Gross Pay" || c === 2;
      const cell = summaryWs[XLSX.utils.encode_cell({ r, c })];
      if (cell && isMoney) cell.z = MONEY_FORMAT;
    });
  });

  // ----- Problems -----
  const problemsWs = tableSheet(
    ["File", "Sheet", "Row in File", "First Name", "Last Name", "Email", "Event", "Event Date", "Total Gross Pay", "Pay Columns Add Up To", "Difference", "Problems"],
    problemRows.map((r) => {
      const sum = hasAnyGrossComponent(r) ? grossComponentSum(r) : null;
      const total = r.total_gross_pay;
      return [
        r.source_file || "",
        sheetName(r),
        r.source_row,
        r.first_name,
        r.last_name,
        r.email,
        r.event_name,
        r.event_date,
        total,
        sum,
        sum !== null && total !== null ? roundMoney(total - sum) : null,
        (issuesByRow.get(r) || []).map((i, n) => `${n + 1}. ${i.message}`).join("  "),
      ];
    }),
    [22, 18, 10, 14, 16, 28, 28, 12, 14, 14, 12, 120],
    ["Total Gross Pay", "Pay Columns Add Up To", "Difference"]
  );

  // ----- Employees -----
  const employeesWs = tableSheet(
    ["Status", "Employee", "Email", "Lines", "Lines Needing a Look", "Hours", "Upload Total Gross", "ADP Payroll Summary Paid", "Upload minus ADP", "System Payroll Gross", "Upload minus System", "What's different"],
    employeeBody,
    [13, 26, 30, 7, 10, 9, 14, 14, 12, 14, 12, 70],
    ["Upload Total Gross", "ADP Payroll Summary Paid", "Upload minus ADP", "System Payroll Gross", "Upload minus System"]
  );

  // ----- All Lines -----
  const usedKeys = PAYROLL_UPLOAD_FIELD_KEYS.filter(
    (k) => ["first_name", "last_name", "email", "total_gross_pay"].includes(k) || rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== "")
  );
  const lineHeader = [
    "Status",
    "Problems",
    "File",
    "Sheet",
    "Row in File",
    ...usedKeys.map((k) => PAYROLL_EXPORT_HEADERS[k]),
    "Pay Columns Add Up To",
    "Columns Not Read (amounts)",
  ];
  const allLinesWs = tableSheet(
    lineHeader,
    rows.map((r) => {
      const issues = issuesByRow.get(r) || [];
      return [
        issues.length ? "Needs a look" : "OK",
        issues.map((i, n) => `${n + 1}. ${i.message}`).join("  "),
        r.source_file || "",
        sheetName(r),
        r.source_row,
        ...usedKeys.map((k: PayrollUploadFieldKey) => (r[k] ?? null) as string | number | null),
        hasAnyGrossComponent(r) ? grossComponentSum(r) : null,
        unreadAmountColumns(r)
          .map((c) => `${c.label}: ${c.value.toFixed(2)}`)
          .join("; "),
      ];
    }),
    [13, 60, 22, 18, 10, ...usedKeys.map((k) => Math.max(10, Math.min(28, PAYROLL_EXPORT_HEADERS[k].length + 2))), 14, 40],
    [
      ...usedKeys.filter((k) => isNumericPayrollField(k) && !k.endsWith("hours") && k !== "hours" && k !== "mileage_miles").map((k) => PAYROLL_EXPORT_HEADERS[k]),
      "Pay Columns Add Up To",
    ]
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  XLSX.utils.book_append_sheet(wb, problemsWs, "Problems");
  XLSX.utils.book_append_sheet(wb, employeesWs, "Employees");
  XLSX.utils.book_append_sheet(wb, allLinesWs, "All Lines");
  if (input.sheets) {
    const notReadWs = tableSheet(
      ["File", "Sheet", "Row in File", "Why it was not read", "Amount", "Text in the row"],
      skipped.map((s) => [s.file, s.sheet, s.row, s.reason, s.amount, s.text]),
      [22, 18, 10, 52, 12, 50],
      ["Amount"]
    );
    XLSX.utils.book_append_sheet(wb, notReadWs, "Rows Not Read");
  }
  return wb;
}

export function downloadPayrollProblemsReport(input: PayrollProblemsReportInput): void {
  const wb = buildPayrollProblemsWorkbook(input);
  XLSX.writeFile(wb, `payroll_upload_problems_${input.periodStart || "start"}_to_${input.periodEnd || "end"}.xlsx`);
}
