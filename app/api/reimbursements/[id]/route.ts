export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  createSignedReceiptUrl,
  getReimbursementAuthedUser,
  getSelectableReimbursementEvents,
  reimbursementSupabaseAdmin,
  removeReimbursementReceipt,
  uploadReimbursementReceipt,
} from '@/lib/reimbursements-server';
import { parseCurrencyInput } from '@/lib/reimbursements';

function normalizeRequestRow(row: any, event: any, receiptUrl: string | null) {
  return {
    id: row.id,
    user_id: row.user_id,
    event_id: row.event_id,
    purchase_date: row.purchase_date,
    description: row.description,
    requested_amount: Number(row.requested_amount || 0),
    approved_amount: row.approved_amount == null ? null : Number(row.approved_amount || 0),
    status: row.status,
    receipt_filename: row.receipt_filename || null,
    receipt_url: receiptUrl,
    approved_pay_date: row.approved_pay_date || null,
    review_notes: row.review_notes || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    event: event
      ? {
          id: event.id,
          event_name: (event.event_name || event.name || 'Event').toString(),
          event_date: event.event_date || null,
          venue: event.venue || null,
          city: event.city || null,
          state: event.state || null,
        }
      : null,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getReimbursementAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: existing, error: existingError } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing || existing.user_id !== user.id) {
      return NextResponse.json({ error: 'Reimbursement request not found' }, { status: 404 });
    }
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'Only submitted requests can be changed' }, { status: 400 });
    }

    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      if (body?.action !== 'cancel') {
        return NextResponse.json({ error: 'Unsupported reimbursement action' }, { status: 400 });
      }

      const { data: cancelled, error: cancelError } = await reimbursementSupabaseAdmin
        .from('vendor_reimbursement_requests')
        .update({ status: 'cancelled' })
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select('*')
        .single();

      if (cancelError) {
        return NextResponse.json({ error: cancelError.message }, { status: 500 });
      }

      const event = cancelled.event_id
        ? await reimbursementSupabaseAdmin.from('events').select('*').eq('id', cancelled.event_id).maybeSingle()
        : { data: null };
      const receiptUrl = await createSignedReceiptUrl(cancelled.receipt_path || null);

      return NextResponse.json({
        success: true,
        request: normalizeRequestRow(cancelled, event.data || null, receiptUrl),
      });
    }

    const formData = await req.formData();
    const description = String(formData.get('description') || '').trim();
    const purchaseDate = String(formData.get('purchase_date') || '').trim();
    const eventIdRaw = String(formData.get('event_id') || '').trim();
    const requestedAmount = parseCurrencyInput(formData.get('requested_amount'));
    const receipt = formData.get('receipt');
    const eventId = eventIdRaw || null;

    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }
    if (!purchaseDate) {
      return NextResponse.json({ error: 'Purchase date is required' }, { status: 400 });
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return NextResponse.json({ error: 'Requested amount must be greater than 0' }, { status: 400 });
    }

    const availableEvents = await getSelectableReimbursementEvents(user.id);
    if (eventId && !availableEvents.some((event) => event.id === eventId)) {
      return NextResponse.json({ error: 'Selected event is not available for this user' }, { status: 400 });
    }

    const updatePayload: Record<string, any> = {
      description,
      purchase_date: purchaseDate,
      requested_amount: Number(requestedAmount.toFixed(2)),
      event_id: eventId,
    };

    if (receipt instanceof File && receipt.size > 0) {
      const uploaded = await uploadReimbursementReceipt({ userId: user.id, file: receipt });
      updatePayload.receipt_path = uploaded.receiptPath;
      updatePayload.receipt_filename = uploaded.receiptFilename;
      await removeReimbursementReceipt(existing.receipt_path || null);
    }

    const { data: updated, error: updateError } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .update(updatePayload)
      .eq('id', existing.id)
      .eq('user_id', user.id)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const event = updated.event_id
      ? availableEvents.find((entry) => entry.id === updated.event_id) || null
      : null;
    const receiptUrl = await createSignedReceiptUrl(updated.receipt_path || null);

    return NextResponse.json({
      success: true,
      request: normalizeRequestRow(updated, event, receiptUrl),
    });
  } catch (err: any) {
    console.error('[PATCH /api/reimbursements/[id]]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
