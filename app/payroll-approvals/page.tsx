"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import "@/app/global-calendar/dashboard-styles.css";

type Submission = {
  id: string;
  submitted_by: string;
  submitted_by_name: string;
  file_name: string;
  status: "submitted" | "approved" | "rejected";
  submitted_at: string;
  notes: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function PayrollApprovalsPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Per-row action state
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  // ── Auth check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { router.push("/login"); return; }

        const { data, error: roleErr } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single() as any;

        const role = (data?.role || "").toString().trim().toLowerCase();
        if (roleErr || !["exec", "admin"].includes(role)) {
          router.push("/dashboard");
          return;
        }
        setIsAuthorized(true);
      } catch {
        router.push("/login");
      } finally {
        setAuthChecking(false);
      }
    };
    check();
  }, [router]);

  // ── Fetch submissions ───────────────────────────────────────────────────────
  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payroll/approvals", {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load submissions");
      setSubmissions(json.submissions ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load submissions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthorized) fetchSubmissions();
  }, [isAuthorized, fetchSubmissions]);

  // ── Open action panel ───────────────────────────────────────────────────────
  const openAction = (id: string, type: "approve" | "reject") => {
    setActionId(id);
    setActionType(type);
    setActionNotes("");
    setActionError("");
  };

  const cancelAction = () => {
    setActionId(null);
    setActionType(null);
    setActionNotes("");
    setActionError("");
  };

  // ── Submit action ───────────────────────────────────────────────────────────
  const submitAction = async () => {
    if (!actionId || !actionType) return;
    setSubmitting(true);
    setActionError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/payroll/approvals", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          id: actionId,
          status: actionType === "approve" ? "approved" : "rejected",
          notes: actionNotes.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to update submission");

      // Update local state optimistically
      setSubmissions(prev =>
        prev.map(s =>
          s.id === actionId
            ? { ...s, status: actionType === "approve" ? "approved" : "rejected", notes: actionNotes.trim() || null }
            : s
        )
      );
      cancelAction();
    } catch (e: any) {
      setActionError(e.message || "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = {
    total: submissions.length,
    submitted: submissions.filter(s => s.status === "submitted").length,
    approved: submissions.filter(s => s.status === "approved").length,
    rejected: submissions.filter(s => s.status === "rejected").length,
  };

  // ── Render guards ───────────────────────────────────────────────────────────
  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="apple-card p-8">
          <p className="text-gray-500 text-sm">Checking access…</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Payroll Approvals</h1>
            <p className="text-gray-500 mt-1 text-sm">Review and approve payroll submissions from the HR team.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchSubmissions}
              disabled={loading}
              className={`apple-button ${loading ? "apple-button-disabled" : "apple-button-secondary"}`}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link href="/hr-dashboard?view=payments">
              <button className="apple-button apple-button-secondary">← HR Dashboard</button>
            </Link>
          </div>
        </div>

        {/* ── Stats ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total", value: stats.total, color: "text-gray-900", bg: "bg-white" },
            { label: "Pending", value: stats.submitted, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Approved", value: stats.approved, color: "text-green-600", bg: "bg-green-50" },
            { label: "Rejected", value: stats.rejected, color: "text-red-600", bg: "bg-red-50" },
          ].map(stat => (
            <div key={stat.label} className={`rounded-2xl p-5 ${stat.bg} border border-black/5`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* ── Error ──────────────────────────────────────────────── */}
        {error && (
          <div className="apple-alert apple-alert-error mb-6">{error}</div>
        )}

        {/* ── Submissions list ────────────────────────────────────── */}
        {loading && submissions.length === 0 ? (
          <div className="apple-card p-10 text-center">
            <p className="text-gray-500 text-sm">Loading submissions…</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="apple-card p-10 text-center">
            <p className="text-gray-400 font-medium">No payroll approval submissions yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map(s => (
              <div key={s.id} className="apple-card">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">

                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900 truncate">{s.file_name}</span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[s.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Submitted by <span className="font-medium text-gray-700">{s.submitted_by_name}</span>
                      {" · "}
                      {new Date(s.submitted_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    {s.notes && (
                      <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <span className="font-medium text-gray-700">Notes: </span>{s.notes}
                      </p>
                    )}
                  </div>

                  {/* Right: action buttons (only for pending) */}
                  {s.status === "submitted" && actionId !== s.id && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => openAction(s.id, "approve")}
                        className="apple-button apple-button-primary text-sm px-4 py-2"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => openAction(s.id, "reject")}
                        className="apple-button apple-button-danger text-sm px-4 py-2"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline action panel */}
                {actionId === s.id && (
                  <div className={`mt-4 rounded-xl border p-4 ${actionType === "approve" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                    <p className={`text-sm font-semibold mb-2 ${actionType === "approve" ? "text-green-700" : "text-red-700"}`}>
                      {actionType === "approve" ? "Approve this submission?" : "Reject this submission?"}
                    </p>
                    <label className="apple-label text-xs mb-1 block">Notes (optional)</label>
                    <textarea
                      rows={2}
                      value={actionNotes}
                      onChange={e => setActionNotes(e.target.value)}
                      placeholder={actionType === "approve" ? "Approval comments…" : "Reason for rejection…"}
                      className="apple-select resize-none text-sm mb-3"
                    />
                    {actionError && (
                      <p className="text-xs text-red-600 mb-2">{actionError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={submitAction}
                        disabled={submitting}
                        className={`apple-button text-sm ${submitting ? "apple-button-disabled" : actionType === "approve" ? "apple-button-primary" : "apple-button-danger"}`}
                      >
                        {submitting ? "Saving…" : actionType === "approve" ? "Confirm Approval" : "Confirm Rejection"}
                      </button>
                      <button
                        onClick={cancelAction}
                        disabled={submitting}
                        className="apple-button apple-button-secondary text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
