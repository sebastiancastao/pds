"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Types ───────────────────────────────────────────────────────────
type TabType = "overview" | "kiosks" | "events" | "attestations";

type ActiveKiosk = {
  ipAddress: string;
  userAgent: string;
  operatorUserId: string;
  operatorName: string;
  eventId: string | null;
  lastSeen: string;
};

type CheckedInUser = {
  userId: string;
  name: string;
  eventId: string | null;
  eventName: string | null;
  venue: string | null;
  clockedInAt: string;
  division: string;
};

type ActiveEvent = {
  id: string;
  name: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  date: string;
  startTime: string;
  endTime: string;
  checkedInCount: number;
  checkedInUsers: Array<{ userId: string; name: string; clockedInAt: string; division: string }>;
};

type Attestation = {
  id: string;
  userId: string;
  name: string;
  signedAt: string;
  ipAddress: string;
  isValid: boolean;
  formId: string;
};

type MonitorData = {
  timestamp: string;
  activeKiosks: ActiveKiosk[];
  activeEvents: ActiveEvent[];
  checkedInUsers: CheckedInUser[];
  attestations: Attestation[];
  summary: {
    totalActiveKiosks: number;
    totalCheckedIn: number;
    totalAttestationsToday: number;
    totalActiveEvents: number;
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────
function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--";
  }
}

function parseDevice(ua: string): string {
  if (!ua || ua === "unknown") return "Unknown";
  if (/iPad/i.test(ua)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return "Android Phone";
  if (/Android/i.test(ua)) return "Android Tablet";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux";
  return "Browser";
}

// ─── Component ───────────────────────────────────────────────────────
export default function CheckInMonitorPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [data, setData] = useState<MonitorData | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const accessTokenRef = useRef<string | null>(null);

  // ─── Auth ──────────────────────────────────────────────────────
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    const mfaVerified = sessionStorage.getItem("mfa_verified");
    if (!mfaVerified) { router.push("/verify-mfa"); return; }

    const { data: userData } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single() as any;

    const role = (userData?.role || "").toString().trim().toLowerCase();
    if (!["manager", "hr", "exec", "admin"].includes(role)) {
      router.push("/");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    accessTokenRef.current = sessionData.session?.access_token || null;

    setIsAuthorized(true);
    setLoading(false);
  };

  // ─── Data fetching ────────────────────────────────────────────
  const fetchMonitorData = useCallback(async () => {
    try {
      const token = accessTokenRef.current;
      if (!token) {
        const { data: sessionData } = await supabase.auth.getSession();
        accessTokenRef.current = sessionData.session?.access_token || null;
        if (!accessTokenRef.current) return;
      }

      const res = await fetch("/api/admin/check-in-monitor", {
        headers: { Authorization: `Bearer ${accessTokenRef.current}` },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || "Failed to load monitor data");
        return;
      }

      const json: MonitorData = await res.json();
      setData(json);
      setLastRefreshed(new Date());
      setError("");
    } catch (err: any) {
      setError(err.message || "Connection error");
    }
  }, []);

  const downloadPdfReport = useCallback(async () => {
    try {
      setIsExportingPdf(true);
      setError("");

      const token =
        accessTokenRef.current || (await supabase.auth.getSession()).data.session?.access_token || null;
      accessTokenRef.current = token;
      if (!token) {
        setError("Session expired. Please sign in again.");
        return;
      }

      const res = await fetch("/api/admin/check-in-monitor/export", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to export PDF");
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = objectUrl;
      link.download = `check-in-monitor-${timestamp}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setError(err.message || "Failed to export PDF");
    } finally {
      setIsExportingPdf(false);
    }
  }, []);

  // Fetch on mount + auto-refresh every 15s
  useEffect(() => {
    if (!isAuthorized) return;
    fetchMonitorData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchMonitorData, 15_000);
    return () => clearInterval(interval);
  }, [isAuthorized, autoRefresh, fetchMonitorData]);

  // ─── Event card expand/collapse ───────────────────────────────
  const toggleEvent = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── Loading state ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }
  if (!isAuthorized) return null;

  const summary = data?.summary || { totalActiveKiosks: 0, totalCheckedIn: 0, totalAttestationsToday: 0, totalActiveEvents: 0 };

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Check-In Monitor</h1>
              <p className="text-xs text-gray-500">
                {lastRefreshed
                  ? `Last updated: ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "Loading..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Export PDF */}
            <button
              onClick={downloadPdfReport}
              disabled={isExportingPdf}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                isExportingPdf
                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
              title="Download monitor report as PDF"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v7m0 0l-3-3m3 3l3-3M3 17a4 4 0 014-4h1m4-4h1a4 4 0 014 4v4m-8-8V3m0 0L9 6m3-3l3 3" />
              </svg>
              {isExportingPdf ? "Preparing..." : "Export PDF"}
            </button>
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                autoRefresh
                  ? "bg-green-100 text-green-800 border border-green-300"
                  : "bg-gray-100 text-gray-600 border border-gray-300"
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${autoRefresh ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
              {autoRefresh ? "Live" : "Paused"}
            </button>
            {/* Manual refresh */}
            <button
              onClick={fetchMonitorData}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
              title="Refresh now"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
          {([
            { key: "overview" as const, label: "Overview" },
            { key: "kiosks" as const, label: "Active Kiosks" },
            { key: "events" as const, label: "Event Check-ins" },
            { key: "attestations" as const, label: "Attestations" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div>
            {/* Summary stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {/* Active Kiosks */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  {summary.totalActiveKiosks > 0 && (
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                  )}
                </div>
                <p className="text-3xl font-bold text-gray-900">{summary.totalActiveKiosks}</p>
                <p className="text-sm text-gray-500 mt-1">Active Kiosks</p>
              </div>

              {/* Currently Checked In */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </div>
                <p className="text-3xl font-bold text-gray-900">{summary.totalCheckedIn}</p>
                <p className="text-sm text-gray-500 mt-1">Currently Checked In</p>
              </div>

              {/* Active Events */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
                <p className="text-3xl font-bold text-gray-900">{summary.totalActiveEvents}</p>
                <p className="text-sm text-gray-500 mt-1">Active Events</p>
              </div>

              {/* Attestations Today */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <p className="text-3xl font-bold text-gray-900">{summary.totalAttestationsToday}</p>
                <p className="text-sm text-gray-500 mt-1">Attestations Today</p>
              </div>
            </div>

            {/* Quick lists */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Active kiosks quick list */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Active Kiosks</h3>
                {(data?.activeKiosks || []).length === 0 ? (
                  <p className="text-sm text-gray-400">No active kiosks</p>
                ) : (
                  <div className="space-y-3">
                    {(data?.activeKiosks || []).slice(0, 5).map((kiosk) => {
                      const secondsAgo = Math.floor((Date.now() - new Date(kiosk.lastSeen).getTime()) / 1000);
                      return (
                        <div key={kiosk.ipAddress} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-2.5 h-2.5 rounded-full ${secondsAgo < 30 ? "bg-green-500" : "bg-yellow-500"}`} />
                            <div>
                              <p className="text-sm font-medium text-gray-800">{kiosk.ipAddress}</p>
                              <p className="text-xs text-gray-500">{kiosk.operatorName}</p>
                            </div>
                          </div>
                          <span className="text-xs text-gray-400">{timeAgo(kiosk.lastSeen)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent attestations quick list */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Attestations</h3>
                {(data?.attestations || []).length === 0 ? (
                  <p className="text-sm text-gray-400">No attestations today</p>
                ) : (
                  <div className="space-y-3">
                    {(data?.attestations || []).slice(0, 5).map((att) => (
                      <div key={att.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2.5 h-2.5 rounded-full ${att.isValid ? "bg-green-500" : "bg-red-500"}`} />
                          <div>
                            <p className="text-sm font-medium text-gray-800">{att.name}</p>
                            <p className="text-xs text-gray-500">{att.ipAddress}</p>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400">{formatTime(att.signedAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Checked-in workers overview */}
            {(data?.checkedInUsers || []).length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mt-4">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Currently Checked In ({data?.checkedInUsers.length})
                </h3>
                <div className="space-y-2">
                  {(data?.checkedInUsers || []).slice(0, 10).map((u) => (
                    <div key={u.userId} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                        <span className="font-medium text-gray-800 truncate">{u.name}</span>
                        {u.eventName && (
                          <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full truncate">
                            {u.eventName}
                          </span>
                        )}
                        {u.venue && (
                          <span className="text-xs text-gray-400 truncate">{u.venue}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{u.division || "—"}</span>
                        <span className="text-xs text-gray-400">{formatTime(u.clockedInAt)}</span>
                      </div>
                    </div>
                  ))}
                  {(data?.checkedInUsers || []).length > 10 && (
                    <p className="text-xs text-gray-400 text-center mt-2">
                      +{(data?.checkedInUsers || []).length - 10} more
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Active Kiosks Tab ── */}
        {activeTab === "kiosks" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Active Kiosks ({data?.activeKiosks.length || 0})
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Kiosks that sent a heartbeat in the last 60 seconds</p>
            </div>
            {(data?.activeKiosks || []).length === 0 ? (
              <div className="px-5 py-12 text-center">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-400">No active kiosks right now</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {(data?.activeKiosks || []).map((kiosk) => {
                  const secondsAgo = Math.floor((Date.now() - new Date(kiosk.lastSeen).getTime()) / 1000);
                  const eventData = kiosk.eventId
                    ? (data?.activeEvents || []).find((e) => e.id === kiosk.eventId)
                    : null;
                  return (
                    <div key={kiosk.ipAddress} className="px-5 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${secondsAgo < 30 ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900 font-mono">{kiosk.ipAddress}</p>
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                              {parseDevice(kiosk.userAgent)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Operator: <span className="font-medium">{kiosk.operatorName}</span>
                          </p>
                          {eventData && (
                            <p className="text-xs text-purple-600 mt-0.5">
                              Event: {eventData.name || "Unnamed"} {eventData.venue ? `@ ${eventData.venue}` : ""}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400">{timeAgo(kiosk.lastSeen)}</p>
                        <p className={`text-xs font-medium mt-0.5 ${secondsAgo < 30 ? "text-green-600" : "text-yellow-600"}`}>
                          {secondsAgo < 30 ? "Connected" : "Stale"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Event Check-ins Tab ── */}
        {activeTab === "events" && (
          <div className="space-y-4">
            {(data?.activeEvents || []).length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-12 text-center">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-400">No active events right now</p>
              </div>
            ) : (
              (data?.activeEvents || []).map((evt) => {
                const isExpanded = expandedEvents.has(evt.id);
                return (
                  <div key={evt.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <button
                      onClick={() => toggleEvent(evt.id)}
                      className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900 truncate">{evt.name || "Unnamed Event"}</h4>
                          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full font-medium flex-shrink-0">
                            {evt.checkedInCount} checked in
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {evt.venue && <span>{evt.venue}</span>}
                          {evt.city && <span> &middot; {evt.city}{evt.state ? `, ${evt.state}` : ""}</span>}
                          {evt.startTime && evt.endTime && (
                            <span> &middot; {evt.startTime.substring(0, 5)} - {evt.endTime.substring(0, 5)}</span>
                          )}
                        </p>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-100">
                        {evt.checkedInUsers.length === 0 ? (
                          <p className="px-5 py-4 text-sm text-gray-400">No workers checked in for this event</p>
                        ) : (
                          <div className="divide-y divide-gray-50">
                            {/* Table header */}
                            <div className="px-5 py-2 flex items-center gap-4 text-xs text-gray-400 uppercase tracking-wide bg-gray-50">
                              <span className="w-8">#</span>
                              <span className="flex-1">Name</span>
                              <span className="w-24 text-right">Clocked In</span>
                              <span className="w-20 text-right">Division</span>
                            </div>
                            {evt.checkedInUsers.map((u, i) => (
                              <div key={u.userId} className="px-5 py-3 flex items-center gap-4 text-sm">
                                <span className="w-8 text-gray-400">{i + 1}</span>
                                <span className="flex-1 font-medium text-gray-800 truncate">{u.name}</span>
                                <span className="w-24 text-right text-gray-500">{formatTime(u.clockedInAt)}</span>
                                <span className="w-20 text-right">
                                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{u.division || "—"}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Workers not linked to any event */}
            {(() => {
              const unlinked = (data?.checkedInUsers || []).filter((u) => !u.eventId);
              if (unlinked.length === 0) return null;
              return (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h4 className="text-sm font-semibold text-gray-700">No Event Linked</h4>
                    <p className="text-xs text-gray-400 mt-0.5">{unlinked.length} worker(s) checked in without an event</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {unlinked.map((u) => (
                      <div key={u.userId} className="px-5 py-3 flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-800">{u.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{u.division || "—"}</span>
                          <span className="text-gray-500">{formatTime(u.clockedInAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Attestations Tab ── */}
        {activeTab === "attestations" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Clock-Out Attestations ({data?.attestations.length || 0})
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Signatures from the last 24 hours</p>
            </div>
            {(data?.attestations || []).length === 0 ? (
              <div className="px-5 py-12 text-center">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-400">No attestations in the last 24 hours</p>
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="px-5 py-2 flex items-center gap-4 text-xs text-gray-400 uppercase tracking-wide bg-gray-50">
                  <span className="flex-1">Worker</span>
                  <span className="w-24 text-right">Signed At</span>
                  <span className="w-32 text-right">IP Address</span>
                  <span className="w-16 text-center">Valid</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {(data?.attestations || []).map((att) => (
                    <div key={att.id} className="px-5 py-3 flex items-center gap-4 text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 truncate">{att.name}</p>
                        <p className="text-xs text-gray-400 truncate font-mono">{att.formId}</p>
                      </div>
                      <span className="w-24 text-right text-gray-500">{formatTime(att.signedAt)}</span>
                      <span className="w-32 text-right text-gray-500 font-mono text-xs">{att.ipAddress}</span>
                      <span className="w-16 text-center">
                        {att.isValid ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 rounded-full">
                            <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-red-100 rounded-full">
                            <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
