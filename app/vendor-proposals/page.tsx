"use client";
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

type Proposal = {
  id: string;
  status: "pending" | "approved" | "declined";
  created_at: string;
  reviewed_at: string | null;
  notes: string | null;
  event_id: string;
  event_name: string;
  event_date: string;
  venue_name: string;
  location_id: string;
  location_name: string;
  vendor_id: string;
  vendor_name: string;
  vendor_email: string;
  proposed_by: string;
  proposer_name: string;
  proposer_email: string;
  reviewed_by: string | null;
  reviewer_name: string | null;
  distance_miles: number | null;
};

type StatusFilter = "all" | "pending" | "approved" | "declined";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatEventDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  }
  return value;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
};

export default function VendorProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [userRole, setUserRole] = useState<string>("");

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const checkRole = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();
    setUserRole(String(data?.role || ""));
  }, []);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const url = statusFilter === "all"
        ? "/api/vendor-proposals"
        : `/api/vendor-proposals?status=${statusFilter}`;

      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load proposals");
      setProposals(Array.isArray(data?.proposals) ? data.proposals : []);
    } catch (err: any) {
      setError(err.message || "Failed to load proposals");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, getToken]);

  useEffect(() => {
    void checkRole();
  }, [checkRole]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const handleReview = async (proposalId: string, action: "approved" | "declined") => {
    setActionLoading(proposalId + action);
    setMessage("");
    try {
      const token = await getToken();
      const notes = reviewNotes[proposalId] || "";
      const res = await fetch(`/api/vendor-proposals/${proposalId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, notes: notes || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Action failed");
      setMessage(data?.message || `Proposal ${action}.`);
      setReviewingId(null);
      setReviewNotes((prev) => { const n = { ...prev }; delete n[proposalId]; return n; });
      void loadProposals();
    } catch (err: any) {
      setMessage(err.message || "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const isExecAdmin = userRole === "exec" || userRole === "admin";

  const pendingCount = proposals.filter((p) => p.status === "pending").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Vendor Proposals</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Review out-of-venue staffing proposals. Approve to assign the vendor; decline to notify the requester.
            </p>
          </div>
          <button
            onClick={() => void loadProposals()}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {!isExecAdmin && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm mb-6">
            You have read-only access. Only exec and admin roles can approve or decline proposals.
          </div>
        )}

        {message && (
          <div className={`rounded-lg p-4 text-sm mb-6 border ${
            message.toLowerCase().includes("fail") || message.toLowerCase().includes("error")
              ? "bg-red-50 border-red-200 text-red-800"
              : "bg-green-50 border-green-200 text-green-800"
          }`}>
            {message}
          </div>
        )}

        {/* Status Tabs */}
        <div className="flex gap-2 mb-6">
          {(["pending", "approved", "declined", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`py-1.5 px-4 rounded-full text-sm font-medium transition ${
                statusFilter === s
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              {s === "pending" && pendingCount > 0 && statusFilter !== "pending" && (
                <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-gray-600">Loading proposals...</p>
          </div>
        ) : proposals.length === 0 ? (
          <div className="bg-white rounded-lg border p-12 text-center">
            <p className="text-gray-500 text-lg font-medium">
              {statusFilter === "pending" ? "No pending proposals" : `No ${statusFilter === "all" ? "" : statusFilter + " "}proposals found`}
            </p>
            <p className="text-gray-400 text-sm mt-2">
              {statusFilter === "pending"
                ? "Proposals appear here when someone requests an out-of-venue vendor assignment."
                : "Change the filter above to view proposals with a different status."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => {
              const isReviewing = reviewingId === proposal.id;
              const actionInProgress = actionLoading?.startsWith(proposal.id);
              return (
                <div
                  key={proposal.id}
                  className={`bg-white border rounded-lg overflow-hidden shadow-sm ${
                    proposal.status === "pending" ? "border-amber-200" : "border-gray-200"
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-4 p-5 border-b border-gray-100">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-semibold text-gray-900">
                          {proposal.vendor_name || proposal.vendor_email}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_COLORS[proposal.status] || "bg-gray-100 text-gray-600"}`}>
                          {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{proposal.vendor_email}</p>
                    </div>
                    <p className="text-xs text-gray-400 whitespace-nowrap">
                      {formatDate(proposal.created_at)}
                    </p>
                  </div>

                  {/* Details Grid */}
                  <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Event</p>
                      <p className="text-gray-900 font-medium">{proposal.event_name}</p>
                      <p className="text-gray-500 text-xs">{formatEventDate(proposal.event_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Venue / Station</p>
                      <p className="text-gray-900">{proposal.venue_name}</p>
                      <p className="text-gray-500 text-xs">{proposal.location_name}</p>
                      {proposal.distance_miles != null && (
                        <p className="text-xs mt-1 font-medium text-indigo-600">
                          {proposal.distance_miles} mi from vendor
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Proposed By</p>
                      <p className="text-gray-900">{proposal.proposer_name || proposal.proposer_email}</p>
                      <p className="text-gray-500 text-xs">{proposal.proposer_email}</p>
                    </div>
                    {proposal.status !== "pending" && proposal.reviewer_name && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                          {proposal.status === "approved" ? "Approved" : "Declined"} By
                        </p>
                        <p className="text-gray-900">{proposal.reviewer_name}</p>
                        <p className="text-gray-500 text-xs">{formatDate(proposal.reviewed_at)}</p>
                      </div>
                    )}
                    {proposal.notes && (
                      <div className="sm:col-span-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Notes</p>
                        <p className="text-gray-700 bg-gray-50 rounded px-3 py-2 text-xs">{proposal.notes}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions — only for pending proposals and exec/admin */}
                  {proposal.status === "pending" && isExecAdmin && (
                    <div className="px-5 pb-5">
                      {!isReviewing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => setReviewingId(proposal.id)}
                            disabled={actionInProgress}
                            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => {
                              setReviewingId(proposal.id);
                            }}
                            disabled={actionInProgress}
                            className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <textarea
                            value={reviewNotes[proposal.id] || ""}
                            onChange={(e) =>
                              setReviewNotes((prev) => ({ ...prev, [proposal.id]: e.target.value }))
                            }
                            placeholder="Optional notes (visible to proposer on decline)"
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => void handleReview(proposal.id, "approved")}
                              disabled={actionInProgress}
                              className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                            >
                              {actionLoading === proposal.id + "approved" ? "Approving..." : "Confirm Approve"}
                            </button>
                            <button
                              onClick={() => void handleReview(proposal.id, "declined")}
                              disabled={actionInProgress}
                              className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                            >
                              {actionLoading === proposal.id + "declined" ? "Declining..." : "Confirm Decline"}
                            </button>
                            <button
                              onClick={() => {
                                setReviewingId(null);
                                setReviewNotes((prev) => { const n = { ...prev }; delete n[proposal.id]; return n; });
                              }}
                              disabled={actionInProgress}
                              className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm font-semibold py-2 px-4 rounded transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
