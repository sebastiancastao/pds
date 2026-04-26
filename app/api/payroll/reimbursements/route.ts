export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  createSignedReceiptUrl,
  getReimbursementAuthedUser,
  getReimbursementUserRole,
  getUserDisplayMap,
  reimbursementSupabaseAdmin,
} from '@/lib/reimbursements-server';
import { parseCurrencyInput } from '@/lib/reimbursements';

function normalizeReviewRow(row: any, event: any, receiptUrl: string | null, userMap: Record<string, { name: string; email: string | null }>) {
  return {
    id: row.id,
    user_id: row.user_id,
    vendor_name: userMap[row.user_id]?.name || 'Unknown',
    vendor_email: userMap[row.user_id]?.email || null,
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
    reviewed_by_name: row.reviewed_by ? userMap[row.reviewed_by]?.name || 'Unknown' : null,
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

    const role = await getReimbursementUserRole(user.id);
    if (!['exec', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { data: rows, error } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const requests = rows || [];
    const eventIds = Array.from(new Set(requests.map((row: any) => row.event_id).filter(Boolean)));
    const userIds = Array.from(
      new Set(
        requests.flatMap((row: any) => [row.user_id, row.reviewed_by]).filter(Boolean)
      )
    ) as string[];

    const [eventsResult, userMap, receiptUrls] = await Promise.all([
      eventIds.length > 0
        ? reimbursementSupabaseAdmin.from('events').select('*').in('id', eventIds)
        : Promise.resolve({ data: [], error: null } as any),
      getUserDisplayMap(userIds),
      Promise.all(requests.map((row: any) => createSignedReceiptUrl(row.receipt_path || null))),
    ]);

    if (eventsResult.error) {
      return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });
    }

    const eventMap: Record<string, any> = {};
    for (const event of eventsResult.data || []) {
      eventMap[event.id] = event;
    }

    return NextResponse.json({
      requests: requests.map((row: any, index: number) =>
        normalizeReviewRow(
          row,
          row.event_id ? eventMap[row.event_id] : null,
          receiptUrls[index] || null,
          userMap
        )
      ),
    });
  } catch (err: any) {
    console.error('[GET /api/payroll/reimbursements]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getReimbursementAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const role = await getReimbursementUserRole(user.id);
    if (!['exec', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const status = String(body?.status || '').trim();
    const reviewNotes = body?.review_notes == null ? null : String(body.review_notes).trim() || null;
    const approvedPayDate = body?.approved_pay_date == null ? null : String(body.approved_pay_date).trim() || null;
    const approvedAmount = parseCurrencyInput(body?.approved_amount);

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'status must be approved or rejected' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Reimbursement request not found' }, { status: 404 });
    }
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'Only submitted requests can be reviewed' }, { status: 400 });
    }

    const updatePayload: Record<string, any> = {
      status,
      review_notes: reviewNotes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    };

    if (status === 'approved') {
      if (!Number.isFinite(approvedAmount) || approvedAmount < 0) {
        return NextResponse.json({ error: 'approved_amount must be a valid number' }, { status: 400 });
      }
      if (!existing.event_id && !approvedPayDate) {
        return NextResponse.json({ error: 'approved_pay_date is required for standalone reimbursements' }, { status: 400 });
      }

      updatePayload.approved_amount = Number(approvedAmount.toFixed(2));
      updatePayload.approved_pay_date = existing.event_id ? null : approvedPayDate;
    } else {
      updatePayload.approved_amount = null;
      updatePayload.approved_pay_date = null;
    }

    const { data: updated, error: updateError } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .update(updatePayload)
      .eq('id', existing.id)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const [eventResult, userMap, receiptUrl] = await Promise.all([
      updated.event_id
        ? reimbursementSupabaseAdmin.from('events').select('*').eq('id', updated.event_id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
      getUserDisplayMap(
        Array.from(new Set([updated.user_id, updated.reviewed_by].filter(Boolean))) as string[]
      ),
      createSignedReceiptUrl(updated.receipt_path || null),
    ]);

    if (eventResult.error) {
      return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      request: normalizeReviewRow(updated, eventResult.data || null, receiptUrl, userMap),
    });
  } catch (err: any) {
    console.error('[PATCH /api/payroll/reimbursements]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
