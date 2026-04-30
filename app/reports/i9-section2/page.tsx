'use client';

import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Section2Basis = 'section2_date' | 'first_day_employed' | 'document_fields' | 'none';

interface Section2Row {
  user_id: string;
  vendor_name: string;
  vendor_email: string;
  vendor_role: string;
  vendor_state: string;
  has_i9_form: boolean;
  i9_form_name: string | null;
  form_updated_at: string | null;
  has_section2: boolean;
  section2_basis: Section2Basis;
  section2_fields: Record<string, string>;
  has_list_a: boolean;
  has_list_b: boolean;
  has_list_c: boolean;
  document_mode: string;
  list_a_filename: string | null;
  list_b_filename: string | null;
  list_c_filename: string | null;
  list_a_uploaded_at: string | null;
  list_b_uploaded_at: string | null;
  list_c_uploaded_at: string | null;
}

interface ReportData {
  summary: {
    total: number;
    with_section2: number;
    without_section2: number;
    with_documents: number;
  };
  rows: Section2Row[];
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatI9Label(formName: string | null): string {
  if (!formName) return 'I-9';
  const normalized = formName.trim().toLowerCase();
  if (normalized === 'i9') return 'I-9';
  const stateCode = normalized.replace(/-i9$/, '').toUpperCase();
  return stateCode ? `${stateCode} I-9` : 'I-9';
}

function formatBasisLabel(basis: Section2Basis): string {
  switch (basis) {
    case 'section2_date':
      return 'Section 2 date';
    case 'first_day_employed':
      return 'First day employed';
    case 'document_fields':
      return 'Document fields';
    default:
      return 'Not detected';
  }
}

function buildDocumentSummary(row: Section2Row): string {
  const parts: string[] = [];
  if (row.has_list_a) parts.push('List A');
  if (row.has_list_b) parts.push('List B');
  if (row.has_list_c) parts.push('List C');
  return parts.join(' + ') || 'No documents';
}

function exportExcel(rows: Section2Row[]) {
  const headers = [
    'Employee',
    'Email',
    'Role',
    'State',
    'I-9 Form',
    'Section 2 Filled',
    'Detection Basis',
    'Support Documents',
    'Last Updated',
    'Section 2 Fields (JSON)',
    'List A File',
    'List B File',
    'List C File',
  ];

  const dataRows = rows.map((row) => [
    row.vendor_name,
    row.vendor_email,
    row.vendor_role || '',
    row.vendor_state || '',
    formatI9Label(row.i9_form_name),
    row.has_section2 ? 'Yes' : 'No',
    formatBasisLabel(row.section2_basis),
    row.document_mode,
    row.form_updated_at ? new Date(row.form_updated_at).toLocaleString('en-US') : '',
    row.has_section2 ? JSON.stringify(row.section2_fields) : '',
    row.list_a_filename || '',
    row.list_b_filename || '',
    row.list_c_filename || '',
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  sheet['!cols'] = [
    { wch: 28 },
    { wch: 32 },
    { wch: 14 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 22 },
    { wch: 80 },
    { wch: 28 },
    { wch: 28 },
    { wch: 28 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'I9 Section 2');
  XLSX.writeFile(workbook, `i9-section2-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function FieldGrid({ fields }: { fields: Record<string, string> }) {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">No Section 2-only fields were detected in the saved PDF.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {entries.map(([name, value]) => (
        <div key={name} className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-indigo-600 mb-1">
            {name}
          </span>
          <p className="text-sm font-medium text-gray-800 break-words">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function I9Section2ReportPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'filled' | 'missing'>('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/reports/i9-section2', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          setError('Access denied. This page is for managers, supervisors, HR, admin, and exec users.');
          return;
        }
        throw new Error(json.error || 'Failed to load report');
      }

      setData(json);
    } catch (fetchError: any) {
      setError(fetchError.message || 'Unexpected error');
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
      const fieldText = Object.entries(row.section2_fields)
        .map(([name, value]) => `${name} ${value}`)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !term || [
        row.vendor_name,
        row.vendor_email,
        row.vendor_role,
        row.vendor_state,
        row.document_mode,
        formatBasisLabel(row.section2_basis),
        fieldText,
      ].join(' ').toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'filled' && row.has_section2) ||
        (statusFilter === 'missing' && !row.has_section2);

      const matchesState = stateFilter === 'all' || row.vendor_state === stateFilter;

      return matchesSearch && matchesStatus && matchesState;
    });
  }, [data, search, statusFilter, stateFilter]);

  const filledCount = filteredRows.filter((row) => row.has_section2).length;
  const missingCount = filteredRows.filter((row) => !row.has_section2).length;

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="liquid-card-compact p-8 animate-scale-in text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-transparent border-t-ios-blue mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Analyzing I-9 Section 2 data...</p>
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
            <Link href="/reports" className="liquid-btn-glass liquid-btn-sm">Back to Reports</Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">I-9 Section 2 Status</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Detects saved I-9 PDFs that contain Section 2-only fields, including the Section 2 date.
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
            <button onClick={fetchData} className="liquid-btn-glass liquid-btn-sm">Refresh</button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-blue">{data?.summary.total ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Total I-9s</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-green-600">{data?.summary.with_section2 ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Section 2 Filled</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-amber-500">{data?.summary.without_section2 ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">Section 2 Missing</p>
          </div>
          <div className="liquid-card p-5 text-center">
            <p className="text-3xl font-bold text-ios-purple">{data?.summary.with_documents ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">With Support Docs</p>
          </div>
        </div>

        <div className="liquid-card p-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Search</label>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email, basis, field, document mode..."
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Section 2</label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'filled' | 'missing')}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All</option>
                <option value="filled">Filled</option>
                <option value="missing">Missing</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">State</label>
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white/80 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All States</option>
                {uniqueStates.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>

            {(search || statusFilter !== 'all' || stateFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setStateFilter('all');
                }}
                className="liquid-btn-glass liquid-btn-sm"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-500 px-1">
          <span>{filteredRows.length} records shown</span>
          {statusFilter === 'all' && (
            <>
              <span className="text-green-600 font-medium">{filledCount} filled</span>
              <span className="text-amber-600 font-medium">{missingCount} missing</span>
            </>
          )}
        </div>

        <div className="liquid-card overflow-hidden">
          {filteredRows.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="font-medium">No records found</p>
              <p className="text-sm mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-white/40">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Employee</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">I-9 Form</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Section 2</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Support Docs</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Last Updated</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredRows.map((row) => {
                    const isExpanded = expandedRow === row.user_id;
                    const fieldCount = Object.keys(row.section2_fields).length;

                    return (
                      <>
                        <tr
                          key={row.user_id}
                          className="hover:bg-white/60 transition-colors align-top cursor-pointer"
                          onClick={() => setExpandedRow(isExpanded ? null : row.user_id)}
                        >
                          <td className="px-4 py-4">
                            <p className="font-medium text-gray-900">{row.vendor_name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{row.vendor_email}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
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
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                              {formatI9Label(row.i9_form_name)}
                            </span>
                          </td>

                          <td className="px-4 py-4">
                            {row.has_section2 ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                  Filled
                                </span>
                                <p className="text-xs text-gray-500 mt-1.5">{formatBasisLabel(row.section2_basis)}</p>
                                <p className="text-xs text-gray-400">{fieldCount} field{fieldCount === 1 ? '' : 's'} found</p>
                              </>
                            ) : (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                  Missing
                                </span>
                                <p className="text-xs text-gray-400 mt-1.5">No Section 2-only fields detected</p>
                              </>
                            )}
                          </td>

                          <td className="px-4 py-4">
                            <p className="text-xs font-medium text-gray-700">{buildDocumentSummary(row)}</p>
                            <p className="text-xs text-gray-400 mt-1">{row.document_mode}</p>
                          </td>

                          <td className="px-4 py-4">
                            <p className="text-xs text-gray-600">{fmtDateTime(row.form_updated_at)}</p>
                          </td>

                          <td className="px-4 py-4 text-gray-400">
                            <svg
                              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr key={`${row.user_id}-expanded`} className="bg-gray-50/60">
                            <td colSpan={6} className="px-6 py-5">
                              <div className="space-y-5">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                  <div>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Section 2 Status</span>
                                    <p className="text-sm font-medium text-gray-800">{row.has_section2 ? 'Filled' : 'Missing'}</p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Detection Basis</span>
                                    <p className="text-sm font-medium text-gray-800">{formatBasisLabel(row.section2_basis)}</p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Support Docs</span>
                                    <p className="text-sm font-medium text-gray-800">{row.document_mode}</p>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Form Last Updated</span>
                                    <p className="text-sm font-medium text-gray-800">{fmtDateTime(row.form_updated_at)}</p>
                                  </div>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                                    Uploaded I-9 Documents
                                  </p>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className={`rounded-xl border p-3 ${row.has_list_a ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                      <p className="text-xs font-semibold text-gray-700 mb-1">List A</p>
                                      <p className="text-sm text-gray-800">{row.list_a_filename || 'Not uploaded'}</p>
                                      {row.list_a_uploaded_at && <p className="text-xs text-gray-500 mt-1">{fmtDate(row.list_a_uploaded_at)}</p>}
                                    </div>
                                    <div className={`rounded-xl border p-3 ${row.has_list_b ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                      <p className="text-xs font-semibold text-gray-700 mb-1">List B</p>
                                      <p className="text-sm text-gray-800">{row.list_b_filename || 'Not uploaded'}</p>
                                      {row.list_b_uploaded_at && <p className="text-xs text-gray-500 mt-1">{fmtDate(row.list_b_uploaded_at)}</p>}
                                    </div>
                                    <div className={`rounded-xl border p-3 ${row.has_list_c ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                      <p className="text-xs font-semibold text-gray-700 mb-1">List C</p>
                                      <p className="text-sm text-gray-800">{row.list_c_filename || 'Not uploaded'}</p>
                                      {row.list_c_uploaded_at && <p className="text-xs text-gray-500 mt-1">{fmtDate(row.list_c_uploaded_at)}</p>}
                                    </div>
                                  </div>
                                </div>

                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                                    Section 2 Fields Found In Saved PDF
                                  </p>
                                  <FieldGrid fields={row.section2_fields} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          {filteredRows.length} of {data?.summary.total ?? 0} I-9 records shown. Section 2 is detected from saved PDF fields, not from uploaded document presence alone.
        </p>
      </div>
    </main>
  );
}
