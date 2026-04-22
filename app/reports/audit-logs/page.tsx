'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type AuditTab = 'general' | 'forms';

type GeneralAuditEntry = {
  id: string;
  user_id: string | null;
  actor_name: string;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip_address: string;
  user_agent: string;
  metadata: Record<string, unknown>;
  success: boolean | null;
  error_message: string | null;
  created_at: string;
};

type FormAuditEntry = {
  id: string;
  user_id: string | null;
  actor_name: string;
  actor_email: string;
  form_id: string;
  form_type: string;
  action: string;
  action_details: Record<string, unknown>;
  field_changed: string;
  old_value: string;
  new_value: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
};

type GeneralAuditResponse = {
  kind: 'general';
  page: number;
  pageSize: number;
  total: number;
  supportsOutcome: boolean;
  entries: GeneralAuditEntry[];
};

type FormAuditResponse = {
  kind: 'forms';
  page: number;
  pageSize: number;
  total: number;
  timeColumn: 'created_at' | 'timestamp';
  entries: FormAuditEntry[];
};

const DAY_OPTIONS = [
  { label: '24h', value: '1' },
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: 'All', value: 'all' },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function truncate(value: string | null | undefined, max = 80) {
  if (!value) return '-';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function jsonPreview(value: unknown) {
  if (value == null) return '-';
  try {
    const raw = JSON.stringify(value);
    return truncate(raw, 120);
  } catch {
    return '-';
  }
}

function toCsvCell(value: string | number | boolean | null | undefined) {
  const text = value == null ? '' : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  const csv = [headers, ...rows].map((row) => row.map(toCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="liquid-card p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 text-sm text-gray-500">{detail}</div>
    </div>
  );
}

export default function AuditLogsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AuditTab>('general');
  const [days, setDays] = useState('30');
  const [actionFilter, setActionFilter] = useState('');
  const [formTypeFilter, setFormTypeFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [generalData, setGeneralData] = useState<GeneralAuditResponse | null>(null);
  const [formData, setFormData] = useState<FormAuditResponse | null>(null);

  useEffect(() => {
    setPage(1);
  }, [activeTab, days, actionFilter, formTypeFilter, outcomeFilter]);

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const params = new URLSearchParams({
        kind: activeTab,
        days,
        page: String(page),
        pageSize: '50',
      });

      if (actionFilter.trim()) params.set('action', actionFilter.trim());
      if (activeTab === 'general' && outcomeFilter !== 'all') params.set('outcome', outcomeFilter);
      if (activeTab === 'forms' && formTypeFilter.trim()) params.set('formType', formTypeFilter.trim());

      const response = await fetch(`/api/reports/audit-logs?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          setError('Access denied. Audit logs follow the same report permissions as the reports area.');
          return;
        }
        throw new Error(payload.error || 'Failed to load audit logs');
      }

      if (activeTab === 'general') {
        const generalPayload = payload as GeneralAuditResponse;
        if (!generalPayload.supportsOutcome && outcomeFilter !== 'all') {
          setOutcomeFilter('all');
        }
        setGeneralData(generalPayload);
      } else {
        setFormData(payload as FormAuditResponse);
      }
    } catch (err: any) {
      setError(err?.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, actionFilter, days, formTypeFilter, outcomeFilter, page, router]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const generalEntries = generalData?.entries || [];
  const formEntries = formData?.entries || [];

  const filteredGeneralEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return generalEntries;
    return generalEntries.filter((entry) =>
      [
        entry.actor_name,
        entry.actor_email,
        entry.action,
        entry.resource_type,
        entry.resource_id,
        entry.ip_address,
        jsonPreview(entry.metadata),
        entry.error_message || '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [generalEntries, search]);

  const filteredFormEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return formEntries;
    return formEntries.filter((entry) =>
      [
        entry.actor_name,
        entry.actor_email,
        entry.action,
        entry.form_id,
        entry.form_type,
        entry.field_changed,
        entry.ip_address,
        jsonPreview(entry.action_details),
        entry.old_value,
        entry.new_value,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [formEntries, search]);

  const visibleGeneralActions = useMemo(
    () => [...new Set(generalEntries.map((entry) => entry.action).filter(Boolean))].sort(),
    [generalEntries]
  );

  const visibleFormActions = useMemo(
    () => [...new Set(formEntries.map((entry) => entry.action).filter(Boolean))].sort(),
    [formEntries]
  );

  const successCount = filteredGeneralEntries.filter((entry) => entry.success === true).length;
  const failureCount = filteredGeneralEntries.filter((entry) => entry.success === false).length;
  const pageCount = Math.max(
    1,
    Math.ceil(((activeTab === 'general' ? generalData?.total : formData?.total) || 0) / 50)
  );

  const exportCurrentView = () => {
    if (activeTab === 'general') {
      downloadCsv(
        `audit-logs-general-page-${page}.csv`,
        ['Timestamp', 'Actor', 'Actor Email', 'Action', 'Resource Type', 'Resource ID', 'Success', 'IP Address', 'Error', 'Metadata'],
        filteredGeneralEntries.map((entry) => [
          formatDateTime(entry.created_at),
          entry.actor_name,
          entry.actor_email,
          entry.action,
          entry.resource_type,
          entry.resource_id,
          entry.success == null ? 'Unknown' : entry.success ? 'Yes' : 'No',
          entry.ip_address,
          entry.error_message || '',
          JSON.stringify(entry.metadata || {}),
        ])
      );
      return;
    }

    downloadCsv(
      `audit-logs-forms-page-${page}.csv`,
      ['Timestamp', 'Actor', 'Actor Email', 'Action', 'Form Type', 'Form ID', 'Field Changed', 'Old Value', 'New Value', 'IP Address', 'Action Details'],
      filteredFormEntries.map((entry) => [
        formatDateTime(entry.created_at),
        entry.actor_name,
        entry.actor_email,
        entry.action,
        entry.form_type,
        entry.form_id,
        entry.field_changed,
        entry.old_value,
        entry.new_value,
        entry.ip_address,
        JSON.stringify(entry.action_details || {}),
      ])
    );
  };

  if (loading && ((activeTab === 'general' && !generalData) || (activeTab === 'forms' && !formData))) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="liquid-card-compact p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-transparent border-t-ios-blue mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading audit logs...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="liquid-card p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86A2 2 0 0021 16.93L14.07 5.07a2 2 0 00-3.14 0L3.07 16.93A2 2 0 005.07 19z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Audit Logs Unavailable</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="flex justify-center gap-3">
            <Link href="/reports" className="liquid-btn-glass liquid-btn-sm">
              Back to Reports
            </Link>
            <button onClick={() => fetchAuditLogs()} className="liquid-btn-primary liquid-btn-sm">
              Retry
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="liquid-badge-blue text-xs px-3 py-1 mb-3 inline-block">Reports</div>
            <h1 className="text-4xl font-bold text-gray-900 keeping-apple-tight">Audit Logs</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Live view over general `audit_logs` and form-level `form_audit_trail`.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/reports" className="liquid-btn-glass liquid-btn-sm">
              Back to Reports
            </Link>
            <button onClick={exportCurrentView} className="liquid-btn-primary liquid-btn-sm">
              Export Current View
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Matching Rows"
            value={String(activeTab === 'general' ? generalData?.total || 0 : formData?.total || 0)}
            detail={`Server-side matches in the selected ${days === 'all' ? 'time range' : `${days}-day window`}.`}
          />
          <StatCard
            label="Visible Rows"
            value={String(activeTab === 'general' ? filteredGeneralEntries.length : filteredFormEntries.length)}
            detail="Rows visible after the page-level search filter."
          />
          <StatCard
            label={activeTab === 'general' ? 'Actions On Page' : 'Form Actions On Page'}
            value={String(activeTab === 'general' ? visibleGeneralActions.length : visibleFormActions.length)}
            detail={activeTab === 'general' ? 'Unique general audit actions in this page.' : 'Unique form audit actions in this page.'}
          />
        </div>

        {activeTab === 'general' && generalData && !generalData.supportsOutcome && (
          <div className="liquid-card p-4 text-sm text-amber-800 bg-amber-50/90 border-amber-200">
            This environment is missing `audit_logs.success` and `audit_logs.error_message`.
            Apply `database/migrations/060_add_audit_logs_outcome_columns.sql` in Supabase to enable outcome filtering.
          </div>
        )}

        <div className="liquid-card p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTab('general')}
                className={activeTab === 'general' ? 'liquid-btn-primary liquid-btn-sm' : 'liquid-btn-glass liquid-btn-sm'}
              >
                General Logs
              </button>
              <button
                onClick={() => setActiveTab('forms')}
                className={activeTab === 'forms' ? 'liquid-btn-primary liquid-btn-sm' : 'liquid-btn-glass liquid-btn-sm'}
              >
                Form Audit Trail
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 mb-2">Window</label>
                <select value={days} onChange={(e) => setDays(e.target.value)} className="liquid-input">
                  {DAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 mb-2">Action Filter</label>
                <input
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  placeholder={activeTab === 'general' ? 'login, password, uninvite...' : 'signed, edited, verified...'}
                  className="liquid-input"
                />
              </div>

              {activeTab === 'forms' ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 mb-2">Form Type</label>
                  <input
                    value={formTypeFilter}
                    onChange={(e) => setFormTypeFilter(e.target.value)}
                    placeholder="i9, w4, de4..."
                    className="liquid-input"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 mb-2">Outcome</label>
                  <select
                    value={outcomeFilter}
                    onChange={(e) => setOutcomeFilter(e.target.value as 'all' | 'success' | 'failure')}
                    className="liquid-input"
                    disabled={generalData ? !generalData.supportsOutcome : false}
                  >
                    <option value="all">All</option>
                    <option value="success">Success</option>
                    <option value="failure">Failure</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 mb-2">Search This Page</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Actor, resource, form, metadata..."
                  className="liquid-input"
                />
              </div>

              <div className="flex items-end gap-2">
                <button onClick={() => fetchAuditLogs()} className="liquid-btn-primary liquid-btn-sm w-full">
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'general' ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <StatCard label="Success On Page" value={String(successCount)} detail="Visible rows with `success = true`." />
              <StatCard label="Failure On Page" value={String(failureCount)} detail="Visible rows with `success = false`." />
            </div>

            <div className="liquid-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/70 text-left">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700">Timestamp</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Actor</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Action</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Resource</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Outcome</th>
                      <th className="px-4 py-3 font-semibold text-gray-700">Context</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGeneralEntries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                          No general audit rows matched the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredGeneralEntries.map((entry) => (
                        <tr key={entry.id} className="border-t border-white/60 align-top">
                          <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-gray-900">{entry.actor_name}</div>
                            <div className="text-xs text-gray-500">{entry.actor_email || entry.user_id || 'System'}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                              {entry.action}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-gray-900">{entry.resource_type || '-'}</div>
                            <div className="text-xs text-gray-500 break-all">{truncate(entry.resource_id, 42)}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div
                              className={
                                entry.success === true
                                  ? 'inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700'
                                  : entry.success === false
                                    ? 'inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700'
                                    : 'inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600'
                              }
                            >
                              {entry.success == null ? 'Unknown' : entry.success ? 'Success' : 'Failure'}
                            </div>
                            <div className="mt-2 text-xs text-gray-500">{entry.ip_address || 'No IP recorded'}</div>
                          </td>
                          <td className="px-4 py-4 max-w-md">
                            <div className="text-xs text-gray-600">{jsonPreview(entry.metadata)}</div>
                            {entry.error_message && (
                              <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                {entry.error_message}
                              </div>
                            )}
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-semibold text-sky-700">Inspect metadata</summary>
                              <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                                {JSON.stringify(entry.metadata || {}, null, 2)}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="liquid-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/70 text-left">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-gray-700">Timestamp</th>
                    <th className="px-4 py-3 font-semibold text-gray-700">Actor</th>
                    <th className="px-4 py-3 font-semibold text-gray-700">Action</th>
                    <th className="px-4 py-3 font-semibold text-gray-700">Form</th>
                    <th className="px-4 py-3 font-semibold text-gray-700">Field Change</th>
                    <th className="px-4 py-3 font-semibold text-gray-700">Context</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFormEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                        No form audit rows matched the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredFormEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-white/60 align-top">
                        <td className="px-4 py-4 text-gray-600 whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900">{entry.actor_name}</div>
                          <div className="text-xs text-gray-500">{entry.actor_email || entry.user_id || 'System'}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">
                            {entry.action}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900">{entry.form_type || '-'}</div>
                          <div className="text-xs text-gray-500 break-all">{truncate(entry.form_id, 42)}</div>
                        </td>
                        <td className="px-4 py-4 max-w-sm">
                          <div className="font-medium text-gray-900">{entry.field_changed || '-'}</div>
                          <div className="mt-2 text-xs text-gray-500">Old: {truncate(entry.old_value, 50)}</div>
                          <div className="text-xs text-gray-500">New: {truncate(entry.new_value, 50)}</div>
                        </td>
                        <td className="px-4 py-4 max-w-md">
                          <div className="text-xs text-gray-500">{entry.ip_address || 'No IP recorded'}</div>
                          <div className="mt-2 text-xs text-gray-600">{jsonPreview(entry.action_details)}</div>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-sky-700">Inspect details</summary>
                            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                              {JSON.stringify(entry.action_details || {}, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="liquid-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-600">
              Page {page} of {pageCount}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="liquid-btn-glass liquid-btn-sm"
                disabled={page === 1}
              >
                Previous
              </button>
              <button
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                className="liquid-btn-glass liquid-btn-sm"
                disabled={page >= pageCount}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
