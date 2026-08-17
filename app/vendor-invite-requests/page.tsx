"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type OverrideRequestRow = {
  id: string;
  vendor_id: string;
  last_invitation_id: string | null;
  last_invited_at: string | null;
  period_end_at: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  sent_invitation_id: string | null;
  created_at: string;
  updated_at: string;
  approval_notification_sent: boolean | null;
  approval_notification_error: string | null;
  outcome_notification_sent: boolean | null;
  outcome_notification_error: string | null;
  vendor_name: string;
  vendor_email: string | null;
  requested_by_name: string;
  requested_by_email: string | null;
};

type DateChange = { date: string; current_available: boolean | null; requested_available: boolean };

type AvailabilityChangeRequestRow = {
  id: string;
  vendor_id: string;
  date_changes: DateChange[];
  reason: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
  approval_notification_sent: boolean | null;
  approval_notification_error: string | null;
  outcome_notification_sent: boolean | null;
  outcome_notification_error: string | null;
  vendor_name: string;
  vendor_email: string | null;
  requested_by_name: string;
  requested_by_email: string | null;
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function fmtDateOnly(value?: string | null) {
  if (!value) return "-";
  const ymd = String(value).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? ymd : date.toLocaleDateString();
}

function availabilityLabel(value: boolean | null) {
  return value === null ? "No answer" : value ? "Available" : "Unavailable";
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

function VendorInviteRequestsPageInner() {
  const searchParams = useSearchParams();
  const highlightedRequestId = (searchParams.get("requestId") || "").trim();

  const [requests, setRequests] = useState<OverrideRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [statusFilter, setStatusFilter] = useState(highlightedRequestId ? "all" : "pending");
  const [updatingRequestId, setUpdatingRequestId] = useState("");
  const [reviewNotesById, setReviewNotesById] = useState<Record<string, string>>({});
  const [actionErrorsById, setActionErrorsById] = useState<Record<string, string>>({});

  const [availabilityRequests, setAvailabilityRequests] = useState<AvailabilityChangeRequestRow[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [availabilityAccessDenied, setAvailabilityAccessDenied] = useState(false);
  const [availabilityStatusFilter, setAvailabilityStatusFilter] = useState("pending");
  const [updatingAvailabilityId, setUpdatingAvailabilityId] = useState("");
  const [availabilityReviewNotesById, setAvailabilityReviewNotesById] = useState<Record<string, string>>({});
  const [availabilityActionErrorsById, setAvailabilityActionErrorsById] = useState<Record<string, string>>({});

  const loadAvailabilityRequests = useCallback(async (token: string, isRefresh = false) => {
    if (isRefresh) setAvailabilityRefreshing(true);
    else setAvailabilityLoading(true);
    setAvailabilityError("");
    setAvailabilityAccessDenied(false);

    try {
      const res = await fetch("/api/vendor-availability-change-requests", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });

      const payload = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setAvailabilityAccessDenied(true);
        setAvailabilityRequests([]);
        return;
      }
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load availability change requests.");
      }

      const rows = Array.isArray(payload?.requests) ? (payload.requests as AvailabilityChangeRequestRow[]) : [];
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setAvailabilityRequests(rows);
      setAvailabilityReviewNotesById((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!(row.id in next)) {
            next[row.id] = row.review_notes || "";
          }
        }
        return next;
      });
    } catch (err: any) {
      setAvailabilityError(err?.message || "Failed to load availability change requests.");
      setAvailabilityRequests([]);
    } finally {
      setAvailabilityLoading(false);
      setAvailabilityRefreshing(false);
    }
  }, []);

  const availabilitySummary = useMemo(() => {
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const row of availabilityRequests) {
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "approved") counts.approved += 1;
      if (row.status === "rejected") counts.rejected += 1;
    }
    return counts;
  }, [availabilityRequests]);

  const visibleAvailabilityRequests = useMemo(() => {
    if (availabilityStatusFilter === "all") return availabilityRequests;
    return availabilityRequests.filter((row) => row.status === availabilityStatusFilter);
  }, [availabilityRequests, availabilityStatusFilter]);

  const handleAvailabilityRefresh = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }
    await loadAvailabilityRequests(session.access_token, true);
  };

  const handleAvailabilityUpdate = async (requestId: string, nextStatus: "approved" | "rejected") => {
    setUpdatingAvailabilityId(requestId);
    setAvailabilityActionErrorsById((prev) => ({ ...prev, [requestId]: "" }));

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }

      const res = await fetch("/api/vendor-availability-change-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: requestId,
          status: nextStatus,
          review_notes: availabilityReviewNotesById[requestId] || undefined,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to update the request.");
      }

      const updated = payload?.request as Partial<AvailabilityChangeRequestRow> | undefined;
      setAvailabilityRequests((prev) =>
        prev.map((row) =>
          row.id === requestId
            ? {
                ...row,
                status: updated?.status || nextStatus,
                review_notes: updated?.review_notes ?? availabilityReviewNotesById[requestId] ?? null,
                reviewed_at: updated?.reviewed_at || new Date().toISOString(),
                reviewed_by: updated?.reviewed_by || row.reviewed_by,
              }
            : row
        )
      );
    } catch (err: any) {
      setAvailabilityActionErrorsById((prev) => ({ ...prev, [requestId]: err?.message || "Failed to update the request." }));
    } finally {
      setUpdatingAvailabilityId("");
    }
  };

  const loadRequests = useCallback(async (token: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    setAccessDenied(false);

    try {
      const res = await fetch("/api/vendor-invite-override-requests", {
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
        throw new Error(payload?.error || "Failed to load vendor invite override requests.");
      }

      const rows = Array.isArray(payload?.requests) ? (payload.requests as OverrideRequestRow[]) : [];
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
      setError(err?.message || "Failed to load vendor invite override requests.");
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

      await Promise.all([loadRequests(session.access_token), loadAvailabilityRequests(session.access_token)]);
    };

    void boot();
  }, [loadRequests, loadAvailabilityRequests]);

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
    await Promise.all([
      loadRequests(session.access_token, true),
      loadAvailabilityRequests(session.access_token, true),
    ]);
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

      const res = await fetch("/api/vendor-invite-override-requests", {
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

      const updated = payload?.request as Partial<OverrideRequestRow> | undefined;
      setRequests((prev) =>
        prev.map((row) =>
          row.id === requestId
            ? {
                ...row,
                status: updated?.status || nextStatus,
                review_notes: updated?.review_notes ?? reviewNotesById[requestId] ?? null,
                reviewed_at: updated?.reviewed_at || new Date().toISOString(),
                reviewed_by: updated?.reviewed_by || row.reviewed_by,
                sent_invitation_id: updated?.sent_invitation_id ?? row.sent_invitation_id,
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
              Loading vendor invite override requests...
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
              <h1 className="text-3xl font-bold tracking-tight">Vendor Requests</h1>
              <p className="max-w-2xl text-sm text-slate-200">
                Two queues: <strong>invite overrides</strong> (a vendor already submitted for their current period and
                needs to be re-invited sooner) and <strong>availability changes</strong> (a vendor wants to correct
                their submitted answer for specific dates). Approving takes effect immediately; rejecting changes
                nothing.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/global-calendar"
                className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                Global Calendar
              </Link>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                {refreshing || availabilityRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        {accessDenied ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-10 text-center shadow-sm">
            <p className="text-sm font-semibold text-red-700">
              Access denied. You do not have permission to review vendor invite override requests.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900">Invite Override Requests</h2>
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
                            Current period ends {fmtDateTime(request.period_end_at)}
                          </span>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium capitalize text-slate-600">
                            Last invited {fmtDateTime(request.last_invited_at)}
                          </span>
                          {isHighlighted && (
                            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                              Email Link
                            </span>
                          )}
                          {request.approval_notification_sent === false && (
                            <span
                              className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700"
                              title={request.approval_notification_error || "The awaiting-approval email failed to send"}
                            >
                              Notification Failed
                            </span>
                          )}
                          {request.status !== "pending" && request.outcome_notification_sent === false && (
                            <span
                              className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700"
                              title={request.outcome_notification_error || "The outcome email to the requester failed to send"}
                            >
                              Outcome Email Failed
                            </span>
                          )}
                        </div>

                        <div>
                          <h3 className="text-xl font-semibold text-slate-900">{request.vendor_name}</h3>
                          <p className="mt-1 text-sm text-slate-500">{request.vendor_email || "-"}</p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{request.vendor_name}</div>
                            <div className="text-xs text-slate-500">{request.vendor_email || "-"}</div>
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
                          href={`/employees/${request.vendor_id}`}
                          className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Open Vendor
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
                            {isUpdating ? "Saving..." : "Approve & Send"}
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

        <div className="border-t border-slate-200 pt-2" />

        {availabilityAccessDenied ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-10 text-center shadow-sm">
            <p className="text-sm font-semibold text-red-700">
              Access denied. You do not have permission to review availability change requests.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900">Availability Change Requests</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{availabilitySummary.pending}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{availabilitySummary.approved}</div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rejected</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{availabilitySummary.rejected}</div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Requests</h3>
                  <p className="text-sm text-slate-500">
                    {visibleAvailabilityRequests.length} request{visibleAvailabilityRequests.length === 1 ? "" : "s"} shown
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAvailabilityStatusFilter(option.value)}
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                        availabilityStatusFilter === option.value
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

            {availabilityLoading && (
              <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <div className="mx-auto flex w-fit items-center gap-3 text-slate-600">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                  Loading availability change requests...
                </div>
              </div>
            )}

            {availabilityError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {availabilityError}
              </div>
            )}

            {!availabilityLoading && !availabilityError && visibleAvailabilityRequests.length === 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <p className="text-sm text-slate-500">No requests match the current filter.</p>
              </div>
            )}

            <div className="space-y-4">
              {!availabilityLoading && visibleAvailabilityRequests.map((request) => {
                const isUpdating = updatingAvailabilityId === request.id;
                const canReview = request.status === "pending";

                return (
                  <div key={request.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                            {request.date_changes.length} date{request.date_changes.length !== 1 ? "s" : ""}
                          </span>
                          {request.approval_notification_sent === false && (
                            <span
                              className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700"
                              title={request.approval_notification_error || "The awaiting-approval email failed to send"}
                            >
                              Notification Failed
                            </span>
                          )}
                          {request.status !== "pending" && request.outcome_notification_sent === false && (
                            <span
                              className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700"
                              title={request.outcome_notification_error || "The outcome email to the vendor failed to send"}
                            >
                              Outcome Email Failed
                            </span>
                          )}
                        </div>

                        <div>
                          <h3 className="text-xl font-semibold text-slate-900">{request.vendor_name}</h3>
                          <p className="mt-1 text-sm text-slate-500">{request.vendor_email || "-"}</p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested By</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{request.requested_by_name}</div>
                          <div className="text-xs text-slate-500">{request.requested_by_email || "-"}</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Link
                          href={`/employees/${request.vendor_id}`}
                          className="inline-flex items-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          Open Vendor
                        </Link>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested Dates</div>
                          <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Currently</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {request.date_changes.map((c) => (
                                  <tr key={c.date}>
                                    <td className="px-3 py-2 font-medium text-slate-900">{fmtDateOnly(c.date)}</td>
                                    <td className="px-3 py-2 text-slate-600">{availabilityLabel(c.current_available)}</td>
                                    <td className="px-3 py-2 font-semibold text-amber-700">{availabilityLabel(c.requested_available)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

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
                            value={availabilityReviewNotesById[request.id] || ""}
                            onChange={(event) =>
                              setAvailabilityReviewNotesById((prev) => ({ ...prev, [request.id]: event.target.value }))
                            }
                            rows={4}
                            disabled={!canReview}
                            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                            placeholder="Add optional internal review notes..."
                          />
                        </div>

                        {availabilityActionErrorsById[request.id] && (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {availabilityActionErrorsById[request.id]}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAvailabilityUpdate(request.id, "approved")}
                            disabled={!canReview || isUpdating}
                            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isUpdating ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleAvailabilityUpdate(request.id, "rejected")}
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

export default function VendorInviteRequestsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
              <div className="flex items-center gap-3 text-slate-600">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                Loading vendor invite override requests...
              </div>
            </div>
          </div>
        </div>
      }
    >
      <VendorInviteRequestsPageInner />
    </Suspense>
  );
}
