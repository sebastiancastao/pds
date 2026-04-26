'use client';

import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ReimbursementEventOption } from '@/lib/reimbursements';

type ReimbursementRequest = {
  id: string;
  user_id: string;
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
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  event: ReimbursementEventOption | null;
};

const STATUS_STYLES: Record<ReimbursementRequest['status'], string> = {
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-200',
};

const EMPTY_FORM = {
  eventId: '',
  purchaseDate: '',
  requestedAmount: '',
  description: '',
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
  const safeAmount = Number(amount || 0);
  return `$${safeAmount.toFixed(2)}`;
}

export default function ReimbursementsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<ReimbursementRequest[]>([]);
  const [availableEvents, setAvailableEvents] = useState<ReimbursementEventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === 'submitted').length,
    [requests]
  );

  const totalApproved = useMemo(
    () =>
      requests.reduce((sum, request) => {
        if (request.status !== 'approved') return sum;
        return sum + Number(request.approved_amount || 0);
      }, 0),
    [requests]
  );

  useEffect(() => {
    void loadData();
  }, []);

  async function getSessionOrRedirect() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      router.push('/login');
      return null;
    }
    return session;
  }

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const session = await getSessionOrRedirect();
      if (!session) return;

      const res = await fetch('/api/reimbursements', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load reimbursements');
      }

      setRequests(Array.isArray(json.requests) ? json.requests : []);
      setAvailableEvents(Array.isArray(json.available_events) ? json.available_events : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load reimbursements');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormState(EMPTY_FORM);
    setReceiptFile(null);
    setEditingId(null);
  }

  function startEditing(request: ReimbursementRequest) {
    setEditingId(request.id);
    setMessage('');
    setError('');
    setReceiptFile(null);
    setFormState({
      eventId: request.event_id || '',
      purchaseDate: request.purchase_date || '',
      requestedAmount: request.requested_amount ? request.requested_amount.toFixed(2) : '',
      description: request.description || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');

    try {
      const session = await getSessionOrRedirect();
      if (!session) return;

      const formData = new FormData();
      formData.append('event_id', formState.eventId);
      formData.append('purchase_date', formState.purchaseDate);
      formData.append('requested_amount', formState.requestedAmount);
      formData.append('description', formState.description);
      if (receiptFile) {
        formData.append('receipt', receiptFile);
      }

      const res = await fetch(editingId ? `/api/reimbursements/${editingId}` : '/api/reimbursements', {
        method: editingId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to save reimbursement');
      }

      const request = json.request as ReimbursementRequest;
      setRequests((prev) => {
        if (editingId) {
          return prev.map((entry) => (entry.id === request.id ? request : entry));
        }
        return [request, ...prev];
      });
      setMessage(editingId ? 'Reimbursement request updated.' : 'Reimbursement request submitted.');
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save reimbursement');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(requestId: string) {
    setCancellingId(requestId);
    setError('');
    setMessage('');

    try {
      const session = await getSessionOrRedirect();
      if (!session) return;

      const res = await fetch(`/api/reimbursements/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'cancel' }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || 'Failed to cancel reimbursement');
      }

      const request = json.request as ReimbursementRequest;
      setRequests((prev) => prev.map((entry) => (entry.id === request.id ? request : entry)));
      if (editingId === request.id) {
        resetForm();
      }
      setMessage('Reimbursement request cancelled.');
    } catch (err: any) {
      setError(err.message || 'Failed to cancel reimbursement');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-600">Vendor Payroll</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">My Reimbursements</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600">
              Submit purchases made on behalf of an event. If you do not pick an event, payroll will review it as a standalone reimbursement and assign the pay date after approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/paystub"
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              View Paystubs
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Submitted Requests</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{requests.length}</p>
          </div>
          <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Pending Review</p>
            <p className="mt-2 text-3xl font-bold text-blue-700">{pendingRequests}</p>
          </div>
          <div className="rounded-3xl border border-green-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">Approved Total</p>
            <p className="mt-2 text-3xl font-bold text-green-700">{formatMoney(totalApproved)}</p>
          </div>
        </div>

        {(error || message) && (
          <div
            className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
              error
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-green-200 bg-green-50 text-green-700'
            }`}
          >
            {error || message}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">
                  {editingId ? 'Edit Request' : 'Submit a Reimbursement'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Receipts are optional, but attaching one makes review easier.
                </p>
              </div>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Event</label>
                <select
                  value={formState.eventId}
                  onChange={(e) => setFormState((prev) => ({ ...prev, eventId: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                >
                  <option value="">Standalone reimbursement</option>
                  {availableEvents.map((eventOption) => (
                    <option key={eventOption.id} value={eventOption.id}>
                      {eventOption.event_name} · {formatDate(eventOption.event_date)}{eventOption.venue ? ` · ${eventOption.venue}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Purchase Date</label>
                  <input
                    type="date"
                    value={formState.purchaseDate}
                    onChange={(e) => setFormState((prev) => ({ ...prev, purchaseDate: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Amount</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={formState.requestedAmount}
                    onChange={(e) => setFormState((prev) => ({ ...prev, requestedAmount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Description</label>
                <textarea
                  rows={5}
                  value={formState.description}
                  onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Describe what you bought, why it was needed, and any useful context for payroll."
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Receipt</label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700"
                />
                {editingId && (
                  <p className="mt-2 text-xs text-slate-500">
                    Leave this empty to keep the existing receipt. Upload a new file only if you need to replace it.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                If you leave the event blank, payroll will review it as a standalone reimbursement and assign the pay date after approval.
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                {submitting ? 'Saving...' : editingId ? 'Save Changes' : 'Submit Request'}
              </button>
            </form>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-slate-900">Request History</h2>
              <p className="mt-1 text-sm text-slate-500">Track review status and see what will be added to payroll.</p>
            </div>

            {loading ? (
              <div className="py-12 text-center text-sm text-slate-500">Loading reimbursement requests...</div>
            ) : requests.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
                <p className="text-sm font-medium text-slate-700">No reimbursement requests yet.</p>
                <p className="mt-2 text-sm text-slate-500">Your submitted requests will appear here once you send the first one.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg font-semibold text-slate-900">{formatMoney(request.requested_amount)}</span>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[request.status]}`}>
                            {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-800">
                          {request.event ? request.event.event_name : 'Standalone reimbursement'}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">{request.description}</p>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                          <span>Purchase: {formatDate(request.purchase_date)}</span>
                          <span>Submitted: {new Date(request.created_at).toLocaleString()}</span>
                          {request.event?.venue && <span>Venue: {request.event.venue}</span>}
                          {request.approved_pay_date && <span>Pay date: {formatDate(request.approved_pay_date)}</span>}
                        </div>
                      </div>
                      {request.status === 'submitted' && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => startEditing(request)}
                            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCancel(request.id)}
                            disabled={cancellingId === request.id}
                            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                          >
                            {cancellingId === request.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Requested</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{formatMoney(request.requested_amount)}</p>
                      </div>
                      <div className="rounded-2xl bg-white px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Approved</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">
                          {request.approved_amount == null ? 'Pending' : formatMoney(request.approved_amount)}
                        </p>
                      </div>
                    </div>

                    {(request.review_notes || request.receipt_url || request.receipt_filename) && (
                      <div className="mt-4 space-y-3">
                        {request.review_notes && (
                          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">Review notes:</span> {request.review_notes}
                          </div>
                        )}
                        {request.receipt_url && (
                          <a
                            href={request.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800"
                          >
                            View receipt
                            {request.receipt_filename ? <span className="text-slate-500">({request.receipt_filename})</span> : null}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
