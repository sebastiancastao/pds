"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type EditRequest = {
  id: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  userId: string;
  workerName: string | null;
  workerEmail: string | null;
  workerRole: string | null;
  requestedBy: string;
  requesterName: string | null;
  requesterEmail: string | null;
  requesterRole: string | null;
  requestReason: string;
  status: string;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const ALLOWED_ROLES = new Set([
  "admin",
  "exec",
  "hr",
  "manager",
  "supervisor",
  "supervisor2",
  "supervisor3",
]);

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "completed", label: "Completed" },
];

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusBadgeClass(status: string) {
  if (status === "submitted") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "in_review") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  if (status === "completed") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-slate-200 bg-white text-slate-700";
}

function statusLabel(status: string) {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function TimesheetEditRequestsPageInner() {
  const searchParams = useSearchParams();
  const highlightedRequestId = (searchParams.get("requestId") || "").trim();

  const [requests, setRequests] = useState<EditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [userRole, setUserRole] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(highlightedRequestId ? "all" : "open");
  const [updatingRequestId, setUpdatingRequestId] = useState("");
  const [reviewNotesById, setReviewNotesById] = useState<Record<string, string>>({});
  const [actionErrorsById, setActionErrorsById] = useState<Record<string, string>>({});

  const loadRequests = useCallback(
    async (token: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const qs = new URLSearchParams();
        qs.set("status", statusFilter);
        qs.set("limit", "250");

        const res = await fetch(`/api/timesheet-edit-requests?${qs.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || "Failed to load timesheet edit requests.");
        }

        const rows = Array.isArray(payload?.requests) ? (payload.requests as EditRequest[]) : [];
        setRequests(rows);
        setReviewNotesById((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            if (!(row.id in next)) {
              next[row.id] = row.reviewNotes || "";
            }
          }
          return next;
        });
      } catch (err: any) {
        setError(err?.message || "Failed to load timesheet edit requests.");
        setRequests([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [highlightedRequestId, statusFilter]
  );

  useEffect(() => {
    const boot = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          window.location.href = "/login";
          return;
        }

        const { data: requester, error: requesterError } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .maybeSingle();

        if (requesterError) {
          throw new Error(requesterError.message);
        }

        const role = String((requester as { role?: string } | null)?.role || "")
          .trim()
          .toLowerCase();
        setUserRole(role);

        if (!ALLOWED_ROLES.has(role)) {
          setError("Access denied. You do not have permission to review timesheet edit requests.");
          setLoading(false);
          return;
        }

        await loadRequests(session.access_token);
      } catch (err: any) {
        setError(err?.message || "Failed to initialize page.");
        setLoading(false);
      }
    };

    void boot();
  }, [loadRequests]);

  const summary = useMemo(() => {
    const counts = {
      open: 0,
      approved: 0,
      rejected: 0,
      completed: 0,
    };
    for (const row of requests) {
      if (row.status === "submitted" || row.status === "in_review") counts.open += 1;
      if (row.status === "approved") counts.approved += 1;
      if (row.status === "rejected") counts.rejected += 1;
      if (row.status === "completed") counts.completed += 1;
    }
    return counts;
  }, [requests]);

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

  const handleUpdate = async (requestId: string, nextStatus: string) => {
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

      const res = await fetch("/api/timesheet-edit-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId,
          status: nextStatus,
          reviewNotes: reviewNotesById[requestId] || "",
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update request.");
      }

      setRequests((prev) => {
        const updatedStatus = payload?.request?.status || nextStatus;
        const nextRows = prev.map((row) =>
          row.id === requestId
            ? {
                ...row,
                status: updatedStatus,
                reviewNotes: payload?.request?.reviewNotes ?? reviewNotesById[requestId] ?? null,
                reviewedAt: payload?.request?.reviewedAt || new Date().toISOString(),
                reviewedBy: payload?.request?.reviewedBy || row.reviewedBy,
              }
            : row
        );

        if (statusFilter === "open" && updatedStatus !== "submitted" && updatedStatus !== "in_review") {
          return nextRows.filter((row) => row.id !== requestId);
        }
        if (statusFilter !== "all" && statusFilter !== "open" && updatedStatus !== statusFilter) {
          return nextRows.filter((row) => row.id !== requestId);
        }
        return nextRows;
      });
    } catch (err: any) {
      setActionErrorsById((prev) => ({
        ...prev,
        [requestId]: err?.message || "Failed to update request.",
      }));
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
              Loading timesheet edit requests...
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
              <h1 className="text-3xl font-bold tracking-tight">Timesheet Edit Requests</h1>
              <p className="max-w-2xl text-sm text-slate-200">
                Approve or reject requests to reopen already attested timesheets. Approved requests allow the worker&apos;s timesheet to open in edit mode again.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
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

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{summary.open}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{summary.approved}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{summary.rejected}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{summary.completed}</div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Requests</h2>
              <p className="text-sm text-slate-500">
                {requests.length} request{requests.length === 1 ? "" : "s"} loaded
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

        {!error && requests.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <p className="text-sm text-slate-500">No requests match the current filter.</p>
          </div>
        )}

        <div className="space-y-4">
          {requests.map((request) => {
            const isHighlighted = highlightedRequestId === request.id;
            const isUpdating = updatingRequestId === request.id;
            const canReview =
              userRole !== null &&
              ALLOWED_ROLES.has(userRole) &&
              request.status !== "approved" &&
              request.status !== "rejected" &&
              request.status !== "completed" &&
              request.status !== "cancelled";

            return (
              <div
                key={request.id}
                className={`rounded-3xl border bg-white p-6 shadow-sm ${
                  isHighlighted
                    ? "border-blue-300 ring-2 ring-blue-100"
                    : "border-slate-200"
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
                      {isHighlighted && (
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                          Email Link
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{request.eventName}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {request.eventDate || "No date"}{request.venue ? ` • ${request.venue}` : ""}
                        {request.city || request.state
                          ? ` • ${[request.city, request.state].filter(Boolean).join(", ")}`
                          : ""}
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Worker</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{request.workerName || request.userId}</div>
                        <div className="text-xs text-slate-500">{request.workerEmail || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested By</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{request.requesterName || request.requestedBy}</div>
                        <div className="text-xs text-slate-500">
                          {[request.requesterRole, request.requesterEmail].filter(Boolean).join(" • ") || "-"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/event-dashboard/${request.eventId}?tab=timesheet`}
                      className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Open Event
                    </Link>
                    <Link
                      href={`/employees/${request.userId}`}
                      className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Open Employee
                    </Link>
                  </div>
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Request Reason</div>
                      <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        {request.requestReason}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</div>
                        <div className="mt-1 text-sm text-slate-700">{fmtDateTime(request.createdAt)}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last Review</div>
                        <div className="mt-1 text-sm text-slate-700">{fmtDateTime(request.reviewedAt)}</div>
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
                          setReviewNotesById((prev) => ({
                            ...prev,
                            [request.id]: event.target.value,
                          }))
                        }
                        rows={4}
                        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                        placeholder="Add optional internal review notes..."
                      />
                    </div>

                    {request.reviewerName && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Reviewed by <span className="font-medium text-slate-900">{request.reviewerName}</span>
                        {request.reviewerEmail ? ` (${request.reviewerEmail})` : ""}
                      </div>
                    )}

                    {actionErrorsById[request.id] && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {actionErrorsById[request.id]}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUpdate(request.id, "in_review")}
                        disabled={!canReview || isUpdating}
                        className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Mark In Review
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdate(request.id, "approved")}
                        disabled={!canReview || isUpdating}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUpdating ? "Saving..." : "Approve Permission"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdate(request.id, "rejected")}
                        disabled={!canReview || isUpdating}
                        className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUpdating ? "Saving..." : "Reject Request"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function TimesheetEditRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
              <div className="flex items-center gap-3 text-slate-600">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                Loading timesheet edit requests...
              </div>
            </div>
          </div>
        </div>
      }
    >
      <TimesheetEditRequestsPageInner />
    </Suspense>
  );
}
