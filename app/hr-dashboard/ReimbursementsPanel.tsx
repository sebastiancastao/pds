"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Read-only visualization of vendor reimbursement requests for the HR dashboard
// Payroll tab. Approve/reject stays on /payroll-approvals (exec-only); this panel
// only shows totals, a per-vendor breakdown, and how each approved request lines
// up with the reimbursement amount currently on the loaded payroll rows.

type ReimbursementRow = {
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
  event: { id: string; event_name: string; event_date: string | null; venue: string | null } | null;
};

type StatusFilter = "all" | ReimbursementRow["status"];

type Props = {
  startDate: string;
  endDate: string;
  // eventId -> userId -> reimbursement amount currently on the loaded payroll row
  payrollReimbursements: Record<string, Record<string, number>>;
  payrollLoaded: boolean;
};

const STATUS_STYLES: Record<ReimbursementRow["status"], string> = {
  submitted: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<ReimbursementRow["status"], string> = {
  submitted: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const money = (n: number) =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// The date a reimbursement lands in payroll: the event date for event-linked
// requests, the approved pay date for standalone ones, else the purchase date.
const payDateOf = (row: ReimbursementRow): string =>
  (row.event?.event_date || row.approved_pay_date || row.purchase_date || "").slice(0, 10);

// The amount that matters for a row: approved amount once approved, otherwise requested.
const effectiveAmountOf = (row: ReimbursementRow): number =>
  row.status === "approved" && row.approved_amount != null ? Number(row.approved_amount) : Number(row.requested_amount || 0);

export default function ReimbursementsPanel({ startDate, endDate, payrollReimbursements, payrollLoaded }: Props) {
  const [rows, setRows] = useState<ReimbursementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [useDateRange, setUseDateRange] = useState(true);
  const [groupByVendor, setGroupByVendor] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payroll/reimbursements", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load reimbursements");
      setRows(Array.isArray(json.requests) ? json.requests : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load reimbursements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasRange = Boolean(startDate || endDate);

  // Date + search filtered, before the status filter so the summary tiles
  // always show every status for the chosen window.
  const windowRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (useDateRange && hasRange) {
        const d = payDateOf(row);
        if (startDate && d < startDate) return false;
        if (endDate && d > endDate) return false;
      }
      if (q) {
        const hay = `${row.vendor_name} ${row.vendor_email || ""} ${row.description} ${row.event?.event_name || ""} ${row.event?.venue || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, useDateRange, hasRange, startDate, endDate]);

  const visibleRows = useMemo(
    () => (statusFilter === "all" ? windowRows : windowRows.filter((r) => r.status === statusFilter)),
    [windowRows, statusFilter],
  );

  const summary = useMemo(() => {
    const base = { count: 0, amount: 0 };
    const out: Record<ReimbursementRow["status"], { count: number; amount: number }> = {
      submitted: { ...base }, approved: { ...base }, rejected: { ...base }, cancelled: { ...base },
    };
    for (const r of windowRows) {
      const bucket = out[r.status] || out.submitted;
      bucket.count += 1;
      bucket.amount += effectiveAmountOf(r);
    }
    return out;
  }, [windowRows]);

  const byVendor = useMemo(() => {
    const map: Record<string, { userId: string; name: string; approved: number; pending: number; count: number; rows: ReimbursementRow[] }> = {};
    for (const r of visibleRows) {
      if (!map[r.user_id]) map[r.user_id] = { userId: r.user_id, name: r.vendor_name, approved: 0, pending: 0, count: 0, rows: [] };
      const v = map[r.user_id];
      v.count += 1;
      v.rows.push(r);
      if (r.status === "approved") v.approved += effectiveAmountOf(r);
      if (r.status === "submitted") v.pending += effectiveAmountOf(r);
    }
    return Object.values(map).sort((a, b) => b.approved + b.pending - (a.approved + a.pending));
  }, [visibleRows]);

  const chartVendors = byVendor.filter((v) => v.approved + v.pending > 0).slice(0, 10);
  const chartMax = Math.max(1, ...chartVendors.map((v) => v.approved + v.pending));

  // Event-linked approved requests compared against the loaded payroll's
  // reimbursement column. Payroll stores one amount per vendor per event, so
  // approved requests are summed per event+vendor before comparing.
  const payrollCheck = useMemo(() => {
    const approvedByKey: Record<string, number> = {};
    for (const r of windowRows) {
      if (r.status !== "approved" || !r.event_id) continue;
      const key = `${r.event_id}|${r.user_id}`;
      approvedByKey[key] = (approvedByKey[key] || 0) + effectiveAmountOf(r);
    }
    return (row: ReimbursementRow): { label: string; className: string; title: string } | null => {
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
  }, [windowRows, payrollLoaded, payrollReimbursements]);

  const statusTiles: Array<{ key: ReimbursementRow["status"]; accent: string }> = [
    { key: "submitted", accent: "border-l-amber-400" },
    { key: "approved", accent: "border-l-green-500" },
    { key: "rejected", accent: "border-l-red-400" },
    { key: "cancelled", accent: "border-l-gray-300" },
  ];

  const renderRow = (r: ReimbursementRow, showVendor: boolean) => {
    const check = payrollCheck(r);
    return (
      <tr key={r.id} className="hover:bg-gray-50 align-top">
        {showVendor && (
          <td className="px-3 py-2 text-sm text-gray-900">
            <div className="font-medium">{r.vendor_name}</div>
            {r.vendor_email && <div className="text-xs text-gray-400">{r.vendor_email}</div>}
          </td>
        )}
        <td className="px-3 py-2 text-sm text-gray-700">
          {r.event ? (
            <>
              <div>{r.event.event_name}</div>
              <div className="text-xs text-gray-400">{formatDate(r.event.event_date)}{r.event.venue ? ` · ${r.event.venue}` : ""}</div>
            </>
          ) : (
            <>
              <div className="text-gray-500">Standalone</div>
              <div className="text-xs text-gray-400">Pay date {formatDate(r.approved_pay_date)}</div>
            </>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatDate(r.purchase_date)}</td>
        <td className="px-3 py-2 text-sm text-gray-700 max-w-xs">
          <div className="line-clamp-2" title={r.description}>{r.description}</div>
          {r.review_notes && <div className="text-xs text-gray-400 line-clamp-1" title={r.review_notes}>Note: {r.review_notes}</div>}
        </td>
        <td className="px-3 py-2 text-sm text-right text-gray-700 whitespace-nowrap">{money(r.requested_amount)}</td>
        <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900 whitespace-nowrap">
          {r.approved_amount != null ? money(r.approved_amount) : "—"}
        </td>
        <td className="px-3 py-2 text-sm whitespace-nowrap">
          <span className={`px-2 py-0.5 text-xs font-semibold border rounded-full ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
          {r.reviewed_by_name && <div className="mt-1 text-xs text-gray-400">by {r.reviewed_by_name}</div>}
        </td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          {check ? <span className={check.className} title={check.title}>{check.label}</span> : <span className="text-gray-300">—</span>}
        </td>
        <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
          {r.receipt_url ? (
            <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-medium">
              Receipt
            </a>
          ) : (
            <span className="text-gray-300">None</span>
          )}
        </td>
      </tr>
    );
  };

  const headerCells = (showVendor: boolean) => (
    <tr>
      {showVendor && <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>}
      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchased</th>
      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Requested</th>
      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Approved</th>
      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Payroll</th>
      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Receipt</th>
    </tr>
  );

  return (
    <div className="apple-card mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Reimbursements</h2>
          <p className="text-sm text-gray-500">
            Vendor reimbursement requests by status and vendor. Dates use the event date, or the approved pay date for standalone requests.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/payroll-approvals">
            <button className="apple-button apple-button-secondary">Review in Approvals</button>
          </Link>
          <button onClick={() => void load()} disabled={loading} className="apple-button apple-button-secondary">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="apple-label" htmlFor="reimb-status">Status</label>
          <select id="reimb-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="apple-select">
            <option value="all">All</option>
            <option value="submitted">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="apple-label" htmlFor="reimb-search">Search</label>
          <input
            id="reimb-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vendor, description, event…"
            className="apple-select w-full"
          />
        </div>
        <label className={`flex items-center gap-2 text-sm pb-2 ${hasRange ? "text-gray-700" : "text-gray-400"}`}>
          <input type="checkbox" checked={useDateRange && hasRange} disabled={!hasRange} onChange={(e) => setUseDateRange(e.target.checked)} />
          {hasRange
            ? `Only payroll dates (${startDate ? formatDate(startDate) : "…"} – ${endDate ? formatDate(endDate) : "…"})`
            : "Set payroll dates above to filter by range"}
        </label>
        <label className="flex items-center gap-2 text-sm pb-2 text-gray-700">
          <input type="checkbox" checked={groupByVendor} onChange={(e) => setGroupByVendor(e.target.checked)} />
          Group by vendor
        </label>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Status tiles (click to filter) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statusTiles.map(({ key, accent }) => {
          const active = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(active ? "all" : key)}
              className={`text-left rounded-xl border border-gray-200 border-l-4 ${accent} px-4 py-3 transition ${active ? "bg-gray-50 ring-2 ring-blue-200" : "bg-white hover:bg-gray-50"}`}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{STATUS_LABELS[key]}</div>
              <div className="mt-1 text-2xl font-semibold text-gray-900 tabular-nums">{money(summary[key].amount)}</div>
              <div className="text-xs text-gray-400">{summary[key].count} request{summary[key].count === 1 ? "" : "s"}</div>
            </button>
          );
        })}
      </div>

      {/* Per-vendor bar chart */}
      {chartVendors.length > 0 && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-gray-700 uppercase">Top vendors by amount</h3>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" />Approved</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Pending</span>
            </div>
          </div>
          <div className="space-y-2">
            {chartVendors.map((v) => (
              <div key={v.userId} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                <div className="truncate text-sm text-gray-700" title={v.name}>{v.name}</div>
                <div className="flex h-4 overflow-hidden rounded bg-gray-100">
                  <div className="h-full bg-green-500" style={{ width: `${(v.approved / chartMax) * 100}%` }} title={`Approved ${money(v.approved)}`} />
                  <div className="h-full bg-amber-400" style={{ width: `${(v.pending / chartMax) * 100}%` }} title={`Pending ${money(v.pending)}`} />
                </div>
                <div className="text-sm tabular-nums text-gray-900 text-right w-24">{money(v.approved + v.pending)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail table */}
      <div className="overflow-x-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700 uppercase">Requests</h3>
          <span className="text-xs text-gray-500">
            {visibleRows.length} shown{!payrollLoaded ? " · load payments to compare against payroll" : ""}
          </span>
        </div>
        {loading && rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">Loading reimbursements…</div>
        ) : visibleRows.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">No reimbursement requests match these filters.</div>
        ) : groupByVendor ? (
          <div className="space-y-4">
            {byVendor.map((v) => (
              <div key={v.userId} className="rounded-xl border border-gray-200">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-50 px-3 py-2 rounded-t-xl">
                  <div className="font-medium text-gray-900">{v.name}</div>
                  <div className="text-xs text-gray-500 tabular-nums">
                    {v.count} request{v.count === 1 ? "" : "s"} · Approved {money(v.approved)} · Pending {money(v.pending)}
                  </div>
                </div>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>{headerCells(false)}</thead>
                  <tbody className="divide-y divide-gray-100">{v.rows.map((r) => renderRow(r, false))}</tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">{headerCells(true)}</thead>
            <tbody className="divide-y divide-gray-100">{visibleRows.map((r) => renderRow(r, true))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
