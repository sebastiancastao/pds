"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

type EditEntry = {
  timeEntryId: string;
  eventId: string | null;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  workerUserId: string;
  workerName: string;
  workerEmail: string | null;
  action: "clock_in" | "clock_out" | "meal_start" | "meal_end" | string;
  entryTimestamp: string;
  editedByRole: string | null;
  editReason: string | null;
  signatureId: string | null;
  editedByUserId: string | null;
  editedByName: string | null;
  editedByEmail: string | null;
  editedAt: string | null;
  rawNote: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  clock_in: "Clock In",
  clock_out: "Clock Out",
  meal_start: "Meal Start",
  meal_end: "Meal End",
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

const fmtDateTime = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
};

const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString();
};

export default function TimesheetEditsPage() {
  const [entries, setEntries] = useState<EditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [userRole, setUserRole] = useState<string | null>(null);

  const loadEntries = useCallback(async (token: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/timesheet-edits?limit=700", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load edit history.");
      }

      const rows = Array.isArray(payload?.entries) ? (payload.entries as EditEntry[]) : [];
      setEntries(rows);
    } catch (err: any) {
      setError(err?.message || "Failed to load edit history.");
      setEntries([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

        const { data: requester, error: roleError } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .maybeSingle();
        if (roleError) {
          throw new Error(roleError.message);
        }

        const role = String((requester as { role?: string } | null)?.role || "").toLowerCase().trim();
        setUserRole(role);
        if (!ALLOWED_ROLES.has(role)) {
          setError("Access denied. You do not have permission to view timesheet edit history.");
          setLoading(false);
          return;
        }

        await loadEntries(session.access_token);
      } catch (err: any) {
        setError(err?.message || "Failed to initialize page.");
        setLoading(false);
      }
    };

    void boot();
  }, [loadEntries]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; date: string | null }>();
    for (const row of entries) {
      const id = row.eventId || "no_event";
      if (!map.has(id)) {
        map.set(id, { id, name: row.eventName || "(No event)", date: row.eventDate });
      }
    }
    return [...map.values()].sort((a, b) => {
      const aTs = a.date ? new Date(a.date).getTime() : 0;
      const bTs = b.date ? new Date(b.date).getTime() : 0;
      return bTs - aTs;
    });
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((row) => {
      if (actionFilter !== "all" && row.action !== actionFilter) return false;

      const rowEventId = row.eventId || "no_event";
      if (eventFilter !== "all" && rowEventId !== eventFilter) return false;

      if (!q) return true;

      const haystack = [
        row.eventName,
        row.eventDate,
        row.workerName,
        row.workerEmail,
        row.editedByName,
        row.editedByEmail,
        row.editedByRole,
        row.editReason,
        row.action,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [entries, search, actionFilter, eventFilter]);

  const handleRefresh = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return;
    }
    await loadEntries(session.access_token, true);
  };

  const handleDownloadExcel = useCallback(() => {
    if (filteredEntries.length === 0) {
      return;
    }

    setDownloadingExcel(true);
    try {
      const exportRows = filteredEntries.map((row) => ({
        "Edited At": row.editedAt || row.entryTimestamp || "",
        "Event Date": row.eventDate || "",
        Event: row.eventName || "",
        Venue: row.venue || "",
        City: row.city || "",
        State: row.state || "",
        Action: ACTION_LABELS[row.action] || row.action || "",
        "Worker Name": row.workerName || "",
        "Worker Email": row.workerEmail || "",
        "Entry Time": row.entryTimestamp || "",
        "Edited By": row.editedByName || "",
        "Editor Email": row.editedByEmail || "",
        "Editor Role": row.editedByRole || "",
        Reason: row.editReason || "",
        "Event ID": row.eventId || "",
        "Time Entry ID": row.timeEntryId || "",
        "Signature ID": row.signatureId || "",
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      worksheet["!cols"] = [
        { wch: 22 }, // Edited At
        { wch: 12 }, // Event Date
        { wch: 28 }, // Event
        { wch: 24 }, // Venue
        { wch: 16 }, // City
        { wch: 8 },  // State
        { wch: 12 }, // Action
        { wch: 24 }, // Worker Name
        { wch: 30 }, // Worker Email
        { wch: 22 }, // Entry Time
        { wch: 24 }, // Edited By
        { wch: 30 }, // Editor Email
        { wch: 12 }, // Editor Role
        { wch: 40 }, // Reason
        { wch: 38 }, // Event ID
        { wch: 38 }, // Time Entry ID
        { wch: 38 }, // Signature ID
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Timesheet Edits");

      const today = new Date().toISOString().slice(0, 10);
      const actionPart = actionFilter === "all" ? "all-actions" : actionFilter;
      const eventPart = eventFilter === "all" ? "all-events" : "filtered-event";
      const filename = `timesheet_edits_${eventPart}_${actionPart}_${today}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (err: any) {
      setError(err?.message || "Failed to download Excel file.");
    } finally {
      setDownloadingExcel(false);
    }
  }, [filteredEntries, actionFilter, eventFilter]);

  const canViewData = userRole ? ALLOWED_ROLES.has(userRole) : true;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-gradient-to-r from-slate-900 to-slate-700 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold">Timesheet Edit History</h1>
              <p className="text-slate-200 mt-1">
                Track who edited each event entry, including clock in/out and meal actions.
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-lg border border-white/30 text-white hover:bg-white/10 transition-colors"
              >
                Back to Dashboard
              </Link>
              <button
                onClick={handleDownloadExcel}
                disabled={loading || downloadingExcel || !canViewData || filteredEntries.length === 0}
                className="px-4 py-2 rounded-lg border border-white/30 text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloadingExcel ? "Downloading..." : "Download Excel"}
              </button>
              <button
                onClick={handleRefresh}
                disabled={loading || refreshing || !canViewData}
                className="px-4 py-2 rounded-lg bg-white text-slate-900 font-semibold hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search event, worker, editor, reason..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-slate-400 focus:outline-none"
            />
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-slate-400 focus:outline-none"
            >
              <option value="all">All events</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} ({event.date ? fmtDate(event.date) : "No date"})
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-slate-400 focus:outline-none"
            >
              <option value="all">All actions</option>
              <option value="clock_in">Clock In</option>
              <option value="clock_out">Clock Out</option>
              <option value="meal_start">Meal Start</option>
              <option value="meal_end">Meal End</option>
            </select>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading timesheet edit history...</div>
          ) : error ? (
            <div className="p-8 text-center">
              <div className="text-red-600 font-semibold">{error}</div>
              {!canViewData && (
                <div className="mt-3 text-sm text-gray-500">
                  Your role: <span className="font-mono">{userRole || "-"}</span>
                </div>
              )}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No manual timesheet edits found for the selected filters.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-200 text-sm text-gray-600">
                Showing <span className="font-semibold text-gray-900">{filteredEntries.length}</span> edit record
                {filteredEntries.length === 1 ? "" : "s"}
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Edited At</th>
                      <th className="text-left px-4 py-3 font-semibold">Event</th>
                      <th className="text-left px-4 py-3 font-semibold">Worker</th>
                      <th className="text-left px-4 py-3 font-semibold">Action</th>
                      <th className="text-left px-4 py-3 font-semibold">Entry Time</th>
                      <th className="text-left px-4 py-3 font-semibold">Edited By</th>
                      <th className="text-left px-4 py-3 font-semibold">Role</th>
                      <th className="text-left px-4 py-3 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((row) => (
                      <tr key={row.timeEntryId} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                          {fmtDateTime(row.editedAt || row.entryTimestamp)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{row.eventName}</div>
                          <div className="text-xs text-gray-500">
                            {fmtDate(row.eventDate)} {row.state ? ` - ${row.state}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{row.workerName}</div>
                          <div className="text-xs text-gray-500">{row.workerEmail || row.workerUserId}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex rounded-full bg-blue-50 text-blue-700 px-2 py-1 text-xs font-semibold">
                            {ACTION_LABELS[row.action] || row.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                          {fmtDateTime(row.entryTimestamp)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {row.editedByName || row.editedByEmail || row.editedByUserId || "-"}
                          </div>
                          <div className="text-xs text-gray-500">{row.editedByEmail || row.editedByUserId || "-"}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                          {row.editedByRole || "-"}
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-sm" title={row.editReason || ""}>
                          {row.editReason || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
