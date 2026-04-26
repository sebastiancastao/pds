'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '@/app/global-calendar/dashboard-styles.css';

type PayrollSubmission = {
  id: string;
  submitted_by: string;
  submitted_by_name: string;
  file_name: string;
  status: 'submitted' | 'approved' | 'rejected';
  submitted_at: string;
  notes: string | null;
};

type ReimbursementReviewRequest = {
  id: string;
  user_id: string;
  vendor_name: string;
  vendor_email: string | null;
  event_id: string | null;
  purchase_date: string;
  description: string;
  requested_amount: number;
  approved_amount: number | null;
  status: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  receipt_filename: string | null;
  receipt_url: string | null;
  approved_pay_date: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  event: {
    id: string;
    event_name: string;
    event_date: string | null;
    venue: string | null;
    city: string | null;
    state: string | null;
  } | null;
};

type TabKey = 'payroll' | 'reimbursements';

const PAYROLL_STATUS_STYLES: Record<PayrollSubmission['status'], string> = {
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const REIMBURSEMENT_STATUS_STYLES: Record<ReimbursementReviewRequest['status'], string> = {
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'N/A';
  try {
    return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return value;
  }
}

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
  return `$${Number(amount || 0).toFixed(2)}`;
}

export default function PayrollApprovalsPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('payroll');

  const [submissions, setSubmissions] = useState<PayrollSubmission[]>([]);
  const [reimbursementRequests, setReimbursementRequests] = useState<ReimbursementReviewRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [submissionActionId, setSubmissionActionId] = useState<string | null>(null);
  const [submissionActionType, setSubmissionActionType] = useState<'approve' | 'reject' | null>(null);
  const [submissionActionNotes, setSubmissionActionNotes] = useState('');
  const [submissionActionError, setSubmissionActionError] = useState('');

  const [reimbursementActionId, setReimbursementActionId] = useState<string | null>(null);
  const [reimbursementActionType, setReimbursementActionType] = useState<'approve' | 'reject' | null>(null);
  const [reimbursementApprovedAmount, setReimbursementApprovedAmount] = useState('');
  const [reimbursementPayDate, setReimbursementPayDate] = useState('');
  const [reimbursementNotes, setReimbursementNotes] = useState('');
  const [reimbursementActionError, setReimbursementActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

        const { data, error: roleErr } = await (supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single() as any);

        const role = (data?.role || '').toString().trim().toLowerCase();
        if (roleErr || !['exec', 'admin'].includes(role)) {
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

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const [payrollRes, reimbursementRes] = await Promise.all([
        fetch('/api/payroll/approvals', { headers }),
        fetch('/api/payroll/reimbursements', { headers }),
      ]);

      const payrollJson = await payrollRes.json().catch(() => ({}));
      const reimbursementJson = await reimbursementRes.json().catch(() => ({}));

      if (!payrollRes.ok) {
        throw new Error(payrollJson.error || 'Failed to load payroll submissions');
      }
      if (!reimbursementRes.ok) {
        throw new Error(reimbursementJson.error || 'Failed to load reimbursement requests');
      }

      setSubmissions(Array.isArray(payrollJson.submissions) ? payrollJson.submissions : []);
      setReimbursementRequests(Array.isArray(reimbursementJson.requests) ? reimbursementJson.requests : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load approval queues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;
    void refreshAll();
  }, [isAuthorized, refreshAll]);

  const payrollStats = useMemo(
    () => ({
      total: submissions.length,
      submitted: submissions.filter((submission) => submission.status === 'submitted').length,
      approved: submissions.filter((submission) => submission.status === 'approved').length,
      rejected: submissions.filter((submission) => submission.status === 'rejected').length,
    }),
    [submissions]
  );

  const reimbursementStats = useMemo(
    () => ({
      total: reimbursementRequests.length,
      submitted: reimbursementRequests.filter((request) => request.status === 'submitted').length,
      approved: reimbursementRequests.filter((request) => request.status === 'approved').length,
      rejected: reimbursementRequests.filter((request) => request.status === 'rejected').length,
      approvedTotal: reimbursementRequests.reduce((sum, request) => {
        if (request.status !== 'approved') return sum;
        return sum + Number(request.approved_amount || 0);
      }, 0),
    }),
    [reimbursementRequests]
  );

  const openSubmissionAction = (id: string, type: 'approve' | 'reject') => {
    setSubmissionActionId(id);
    setSubmissionActionType(type);
    setSubmissionActionNotes('');
    setSubmissionActionError('');
  };

  const closeSubmissionAction = () => {
    setSubmissionActionId(null);
    setSubmissionActionType(null);
    setSubmissionActionNotes('');
    setSubmissionActionError('');
  };

  const openReimbursementAction = (request: ReimbursementReviewRequest, type: 'approve' | 'reject') => {
    setReimbursementActionId(request.id);
    setReimbursementActionType(type);
    setReimbursementApprovedAmount(
      request.approved_amount != null
        ? request.approved_amount.toFixed(2)
        : request.requested_amount.toFixed(2)
    );
    setReimbursementPayDate(request.approved_pay_date || '');
    setReimbursementNotes(request.review_notes || '');
    setReimbursementActionError('');
  };

  const closeReimbursementAction = () => {
    setReimbursementActionId(null);
    setReimbursementActionType(null);
    setReimbursementApprovedAmount('');
    setReimbursementPayDate('');
    setReimbursementNotes('');
    setReimbursementActionError('');
  };

  async function submitSubmissionAction() {
    if (!submissionActionId || !submissionActionType) return;

    setSubmitting(true);
    setSubmissionActionError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch('/api/payroll/approvals', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          id: submissionActionId,
          status: submissionActionType === 'approve' ? 'approved' : 'rejected',
          notes: submissionActionNotes.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to update submission');
      }

      const updated = json.submission;
      setSubmissions((prev) =>
        prev.map((entry) =>
          entry.id === submissionActionId
            ? { ...entry, status: updated.status, notes: updated.notes }
            : entry
        )
      );
      closeSubmissionAction();
    } catch (err: any) {
      setSubmissionActionError(err.message || 'Failed to update submission');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReimbursementAction() {
    if (!reimbursementActionId || !reimbursementActionType) return;

    setSubmitting(true);
    setReimbursementActionError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch('/api/payroll/reimbursements', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          id: reimbursementActionId,
          status: reimbursementActionType === 'approve' ? 'approved' : 'rejected',
          approved_amount: reimbursementApprovedAmount,
          approved_pay_date: reimbursementPayDate || null,
          review_notes: reimbursementNotes.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to review reimbursement');
      }

      const updated = json.request as ReimbursementReviewRequest;
      setReimbursementRequests((prev) =>
        prev.map((entry) => (entry.id === updated.id ? updated : entry))
      );
      closeReimbursementAction();
    } catch (err: any) {
      setReimbursementActionError(err.message || 'Failed to review reimbursement');
    } finally {
      setSubmitting(false);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Payroll Approvals</h1>
            <p className="mt-1 text-sm text-gray-500">
              Review payroll file submissions and vendor reimbursement requests from one queue.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void refreshAll()}
              disabled={loading}
              className={`apple-button ${loading ? 'apple-button-disabled' : 'apple-button-secondary'}`}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <Link href="/hr-dashboard?view=payments">
              <button className="apple-button apple-button-secondary">Back to HR Dashboard</button>
            </Link>
          </div>
        </div>

        <div className="mb-8 inline-flex rounded-full border border-gray-200 bg-white p-1 shadow-sm">
          <button
            onClick={() => setActiveTab('payroll')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              activeTab === 'payroll'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Payroll Files
          </button>
          <button
            onClick={() => setActiveTab('reimbursements')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              activeTab === 'reimbursements'
                ? 'bg-emerald-600 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Reimbursements
          </button>
        </div>

        {error && <div className="apple-alert apple-alert-error mb-6">{error}</div>}

        {activeTab === 'payroll' ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total', value: payrollStats.total, color: 'text-gray-900', bg: 'bg-white' },
                { label: 'Pending', value: payrollStats.submitted, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Approved', value: payrollStats.approved, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Rejected', value: payrollStats.rejected, color: 'text-red-600', bg: 'bg-red-50' },
              ].map((stat) => (
                <div key={stat.label} className={`rounded-2xl p-5 ${stat.bg} border border-black/5`}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {loading && submissions.length === 0 ? (
              <div className="apple-card p-10 text-center">
                <p className="text-gray-500 text-sm">Loading payroll submissions...</p>
              </div>
            ) : submissions.length === 0 ? (
              <div className="apple-card p-10 text-center">
                <p className="text-gray-400 font-medium">No payroll approval submissions yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {submissions.map((submission) => (
                  <div key={submission.id} className="apple-card">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap mb-1">
                          <span className="font-semibold text-gray-900 truncate">{submission.file_name}</span>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${PAYROLL_STATUS_STYLES[submission.status]}`}>
                            {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500">
                          Submitted by <span className="font-medium text-gray-700">{submission.submitted_by_name}</span>
                          {' · '}
                          {formatDateTime(submission.submitted_at)}
                        </p>
                        {submission.notes && (
                          <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                            <span className="font-medium text-gray-700">Notes: </span>
                            {submission.notes}
                          </p>
                        )}
                      </div>

                      {submission.status === 'submitted' && submissionActionId !== submission.id && (
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => openSubmissionAction(submission.id, 'approve')}
                            className="apple-button apple-button-primary text-sm px-4 py-2"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => openSubmissionAction(submission.id, 'reject')}
                            className="apple-button apple-button-danger text-sm px-4 py-2"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>

                    {submissionActionId === submission.id && (
                      <div className={`mt-4 rounded-xl border p-4 ${submissionActionType === 'approve' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                        <p className={`text-sm font-semibold mb-2 ${submissionActionType === 'approve' ? 'text-green-700' : 'text-red-700'}`}>
                          {submissionActionType === 'approve' ? 'Approve this submission?' : 'Reject this submission?'}
                        </p>
                        <label className="apple-label text-xs mb-1 block">Notes (optional)</label>
                        <textarea
                          rows={2}
                          value={submissionActionNotes}
                          onChange={(e) => setSubmissionActionNotes(e.target.value)}
                          placeholder={submissionActionType === 'approve' ? 'Approval comments...' : 'Reason for rejection...'}
                          className="apple-select resize-none text-sm mb-3"
                        />
                        {submissionActionError && <p className="text-xs text-red-600 mb-2">{submissionActionError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void submitSubmissionAction()}
                            disabled={submitting}
                            className={`apple-button text-sm ${submitting ? 'apple-button-disabled' : submissionActionType === 'approve' ? 'apple-button-primary' : 'apple-button-danger'}`}
                          >
                            {submitting ? 'Saving...' : submissionActionType === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
                          </button>
                          <button
                            onClick={closeSubmissionAction}
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
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
              {[
                { label: 'Total', value: reimbursementStats.total, color: 'text-gray-900', bg: 'bg-white' },
                { label: 'Pending', value: reimbursementStats.submitted, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'Approved', value: reimbursementStats.approved, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Rejected', value: reimbursementStats.rejected, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Approved $', value: formatMoney(reimbursementStats.approvedTotal), color: 'text-emerald-700', bg: 'bg-emerald-50' },
              ].map((stat) => (
                <div key={stat.label} className={`rounded-2xl p-5 ${stat.bg} border border-black/5`}>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {loading && reimbursementRequests.length === 0 ? (
              <div className="apple-card p-10 text-center">
                <p className="text-gray-500 text-sm">Loading reimbursement requests...</p>
              </div>
            ) : reimbursementRequests.length === 0 ? (
              <div className="apple-card p-10 text-center">
                <p className="text-gray-400 font-medium">No reimbursement requests yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {reimbursementRequests.map((request) => {
                  const isStandalone = !request.event_id;
                  return (
                    <div key={request.id} className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-semibold text-gray-900">{request.vendor_name}</span>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${REIMBURSEMENT_STATUS_STYLES[request.status]}`}>
                              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                            </span>
                            {isStandalone && (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                Standalone
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-gray-500">
                            {request.vendor_email || 'No email'}
                            {' · '}
                            Submitted {formatDateTime(request.created_at)}
                          </p>
                          <p className="mt-3 text-sm font-medium text-gray-900">
                            {request.event ? request.event.event_name : 'No event selected'}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">{request.description}</p>
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500">
                            <span>Purchase: {formatDate(request.purchase_date)}</span>
                            {request.event?.event_date && <span>Event Date: {formatDate(request.event.event_date)}</span>}
                            {request.event?.venue && <span>Venue: {request.event.venue}</span>}
                            {request.approved_pay_date && <span>Pay Date: {formatDate(request.approved_pay_date)}</span>}
                            {request.reviewed_at && <span>Reviewed: {formatDateTime(request.reviewed_at)}</span>}
                          </div>
                        </div>

                        {request.status === 'submitted' && reimbursementActionId !== request.id && (
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => openReimbursementAction(request, 'approve')}
                              className="apple-button apple-button-primary text-sm px-4 py-2"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => openReimbursementAction(request, 'reject')}
                              className="apple-button apple-button-danger text-sm px-4 py-2"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Requested</p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">{formatMoney(request.requested_amount)}</p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Approved</p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {request.approved_amount == null ? 'Pending' : formatMoney(request.approved_amount)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Receipt</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">
                            {request.receipt_url ? (
                              <a href={request.receipt_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:text-emerald-800">
                                {request.receipt_filename || 'View receipt'}
                              </a>
                            ) : (
                              'No receipt attached'
                            )}
                          </p>
                        </div>
                      </div>

                      {(request.review_notes || request.reviewed_by_name) && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          {request.reviewed_by_name ? (
                            <p className="font-medium text-slate-800 mb-1">Reviewed by {request.reviewed_by_name}</p>
                          ) : null}
                          {request.review_notes || 'No review notes.'}
                        </div>
                      )}

                      {reimbursementActionId === request.id && (
                        <div className={`mt-4 rounded-xl border p-4 ${reimbursementActionType === 'approve' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                          <p className={`text-sm font-semibold mb-3 ${reimbursementActionType === 'approve' ? 'text-green-700' : 'text-red-700'}`}>
                            {reimbursementActionType === 'approve' ? 'Approve this reimbursement?' : 'Reject this reimbursement?'}
                          </p>

                          {reimbursementActionType === 'approve' && (
                            <div className="grid gap-3 md:grid-cols-2 mb-3">
                              <div>
                                <label className="apple-label text-xs mb-1 block">Approved Amount</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={reimbursementApprovedAmount}
                                  onChange={(e) => setReimbursementApprovedAmount(e.target.value)}
                                  className="apple-select text-sm"
                                />
                              </div>
                              <div>
                                <label className="apple-label text-xs mb-1 block">
                                  {isStandalone ? 'Pay Date (required)' : 'Pay Date'}
                                </label>
                                <input
                                  type="date"
                                  value={reimbursementPayDate}
                                  onChange={(e) => setReimbursementPayDate(e.target.value)}
                                  className="apple-select text-sm"
                                  disabled={!isStandalone}
                                />
                              </div>
                            </div>
                          )}

                          <label className="apple-label text-xs mb-1 block">Notes</label>
                          <textarea
                            rows={3}
                            value={reimbursementNotes}
                            onChange={(e) => setReimbursementNotes(e.target.value)}
                            placeholder={reimbursementActionType === 'approve' ? 'Approval notes...' : 'Reason for rejection...'}
                            className="apple-select resize-none text-sm mb-3"
                          />

                          {reimbursementActionError && (
                            <p className="text-xs text-red-600 mb-2">{reimbursementActionError}</p>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={() => void submitReimbursementAction()}
                              disabled={submitting}
                              className={`apple-button text-sm ${submitting ? 'apple-button-disabled' : reimbursementActionType === 'approve' ? 'apple-button-primary' : 'apple-button-danger'}`}
                            >
                              {submitting ? 'Saving...' : reimbursementActionType === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
                            </button>
                            <button
                              onClick={closeReimbursementAction}
                              disabled={submitting}
                              className="apple-button apple-button-secondary text-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
