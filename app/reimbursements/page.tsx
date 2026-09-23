'use client';

import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { groupReimbursementRequestsByBatch, type ReimbursementEventOption } from '@/lib/reimbursements';

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
  batch_id: string | null;
  event: ReimbursementEventOption | null;
};

type LineItem = {
  key: string;
  eventId: string;
  purchaseDate: string;
  requestedAmount: string;
  description: string;
  file: File | null;
};

function newLineItem(): LineItem {
  return {
    key: Math.random().toString(36).slice(2),
    eventId: '',
    purchaseDate: '',
    requestedAmount: '',
    description: '',
    file: null,
  };
}

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

  // Submitting new requests supports a batch: one or several receipts added
  // in one sitting, listed with a running total, then submitted together.
  // Editing an existing request still uses the single formState/receiptFile
  // above, since you can only edit one at a time.
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()]);
  const [batchSubmitError, setBatchSubmitError] = useState('');

  const batchTotal = useMemo(
    () => lineItems.reduce((sum, item) => sum + (Number(item.requestedAmount) || 0), 0),
    [lineItems]
  );

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

  function updateLineItem(key: string, patch: Partial<LineItem>) {
    setLineItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, newLineItem()]);
  }

  function removeLineItem(key: string) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((item) => item.key !== key) : prev));
  }

  async function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    setBatchSubmitError('');

    try {
      const session = await getSessionOrRedirect();
      if (!session) return;

      const isBatch = lineItems.length > 1;
      const batchId = isBatch ? (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`) : null;

      const created: ReimbursementRequest[] = [];
      for (let index = 0; index < lineItems.length; index += 1) {
        const item = lineItems[index];
        const formData = new FormData();
        formData.append('event_id', item.eventId);
        formData.append('purchase_date', item.purchaseDate);
        formData.append('requested_amount', item.requestedAmount);
        formData.append('description', item.description);
        if (item.file) {
          formData.append('receipt', item.file);
        }
        if (batchId) {
          formData.append('batch_id', batchId);
          formData.append('batch_size', String(lineItems.length));
          formData.append('batch_index', String(index));
        }

        const res = await fetch('/api/reimbursements', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            isBatch
              ? `Receipt ${index + 1} of ${lineItems.length} failed: ${json.error || 'Failed to save reimbursement'}`
              : json.error || 'Failed to save reimbursement'
          );
        }
        created.push(json.request as ReimbursementRequest);
      }

      setRequests((prev) => [...created, ...prev]);
      setMessage(
        created.length > 1
          ? `${created.length} reimbursement requests submitted (batch total ${formatMoney(batchTotal)}).`
          : 'Reimbursement request submitted.'
      );
      setLineItems([newLineItem()]);
    } catch (err: any) {
      setBatchSubmitError(err.message || 'Failed to submit one or more reimbursements.');
    } finally {
      setSubmitting(false);
    }
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
          {editingId ? (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Edit Request</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Receipts are optional, but attaching one makes review easier.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel Edit
                </button>
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
                  <p className="mt-2 text-xs text-slate-500">
                    Leave this empty to keep the existing receipt. Upload a new file only if you need to replace it.
                  </p>
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  If you leave the event blank, payroll will review it as a standalone reimbursement and assign the pay date after approval.
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>
          ) : (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold text-slate-900">Submit Reimbursements</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Add one receipt or several from the same trip — list them here, then submit as one batch.
                </p>
              </div>

              <form onSubmit={handleBatchSubmit} className="space-y-5">
                {lineItems.map((item, index) => (
                  <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">
                        Receipt {index + 1}{lineItems.length > 1 ? ` of ${lineItems.length}` : ''}
                      </p>
                      {lineItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLineItem(item.key)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-slate-700">Event</label>
                      <select
                        value={item.eventId}
                        onChange={(e) => updateLineItem(item.key, { eventId: e.target.value })}
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

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-700">Purchase Date</label>
                        <input
                          type="date"
                          value={item.purchaseDate}
                          onChange={(e) => updateLineItem(item.key, { purchaseDate: e.target.value })}
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
                          value={item.requestedAmount}
                          onChange={(e) => updateLineItem(item.key, { requestedAmount: e.target.value })}
                          placeholder="0.00"
                          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                          required
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="mb-2 block text-sm font-medium text-slate-700">Description</label>
                      <textarea
                        rows={3}
                        value={item.description}
                        onChange={(e) => updateLineItem(item.key, { description: e.target.value })}
                        placeholder="Describe what you bought, why it was needed, and any useful context for payroll."
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                        required
                      />
                    </div>

                    <div className="mt-4">
                      <label className="mb-2 block text-sm font-medium text-slate-700">Receipt</label>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                        onChange={(e) => updateLineItem(item.key, { file: e.target.files?.[0] || null })}
                        className="block w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-emerald-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-emerald-700"
                      />
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addLineItem}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700"
                >
                  + Add Another Receipt
                </button>

                <div className="flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <span>
                    {lineItems.length > 1
                      ? 'If you leave an event blank, payroll reviews that receipt as standalone.'
                      : 'If you leave the event blank, payroll will review it as a standalone reimbursement and assign the pay date after approval.'}
                  </span>
                  {lineItems.length > 1 && (
                    <span className="shrink-0 pl-4 font-semibold">Batch total: {formatMoney(batchTotal)}</span>
                  )}
                </div>

                {batchSubmitError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {batchSubmitError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {submitting
                    ? 'Saving...'
                    : lineItems.length > 1
                    ? `Submit ${lineItems.length} Receipts (${formatMoney(batchTotal)})`
                    : 'Submit Request'}
                </button>
              </form>
            </div>
          )}

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
              <div className="space-y-6">
                {groupReimbursementRequestsByBatch(requests).map((group) => (
                  <div
                    key={group.batchId || group.items[0].id}
                    className={
                      group.items.length > 1
                        ? 'space-y-4 rounded-[2rem] border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-4'
                        : 'space-y-4'
                    }
                  >
                    {group.items.length > 1 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                        <p className="text-sm font-semibold text-emerald-800">Batch of {group.items.length} receipts</p>
                        <p className="text-sm font-bold text-emerald-800">
                          Total: {formatMoney(group.items.reduce((sum, entry) => sum + entry.requested_amount, 0))}
                        </p>
                      </div>
                    )}
                    {group.items.map((request) => (
                  <div key={request.id} className="rounded-3xl border border-slate-200 bg-white p-6">
                    <p className="text-center text-4xl font-bold text-slate-900">{formatMoney(request.requested_amount)}</p>
                    <p className="mt-2 text-center text-sm text-slate-500">
                      {request.event ? request.event.event_name : 'Standalone reimbursement'}
                      {request.event?.venue ? `, ${request.event.venue}` : ''}
                    </p>
                    <p className="text-center text-sm text-slate-500">{formatDate(request.purchase_date)}</p>

                    <div className="mt-6 border-t border-slate-100">
                      <div className="flex items-center justify-between border-b border-slate-100 py-3">
                        <span className="text-sm font-semibold text-slate-900">Status</span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[request.status]}`}>
                          {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                        </span>
                      </div>

                      <div className="border-b border-slate-100 py-3">
                        <span className="text-sm font-semibold text-slate-900">Description</span>
                        <p className="mt-1 text-sm text-slate-600">{request.description}</p>
                      </div>

                      <div className="flex items-center justify-between border-b border-slate-100 py-3">
                        <span className="text-sm font-semibold text-slate-900">Approved Amount</span>
                        <span className="text-sm text-slate-600">
                          {request.approved_amount == null ? 'Pending' : formatMoney(request.approved_amount)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between border-b border-slate-100 py-3">
                        <span className="text-sm font-semibold text-slate-900">Submitted</span>
                        <span className="text-sm text-slate-600">{new Date(request.created_at).toLocaleString()}</span>
                      </div>

                      {request.approved_pay_date && (
                        <div className="flex items-center justify-between border-b border-slate-100 py-3">
                          <span className="text-sm font-semibold text-slate-900">Pay Date</span>
                          <span className="text-sm text-slate-600">{formatDate(request.approved_pay_date)}</span>
                        </div>
                      )}

                      {request.review_notes && (
                        <div className="border-b border-slate-100 py-3">
                          <span className="text-sm font-semibold text-slate-900">Review Notes</span>
                          <p className="mt-1 text-sm text-slate-600">{request.review_notes}</p>
                        </div>
                      )}

                      {request.receipt_url && (
                        <div className="flex items-center justify-between py-3">
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-slate-900">Receipt</span>
                            {request.receipt_filename && (
                              <p className="truncate text-xs text-slate-500">{request.receipt_filename}</p>
                            )}
                          </div>
                          <a
                            href={request.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
                          >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </a>
                        </div>
                      )}
                    </div>

                    {request.status === 'submitted' && (
                      <div className="mt-5 flex gap-2">
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
                    ))}
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
