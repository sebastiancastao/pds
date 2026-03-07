'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '@/app/global-calendar/dashboard-styles.css';

type CustomForm = {
  id: string;
  title: string;
  requires_signature: boolean;
  target_state: string | null;
};

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  state: string;
};

type Completion = {
  employeeId: string;
  formName: string;
  updatedAt: string;
};

type VendorStatus = {
  onboarding_completed: boolean;
  completed_date: string | null;
};

type FilterStatus = 'all' | 'completed' | 'partial' | 'none';

export default function SupplementOnboardingPage() {
  const router = useRouter();
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [vendorStatuses, setVendorStatuses] = useState<Record<string, VendorStatus>>({});
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [emailSentNow, setEmailSentNow] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const year = new Date().getFullYear();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const [formsRes, empRes] = await Promise.all([
        fetch('/api/custom-forms/list', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch('/api/employees', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);

      if (!formsRes.ok) throw new Error('Failed to load forms');
      if (!empRes.ok) throw new Error('Failed to load employees');

      const formsData = await formsRes.json();
      const empData = await empRes.json();

      const fetchedForms: CustomForm[] = formsData.forms || [];
      const fetchedEmployees: Employee[] = Array.isArray(empData) ? empData : (empData.employees || []);

      setForms(fetchedForms);
      setEmployees(fetchedEmployees);
      setLoading(false);

      // Fetch completions and vendor statuses in parallel (non-critical)
      await Promise.allSettled([
        fetch('/api/custom-forms/completions', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).then(async r => {
          if (!r.ok) return;
          const d = await r.json();
          const rows = (d.completions || []) as { userId: string; formName: string; updatedAt: string }[];
          setCompletions(rows.map(r => ({ employeeId: r.userId, formName: r.formName, updatedAt: r.updatedAt })));
        }),
        fetch('/api/supplement-onboarding/vendor-status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).then(async r => {
          if (!r.ok) return;
          const d = await r.json();
          setVendorStatuses(d.statuses || {});
        }),
      ]);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const callAction = useCallback(async (employeeId: string, action: 'mark_complete' | 'mark_incomplete' | 'send_email') => {
    const key = `${employeeId}-${action}`;
    setActionLoading(prev => new Set(prev).add(key));
    setActionError(prev => { const next = { ...prev }; delete next[employeeId]; return next; });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/supplement-onboarding/vendor-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ user_id: employeeId, action }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');

      if (action === 'mark_complete') {
        setVendorStatuses(prev => ({ ...prev, [employeeId]: { onboarding_completed: true, completed_date: new Date().toISOString() } }));
      } else if (action === 'mark_incomplete') {
        setVendorStatuses(prev => ({ ...prev, [employeeId]: { onboarding_completed: false, completed_date: null } }));
      } else if (action === 'send_email') {
        setEmailSentNow(prev => new Set(prev).add(employeeId));
      }
    } catch (err: any) {
      setActionError(prev => ({ ...prev, [employeeId]: err.message }));
    } finally {
      setActionLoading(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, []);

  const handleCompleteToggle = (employeeId: string, currentlyCompleted: boolean) => {
    callAction(employeeId, currentlyCompleted ? 'mark_incomplete' : 'mark_complete');
  };

  const handleSendEmail = (employeeId: string) => {
    if (emailSentNow.has(employeeId)) return;
    callAction(employeeId, 'send_email');
  };

  const handleExportToExcel = async () => {
    if (exporting) return;

    try {
      setExporting(true);
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/supplement-onboarding/export', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      if (!response.ok) {
        let errorMessage = 'Failed to export data';
        try {
          const data = await response.json();
          errorMessage = data.error || errorMessage;
        } catch {
          // Ignore JSON parse errors and use default error message
        }
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const contentDisposition =
        response.headers.get('Content-Disposition') ??
        response.headers.get('content-disposition');

      let filename = `supplement_onboarding_report_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filenameMatch = contentDisposition?.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i);
      if (filenameMatch?.[1]) {
        filename = decodeURIComponent(filenameMatch[1]).replace(/"/g, '').trim();
      }

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error exporting supplement onboarding data:', err);
      alert(`Failed to export data: ${err.message || 'Unknown error'}`);
    } finally {
      setExporting(false);
    }
  };

  const getApplicableForms = (emp: Employee) =>
    forms.filter(f => !f.target_state || f.target_state === emp.state);

  const getCompleted = (emp: Employee) =>
    getApplicableForms(emp).filter(f => completions.some(c => c.employeeId === emp.id && c.formName === `${f.title} ${year}`));

  const getMissing = (emp: Employee) =>
    getApplicableForms(emp).filter(f => !completions.some(c => c.employeeId === emp.id && c.formName === `${f.title} ${year}`));

  const getCompletedAt = (employeeId: string, form: CustomForm) =>
    completions.find(c => c.employeeId === employeeId && c.formName === `${form.title} ${year}`)?.updatedAt ?? null;

  const filteredEmployees = employees
    .filter(e => {
      const matchesSearch = !search ||
        `${e.first_name} ${e.last_name} ${e.email}`.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;

      if (forms.length === 0) return true;
      const applicable = getApplicableForms(e);
      const done = getCompleted(e).length;
      if (filterStatus === 'completed') return done === applicable.length;
      if (filterStatus === 'partial') return done > 0 && done < applicable.length;
      if (filterStatus === 'none') return done === 0;
      return true;
    })
    .sort((a, b) => getCompleted(b).length - getCompleted(a).length);

  const totalCompletions = employees.reduce((acc, e) => acc + getCompleted(e).length, 0);
  const totalPossible = employees.reduce((acc, e) => acc + getApplicableForms(e).length, 0);
  const completionPct = totalPossible > 0 ? Math.round((totalCompletions / totalPossible) * 100) : 0;
  const fullyDoneCount = employees.filter(e => {
    const applicable = getApplicableForms(e);
    return applicable.length > 0 && getCompleted(e).length === applicable.length;
  }).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading supplement onboarding…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Supplement Onboarding</h1>
            <p className="mt-2 text-gray-600">Track employee completion of supplemental custom forms</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleExportToExcel}
              disabled={exporting}
              className={`apple-button apple-button-primary flex items-center gap-2 ${exporting ? 'opacity-60 cursor-not-allowed' : ''}`}
              title="Export to Excel"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {exporting ? 'Exporting...' : 'Export to Excel'}
            </button>
            <Link href="/hr-dashboard">
              <button className="apple-button apple-button-secondary flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Back to Dashboard
              </button>
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Custom Forms</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{forms.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Employees</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{employees.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Fully Completed</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{fullyDoneCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Completion Rate</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">{completionPct}%</div>
          </div>
        </div>

        {forms.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-10 text-center">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 font-medium">No custom forms uploaded yet.</p>
            <p className="text-sm text-gray-400 mt-1">
              Upload forms at{' '}
              <Link href="/admin/pdf-forms" className="text-blue-600 hover:underline">/admin/pdf-forms</Link>
            </p>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div className="bg-white rounded-lg shadow mb-6 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search Employees</label>
                  <input
                    type="text"
                    placeholder="Search by name or email…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Completion Status</label>
                  <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value as FilterStatus)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Employees</option>
                    <option value="completed">All Forms Completed</option>
                    <option value="partial">In Progress</option>
                    <option value="none">Not Started</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Form Progress</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Form Requirements</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Download Forms</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Vendor Onboarding Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                          {search || filterStatus !== 'all'
                            ? 'No employees found matching your filters.'
                            : 'No employees found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredEmployees.map(emp => {
                        const applicable = getApplicableForms(emp);
                        const completed = getCompleted(emp);
                        const missing = getMissing(emp);
                        const doneCount = completed.length;
                        const progressPct = applicable.length > 0 ? Math.round((doneCount / applicable.length) * 100) : 100;
                        const isFullyDone = applicable.length > 0 && doneCount === applicable.length;
                        const notStarted = doneCount === 0;

                        const vendorStatus = vendorStatuses[emp.id];
                        const isOnboardingComplete = vendorStatus?.onboarding_completed ?? false;
                        const isCompleteLoading = actionLoading.has(`${emp.id}-mark_complete`) || actionLoading.has(`${emp.id}-mark_incomplete`);
                        const isEmailLoading = actionLoading.has(`${emp.id}-send_email`);
                        const emailAlreadySent = emailSentNow.has(emp.id);
                        const empError = actionError[emp.id];

                        return (
                          <tr key={emp.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <Link href={`/employees/${emp.id}`} className="hover:underline">
                                <div className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</div>
                                <div className="text-sm text-gray-500">{emp.email}</div>
                              </Link>
                            </td>
                            <td className="px-6 py-4">
                              <div className="min-w-[220px]">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-gray-700">{doneCount}/{applicable.length} forms</span>
                                  <span className="text-xs text-gray-500">{progressPct}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      isFullyDone ? 'bg-green-500' : notStarted ? 'bg-gray-300' : 'bg-indigo-500'
                                    }`}
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>

                                {completed.length > 0 && (
                                  <details className="mt-2">
                                    <summary className="text-xs text-indigo-600 cursor-pointer hover:text-indigo-800">
                                      View {completed.length} completed form{completed.length !== 1 ? 's' : ''}
                                    </summary>
                                    <ul className="mt-1 text-xs text-gray-500 pl-2 space-y-0.5 max-h-32 overflow-y-auto">
                                      {completed.map(f => {
                                        const doneAt = getCompletedAt(emp.id, f);
                                        return (
                                          <li key={f.id} className="truncate" title={f.title}>
                                            ✓ {f.title}{doneAt ? ` (${new Date(doneAt).toLocaleDateString()})` : ''}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </details>
                                )}

                                {missing.length > 0 && doneCount > 0 && (
                                  <details className="mt-1">
                                    <summary className="text-xs text-amber-700 cursor-pointer hover:text-amber-900">
                                      Missing {missing.length} form{missing.length !== 1 ? 's' : ''}
                                    </summary>
                                    <ul className="mt-1 text-xs text-amber-800 pl-2 space-y-0.5 max-h-32 overflow-y-auto">
                                      {missing.map(f => (
                                        <li key={f.id} className="truncate" title={f.title}>• {f.title}</li>
                                      ))}
                                    </ul>
                                  </details>
                                )}

                                {notStarted && (
                                  <div className="text-xs text-gray-400 mt-1">No forms completed</div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {isFullyDone ? (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                  Completed
                                </span>
                              ) : notStarted ? (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                                  Not Started
                                </span>
                              ) : (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-amber-100 text-amber-800">
                                  In Progress
                                </span>
                              )}
                            </td>

                            {/* Form Requirements */}
                            <td className="px-6 py-4">
                              <div className="min-w-[180px] space-y-2">
                                {(() => {
                                  const universal = applicable.filter(f => !f.target_state);
                                  const stateSpecific = applicable.filter(f => f.target_state);
                                  return (
                                    <>
                                      {universal.length > 0 && (
                                        <div>
                                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 mb-1">
                                            All States
                                          </span>
                                          <ul className="text-xs text-gray-600 pl-1 space-y-0.5">
                                            {universal.map(f => (
                                              <li key={f.id} className="truncate" title={f.title}>• {f.title}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {stateSpecific.length > 0 && (
                                        <div>
                                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 mb-1">
                                            {emp.state} Only
                                          </span>
                                          <ul className="text-xs text-gray-600 pl-1 space-y-0.5">
                                            {stateSpecific.map(f => (
                                              <li key={f.id} className="truncate" title={f.title}>• {f.title}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {applicable.length === 0 && (
                                        <span className="text-xs text-gray-400">No forms required</span>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </td>

                            {/* Download Forms */}
                            <td className="px-6 py-4 text-center">
                              <div className="flex flex-wrap gap-1 justify-center">
                                {applicable.map(f => (
                                  <a
                                    key={f.id}
                                    href={`/api/custom-forms/${f.id}/pdf`}
                                    download={`${f.title}.pdf`}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border text-green-600 hover:text-green-800 hover:bg-green-50 border-green-300 max-w-[150px] truncate"
                                    title={`Download ${f.title}`}
                                  >
                                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <polyline points="7 10 12 15 17 10" />
                                      <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    {f.title}
                                  </a>
                                ))}
                              </div>
                            </td>

                            {/* Vendor Onboarding Actions */}
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-3 min-w-[220px]">

                                {/* Checkbox 1 — Update DB status */}
                                <label className={`flex items-start gap-2 ${isCompleteLoading ? 'opacity-60' : 'cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    checked={isOnboardingComplete}
                                    disabled={isCompleteLoading}
                                    onChange={() => handleCompleteToggle(emp.id, isOnboardingComplete)}
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                  <span className="text-xs leading-tight select-none">
                                    <span className="font-semibold text-green-700 block">
                                      Mark Onboarding Complete
                                      {isCompleteLoading && <span className="ml-1 text-gray-400">(saving…)</span>}
                                    </span>
                                    <span className="text-gray-400 block">
                                      Sets <code className="text-gray-500">vendor_onboarding_status</code> in the database
                                    </span>
                                    {isOnboardingComplete && vendorStatus?.completed_date && (
                                      <span className="text-green-600 block mt-0.5">
                                        ✓ Completed {new Date(vendorStatus.completed_date).toLocaleDateString()}
                                      </span>
                                    )}
                                  </span>
                                </label>

                                {/* Divider */}
                                <div className="border-t border-gray-100" />

                                {/* Checkbox 2 — Send email */}
                                <label className={`flex items-start gap-2 ${isEmailLoading || emailAlreadySent ? 'opacity-60' : 'cursor-pointer'}`}>
                                  <input
                                    type="checkbox"
                                    checked={emailAlreadySent}
                                    disabled={isEmailLoading || emailAlreadySent}
                                    onChange={() => handleSendEmail(emp.id)}
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                  />
                                  <span className="text-xs leading-tight select-none">
                                    <span className="font-semibold text-blue-700 block">
                                      Send Confirmation Email
                                      {isEmailLoading && <span className="ml-1 text-gray-400">(sending…)</span>}
                                    </span>
                                    <span className="text-gray-400 block">
                                      Sends Phase 2 approval email to {emp.email}
                                    </span>
                                    {emailAlreadySent && (
                                      <span className="text-blue-600 block mt-0.5">✓ Email sent this session</span>
                                    )}
                                  </span>
                                </label>

                                {/* Error */}
                                {empError && (
                                  <p className="text-xs text-red-600 mt-1">{empError}</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 text-sm text-gray-500 text-center">
              Showing {filteredEmployees.length} of {employees.length} employees
            </div>
          </>
        )}
      </div>
    </div>
  );
}
