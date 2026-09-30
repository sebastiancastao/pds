import * as XLSX from "xlsx";
import { buildPayrollExportRows, type PayrollUploadRow } from "@/lib/payroll-upload";

// Downloads uploaded payroll lines as an Excel file in the same column format
// as the Payroll tab's "Export to Excel" ("Vendor Payments" sheet), so it can
// be edited and uploaded again.
export function downloadUploadedPayroll(rows: PayrollUploadRow[], periodStart: string, periodEnd: string): void {
  const { header, data } = buildPayrollExportRows(rows);
  const sheet = XLSX.utils.json_to_sheet(data, { header });
  sheet["!cols"] = header.map((h) => ({ wch: Math.max(10, Math.min(32, h.length + 4)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Vendor Payments");
  XLSX.writeFile(workbook, `uploaded_payroll_${periodStart || "start"}_to_${periodEnd || "end"}.xlsx`);
}
