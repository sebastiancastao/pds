export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  createSignedReceiptUrl,
  getReimbursementAuthedUser,
  getReimbursementUserRole,
  getUserDisplayMap,
  reimbursementSupabaseAdmin,
} from '@/lib/reimbursements-server';
import { canUserAccessEventById } from '@/lib/event-access';

// Read-only list of the vendor reimbursement requests filed against one event,
// for the event dashboard's Reimbursements tab. Exec sees every event; a
// manager only sees events they can already open (same rule as the dashboard).
// Approve/reject stays on /payroll-approvals.
const EVENT_REIMBURSEMENT_VIEW_ROLES = new Set(['exec', 'manager']);

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getReimbursementAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const eventId = String(params?.id || '').trim();
    if (!eventId) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    const role = await getReimbursementUserRole(user.id);
    if (!EVENT_REIMBURSEMENT_VIEW_ROLES.has(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const hasAccess = await canUserAccessEventById(reimbursementSupabaseAdmin, eventId, {
      userId: user.id,
      role,
    });
    if (!hasAccess) {
      return NextResponse.json({ error: 'Not authorized for this event' }, { status: 403 });
    }

    const { data: rows, error } = await reimbursementSupabaseAdmin
      .from('vendor_reimbursement_requests')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const requests = rows || [];
    const userIds = Array.from(
      new Set(requests.flatMap((row: any) => [row.user_id, row.reviewed_by]).filter(Boolean))
    ) as string[];

    const [userMap, receiptUrls] = await Promise.all([
      getUserDisplayMap(userIds),
      Promise.all(requests.map((row: any) => createSignedReceiptUrl(row.receipt_path || null))),
    ]);

    return NextResponse.json({
      requests: requests.map((row: any, index: number) => ({
        id: row.id,
        user_id: row.user_id,
        vendor_name: userMap[row.user_id]?.name || 'Unknown',
        vendor_email: userMap[row.user_id]?.email || null,
        purchase_date: row.purchase_date,
        description: row.description,
        requested_amount: Number(row.requested_amount || 0),
        approved_amount: row.approved_amount == null ? null : Number(row.approved_amount || 0),
        status: row.status,
        receipt_filename: row.receipt_filename || null,
        receipt_url: receiptUrls[index] || null,
        review_notes: row.review_notes || null,
        reviewed_by_name: row.reviewed_by ? userMap[row.reviewed_by]?.name || 'Unknown' : null,
        reviewed_at: row.reviewed_at || null,
        created_at: row.created_at,
      })),
    });
  } catch (err: any) {
    console.error('[GET /api/events/[id]/reimbursements]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
