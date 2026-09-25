"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Read-only view of the vendor reimbursement requests submitted for one event.
// Shown on the event dashboard to exec and manager only (the API enforces the
// same rule plus per-event access). Approve/reject stays on /payroll-approvals.

type ReimbursementStatus = "submitted" | "approved" | "rejected" | "cancelled";

type EventReimbursementRow = {
  id: string;
  user_id: string;
  vendor_name: string;
  vendor_email: string | null;
  purchase_date: string;
  description: string;
  requested_amount: number;
  approved_amount: number | null;
  status: ReimbursementStatus;
  receipt_filename: string | null;
  receipt_url: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type StatusFilter = "all" | ReimbursementStatus;

const STATUS_STYLES: Record<ReimbursementStatus, string> = {
  submitted: "bg-amber-100 text-amber-800 border-amber-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<ReimbursementStatus, string> = {
  submitted: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_TILES: Array<{ key: ReimbursementStatus; accent: string }> = [
  { key: "submitted", accent: "border-l-amber-400" },
  { key: "approved", accent: "border-l-green-500" },
  { key: "rejected", accent: "border-l-red-400" },
  { key: "cancelled", accent: "border-l-gray-300" },
];

const money = (n: number) =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Approved amount once approved, otherwise what was requested.
const effectiveAmountOf = (row: EventReimbursementRow): number =>
  row.status === "approved" && row.approved_amount != null ? Number(row.approved_amount) : Number(row.requested_amount || 0);

export default function EventReimbursementsTab({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<EventReimbursementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}/reimbursements`, {
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
      setLoaded(true);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Search applies before the status filter so the tiles always show every status.
  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.vendor_name} ${row.vendor_email || ""} ${row.description}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const visibleRows = useMemo(
    () => (statusFilter === "all" ? searchedRows : searchedRows.filter((r) => r.status === statusFilter)),
    [searchedRows, statusFilter],
  );

  const summary = useMemo(() => {
    const out: Record<ReimbursementStatus, { count: number; amount: number }> = {
      submitted: { count: 0, amount: 0 },
      approved: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
      cancelled: { count: 0, amount: 0 },
    };
    for (const r of searchedRows) {
      const bucket = out[r.status] || out.submitted;
      bucket.count += 1;
      bucket.amount += effectiveAmountOf(r);
    }
    return out;
  }, [searchedRows]);

  const byVendor = useMemo(() => {
    const map: Record<string, { userId: string; name: string; approved: number; pending: number }> = {};
    for (const r of visibleRows) {
      if (!map[r.user_id]) map[r.user_id] = { userId: r.user_id, name: r.vendor_name, approved: 0, pending: 0 };
      if (r.status === "approved") map[r.user_id].approved += effectiveAmountOf(r);
      if (r.status === "submitted") map[r.user_id].pending += effectiveAmountOf(r);
    }
    return Object.values(map)
      .filter((v) => v.approved + v.pending > 0)
      .sort((a, b) => b.approved + b.pending - (a.approved + a.pending));
  }, [visibleRows]);

  const chartMax = Math.max(1, ...byVendor.map((v) => v.approved + v.pending));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Reimbursements</h2>
          <p className="text-sm text-gray-500">
            Reimbursement requests vendors submitted for this event. View only; approvals happen in Payroll Approvals.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="apple-button apple-button-secondary">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Status tiles (click to filter) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STATUS_TILES.map(({ key, accent }) => {
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

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="apple-label" htmlFor="event-reimb-status">Status</label>
          <select
            id="event-reimb-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="apple-select"
          >
            <option value="all">All</option>
            <option value="submitted">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="apple-label" htmlFor="event-reimb-search">Search</label>
          <input
            id="event-reimb-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vendor or description…"
            className="apple-select w-full"
          />
        </div>
      </div>

      {/* Per-vendor bars */}
      {byVendor.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-gray-700 uppercase">By vendor</h3>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" />Approved</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />Pending</span>
            </div>
          </div>
          <div className="space-y-2">
            {byVendor.map((v) => (
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
          <span className="text-xs text-gray-500">{visibleRows.length} shown</span>
        </div>
        {loading && !loaded ? (
          <div className="text-center py-6 text-sm text-gray-400">Loading reimbursements…</div>
        ) : rows.length === 0 && !error ? (
          <div className="text-center py-6 text-sm text-gray-400">No reimbursements have been submitted for this event.</div>
        ) : visibleRows.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">No reimbursement requests match these filters.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Purchased</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Requested</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Approved</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 text-sm text-gray-900">
                    <div className="font-medium">{r.vendor_name}</div>
                    {r.vendor_email && <div className="text-xs text-gray-400">{r.vendor_email}</div>}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatDate(r.purchase_date)}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 max-w-xs">
                    <div className="line-clamp-2" title={r.description}>{r.description}</div>
                    {r.review_notes && (
                      <div className="text-xs text-gray-400 line-clamp-1" title={r.review_notes}>Note: {r.review_notes}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-right text-gray-700 whitespace-nowrap">{money(r.requested_amount)}</td>
                  <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900 whitespace-nowrap">
                    {r.approved_amount != null ? money(r.approved_amount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    <span className={`px-2 py-0.5 text-xs font-semibold border rounded-full ${STATUS_STYLES[r.status] || STATUS_STYLES.submitted}`}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                    {r.reviewed_by_name && <div className="mt-1 text-xs text-gray-400">by {r.reviewed_by_name}</div>}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatDate(r.created_at)}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
