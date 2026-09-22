"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TimesheetProposalView, TimesheetTimesFields } from "@/components/TimesheetEditTimes";
import {
  TIMESHEET_EDIT_REASON_MAX_LENGTH,
  changedTimeKeys,
  emptyTimesheetTimes,
  isOpenTimesheetEditStatus,
  timesheetEditStatusLabel,
  validateTimesheetTimes,
  type TimesheetEditProposal,
  type TimesheetEditRequest,
  type TimesheetEditViewer,
  type TimesheetTimes,
} from "@/lib/timesheet-edit-requests";
import {
  listWorkDates,
  loadTimesheetTimes,
  reviewTimesheetEditRequest,
  submitTimesheetEditRequest,
} from "@/lib/timesheet-edit-requests-client";

export const TIMESHEET_EDIT_PANEL_ID = "timesheet-edit-permissions";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// Event dates are plain YYYY-MM-DD values. Formatting them through Date would
// shift them by the viewer's time zone, so format the parts directly.
function formatEventDay(value?: string | null) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "No date";
}

function statusBadgeClass(status: string) {
  if (status === "submitted") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "in_review") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
}

function statusRank(status: string) {
  if (isOpenTimesheetEditStatus(status)) return 0;
  if (status === "approved") return 1;
  return 2;
}

/* ------------------------------------------------------------------ */
/* Request modal                                                       */
/* ------------------------------------------------------------------ */

export type TimesheetEditRequestTarget = {
  eventId: string;
  eventName: string;
  workerId: string;
  workerName?: string | null;
};

export function TimesheetEditRequestModal({
  target,
  onClose,
  onSubmitted,
}: {
  target: TimesheetEditRequestTarget | null;
  onClose: () => void;
  onSubmitted: (result: { deduped: boolean }) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Times as recorded, and the times the requester wants. Both are for one day.
  const [previous, setPrevious] = useState<TimesheetTimes | null>(null);
  const [times, setTimes] = useState<TimesheetTimes>(emptyTimesheetTimes());
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  // The day the requester picked. Null until they pick one, which loads the
  // event default.
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState("");
  const [workDates, setWorkDates] = useState<string[]>([]);

  // Start every request with a clean form.
  useEffect(() => {
    if (!target) return;
    setReason("");
    setError("");
    setSubmitting(false);
    setPickedDate(null);
    setActiveDate("");
    setWorkDates([]);
  }, [target?.eventId, target?.workerId]);

  // Load what is currently recorded for the day being edited.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoadState("loading");
    loadTimesheetTimes({
      eventId: target.eventId,
      workerId: target.workerId,
      workDate: pickedDate || undefined,
    })
      .then((snapshot) => {
        if (cancelled) return;
        setPrevious(snapshot.times);
        setTimes(snapshot.times);
        setActiveDate(snapshot.workDate);
        setWorkDates(listWorkDates(snapshot.eventDate, snapshot.eventEndDate));
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        // Without the recorded times the request can still carry a reason, or
        // a complete set of times typed in by hand.
        setPrevious(null);
        setTimes(emptyTimesheetTimes());
        setLoadState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [target?.eventId, target?.workerId, pickedDate]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, submitting, onClose]);

  if (!target) return null;

  const changedKeys = changedTimeKeys(previous, times);
  const isLoading = loadState === "loading";

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Please explain what needs to be corrected.");
      return;
    }

    // Only attach the times when something actually changed.
    let requestedChanges: TimesheetEditProposal | null = null;
    if (changedKeys.length > 0) {
      const timesError = validateTimesheetTimes(times);
      if (timesError) {
        setError(timesError);
        return;
      }
      requestedChanges = { workDate: activeDate || null, requested: times, previous };
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await submitTimesheetEditRequest({
        eventId: target.eventId,
        targetUserId: target.workerId,
        requestReason: trimmed,
        requestedChanges,
      });
      onSubmitted(result);
    } catch (err: any) {
      setError(err?.message || "Failed to submit the edit request.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-6"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="timesheet-edit-request-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="timesheet-edit-request-title" className="text-lg font-semibold text-gray-900">
          Request timesheet edit
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          {target.eventName}
          {target.workerName ? ` for ${target.workerName}` : ""}. This timesheet is locked. A
          reviewer has to approve the request first. Any times you change below are applied to the
          timesheet once it is approved.
        </p>

        {workDates.length > 1 && (
          <div className="mt-5">
            <label className="block text-sm font-medium text-gray-700" htmlFor="timesheet-edit-day">
              Work day
            </label>
            <select
              id="timesheet-edit-day"
              value={activeDate}
              disabled={submitting || isLoading}
              onChange={(event) => setPickedDate(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-gray-50"
            >
              {workDates.map((day) => (
                <option key={day} value={day}>
                  {formatEventDay(day)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-gray-700">Times</span>
            <span className="text-xs text-gray-400">
              {isLoading
                ? "Loading current times..."
                : loadState === "failed"
                ? "Current times could not be loaded"
                : "Change only what is wrong"}
            </span>
          </div>
          <TimesheetTimesFields
            value={times}
            previous={previous}
            disabled={submitting || isLoading}
            onChange={(key, next) => setTimes((current) => ({ ...current, [key]: next }))}
          />
          {!isLoading && changedKeys.length === 0 && (
            <p className="mt-2 text-xs text-gray-400">
              No times changed. The request will only include your reason.
            </p>
          )}
        </div>

        <label className="mt-5 block text-sm font-medium text-gray-700" htmlFor="timesheet-edit-reason">
          Why does it need to change? <span className="text-red-500">*</span>
        </label>
        <textarea
          id="timesheet-edit-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={TIMESHEET_EDIT_REASON_MAX_LENGTH}
          placeholder="Example: I forgot to log my second meal break."
          className="mt-1.5 w-full resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />

        {error && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || isLoading}
            className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-employee panel                                                  */
/* ------------------------------------------------------------------ */

const COLLAPSED_HISTORY_COUNT = 3;

export function TimesheetEditPermissionsPanel({
  requests,
  viewer,
  loading,
  error,
  onChanged,
}: {
  requests: TimesheetEditRequest[];
  viewer: TimesheetEditViewer | null;
  loading: boolean;
  error: string;
  // Called after a decision so the caller can reload requests and timesheet status.
  onChanged: () => void;
}) {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [errorsById, setErrorsById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);

  const canReview = viewer?.canReview === true;

  const { active, history } = useMemo(() => {
    const sorted = [...requests].sort((a, b) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return {
      active: sorted.filter((r) => statusRank(r.status) < 2),
      history: sorted.filter((r) => statusRank(r.status) === 2),
    };
  }, [requests]);

  const awaitingReview = active.filter((r) => isOpenTimesheetEditStatus(r.status)).length;

  if (!loading && !error && requests.length === 0) return null;

  const act = async (
    request: TimesheetEditRequest,
    status: "in_review" | "approved" | "rejected" | "cancelled" | "completed"
  ) => {
    const note = (notesById[request.id] || "").trim();
    setErrorsById((prev) => ({ ...prev, [request.id]: "" }));

    if (status === "rejected" && !note) {
      setErrorsById((prev) => ({
        ...prev,
        [request.id]: "Add a note so the worker knows why the request was rejected.",
      }));
      return;
    }
    if (
      request.status === "approved" &&
      status === "cancelled" &&
      !window.confirm("Revoke this permission? The timesheet will lock again.")
    ) {
      return;
    }

    setBusyId(request.id);
    try {
      await reviewTimesheetEditRequest({ requestId: request.id, status, reviewNotes: note });
      setNotesById((prev) => ({ ...prev, [request.id]: "" }));
      onChanged();
    } catch (err: any) {
      setErrorsById((prev) => ({
        ...prev,
        [request.id]: err?.message || "Failed to update the request.",
      }));
    } finally {
      setBusyId("");
    }
  };

  const renderCard = (request: TimesheetEditRequest) => {
    const isOpen = isOpenTimesheetEditStatus(request.status);
    const isApproved = request.status === "approved";
    const isBusy = busyId === request.id;
    const isMine = viewer?.id === request.requestedBy || viewer?.id === request.userId;
    const canWithdraw = isOpen && isMine;
    // A reviewer role never gets to approve/reject/apply/revoke a request that is
    // their own submission or filed for their own timesheet — that would be self-approval.
    const canReviewThis = canReview && !isMine;

    return (
      <div key={request.id} className="px-6 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(
                  request.status
                )}`}
              >
                {timesheetEditStatusLabel(request.status)}
              </span>
              <span className="text-sm font-semibold text-gray-900">{request.eventName}</span>
              <span className="text-xs text-gray-500">{formatEventDay(request.eventDate)}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Requested by {request.requesterName || request.requestedBy}
              {request.requesterRole ? ` (${request.requesterRole})` : ""} on{" "}
              {formatDateTime(request.createdAt)}
            </p>
          </div>

          {isApproved && (
            <Link
              href={`/time-sheets/${request.eventId}?userId=${encodeURIComponent(request.userId)}`}
              className="inline-flex shrink-0 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
            >
              Open Timesheet
            </Link>
          )}
        </div>

        <p className="mt-3 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {request.requestReason}
        </p>

        {request.requestedChanges && (
          <div className="mt-3">
            <TimesheetProposalView proposal={request.requestedChanges} />
          </div>
        )}

        {(request.reviewerName || request.reviewNotes) && (
          <p className="mt-2 text-xs text-gray-500">
            {request.reviewerName ? (
              <>
                {request.status === "approved" ? "Approved" : "Reviewed"} by{" "}
                <span className="font-medium text-gray-700">{request.reviewerName}</span>
                {request.reviewedAt ? ` on ${formatDateTime(request.reviewedAt)}` : ""}
                {request.reviewNotes ? ". " : ""}
              </>
            ) : null}
            {request.reviewNotes ? (
              <span className="italic text-blue-700">{request.reviewNotes}</span>
            ) : null}
          </p>
        )}

        {canReviewThis && isOpen && request.requestedChanges && (
          <p className="mt-2 text-xs text-gray-500">
            Approving changes the timesheet to the requested times. The worker keeps their
            existing attestation.
          </p>
        )}

        {isApproved && !request.requestedChanges && (
          <p className="mt-2 text-xs text-emerald-700">
            The timesheet is open for one correction. This permission closes when the corrected
            timesheet is saved and attested again.
          </p>
        )}
        {isApproved && request.requestedChanges && (
          <p className="mt-2 text-xs text-amber-700">
            Approved, but the timesheet has not been changed to the requested times yet.
            {canReviewThis ? " Apply them now, or revoke the permission." : ""}
          </p>
        )}

        {((canReviewThis && (isOpen || isApproved)) || canWithdraw) && (
          <div className="mt-4 space-y-3">
            {canReviewThis && (isOpen || isApproved) && (
              <textarea
                value={notesById[request.id] || ""}
                onChange={(event) =>
                  setNotesById((prev) => ({ ...prev, [request.id]: event.target.value }))
                }
                rows={2}
                maxLength={TIMESHEET_EDIT_REASON_MAX_LENGTH}
                placeholder={
                  isApproved
                    ? "Optional note for revoking this permission..."
                    : "Review note (required when rejecting)..."
                }
                className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            )}

            {errorsById[request.id] && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorsById[request.id]}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {canReviewThis && isOpen && (
                <>
                  {request.status === "submitted" && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void act(request, "in_review")}
                      className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-60"
                    >
                      Mark In Review
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void act(request, "approved")}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {isBusy
                      ? "Saving..."
                      : request.requestedChanges
                      ? "Approve and Apply"
                      : "Approve Edit"}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void act(request, "rejected")}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </>
              )}
              {canReviewThis && isApproved && request.requestedChanges && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void act(request, "completed")}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {isBusy ? "Saving..." : "Apply Requested Times"}
                </button>
              )}
              {canReviewThis && isApproved && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void act(request, "cancelled")}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                >
                  {isBusy ? "Saving..." : "Revoke Permission"}
                </button>
              )}
              {canWithdraw && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void act(request, "cancelled")}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                >
                  Withdraw Request
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const visibleHistory = showAllHistory ? history : history.slice(0, COLLAPSED_HISTORY_COUNT);

  return (
    <section id={TIMESHEET_EDIT_PANEL_ID} className="mb-8 scroll-mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="keeping-tight text-2xl font-semibold text-gray-900">
          Timesheet Edit Permissions
        </h2>
        {!loading && awaitingReview > 0 && (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            {awaitingReview} awaiting review
          </span>
        )}
      </div>

      <div className="apple-card divide-y divide-gray-100">
        {loading ? (
          <div className="px-6 py-4 text-sm text-gray-400">Loading...</div>
        ) : error ? (
          <div className="px-6 py-4 text-sm text-red-600">{error}</div>
        ) : (
          <>
            {active.map(renderCard)}
            {visibleHistory.map(renderCard)}
            {history.length > COLLAPSED_HISTORY_COUNT && (
              <div className="px-6 py-3 text-center">
                <button
                  type="button"
                  onClick={() => setShowAllHistory((current) => !current)}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  {showAllHistory
                    ? "Show fewer past requests"
                    : `Show ${history.length - COLLAPSED_HISTORY_COUNT} more past requests`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
