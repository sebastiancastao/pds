"use client";

import Link from "next/link";
import { useState } from "react";
import { TimesheetProposalView } from "@/components/TimesheetEditTimes";
import {
  TIMESHEET_EDIT_REASON_MAX_LENGTH,
  isOpenTimesheetEditStatus,
  type TimesheetEditRequest,
} from "@/lib/timesheet-edit-requests";
import {
  reviewTimesheetEditRequest,
  useTimesheetEditRequests,
} from "@/lib/timesheet-edit-requests-client";

// Refresh in the background so a reviewer who leaves /employees open sees new
// requests without reloading.
const POLL_MS = 2 * 60 * 1000;

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatEventDay(value?: string | null) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "No date";
}

const buttonBase = {
  padding: "0.35rem 0.75rem",
  borderRadius: "0.375rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  cursor: "pointer",
} as const;

// Shows the requests that need a decision, plus approvals that are still
// waiting for the worker to make the correction, on the /employees list.
export default function TimesheetEditReviewQueue() {
  const { requests, loading, error, forbidden, reload } = useTimesheetEditRequests({
    status: "active",
    limit: 100,
    pollMs: POLL_MS,
  });

  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [errorsById, setErrorsById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");

  // The API refuses roles that cannot review. Show nothing rather than an error.
  if (forbidden) return null;

  const open = requests.filter((r) => isOpenTimesheetEditStatus(r.status));
  const approved = requests.filter((r) => r.status === "approved");

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
      status === "cancelled" &&
      request.status === "approved" &&
      !window.confirm("Revoke this permission? The timesheet will lock again.")
    ) {
      return;
    }

    setBusyId(request.id);
    try {
      await reviewTimesheetEditRequest({ requestId: request.id, status, reviewNotes: note });
      setNotesById((prev) => ({ ...prev, [request.id]: "" }));
      await reload();
    } catch (err: any) {
      setErrorsById((prev) => ({
        ...prev,
        [request.id]: err?.message || "Failed to update the request.",
      }));
    } finally {
      setBusyId("");
    }
  };

  const renderRow = (request: TimesheetEditRequest, index: number, total: number) => {
    const isOpen = isOpenTimesheetEditStatus(request.status);
    const isBusy = busyId === request.id;
    return (
      <div
        key={request.id}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "1rem",
          padding: "0.875rem 1.25rem",
          borderBottom: index < total - 1 ? "1px solid #f3f4f6" : "none",
          backgroundColor: index % 2 === 0 ? "#ffffff" : "#fafafa",
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
            <Link
              href={`/employees/${request.userId}#timesheet-edit-permissions`}
              style={{ fontWeight: 600, fontSize: "0.875rem", color: "#111827", textDecoration: "none" }}
            >
              {request.workerName || request.workerEmail || request.userId}
            </Link>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                padding: "0.1rem 0.5rem",
                borderRadius: "9999px",
                border: `1px solid ${isOpen ? "#fde68a" : "#a7f3d0"}`,
                backgroundColor: isOpen ? "#fffbeb" : "#ecfdf5",
                color: isOpen ? "#b45309" : "#047857",
              }}
            >
              {request.status === "in_review"
                ? "In review"
                : request.status === "submitted"
                ? "Awaiting review"
                : "Approved, not yet edited"}
            </span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "#4b5563", marginTop: "0.2rem" }}>
            {request.eventName} · {formatEventDay(request.eventDate)}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#374151", marginTop: "0.35rem", lineHeight: 1.4 }}>
            {request.requestReason.length > 200
              ? `${request.requestReason.slice(0, 200)}…`
              : request.requestReason}
          </div>
          {request.requestedChanges && (
            <div style={{ marginTop: "0.5rem", maxWidth: "26rem" }}>
              <TimesheetProposalView proposal={request.requestedChanges} compact />
            </div>
          )}
          <div style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: "0.25rem" }}>
            Requested by {request.requesterName || request.requestedBy} ·{" "}
            {formatDateTime(request.createdAt)}
          </div>
        </div>

        <div style={{ flex: "0 1 320px", minWidth: "220px" }}>
          <input
            type="text"
            value={notesById[request.id] || ""}
            onChange={(event) =>
              setNotesById((prev) => ({ ...prev, [request.id]: event.target.value }))
            }
            maxLength={TIMESHEET_EDIT_REASON_MAX_LENGTH}
            placeholder={isOpen ? "Review note (required to reject)" : "Optional note"}
            style={{
              width: "100%",
              padding: "0.4rem 0.6rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.8rem",
              boxSizing: "border-box",
            }}
          />
          {errorsById[request.id] && (
            <div style={{ color: "#b91c1c", fontSize: "0.75rem", marginTop: "0.3rem" }}>
              {errorsById[request.id]}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}>
            {isOpen ? (
              <>
                {request.status === "submitted" && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void act(request, "in_review")}
                    style={{
                      ...buttonBase,
                      border: "1px solid #93c5fd",
                      backgroundColor: "#eff6ff",
                      color: "#1d4ed8",
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    In review
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void act(request, "approved")}
                  title={
                    request.requestedChanges
                      ? "Changes the timesheet to the requested times"
                      : "Lets the timesheet be edited once"
                  }
                  style={{
                    ...buttonBase,
                    border: "none",
                    backgroundColor: "#059669",
                    color: "#ffffff",
                    opacity: isBusy ? 0.6 : 1,
                  }}
                >
                  {isBusy ? "Saving…" : request.requestedChanges ? "Approve and apply" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void act(request, "rejected")}
                  style={{
                    ...buttonBase,
                    border: "none",
                    backgroundColor: "#dc2626",
                    color: "#ffffff",
                    opacity: isBusy ? 0.6 : 1,
                  }}
                >
                  Reject
                </button>
              </>
            ) : (
              <>
              {request.requestedChanges && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void act(request, "completed")}
                  title="Approved earlier. Changes the timesheet to the requested times"
                  style={{
                    ...buttonBase,
                    border: "none",
                    backgroundColor: "#059669",
                    color: "#ffffff",
                    opacity: isBusy ? 0.6 : 1,
                  }}
                >
                  {isBusy ? "Saving…" : "Apply times"}
                </button>
              )}
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void act(request, "cancelled")}
                style={{
                  ...buttonBase,
                  border: "1px solid #fca5a5",
                  backgroundColor: "#ffffff",
                  color: "#b91c1c",
                  opacity: isBusy ? 0.6 : 1,
                }}
              >
                {isBusy ? "Saving…" : "Revoke"}
              </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ordered = [...open, ...approved];

  return (
    <div
      style={{
        backgroundColor: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
        marginBottom: "2rem",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 1.25rem",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#f9fafb",
        }}
      >
        <div>
          <span style={{ fontWeight: 600, fontSize: "0.95rem", color: "#111827" }}>
            Timesheet Edit Requests
          </span>
          {!loading && !error && (
            <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "#6b7280" }}>
              ({open.length} awaiting review
              {approved.length > 0 ? `, ${approved.length} approved` : ""})
            </span>
          )}
        </div>
        <Link
          href="/timesheet-edit-requests"
          style={{ fontSize: "0.85rem", color: "#2563eb", textDecoration: "none", fontWeight: 500 }}
        >
          Open full queue →
        </Link>
      </div>

      {error && (
        <div style={{ padding: "0.75rem 1.25rem", backgroundColor: "#fee2e2", color: "#b91c1c", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "1.5rem 1.25rem", color: "#6b7280", fontSize: "0.875rem" }}>
          Loading timesheet edit requests…
        </div>
      ) : !error && ordered.length === 0 ? (
        <div style={{ padding: "1.5rem 1.25rem", color: "#6b7280", fontSize: "0.875rem" }}>
          No timesheet edit requests are waiting. Workers and managers request edits from a locked
          timesheet on the employee profile.
        </div>
      ) : (
        <div>{ordered.map((request, index) => renderRow(request, index, ordered.length))}</div>
      )}
    </div>
  );
}
