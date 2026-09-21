"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import type { VenueDataEntryWithVenue } from "@/lib/venue-data";
import { fmtDate, fmtInt, fmtMoney, toLocalISODate } from "@/components/venue-data/format";

type Venue = {
  id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
};

type FormState = {
  venue_id: string;
  event_date: string;
  event_name: string;
  attendance: string;
  capacity: string;
  gross_sales: string;
  staff_count: string;
  notes: string;
};

type ImportIssue = { row: number; message: string };
type ImportResult = {
  inserted: number;
  skipped: ImportIssue[];
  failed: ImportIssue[];
  aborted: string;
};

const PAGE_SIZE = 25;
const IMPORT_CHUNK = 500;
const MAX_IMPORT_ROWS = 5000;
const dash = "—";

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700";

function emptyForm(venueId = "", date = toLocalISODate(new Date())): FormState {
  return {
    venue_id: venueId,
    event_date: date,
    event_name: "",
    attendance: "",
    capacity: "",
    gross_sales: "",
    staff_count: "",
    notes: "",
  };
}

// Accepted CSV column names (case and punctuation ignored) -> field name.
const HEADER_ALIASES: Record<string, string> = {
  venue: "venue_name",
  venuename: "venue_name",
  date: "event_date",
  eventdate: "event_date",
  event: "event_name",
  eventname: "event_name",
  attendance: "attendance",
  attendees: "attendance",
  capacity: "capacity",
  grosssales: "gross_sales",
  gross: "gross_sales",
  sales: "gross_sales",
  staff: "staff_count",
  staffcount: "staff_count",
  notes: "notes",
  note: "notes",
};

function canonicalHeader(header: string): string {
  const key = header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return HEADER_ALIASES[key] ?? key;
}

function venueLabel(v: Venue): string {
  const place = [v.city, v.state].filter(Boolean).join(", ");
  return place ? `${v.venue_name} (${place})` : v.venue_name;
}

export default function VenueDataPage() {
  const [authChecking, setAuthChecking] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);

  // Entry form
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const formRef = useRef<HTMLDivElement>(null);

  // Saved entries
  const [entries, setEntries] = useState<VenueDataEntryWithVenue[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterVenueId, setFilterVenueId] = useState("");

  // CSV import
  const [importOpen, setImportOpen] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importParseError, setImportParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string> | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = "/login";
      return null;
    }
    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }, []);

  // Only exec/admin can use this page (the API enforces the same rule).
  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        window.location.href = "/login";
        return;
      }
      const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single();
      const role = String((userData as { role?: string } | null)?.role ?? "")
        .trim()
        .toLowerCase();
      if (role !== "exec" && role !== "admin") {
        alert("Access denied. This page is for executives and admins only.");
        window.location.href = "/dashboard";
        return;
      }

      try {
        const res = await fetch("/api/venues", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        setVenues((body.venues || []) as Venue[]);
      } catch (err) {
        console.error("Error loading venues:", err);
      }
      setAuthChecking(false);
    };
    init();
  }, []);

  // limit: how many rows to (re)load from the top of the list.
  const loadEntries = useCallback(
    async (limit = PAGE_SIZE) => {
      setListLoading(true);
      setListError("");
      try {
        const headers = await authHeaders();
        if (!headers) return;
        const params = new URLSearchParams({ limit: String(Math.min(limit, 200)) });
        if (filterVenueId) params.set("venue_id", filterVenueId);
        const res = await fetch(`/api/venue-data?${params.toString()}`, { headers, cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Failed to load entries");
        setEntries(body.entries || []);
        setTotal(body.total || 0);
      } catch (err: any) {
        setListError(err?.message || "Failed to load entries");
      } finally {
        setListLoading(false);
      }
    },
    [authHeaders, filterVenueId]
  );

  useEffect(() => {
    if (!authChecking) loadEntries();
  }, [authChecking, loadEntries]);

  const loadMore = async () => {
    setListLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(entries.length),
      });
      if (filterVenueId) params.set("venue_id", filterVenueId);
      const res = await fetch(`/api/venue-data?${params.toString()}`, { headers, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to load entries");
      setEntries((current) => [...current, ...(body.entries || [])]);
      setTotal(body.total || 0);
    } catch (err: any) {
      setListError(err?.message || "Failed to load entries");
    } finally {
      setListLoading(false);
    }
  };

  const setField = (field: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const resetForm = (keepContext: boolean) => {
    setEditingId(null);
    setForm(keepContext ? emptyForm(form.venue_id, form.event_date) : emptyForm());
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!form.venue_id) return setFormError("Choose a venue.");
    if (!form.event_date) return setFormError("Enter the event date.");
    if (!form.attendance.trim() && !form.capacity.trim() && !form.gross_sales.trim() && !form.staff_count.trim()) {
      return setFormError("Enter at least one of attendance, capacity, gross sales or staff count.");
    }

    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch("/api/venue-data", {
        method: editingId ? "PUT" : "POST",
        headers,
        body: JSON.stringify({ ...form, ...(editingId ? { id: editingId } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to save");

      setFormSuccess(editingId ? "Entry updated." : "Saved. It now counts on the dashboard.");
      resetForm(!editingId);
      await loadEntries(Math.max(entries.length, PAGE_SIZE));
      window.setTimeout(() => setFormSuccess(""), 5000);
    } catch (err: any) {
      setFormError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (entry: VenueDataEntryWithVenue) => {
    setEditingId(entry.id);
    setFormError("");
    setFormSuccess("");
    setForm({
      venue_id: entry.venue_id,
      event_date: entry.event_date,
      event_name: entry.event_name ?? "",
      attendance: entry.attendance === null ? "" : String(entry.attendance),
      capacity: entry.capacity === null ? "" : String(entry.capacity),
      gross_sales: entry.gross_sales === null ? "" : String(entry.gross_sales),
      staff_count: entry.staff_count === null ? "" : String(entry.staff_count),
      notes: entry.notes ?? "",
    });
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDelete = async (entry: VenueDataEntryWithVenue) => {
    const label = `${entry.venue?.venue_name ?? "this venue"} on ${fmtDate(entry.event_date)}`;
    if (!window.confirm(`Delete the entry for ${label}? This removes it from the dashboard.`)) return;
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/venue-data?id=${entry.id}`, { method: "DELETE", headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Failed to delete");
      if (editingId === entry.id) resetForm(false);
      await loadEntries(Math.max(entries.length - 1, PAGE_SIZE));
    } catch (err: any) {
      setListError(err?.message || "Failed to delete");
    }
  };

  // ---- CSV import ---------------------------------------------------------

  const downloadTemplate = () => {
    const sample = (venues[0]?.venue_name ?? "Example Venue").replace(/"/g, '""');
    const csv = [
      "venue_name,event_date,event_name,attendance,capacity,gross_sales,staff_count,notes",
      `"${sample}",${toLocalISODate(new Date())},EXAMPLE - delete this row,12500,15000,41250.50,30,`,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "venue-data-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = (file: File | undefined) => {
    setImportResult(null);
    setImportParseError("");
    setImportRows([]);
    setImportFileName(file?.name ?? "");
    if (!file) return;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: canonicalHeader,
      complete: (results) => {
        const fields = results.meta.fields ?? [];
        const missing = ["venue_name", "event_date"].filter((f) => !fields.includes(f));
        if (missing.length > 0) {
          setImportParseError(
            `The file is missing a column for: ${missing.join(", ")}. Download the template to see the expected columns.`
          );
          return;
        }
        if (results.data.length === 0) {
          setImportParseError("The file has no data rows.");
          return;
        }
        if (results.data.length > MAX_IMPORT_ROWS) {
          setImportParseError(`The file has ${fmtInt(results.data.length)} rows. Import at most ${fmtInt(MAX_IMPORT_ROWS)} at a time.`);
          return;
        }
        setImportRows(results.data);
      },
      error: (err) => setImportParseError(err.message || "Could not read the file."),
    });
  };

  const runImport = async () => {
    if (importRows.length === 0) return;
    setImporting(true);
    setImportResult(null);
    const result: ImportResult = { inserted: 0, skipped: [], failed: [], aborted: "" };
    try {
      const headers = await authHeaders();
      if (!headers) return;
      for (let offset = 0; offset < importRows.length; offset += IMPORT_CHUNK) {
        const chunk = importRows.slice(offset, offset + IMPORT_CHUNK);
        const res = await fetch("/api/venue-data", {
          method: "POST",
          headers,
          body: JSON.stringify({ entries: chunk }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          result.aborted = `${body?.error || "Import failed"}. Rows from ${offset + 1} onward were not imported.`;
          break;
        }
        result.inserted += body.inserted || 0;
        for (const s of body.skipped || []) result.skipped.push({ row: s.row + offset, message: s.reason });
        for (const f of body.failed || []) result.failed.push({ row: f.row + offset, message: f.error });
      }
    } catch (err: any) {
      result.aborted = err?.message || "Import failed";
    } finally {
      setImportResult(result);
      setImporting(false);
      if (result.inserted > 0) {
        setImportRows([]);
        setImportFileName("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        loadEntries();
      }
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const tomorrow = toLocalISODate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const previewColumns = ["venue_name", "event_date", "event_name", "attendance", "capacity", "gross_sales", "staff_count"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900 sm:text-4xl">Venue Data</h1>
            <p className="mt-1 text-gray-600">
              Record what each venue reports for an event. Saved entries feed the Venue Dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/venue-dashboard"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              View dashboard
            </Link>
            <Link
              href="/venue-management"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
            >
              Venues
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {/* Entry form */}
          <div ref={formRef} className="scroll-mt-6 lg:sticky lg:top-6 lg:self-start">
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
              noValidate
            >
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? "Edit entry" : "New entry"}
              </h2>
              <p className="mt-0.5 text-sm text-gray-600">
                Only the venue and date are required, plus at least one number.
              </p>

              {formError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
                  {formSuccess}
                </div>
              )}

              <div className="mt-4 space-y-4">
                <label className={labelClass}>
                  Venue
                  <select
                    value={form.venue_id}
                    onChange={(e) => setField("venue_id", e.target.value)}
                    className={inputClass}
                    required
                  >
                    <option value="">Select a venue</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {venueLabel(v)}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Event date
                    <input
                      type="date"
                      value={form.event_date}
                      max={tomorrow}
                      onChange={(e) => setField("event_date", e.target.value)}
                      className={inputClass}
                      required
                    />
                  </label>
                  <label className={labelClass}>
                    Event name
                    <input
                      type="text"
                      value={form.event_name}
                      maxLength={200}
                      placeholder="Optional"
                      onChange={(e) => setField("event_name", e.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    Attendance
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={form.attendance}
                      onChange={(e) => setField("attendance", e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    Capacity
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={form.capacity}
                      onChange={(e) => setField("capacity", e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    Gross sales ($)
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={form.gross_sales}
                      onChange={(e) => setField("gross_sales", e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    Staff count
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={form.staff_count}
                      onChange={(e) => setField("staff_count", e.target.value)}
                      className={inputClass}
                    />
                  </label>
                </div>

                <label className={labelClass}>
                  Notes
                  <textarea
                    value={form.notes}
                    maxLength={2000}
                    rows={3}
                    placeholder="Optional"
                    onChange={(e) => setField("notes", e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : editingId ? "Update entry" : "Save entry"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      resetForm(false);
                      setFormError("");
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="min-w-0 space-y-6">
            {/* CSV import */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <button
                type="button"
                onClick={() => setImportOpen((open) => !open)}
                aria-expanded={importOpen}
                className="flex w-full items-center justify-between text-left"
              >
                <span>
                  <span className="block text-lg font-semibold text-gray-900">Import from CSV</span>
                  <span className="block text-sm text-gray-600">
                    Add many events at once from a spreadsheet export.
                  </span>
                </span>
                <span aria-hidden="true" className="text-gray-500">
                  {importOpen ? "▲" : "▼"}
                </span>
              </button>

              {importOpen && (
                <div className="mt-4 space-y-4">
                  <p className="text-sm text-gray-600">
                    Columns: <code className="text-xs">venue_name</code>, <code className="text-xs">event_date</code>{" "}
                    (required), then <code className="text-xs">event_name</code>, <code className="text-xs">attendance</code>,{" "}
                    <code className="text-xs">capacity</code>, <code className="text-xs">gross_sales</code>,{" "}
                    <code className="text-xs">staff_count</code>, <code className="text-xs">notes</code>. Venue names must match a
                    venue in Venue Management. Rows already saved for the same venue, date and event name are skipped.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={downloadTemplate}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                    >
                      Download template
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                      className="text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 hover:file:bg-gray-200"
                      aria-label="Choose a CSV file"
                    />
                  </div>

                  {importParseError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                      {importParseError}
                    </div>
                  )}

                  {importRows.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{importFileName}</span>: {fmtInt(importRows.length)} row
                        {importRows.length === 1 ? "" : "s"} ready. Preview of the first {Math.min(5, importRows.length)}:
                      </p>
                      <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 text-gray-600">
                            <tr>
                              {previewColumns.map((c) => (
                                <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.slice(0, 5).map((row, i) => (
                              <tr key={i} className="border-t border-gray-100">
                                {previewColumns.map((c) => (
                                  <td key={c} className="whitespace-nowrap px-3 py-1.5 text-gray-800">
                                    {row[c] || dash}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button
                        type="button"
                        onClick={runImport}
                        disabled={importing}
                        className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {importing ? "Importing..." : `Import ${fmtInt(importRows.length)} row${importRows.length === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  )}

                  {importResult && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm" role="status">
                      <p className="font-medium text-gray-900">
                        {fmtInt(importResult.inserted)} imported
                        {importResult.skipped.length > 0 && `, ${fmtInt(importResult.skipped.length)} skipped`}
                        {importResult.failed.length > 0 && `, ${fmtInt(importResult.failed.length)} not imported`}
                      </p>
                      {importResult.aborted && <p className="mt-1 text-red-700">{importResult.aborted}</p>}
                      {importResult.failed.length + importResult.skipped.length > 0 && (
                        <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs text-gray-700">
                          {[
                            ...importResult.failed.map((f) => ({ ...f, kind: "Not imported" })),
                            ...importResult.skipped.map((s) => ({ ...s, kind: "Skipped" })),
                          ]
                            .sort((a, b) => a.row - b.row)
                            .slice(0, 50)
                            .map((issue) => (
                              <li key={`${issue.kind}-${issue.row}`}>
                                Row {issue.row} ({issue.kind.toLowerCase()}): {issue.message}
                              </li>
                            ))}
                          {importResult.failed.length + importResult.skipped.length > 50 && (
                            <li>and {fmtInt(importResult.failed.length + importResult.skipped.length - 50)} more</li>
                          )}
                        </ul>
                      )}
                      {importResult.failed.length + importResult.skipped.length > 0 && (
                        <p className="mt-2 text-xs text-gray-500">Row numbers count data rows, not the header.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Saved entries */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Saved entries</h2>
                  <p className="text-sm text-gray-600">
                    {fmtInt(total)} {total === 1 ? "entry" : "entries"}
                    {filterVenueId ? " for this venue" : ""}, newest event first.
                  </p>
                </div>
                <select
                  value={filterVenueId}
                  onChange={(e) => setFilterVenueId(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  aria-label="Filter entries by venue"
                >
                  <option value="">All venues</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.venue_name}
                    </option>
                  ))}
                </select>
              </div>

              {listError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  {listError}
                </div>
              )}

              {entries.length === 0 && !listLoading ? (
                <p className="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-600">
                  No entries yet. Save the first one with the form.
                </p>
              ) : (
                <div className={`overflow-x-auto transition-opacity ${listLoading ? "opacity-60" : ""}`}>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-600">
                        <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                        <th className="whitespace-nowrap px-3 py-2 font-medium">Venue</th>
                        <th className="whitespace-nowrap px-3 py-2 font-medium">Event</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Attendance</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Capacity</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Gross sales</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Staff</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`border-b border-gray-100 ${editingId === entry.id ? "bg-blue-50" : ""}`}
                        >
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDate(entry.event_date)}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                            {entry.venue?.venue_name ?? "Unknown venue"}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {entry.event_name || dash}
                            {entry.source === "csv" && (
                              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-600">
                                CSV
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {entry.attendance === null ? dash : fmtInt(entry.attendance)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {entry.capacity === null ? dash : fmtInt(entry.capacity)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {entry.gross_sales === null ? dash : fmtMoney(entry.gross_sales, 2)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {entry.staff_count === null ? dash : fmtInt(entry.staff_count)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => startEdit(entry)}
                              className="mr-3 text-sm font-medium text-blue-600 hover:text-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(entry)}
                              className="text-sm font-medium text-red-600 hover:text-red-700"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {entries.length < total && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={listLoading}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {listLoading ? "Loading..." : `Show ${Math.min(PAGE_SIZE, total - entries.length)} more`}
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
