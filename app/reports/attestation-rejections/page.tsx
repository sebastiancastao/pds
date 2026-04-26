'use client';

import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RejectionRow {
  id: string;
  user_id: string;
  worker_name: string;
  worker_email: string;
  worker_role: string;
  worker_division: string;
  event_id: string | null;
  event_name: string;
  event_venue: string;
  event_city: string;
  event_state: string;
  event_date: string;
  time_entry_id: string;
  clock_in: string | null;
  clock_out: string | null;
  rejection_reason: string;
  rejection_notes: string;
  created_at: string;
}

interface ReportData {
  total: number;
  unique_workers: number;
  unique_events: number;
  reason_counts: Record<string, number>;
  rows: RejectionRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function exportExcel(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = headers.map((header, index) => {
    const maxCellLength = Math.max(
      header.length,
      ...rows.map((row) => String(row[index] ?? '').length)
    );
    return { wch: Math.min(Math.max(maxCellLength + 2, 12), 40) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attestation Rejections');
  XLSX.writeFile(workbook, filename);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AttestationRejectionsReportPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate)   params.set('to', toDate);

      const res = await fetch(`/api/reports/attestation-rejections?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          setError('Access denied. This page is for managers, HR, and supervisors only.');
          setLoading(false);
          return;
        }
        throw new Error(json.error || 'Failed to load report data');
      }
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredRows = (data?.rows || []).filter(r => {
    const term = search.toLowerCase();
    const matchSearch = !term ||
      r.worker_name.toLowerCase().includes(term) ||
      r.worker_email.toLowerCase().includes(term) ||
      r.event_name.toLowerCase().includes(term) ||
      r.event_venue.toLowerCase().includes(term) ||
      r.rejection_reason.toLowerCase().includes(term) ||
      r.rejection_notes.toLowerCase().includes(term);
    const matchReason = reasonFilter === 'all' || r.rejection_reason === reasonFilter;
    return matchSearch && matchReason;
  });

  const allReasons = Array.from(new Set((data?.rows || []).map(r => r.rejection_reason))).sort();

  const handleExport = () => {
    exportExcel(
      'attestation-rejections-report.xlsx',
      ['ID', 'Worker Name', 'Worker Email', 'Role', 'Division', 'Event Name', 'Venue', 'City', 'State', 'Event Date', 'Clock In', 'Clock Out', 'Rejection Reason', 'Notes', 'Submitted At'],
      filteredRows.map(r => [
        r.id,
        r.worker_name,
        r.worker_email,
        r.worker_role,
        r.worker_division,
        r.event_name,
        r.event_venue,
        r.event_city,
        r.event_state,
        r.event_date,
        r.clock_in ? fmtDateTime(r.clock_in) : '',
        r.clock_out ? fmtDateTime(r.clock_out) : '',
        r.rejection_reason,
        r.rejection_notes,
        fmtDateTime(r.created_at),
      ])
    );
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="liquid-card-compact p-8 animate-scale-in text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-transparent border-t-ios-blue mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading attestation rejection report...</p>
        </div>
      </main>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="liquid-card p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86A2 2 0 0021 16.93L14.07 5.07a2 2 0 00-3.14 0L3.07 16.93A2 2 0 005.07 19z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button onClick={() => router.back()} className="liquid-btn-glass liquid-btn-sm">Go Back</button>
        </div>
      </main>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="liquid-btn-glass liquid-btn-sm">
              ← Reports
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Attestation Rejection Report</h1>
              <p className="text-sm text-gray-500 mt-0.5">Workers who disputed their clock-out attestation</p>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={filteredRows.length === 0}
            className="liquid-btn-glass liquid-btn-sm disabled:opacity-40"
          >
            Export Excel
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-blue">{data?.total ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Total Rejections</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-indigo">{data?.unique_workers ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Unique Workers</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-teal">{data?.unique_events ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Events Affected</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-orange">{filteredRows.length}</p>
            <p className="text-sm text-gray-500 mt-1">Showing</p>
          </div>
        </div>

        {/* Rejection Reason Breakdown */}
        {Object.keys(data?.reason_counts || {}).length > 0 && (
          <div className="liquid-card p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Rejections by Reason</h2>
            <div className="flex flex-wrap gap-3">
              {Object.entries(data!.reason_counts)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <div key={reason} className="flex items-center gap-2 bg-white/60 border border-white/80 rounded-xl px-3 py-2 shadow-sm">
                    <span className="text-sm font-medium text-gray-700">{reason}</span>
                    <span className="text-xs font-bold text-white bg-ios-blue rounded-full px-2 py-0.5">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="liquid-card p-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">To</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Search</label>
              <input
                type="text"
                placeholder="Worker name, email, event, reason..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Reason</label>
              <select
                value={reasonFilter}
                onChange={e => setReasonFilter(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All Reasons</option>
                {allReasons.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {(fromDate || toDate || search || reasonFilter !== 'all') && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); setSearch(''); setReasonFilter('all'); }}
                className="liquid-btn-glass liquid-btn-sm self-end"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="liquid-card overflow-hidden">
          {filteredRows.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="font-medium">No rejections found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-white/40">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Worker</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Event</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Clock In</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Clock Out</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Reason</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Notes</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredRows.map(r => (
                    <tr key={r.id} className="hover:bg-white/60 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{r.worker_name}</p>
                        <p className="text-xs text-gray-400">{r.worker_email}</p>
                        {r.worker_role && (
                          <span className="inline-block mt-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                            {r.worker_role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.event_name ? (
                          <>
                            <p className="font-medium text-gray-800">{r.event_name}</p>
                            <p className="text-xs text-gray-400">{r.event_venue}</p>
                            <p className="text-xs text-gray-400">{[r.event_city, r.event_state].filter(Boolean).join(', ')}</p>
                            {r.event_date && (
                              <p className="text-xs text-gray-400">{fmtDate(r.event_date)}</p>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                        {fmtDateTime(r.clock_in)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                        {fmtDateTime(r.clock_out)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block bg-red-50 text-red-700 border border-red-100 rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap">
                          {r.rejection_reason}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        {r.rejection_notes ? (
                          <p className="text-gray-600 text-xs line-clamp-3">{r.rejection_notes}</p>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 text-xs">
                        {fmtDateTime(r.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 pb-4">
          {filteredRows.length} of {data?.total ?? 0} rejections shown
        </p>
      </div>
    </main>
  );
}
