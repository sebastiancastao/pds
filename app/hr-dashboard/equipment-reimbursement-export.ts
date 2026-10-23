import * as XLSX from "xlsx";

// Excel downloads for equipment reimbursement on the HR dashboard Payroll tab:
// the Equipment Reimbursement panel (one pay date, plus the month's vendor list)
// and the Equipment Reimbursement card for the loaded payroll dates.

export type ExcelSheet = {
  name: string; // at most 31 characters, no : \ / ? * [ ]
  headers: string[];
  rows: Array<Record<string, string | number>>;
  widths?: Record<string, number>;
  // Columns shown as dollars; defaults to the "Amount" column.
  moneyHeaders?: string[];
};

const MONEY_FORMAT = '"$"#,##0.00';

export function downloadExcelSheets(fileName: string, sheets: ExcelSheet[]): void {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows, { header: sheet.headers });
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (const header of sheet.moneyHeaders ?? ["Amount"]) {
      const col = sheet.headers.indexOf(header);
      if (col < 0) continue;
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
        if (cell && typeof cell.v === "number") cell.z = MONEY_FORMAT;
      }
    }
    ws["!cols"] = sheet.headers.map((h) => ({ wch: sheet.widths?.[h] ?? 14 }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

export const roundCents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
