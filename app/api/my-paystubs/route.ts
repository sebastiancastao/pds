import { NextRequest, NextResponse } from 'next/server';
import {
  getReimbursementAuthedUser,
  reimbursementSupabaseAdmin,
} from '@/lib/reimbursements-server';

export const dynamic = 'force-dynamic';

type StandaloneReimbursementEntry = {
  id: string;
  approved_amount: number;
  approved_pay_date: string;
  description: string;
  purchase_date: string;
  created_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const user = await getReimbursementAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = user.id;
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    const { data: allPayments, error: paymentsError } = await reimbursementSupabaseAdmin
      .from('event_vendor_payments')
      .select('id, event_id, regular_hours, regular_pay, overtime_hours, overtime_pay, doubletime_hours, doubletime_pay, commissions, tips, total_pay, created_at')
      .eq('user_id', userId);

    if (paymentsError) {
      console.error('[MY_PAYSTUBS] Error fetching vendor payments:', paymentsError);
      return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
    }

    const allEventIds = Array.from(new Set((allPayments || []).map((payment: any) => payment.event_id).filter(Boolean)));
    let filteredEvents: any[] = [];
    if (allEventIds.length > 0) {
      let eventsQuery = reimbursementSupabaseAdmin
        .from('events')
        .select('*')
        .in('id', allEventIds)
        .order('event_date', { ascending: false });

      if (startDate) {
        eventsQuery = eventsQuery.gte('event_date', startDate);
      }
      if (endDate) {
        eventsQuery = eventsQuery.lte('event_date', endDate);
      }

      const { data: events, error: eventsError } = await eventsQuery;
      if (eventsError) {
        console.error('[MY_PAYSTUBS] Error fetching events:', eventsError);
        return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
      }
      filteredEvents = events || [];
    }

    const filteredEventIdSet = new Set(filteredEvents.map((event: any) => event.id));
    const payments = (allPayments || []).filter((payment: any) => filteredEventIdSet.has(payment.event_id));
    const filteredEventIds = Array.from(filteredEventIdSet);

    const [eventPaymentsResult, adjustmentsResult, reimbursementsResult, standaloneResult] = await Promise.all([
      filteredEventIds.length > 0
        ? reimbursementSupabaseAdmin
            .from('event_payments')
            .select('event_id, base_rate')
            .in('event_id', filteredEventIds)
        : Promise.resolve({ data: [], error: null } as any),
      filteredEventIds.length > 0
        ? reimbursementSupabaseAdmin
            .from('payment_adjustments')
            .select('event_id, adjustment_amount')
            .eq('user_id', userId)
            .in('event_id', filteredEventIds)
        : Promise.resolve({ data: [], error: null } as any),
      filteredEventIds.length > 0
        ? reimbursementSupabaseAdmin
            .from('vendor_reimbursement_requests')
            .select('event_id, approved_amount')
            .eq('user_id', userId)
            .eq('status', 'approved')
            .not('event_id', 'is', null)
            .in('event_id', filteredEventIds)
        : Promise.resolve({ data: [], error: null } as any),
      (() => {
        let query = reimbursementSupabaseAdmin
          .from('vendor_reimbursement_requests')
          .select('id, approved_amount, approved_pay_date, description, purchase_date, created_at')
          .eq('user_id', userId)
          .eq('status', 'approved')
          .is('event_id', null)
          .not('approved_pay_date', 'is', null)
          .order('approved_pay_date', { ascending: false });

        if (startDate) {
          query = query.gte('approved_pay_date', startDate);
        }
        if (endDate) {
          query = query.lte('approved_pay_date', endDate);
        }
        return query;
      })(),
    ]);

    if (eventPaymentsResult.error) {
      console.error('[MY_PAYSTUBS] Error fetching event pay summaries:', eventPaymentsResult.error);
      return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
    }
    if (adjustmentsResult.error) {
      console.error('[MY_PAYSTUBS] Error fetching payment adjustments:', adjustmentsResult.error);
      return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
    }
    if (reimbursementsResult.error) {
      console.error('[MY_PAYSTUBS] Error fetching reimbursements:', reimbursementsResult.error);
      return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
    }
    if (standaloneResult.error) {
      console.error('[MY_PAYSTUBS] Error fetching standalone reimbursements:', standaloneResult.error);
      return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
    }

    const eventMap: Record<string, any> = {};
    for (const event of filteredEvents) {
      eventMap[event.id] = event;
    }

    const baseRateByEventId: Record<string, number> = {};
    for (const row of eventPaymentsResult.data || []) {
      baseRateByEventId[row.event_id] = Number(row.base_rate || 0);
    }

    const adjustmentByEventId: Record<string, number> = {};
    for (const row of adjustmentsResult.data || []) {
      adjustmentByEventId[row.event_id] = Number(row.adjustment_amount || 0);
    }

    const reimbursementByEventId: Record<string, number> = {};
    for (const row of reimbursementsResult.data || []) {
      const eventId = row.event_id;
      reimbursementByEventId[eventId] = Number((reimbursementByEventId[eventId] || 0) + Number(row.approved_amount || 0));
    }

    const paystubs = payments
      .map((payment: any) => {
        const event = eventMap[payment.event_id] || null;
        const adjustmentAmount = Number(adjustmentByEventId[payment.event_id] || 0);
        const reimbursementAmount = Number(reimbursementByEventId[payment.event_id] || 0);
        const totalPay = Number(payment.total_pay || 0);

        return {
          id: payment.id,
          event_id: payment.event_id,
          event_name: (event?.event_name || event?.name || 'Unknown Event').toString(),
          event_date: event?.event_date || payment.created_at,
          venue: event?.venue || 'Unknown Venue',
          regular_hours: Number(payment.regular_hours || 0),
          regular_pay: Number(payment.regular_pay || 0),
          overtime_hours: Number(payment.overtime_hours || 0),
          overtime_pay: Number(payment.overtime_pay || 0),
          doubletime_hours: Number(payment.doubletime_hours || 0),
          doubletime_pay: Number(payment.doubletime_pay || 0),
          commissions: Number(payment.commissions || 0),
          tips: Number(payment.tips || 0),
          adjustment_amount: adjustmentAmount,
          reimbursement_amount: reimbursementAmount,
          total_pay: totalPay,
          final_pay: totalPay + adjustmentAmount + reimbursementAmount,
          base_rate: Number(baseRateByEventId[payment.event_id] || 17.28),
          created_at: payment.created_at,
        };
      })
      .sort((a, b) => {
        const dateCompare = String(b.event_date || '').localeCompare(String(a.event_date || ''));
        if (dateCompare !== 0) return dateCompare;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });

    const standaloneReimbursements: StandaloneReimbursementEntry[] = (standaloneResult.data || []).map((row: any) => ({
      id: row.id,
      approved_amount: Number(row.approved_amount || 0),
      approved_pay_date: row.approved_pay_date,
      description: row.description || '',
      purchase_date: row.purchase_date,
      created_at: row.created_at,
    }));

    return NextResponse.json({
      paystubs,
      standalone_reimbursements: standaloneReimbursements,
    });
  } catch (err: any) {
    console.error('[MY_PAYSTUBS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
