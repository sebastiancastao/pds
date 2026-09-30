import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

// Shared by the Reimbursements panel and the Exports row on the HR dashboard
// Payroll tab: the request shape returned by GET /api/payroll/reimbursements,
// the comparison against the loaded payroll, and the approved-reimbursements
// Excel report.

export type ReimbursementRow = {
  id: string;
  user_id: string;
  vendor_name: string;
  vendor_email: string | null;
  event_id: string | null;
  purchase_date: string;
  description: string;
  requested_amount: number;
  approved_amount: number | null;
  status: "submitted" | "approved" | "rejected" | "cancelled";
  receipt_filename: string | null;
  receipt_url: string | null;
  approved_pay_date: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  event: {
    id: string;
    event_name: string;
    event_date: string | null;
    venue: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
};

export type PayrollCheck = { label: string; className: string; title: string };
export type PayrollCheckFn = (row: ReimbursementRow) => PayrollCheck | null;

export const money = (n: number) =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The date a reimbursement lands in payroll: the event date for event-linked
// requests, the approved pay date for standalone ones, else the purchase date.
export const payDateOf = (row: ReimbursementRow): string =>
  (row.event?.event_date || row.approved_pay_date || row.purchase_date || "").slice(0, 10);

// The amount that matters for a row: approved amount once approved, otherwise requested.
export const effectiveAmountOf = (row: ReimbursementRow): number =>
  row.status === "approved" && row.approved_amount != null ? Number(row.approved_amount) : Number(row.requested_amount || 0);

// Inclusive YYYY-MM-DD bounds on the payroll date; an empty bound is open.
export const isWithinPayrollDates = (row: ReimbursementRow, startDate: string, endDate: string): boolean => {
  const d = payDateOf(row);
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
};

export const payrollRangeFileLabel = (startDate: string, endDate: string): string =>
  startDate || endDate ? `${startDate || "start"}_to_${endDate || "today"}` : "all_dates";

export async function fetchReimbursementRequests(): Promise<ReimbursementRow[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/payroll/reimbursements", {
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Failed to load reimbursements");
  return Array.isArray(json.requests) ? json.requests : [];
}

// Event-linked approved requests compared against the loaded payroll's
// reimbursement column. Payroll stores one amount per vendor per event, so
// approved requests are summed per event+vendor before comparing. Pass every
// request for the date window (not a search subset) so those sums are whole.
export function buildPayrollCheck(
  rows: ReimbursementRow[],
  payrollReimbursements: Record<string, Record<string, number>>,
  payrollLoaded: boolean,
): PayrollCheckFn {
  const approvedByKey: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "approved" || !r.event_id) continue;
    const key = `${r.event_id}|${r.user_id}`;
    approvedByKey[key] = (approvedByKey[key] || 0) + effectiveAmountOf(r);
  }
  return (row) => {
    if (!payrollLoaded || row.status !== "approved") return null;
    if (!row.event_id) return { label: "Standalone", className: "text-gray-500", title: "Not tied to an event; paid on the approved pay date." };
    const eventMap = payrollReimbursements[row.event_id];
    if (!eventMap) return { label: "Not in loaded payroll", className: "text-gray-400", title: "This event is not part of the payroll currently loaded." };
    const onPayroll = Number(eventMap[row.user_id] || 0);
    const approved = approvedByKey[`${row.event_id}|${row.user_id}`] || 0;
    if (Math.abs(onPayroll - approved) < 0.005) {
      return { label: `On payroll ${money(onPayroll)}`, className: "text-green-700", title: "Payroll reimbursement matches the approved total for this vendor and event." };
    }
    return {
      label: `Payroll ${money(onPayroll)} vs ${money(approved)}`,
      className: "text-red-600 font-semibold",
      title: "Payroll reimbursement for this vendor and event differs from the approved total.",
    };
  };
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

// YYYY-MM-DD in the viewer's local time zone (timestamps), or the date part as-is.
const isoDate = (value: string | null | undefined): string => {
  if (!value) return "";
  if (value.length === 10) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString("en-CA");
};

// Shows the given header columns as dollars in Excel while keeping them numeric.
const applyCurrencyFormat = (ws: XLSX.WorkSheet, headers: string[], currencyHeaders: string[]) => {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (const header of currencyHeaders) {
    const c = headers.indexOf(header);
    if (c < 0) continue;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = '"$"#,##0.00';
    }
  }
};

// Approved rows only, sorted by vendor and then payroll date.
export const approvedForReport = (rows: ReimbursementRow[]): ReimbursementRow[] =>
  rows
    .filter((r) => r.status === "approved")
    .sort((a, b) => a.vendor_name.localeCompare(b.vendor_name) || payDateOf(a).localeCompare(payDateOf(b)));

// Downloads the approved-reimbursements workbook: a detail sheet with a TOTAL
// row and a per-vendor summary. Rows that are not approved are skipped. The
// Payroll Check column is added only when a payroll check is supplied.
// Returns how many requests were exported (0 means nothing was downloaded).
export function exportApprovedReimbursementsToExcel(opts: {
  rows: ReimbursementRow[];
  payrollCheck: PayrollCheckFn | null;
  fileLabel: string;
}): number {
  const approvedRows = approvedForReport(opts.rows);
  if (approvedRows.length === 0) return 0;
  const { payrollCheck } = opts;

  const detailHeaders = [
    "Vendor", "Email", "Event", "Venue", "City", "State", "Payroll Date", "Purchase Date", "Description",
    "Requested", "Approved", "Reviewed By", "Reviewed On", "Review Notes", "Receipt File",
    ...(payrollCheck ? ["Payroll Check"] : []),
  ];

  let requestedTotal = 0;
  let approvedTotal = 0;
  const detail: Array<Record<string, string | number>> = approvedRows.map((r) => {
    const requested = round2(Number(r.requested_amount || 0));
    const approved = round2(effectiveAmountOf(r));
    requestedTotal += requested;
    approvedTotal += approved;
    const row: Record<string, string | number> = {
      "Vendor": r.vendor_name,
      "Email": r.vendor_email || "",
      "Event": r.event?.event_name || "Standalone",
      "Venue": r.event?.venue || "",
      "City": r.event?.city || "",
      "State": r.event?.state || "",
      "Payroll Date": payDateOf(r),
      "Purchase Date": isoDate(r.purchase_date),
      "Description": r.description || "",
      "Requested": requested,
      "Approved": approved,
      "Reviewed By": r.reviewed_by_name || "",
      "Reviewed On": isoDate(r.reviewed_at),
      "Review Notes": r.review_notes || "",
      "Receipt File": r.receipt_filename || "",
    };
    if (payrollCheck) row["Payroll Check"] = payrollCheck(r)?.label || "";
    return row;
  });
  const detailTotal: Record<string, string | number> = Object.fromEntries(detailHeaders.map((h) => [h, ""]));
  detailTotal["Vendor"] = "TOTAL";
  detailTotal["Requested"] = round2(requestedTotal);
  detailTotal["Approved"] = round2(approvedTotal);
  detail.push(detailTotal);

  const detailSheet = XLSX.utils.json_to_sheet(detail, { header: detailHeaders });
  detailSheet["!cols"] = [
    { wch: 26 }, { wch: 30 }, { wch: 30 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 13 }, { wch: 13 }, { wch: 40 },
    { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 13 }, { wch: 30 }, { wch: 28 },
    ...(payrollCheck ? [{ wch: 30 }] : []),
  ];
  applyCurrencyFormat(detailSheet, detailHeaders, ["Requested", "Approved"]);

  // One line per vendor with their approved total.
  const vendorMap: Record<string, { name: string; email: string; count: number; approved: number }> = {};
  for (const r of approvedRows) {
    if (!vendorMap[r.user_id]) vendorMap[r.user_id] = { name: r.vendor_name, email: r.vendor_email || "", count: 0, approved: 0 };
    vendorMap[r.user_id].count += 1;
    vendorMap[r.user_id].approved += round2(effectiveAmountOf(r));
  }
  const vendorHeaders = ["Vendor", "Email", "Requests", "Approved Total"];
  const vendorRows: Array<Record<string, string | number>> = Object.values(vendorMap)
    .sort((a, b) => b.approved - a.approved || a.name.localeCompare(b.name))
    .map((v) => ({ "Vendor": v.name, "Email": v.email, "Requests": v.count, "Approved Total": round2(v.approved) }));
  vendorRows.push({ "Vendor": "TOTAL", "Email": "", "Requests": approvedRows.length, "Approved Total": round2(approvedTotal) });

  const vendorSheet = XLSX.utils.json_to_sheet(vendorRows, { header: vendorHeaders });
  vendorSheet["!cols"] = [{ wch: 26 }, { wch: 30 }, { wch: 10 }, { wch: 15 }];
  applyCurrencyFormat(vendorSheet, vendorHeaders, ["Approved Total"]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, detailSheet, "Approved Reimbursements");
  XLSX.utils.book_append_sheet(wb, vendorSheet, "By Vendor");
  XLSX.writeFile(wb, `approved_reimbursements_${opts.fileLabel}.xlsx`);
  return approvedRows.length;
}
