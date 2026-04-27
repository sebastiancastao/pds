'use client';

import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface I9ReportSummary {
  total_records: number;
  with_form: number;
  with_documents: number;
  without_documents: number;
  proxy_edits: number;
  form_only: number;
  documents_only: number;
}

interface I9ReportRow {
  user_id: string;
  vendor_name: string;
  vendor_email: string;
  vendor_role: string;
  vendor_state: string;
  has_i9_form: boolean;
  i9_form_name: string | null;
  i9_form_label: string;
  form_saved_at: string | null;
  form_date: string | null;
  documents_added: boolean;
  document_mode: string;
  document_count: number;
  document_summary: string;
  has_list_a: boolean;
  has_list_b: boolean;
  has_list_c: boolean;
  list_a_filename: string | null;
  list_b_filename: string | null;
  list_c_filename: string | null;
  list_a_uploaded_at: string | null;
  list_b_uploaded_at: string | null;
  list_c_uploaded_at: string | null;
  last_editor_user_id: string;
  last_editor_name: string;
  last_editor_email: string;
  last_editor_role: string;
  last_change_at: string | null;
  last_change_source: string;
  edited_by_non_owner: boolean;
  proxy_change_count: number;
  latest_proxy_editor_name: string | null;
  latest_proxy_editor_email: string | null;
  latest_proxy_editor_role: string | null;
  latest_proxy_at: string | null;
  latest_proxy_source: string | null;
}

interface ReportData {
  summary: I9ReportSummary;
  rows: I9ReportRow[];
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function fmtExportDate(iso: string | null | undefined): string {
  if (!iso) return '—';

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return `${year}-${month}-${day}`;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function fmtExportDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const hours24 = date.getHours();
  const minutes = pad2(date.getMinutes());
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${hours12}:${minutes} ${ampm}`;
}

function exportExcel(rows: I9ReportRow[]) {
  const headers = [
    'Vendor Name',
    'Vendor Email',
    'Vendor Role',
    'Vendor State',
    'I-9 Form',
    'Has I-9 Form',
    'Form Saved At',
    'Form Date',
    'Documents Added',
    'Document Mode',
    'Document Count',
    'Document Summary',
    'List A Filename',
    'List B Filename',
    'List C Filename',
    'List A Uploaded At',
    'List B Uploaded At',
    'List C Uploaded At',
    'Last Editor Name',
    'Last Editor Email',
    'Last Editor Role',
    'Last Change At',
    'Last Change Source',
    'Edited By Non-Owner',
    'Proxy Change Count',
    'Latest Proxy Editor',
    'Latest Proxy Editor Email',
    'Latest Proxy Editor Role',
    'Latest Proxy At',
    'Latest Proxy Source',
  ];

  const dataRows = rows.map((row) => ([
    row.vendor_name,
    row.vendor_email,
    row.vendor_role || '—',
    row.vendor_state || '—',
    row.i9_form_label,
    row.has_i9_form ? 'Yes' : 'No',
    fmtExportDateTime(row.form_saved_at),
    fmtExportDate(row.form_date),
    row.documents_added ? 'Yes' : 'No',
    row.document_mode,
    String(row.document_count),
    row.document_summary,
    row.list_a_filename || '',
    row.list_b_filename || '',
    row.list_c_filename || '',
    fmtExportDateTime(row.list_a_uploaded_at),
    fmtExportDateTime(row.list_b_uploaded_at),
    fmtExportDateTime(row.list_c_uploaded_at),
    row.last_editor_name,
    row.last_editor_email || '',
    row.last_editor_role || '',
    fmtExportDateTime(row.last_change_at),
    row.last_change_source,
    row.edited_by_non_owner ? 'Yes' : 'No',
    String(row.proxy_change_count),
    row.latest_proxy_editor_name || '',
    row.latest_proxy_editor_email || '',
    row.latest_proxy_editor_role || '',
    fmtExportDateTime(row.latest_proxy_at),
    row.latest_proxy_source || '',
  ]));

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  worksheet['!cols'] = [
    { wch: 28 },
    { wch: 34 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 12 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 18 },
    { wch: 12 },
    { wch: 60 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 28 },
    { wch: 34 },
    { wch: 18 },
    { wch: 24 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
    { wch: 34 },
    { wch: 18 },
    { wch: 24 },
    { wch: 18 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'I9 Audit');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `i9-audit-report-${today}.xlsx`);
}

export default function I9AuditReportPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [documentsFilter, setDocumentsFilter] = useState<'all' | 'with' | 'without'>('all');
  const [proxyFilter, setProxyFilter] = useState<'all' | 'proxy' | 'owner'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/reports/i9-audit', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const json = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          setError('Access denied. This page is for managers, supervisors, HR, admin, and exec users.');
          setLoading(false);
          return;
        }
        throw new Error(json.error || 'Failed to load I-9 audit report');
      }

      setData(json);
    } catch (err: any) {
      setError(err.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const uniqueStates = useMemo(
    () => Array.from(new Set((data?.rows || []).map((row) => row.vendor_state).filter(Boolean))).sort(),
    [data]
  );

  const filteredRows = useMemo(() => {
    return (data?.rows || []).filter((row) => {
      const term = search.trim().toLowerCase();
      const matchesSearch = !term || [
        row.vendor_name,
        row.vendor_email,
        row.vendor_role,
        row.vendor_state,
        row.i9_form_label,
        row.document_summary,
        row.last_editor_name,
        row.last_editor_email,
        row.latest_proxy_editor_name || '',
        row.latest_proxy_editor_email || '',
      ].join(' ').toLowerCase().includes(term);

      const matchesState = stateFilter === 'all' || row.vendor_state === stateFilter;
      const matchesDocuments =
        documentsFilter === 'all' ||
        (documentsFilter === 'with' && row.documents_added) ||
        (documentsFilter === 'without' && !row.documents_added);
      const matchesProxy =
        proxyFilter === 'all' ||
        (proxyFilter === 'proxy' && row.edited_by_non_owner) ||
        (proxyFilter === 'owner' && !row.edited_by_non_owner);

      return matchesSearch && matchesState && matchesDocuments && matchesProxy;
    });
  }, [data, documentsFilter, proxyFilter, search, stateFilter]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="liquid-card-compact p-8 animate-scale-in text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-transparent border-t-ios-blue mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading I-9 audit report...</p>
        </div>
      </main>
    );
  }

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

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="liquid-btn-glass liquid-btn-sm">
              ← Reports
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">I-9 Audit Report</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Vendor I-9 ownership, document status, and non-owner change detection.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => exportExcel(filteredRows)}
              disabled={filteredRows.length === 0}
              className="liquid-btn-glass liquid-btn-sm disabled:opacity-40"
            >
              Export Excel
            </button>
            <button onClick={fetchData} className="liquid-btn-glass liquid-btn-sm">
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-blue">{data?.summary.total_records ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Total Users</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-teal">{data?.summary.with_documents ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">With Documents</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-orange">{data?.summary.without_documents ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Missing Documents</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-indigo">{data?.summary.proxy_edits ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Proxy Edits</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-purple">{filteredRows.length}</p>
            <p className="text-sm text-gray-500 mt-1">Showing</p>
          </div>
        </div>

        <div className="liquid-card p-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Search</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Vendor, email, editor, form..."
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">State</label>
              <select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All States</option>
                {uniqueStates.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Documents</label>
              <select
                value={documentsFilter}
                onChange={(e) => setDocumentsFilter(e.target.value as 'all' | 'with' | 'without')}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All</option>
                <option value="with">With Documents</option>
                <option value="without">Without Documents</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Change Type</label>
              <select
                value={proxyFilter}
                onChange={(e) => setProxyFilter(e.target.value as 'all' | 'proxy' | 'owner')}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All</option>
                <option value="proxy">Non-Owner Changes</option>
                <option value="owner">Owner Only</option>
              </select>
            </div>

            {(search || stateFilter !== 'all' || documentsFilter !== 'all' || proxyFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearch('');
                  setStateFilter('all');
                  setDocumentsFilter('all');
                  setProxyFilter('all');
                }}
                className="liquid-btn-glass liquid-btn-sm"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="liquid-card p-4 text-sm text-gray-600">
          Proxy edits are flagged when the authenticated actor was different from the I-9 owner. Existing historical rows without actor audit data fall back to the owner.
        </div>

        <div className="liquid-card overflow-hidden">
          {filteredRows.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="font-medium">No I-9 records found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-white/40">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Vendor</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">I-9</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Documents</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Last Change</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Last Editor</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Proxy Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredRows.map((row) => (
                    <tr key={row.user_id} className="hover:bg-white/60 transition-colors align-top">
                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">{row.vendor_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{row.vendor_email}</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {row.vendor_role && (
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 capitalize">
                              {row.vendor_role}
                            </span>
                          )}
                          {row.vendor_state && (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                              {row.vendor_state}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">{row.i9_form_label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {row.has_i9_form ? 'Form saved' : 'Documents only'}
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                          Saved: {fmtDateTime(row.form_saved_at)}
                        </p>
                        {row.form_date && (
                          <p className="text-xs text-gray-400">Form date: {fmtDate(row.form_date)}</p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            row.documents_added ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {row.documents_added ? 'Added' : 'Missing'}
                          </span>
                          <span className="text-xs text-gray-500">{row.document_mode}</span>
                        </div>
                        <p className="text-xs text-gray-600 max-w-sm">{row.document_summary}</p>
                        <p className="text-xs text-gray-400 mt-2">
                          Count: {row.document_count}
                        </p>
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">{fmtDateTime(row.last_change_at)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{row.last_change_source}</p>
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">{row.last_editor_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{row.last_editor_email || '—'}</p>
                        {row.last_editor_role && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 capitalize mt-2">
                            {row.last_editor_role}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        {row.edited_by_non_owner ? (
                          <>
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              Yes
                            </span>
                            <p className="text-xs text-gray-600 mt-2">
                              {row.latest_proxy_editor_name || 'Unknown editor'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {row.latest_proxy_at ? fmtDateTime(row.latest_proxy_at) : '—'}
                            </p>
                            {row.latest_proxy_source && (
                              <p className="text-xs text-gray-400">{row.latest_proxy_source}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">
                              {row.proxy_change_count} proxy change{row.proxy_change_count === 1 ? '' : 's'}
                            </p>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                              No
                            </span>
                            <p className="text-xs text-gray-400 mt-2">No non-owner change detected</p>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          {filteredRows.length} of {data?.summary.total_records ?? 0} I-9 records shown
        </p>
      </div>
    </main>
  );
}
