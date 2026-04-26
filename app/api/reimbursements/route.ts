export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  createSignedReceiptUrl,
  getReimbursementAuthedUser,
  getSelectableReimbursementEvents,
  reimbursementSupabaseAdmin,
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

export async function GET(req: NextRequest) {
  try {
    const user = await getReimbursementAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const [requestsResult, availableEvents] = await Promise.all([
      reimbursementSupabaseAdmin
        .from('vendor_reimbursement_requests')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      getSelectableReimbursementEvents(user.id),
    ]);

    if (requestsResult.error) {
      return NextResponse.json({ error: requestsResult.error.message }, { status: 500 });
    }

    const requests = requestsResult.data || [];
    const eventIds = Array.from(new Set(requests.map((row: any) => row.event_id).filter(Boolean)));
    const eventMap: Record<string, any> = {};

    if (eventIds.length > 0) {
      const { data: events, error: eventsError } = await reimbursementSupabaseAdmin
        .from('events')
        .select('*')
        .in('id', eventIds);

      if (eventsError) {
        return NextResponse.json({ error: eventsError.message }, { status: 500 });
      }

      for (const event of events || []) {
        eventMap[event.id] = event;
      }
    }

    const receiptUrls = await Promise.all(
      requests.map((row: any) => createSignedReceiptUrl(row.receipt_path || null))
    );

    return NextResponse.json({
      requests: requests.map((row: any, index: number) =>
        normalizeRequestRow(row, row.event_id ? eventMap[row.event_id] : null, receiptUrls[index] || null)
      ),
      available_events: availableEvents,
    });
  } catch (err: any) {
    console.error('[GET /api/reimbursements]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getReimbursementAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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

    let receiptPath: string | null = null;
    let receiptFilename: string | null = null;
    if (receipt instanceof File && receipt.size > 0) {
      const uploaded = await uploadReimbursementReceipt({ userId: user.id, file: receipt });
      receiptPath = uploaded.receiptPath;
      receiptFilename = uploaded.receiptFilename;
    }

    const { data: inserted, error } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .insert({
        user_id: user.id,
        event_id: eventId,
        purchase_date: purchaseDate,
        description,
        requested_amount: Number(requestedAmount.toFixed(2)),
        receipt_path: receiptPath,
        receipt_filename: receiptFilename,
        status: 'submitted',
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const receiptUrl = await createSignedReceiptUrl(inserted.receipt_path || null);
    const event = eventId ? availableEvents.find((entry) => entry.id === eventId) || null : null;

    return NextResponse.json({
      success: true,
      request: normalizeRequestRow(inserted, event, receiptUrl),
    });
  } catch (err: any) {
    console.error('[POST /api/reimbursements]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
