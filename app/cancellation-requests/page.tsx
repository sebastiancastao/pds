"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type EventInfo = {
  event_name: string | null;
  event_date: string | null;
  start_time: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
};

type CancellationRequestRow = {
  id: string;
  user_id: string;
  event_id: string;
  source: "team" | "location";
  previous_status: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  events: EventInfo | EventInfo[] | null;
  employee_name: string;
  employee_email: string | null;
  requested_by_name: string;
  requested_by_email: string | null;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function getEventInfo(row: CancellationRequestRow): EventInfo | null {
  if (!row.events) return null;
  return Array.isArray(row.events) ? row.events[0] || null : row.events;
}

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function fmtDate(value?: string | null) {
  if (!value) return "No date";
  const ymd = String(value).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? ymd : date.toLocaleDateString();
}

function statusBadgeClass(status: string) {
  if (status === "pending") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-white text-slate-700";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function CancellationRequestsPageInner() {
  const searchParams = useSearchParams();
  const highlightedRequestId = (searchParams.get("requestId") || "").trim();

  const [requests, setRequests] = useState<CancellationRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [statusFilter, setStatusFilter] = useState(highlightedRequestId ? "all" : "pending");
  const [updatingRequestId, setUpdatingRequestId] = useState("");
  const [reviewNotesById, setReviewNotesById] = useState<Record<string, string>>({});
  const [actionErrorsById, setActionErrorsById] = useState<Record<string, string>>({});

  const loadRequests = useCallback(async (token: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    setAccessDenied(false);

    try {
      const res = await fetch("/api/invitation-cancellation-requests", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const payload = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setAccessDenied(true);
        setRequests([]);
        return;
      }
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load cancellation requests.");
      }

      const rows = Array.isArray(payload?.requests) ? (payload.requests as CancellationRequestRow[]) : [];
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRequests(rows);
      setReviewNotesById((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!(row.id in next)) {
            next[row.id] = row.review_notes || "";
          }
        }
        return next;
      });
    } catch (err: any) {
      setError(err?.message || "Failed to load cancellation requests.");
      setRequests([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const boot = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = "/login";
        return;
      }

      await loadRequests(session.access_token);
    };

    void boot();
  }, [loadRequests]);

  const summary = useMemo(() => {
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const row of requests) {
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "approved") counts.approved += 1;
      if (row.status === "rejected") counts.rejected += 1;
    }
    return counts;
  }, [requests]);

  const visibleRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((row) => row.status === statusFilter);
  }, [requests, statusFilter]);

  const handleRefresh = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }
    await loadRequests(session.access_token, true);
  };

  const handleUpdate = async (requestId: string, nextStatus: "approved" | "rejected") => {
    setUpdatingRequestId(requestId);
    setActionErrorsById((prev) => ({ ...prev, [requestId]: "" }));

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch("/api/invitation-cancellation-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: requestId,
          status: nextStatus,
          review_notes: reviewNotesById[requestId] || undefined,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update the request.");
      }

      const updated = payload?.request as Partial<CancellationRequestRow> | undefined;
      setRequests((prev) =>
        prev.map((row) =>
          row.id === requestId
            ? {
                ...row,
                status: updated?.status || nextStatus,
                review_notes: updated?.review_notes ?? reviewNotesById[requestId] ?? null,
                reviewed_at: updated?.reviewed_at || new Date().toISOString(),
                reviewed_by: updated?.reviewed_by || row.reviewed_by,
              }
            : row
        )
      );
    } catch (err: any) {
      setActionErrorsById((prev) => ({ ...prev, [requestId]: err?.message || "Failed to update the request." }));
    } finally {
      setUpdatingRequestId("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
            <div className="flex items-center gap-3 text-slate-600">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
              Loading cancellation requests...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100">
                Review Queue
              </div>
              <h1 className="text-3xl font-bold tracking-tight">Cancellation Requests</h1>
              <p className="max-w-2xl text-sm text-slate-200">
                Approve or reject employee-submitted requests to cancel an already-responded event invitation.
                Approving removes the invitation; rejecting leaves it in place.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/user-management"
                className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                User Management
              </Link>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        {accessDenied ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-10 text-center shadow-sm">
            <p className="text-sm font-semibold text-red-700">
              Access denied. You do not have permission to review cancellation requests.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{summary.pending}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{summary.approved}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{summary.rejected}</div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Requests</h2>
                  <p className="text-sm text-slate-500">
                    {visibleRequests.length} request{visibleRequests.length === 1 ? "" : "s"} shown
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStatusFilter(option.value)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        statusFilter === option.value
                          ? "bg-slate-900 text-white"
                          : "border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            {!error && visibleRequests.length === 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <p className="text-sm text-slate-500">No requests match the current filter.</p>
              </div>
            )}

            <div className="space-y-4">
              {visibleRequests.map((request) => {
                const eventInfo = getEventInfo(request);
                const isHighlighted = highlightedRequestId === request.id;
                const isUpdating = updatingRequestId === request.id;
                const canReview = request.status === "pending";

                return (
                  <div
                    key={request.id}
                    className={`rounded-3xl border bg-white p-6 shadow-sm ${
                      isHighlighted ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadgeClass(
                              request.status
                            )}`}
                          >
                            {statusLabel(request.status)}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium capitalize text-slate-600">
                            Cancelling a {request.previous_status || "responded"} invitation
                          </span>
                          {isHighlighted && (
                            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                              Email Link
                            </span>
                          )}
                        </div>

                        <div>
                          <h3 className="text-xl font-semibold text-slate-900">
                            {eventInfo?.event_name || "Event"}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {fmtDate(eventInfo?.event_date)}
                            {eventInfo?.venue ? ` • ${eventInfo.venue}` : ""}
                            {eventInfo?.city || eventInfo?.state
                              ? ` • ${[eventInfo?.city, eventInfo?.state].filter(Boolean).join(", ")}`
                              : ""}
                          </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Employee</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{request.employee_name}</div>
                            <div className="text-xs text-slate-500">{request.employee_email || "-"}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested By</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{request.requested_by_name}</div>
                            <div className="text-xs text-slate-500">{request.requested_by_email || "-"}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Link
                          href={`/event-dashboard/${request.event_id}?tab=team`}
                          className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Open Event
                        </Link>
                        <Link
                          href={`/employees/${request.user_id}`}
                          className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Open Employee
                        </Link>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</div>
                          <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                            {request.reason}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</div>
                            <div className="mt-1 text-sm text-slate-700">{fmtDateTime(request.created_at)}</div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last Review</div>
                            <div className="mt-1 text-sm text-slate-700">{fmtDateTime(request.reviewed_at)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Review Notes
                          </label>
                          <textarea
                            value={reviewNotesById[request.id] || ""}
                            onChange={(event) =>
                              setReviewNotesById((prev) => ({ ...prev, [request.id]: event.target.value }))
                            }
                            rows={4}
                            disabled={!canReview}
                            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                            placeholder="Add optional internal review notes..."
                          />
                        </div>

                        {actionErrorsById[request.id] && (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {actionErrorsById[request.id]}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleUpdate(request.id, "approved")}
                            disabled={!canReview || isUpdating}
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isUpdating ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleUpdate(request.id, "rejected")}
                            disabled={!canReview || isUpdating}
                            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isUpdating ? "Saving..." : "Reject"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CancellationRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
              <div className="flex items-center gap-3 text-slate-600">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                Loading cancellation requests...
              </div>
            </div>
          </div>
        </div>
      }
    >
      <CancellationRequestsPageInner />
    </Suspense>
  );
}
