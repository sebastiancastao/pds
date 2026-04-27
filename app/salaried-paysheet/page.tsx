'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '@/app/global-calendar/dashboard-styles.css';
import '@/app/dashboard/dashboard-styles.css';

type PayRecord = {
  id: string;
  user_id: string;
  employee_name: string;
  employee_email: string | null;
  pay_period_start: string;
  pay_period_end: string;
  annual_salary: number;
  gross_pay: number;
  federal_tax: number;
  state_tax: number;
  social_security: number;
  medicare: number;
  other_deductions: number;
  deduction_notes: string | null;
  net_pay: number;
  status: 'draft' | 'approved' | 'paid';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type EmployeeOption = {
  id: string;
  name: string;
  email: string | null;
};

type FormState = {
  user_id: string;
  pay_period_start: string;
  pay_period_end: string;
  annual_salary: string;
  gross_pay: string;
  federal_tax: string;
  state_tax: string;
  social_security: string;
  medicare: string;
  other_deductions: string;
  deduction_notes: string;
  notes: string;
  status: 'draft' | 'approved' | 'paid';
};

const EMPTY_FORM: FormState = {
  user_id: '',
  pay_period_start: '',
  pay_period_end: '',
  annual_salary: '',
  gross_pay: '',
  federal_tax: '',
  state_tax: '',
  social_security: '',
  medicare: '',
  other_deductions: '',
  deduction_notes: '',
  notes: '',
  status: 'draft',
};

const STATUS_STYLES: Record<PayRecord['status'], string> = {
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  approved: 'bg-blue-100 text-blue-700 border-blue-200',
  paid: 'bg-green-100 text-green-700 border-green-200',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const normalized = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return value;
}

function formatMoney(amount: number | null | undefined): string {
  return `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function SalariedPaysheetPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const { start: defaultStart, end: defaultEnd } = currentMonthRange();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  const [records, setRecords] = useState<PayRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  useEffect(() => {
    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { router.push('/login'); return; }

        const { data, error: roleErr } = await (supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single() as any);

        const role = (data?.role || '').toString().trim().toLowerCase();
        if (roleErr || !['exec', 'admin', 'finance'].includes(role)) {
          router.push('/dashboard');
          return;
        }
        setIsAuthorized(true);
      } catch {
        router.push('/login');
      } finally {
        setAuthChecking(false);
      }
    };
    void check();
  }, [router]);

  const loadEmployees = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch('/api/employees', { headers });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const list = Array.isArray(json.employees) ? json.employees : Array.isArray(json) ? json : [];
        setEmployees(
          list.map((e: any) => ({
            id: e.id,
            name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email || e.id,
            email: e.email || null,
          }))
        );
      }
    } catch {
      // fallback: leave employees empty, user can type ID directly
    }
  }, []);

  const loadRecords = useCallback(async (start = startDate, end = endDate) => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const params = new URLSearchParams();
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);

      const res = await fetch(`/api/salaried-paysheet?${params.toString()}`, { headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load records');
      setRecords(Array.isArray(json.records) ? json.records : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (!isAuthorized) return;
    void loadRecords();
    void loadEmployees();
  }, [isAuthorized, loadRecords, loadEmployees]);

  const stats = useMemo(() => ({
    count: records.length,
    totalGross: records.reduce((s, r) => s + r.gross_pay, 0),
    totalDeductions: records.reduce((s, r) => s + r.federal_tax + r.state_tax + r.social_security + r.medicare + r.other_deductions, 0),
    totalNet: records.reduce((s, r) => s + r.net_pay, 0),
  }), [records]);

  function openAddForm() {
    setForm({ ...EMPTY_FORM, pay_period_start: startDate, pay_period_end: endDate });
    setFormError('');
    setEditingId(null);
    setShowAddForm(true);
  }

  function openEditForm(record: PayRecord) {
    setForm({
      user_id: record.user_id,
      pay_period_start: record.pay_period_start,
      pay_period_end: record.pay_period_end,
      annual_salary: record.annual_salary.toFixed(2),
      gross_pay: record.gross_pay.toFixed(2),
      federal_tax: record.federal_tax.toFixed(2),
      state_tax: record.state_tax.toFixed(2),
      social_security: record.social_security.toFixed(2),
      medicare: record.medicare.toFixed(2),
      other_deductions: record.other_deductions.toFixed(2),
      deduction_notes: record.deduction_notes || '',
      notes: record.notes || '',
      status: record.status,
    });
    setFormError('');
    setEditingId(record.id);
    setShowAddForm(false);
    setExpandedId(null);
  }

  function closeForm() {
    setShowAddForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  function updateForm(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function computedNet(): number {
    const gross = parseFloat(form.gross_pay) || 0;
    const deductions =
      (parseFloat(form.federal_tax) || 0) +
      (parseFloat(form.state_tax) || 0) +
      (parseFloat(form.social_security) || 0) +
      (parseFloat(form.medicare) || 0) +
      (parseFloat(form.other_deductions) || 0);
    return gross - deductions;
  }

  async function submitForm() {
    if (!form.user_id.trim()) { setFormError('Employee is required'); return; }
    if (!form.pay_period_start) { setFormError('Pay period start is required'); return; }
    if (!form.pay_period_end) { setFormError('Pay period end is required'); return; }
    if (!form.annual_salary || isNaN(parseFloat(form.annual_salary))) { setFormError('Annual salary is required'); return; }
    if (!form.gross_pay || isNaN(parseFloat(form.gross_pay))) { setFormError('Gross pay is required'); return; }

    setSubmitting(true);
    setFormError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const payload = {
        ...(editingId ? { id: editingId } : {}),
        user_id: form.user_id.trim(),
        pay_period_start: form.pay_period_start,
        pay_period_end: form.pay_period_end,
        annual_salary: parseFloat(form.annual_salary),
        gross_pay: parseFloat(form.gross_pay),
        federal_tax: parseFloat(form.federal_tax) || 0,
        state_tax: parseFloat(form.state_tax) || 0,
        social_security: parseFloat(form.social_security) || 0,
        medicare: parseFloat(form.medicare) || 0,
        other_deductions: parseFloat(form.other_deductions) || 0,
        deduction_notes: form.deduction_notes.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
      };

      const res = await fetch('/api/salaried-paysheet', {
        method: editingId ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to save record');

      const saved: PayRecord = json.record;
      setRecords((prev) =>
        editingId
          ? prev.map((r) => (r.id === editingId ? saved : r))
          : [saved, ...prev]
      );
      closeForm();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save record');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRecord(id: string) {
    if (!confirm('Delete this pay record? This cannot be undone.')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch(`/api/salaried-paysheet?id=${id}`, { method: 'DELETE', headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to delete');
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (editingId === id) closeForm();
      if (expandedId === id) setExpandedId(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete record');
    }
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="apple-card p-8">
          <p className="text-gray-500 text-sm">Checking access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) return null;

  const formPanel = (
    <div className="apple-card mt-4">
      <h3 className="text-base font-semibold text-gray-900 mb-4">
        {editingId ? 'Edit Pay Record' : 'Add Salaried Pay Record'}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="apple-label text-xs mb-1 block">Employee</label>
          {employees.length > 0 ? (
            <select
              value={form.user_id}
              onChange={(e) => updateForm('user_id', e.target.value)}
              className="apple-select text-sm"
            >
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}{emp.email ? ` (${emp.email})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Employee user ID (UUID)"
              value={form.user_id}
              onChange={(e) => updateForm('user_id', e.target.value)}
              className="apple-select text-sm"
            />
          )}
        </div>

        <div>
          <label className="apple-label text-xs mb-1 block">Pay Period Start</label>
          <input type="date" value={form.pay_period_start} onChange={(e) => updateForm('pay_period_start', e.target.value)} className="apple-select text-sm" />
        </div>
        <div>
          <label className="apple-label text-xs mb-1 block">Pay Period End</label>
          <input type="date" value={form.pay_period_end} onChange={(e) => updateForm('pay_period_end', e.target.value)} className="apple-select text-sm" />
        </div>

        <div>
          <label className="apple-label text-xs mb-1 block">Annual Salary ($)</label>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={form.annual_salary} onChange={(e) => updateForm('annual_salary', e.target.value)} className="apple-select text-sm" />
        </div>
        <div>
          <label className="apple-label text-xs mb-1 block">Gross Pay This Period ($)</label>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={form.gross_pay} onChange={(e) => updateForm('gross_pay', e.target.value)} className="apple-select text-sm" />
        </div>

        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Deductions</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {(
              [
                { key: 'federal_tax', label: 'Federal Tax' },
                { key: 'state_tax', label: 'State Tax' },
                { key: 'social_security', label: 'Social Security' },
                { key: 'medicare', label: 'Medicare' },
                { key: 'other_deductions', label: 'Other' },
              ] as { key: keyof FormState; label: string }[]
            ).map(({ key, label }) => (
              <div key={key}>
                <label className="apple-label text-xs mb-1 block">{label} ($)</label>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form[key] as string} onChange={(e) => updateForm(key, e.target.value)} className="apple-select text-sm" />
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="flex items-center justify-between rounded-2xl bg-gray-50 border border-gray-200 px-5 py-3">
            <span className="text-sm font-semibold text-gray-700">Computed Net Pay</span>
            <span className={`text-xl font-bold ${computedNet() >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {formatMoney(computedNet())}
            </span>
          </div>
        </div>

        <div>
          <label className="apple-label text-xs mb-1 block">Deduction Notes (optional)</label>
          <input type="text" placeholder="e.g. 401k, health insurance..." value={form.deduction_notes} onChange={(e) => updateForm('deduction_notes', e.target.value)} className="apple-select text-sm" />
        </div>
        <div>
          <label className="apple-label text-xs mb-1 block">Status</label>
          <select value={form.status} onChange={(e) => updateForm('status', e.target.value as FormState['status'])} className="apple-select text-sm">
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="apple-label text-xs mb-1 block">Internal Notes (optional)</label>
          <textarea rows={2} placeholder="Any additional notes..." value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} className="apple-select resize-none text-sm" />
        </div>
      </div>

      {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}

      <div className="flex gap-3 mt-5">
        <button onClick={() => void submitForm()} disabled={submitting} className={`apple-button text-sm ${submitting ? 'apple-button-disabled' : 'apple-button-primary'}`}>
          {submitting ? 'Saving...' : editingId ? 'Save Changes' : 'Add Record'}
        </button>
        <button onClick={closeForm} disabled={submitting} className="apple-button apple-button-secondary text-sm">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Salaried Paysheet</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage salary-based pay records by pay period.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={openAddForm}
              disabled={showAddForm}
              className={`apple-button ${showAddForm ? 'apple-button-disabled' : 'apple-button-primary'} text-sm`}
            >
              + Add Record
            </button>
            <button
              onClick={() => void loadRecords()}
              disabled={loading}
              className={`apple-button ${loading ? 'apple-button-disabled' : 'apple-button-secondary'} text-sm`}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <Link href="/hr-dashboard?view=payments">
              <button className="apple-button apple-button-secondary text-sm">Back to HR</button>
            </Link>
          </div>
        </div>

        {/* Pay Period Filter */}
        <div className="apple-card mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Pay Period Filter</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="apple-label text-xs mb-1 block">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="apple-select text-sm" />
            </div>
            <div>
              <label className="apple-label text-xs mb-1 block">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="apple-select text-sm" />
            </div>
            <button
              onClick={() => void loadRecords(startDate, endDate)}
              disabled={loading}
              className={`apple-button text-sm ${loading ? 'apple-button-disabled' : 'apple-button-primary'}`}
            >
              Apply
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Employees', value: stats.count, color: 'text-gray-900', bg: 'bg-white' },
            { label: 'Total Gross', value: formatMoney(stats.totalGross), color: 'text-blue-700', bg: 'bg-blue-50' },
            { label: 'Total Deductions', value: formatMoney(stats.totalDeductions), color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Total Net Pay', value: formatMoney(stats.totalNet), color: 'text-green-700', bg: 'bg-green-50' },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-2xl p-5 ${stat.bg} border border-black/5`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {error && <div className="apple-alert apple-alert-error mb-6">{error}</div>}

        {/* Add form */}
        {showAddForm && formPanel}

        {/* Records */}
        {loading && records.length === 0 ? (
          <div className="apple-card p-10 text-center mt-4">
            <p className="text-gray-500 text-sm">Loading pay records...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="apple-card p-10 text-center mt-4">
            <p className="text-gray-400 font-medium">No salaried pay records for this period.</p>
            <button onClick={openAddForm} className="apple-button apple-button-primary text-sm mt-4">
              Add the first record
            </button>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {records.map((record) => {
              const isExpanded = expandedId === record.id;
              const isEditing = editingId === record.id;
              const totalDeductions =
                record.federal_tax + record.state_tax + record.social_security +
                record.medicare + record.other_deductions;

              return (
                <div key={record.id} className="apple-card">
                  {/* Row header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (!isEditing) setExpandedId(isExpanded ? null : record.id);
                      }}
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-gray-900">{record.employee_name}</span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_STYLES[record.status]}`}>
                          {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {formatDate(record.pay_period_start)} – {formatDate(record.pay_period_end)}
                        {record.employee_email && (
                          <span className="ml-2 text-gray-400">· {record.employee_email}</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-right">
                        <p className="text-xs text-gray-400 uppercase tracking-wider">Gross</p>
                        <p className="text-base font-semibold text-gray-900">{formatMoney(record.gross_pay)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-400 uppercase tracking-wider">Net</p>
                        <p className="text-lg font-bold text-green-700">{formatMoney(record.net_pay)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => isEditing ? closeForm() : openEditForm(record)}
                          className="apple-button apple-button-secondary text-xs px-3 py-1.5"
                        >
                          {isEditing ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          onClick={() => void deleteRecord(record.id)}
                          className="apple-button apple-button-danger text-xs px-3 py-1.5"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Edit form inline */}
                  {isEditing && formPanel}

                  {/* Expanded deduction breakdown */}
                  {isExpanded && !isEditing && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Salary</p>
                          <div className="space-y-1 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Annual</span>
                              <span className="font-medium">{formatMoney(record.annual_salary)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-600">Gross This Period</span>
                              <span className="font-medium">{formatMoney(record.gross_pay)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-red-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-red-400 mb-2">Deductions</p>
                          <div className="space-y-1 text-sm">
                            {record.federal_tax > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Federal Tax</span>
                                <span className="text-red-700">-{formatMoney(record.federal_tax)}</span>
                              </div>
                            )}
                            {record.state_tax > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">State Tax</span>
                                <span className="text-red-700">-{formatMoney(record.state_tax)}</span>
                              </div>
                            )}
                            {record.social_security > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Social Security</span>
                                <span className="text-red-700">-{formatMoney(record.social_security)}</span>
                              </div>
                            )}
                            {record.medicare > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Medicare</span>
                                <span className="text-red-700">-{formatMoney(record.medicare)}</span>
                              </div>
                            )}
                            {record.other_deductions > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">Other</span>
                                <span className="text-red-700">-{formatMoney(record.other_deductions)}</span>
                              </div>
                            )}
                            <div className="flex justify-between pt-1 border-t border-red-100 font-semibold">
                              <span className="text-gray-700">Total Deductions</span>
                              <span className="text-red-700">-{formatMoney(totalDeductions)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl bg-green-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-green-500 mb-2">Take-Home</p>
                          <p className="text-3xl font-bold text-green-700 mt-1">{formatMoney(record.net_pay)}</p>
                          {record.deduction_notes && (
                            <p className="mt-2 text-xs text-gray-500">{record.deduction_notes}</p>
                          )}
                        </div>
                      </div>

                      {record.notes && (
                        <div className="mt-3 rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-600">
                          <span className="font-medium text-gray-700">Notes: </span>
                          {record.notes}
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
