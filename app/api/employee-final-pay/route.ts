import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const GATE_PHONE_OFFSET_HOURS = 0.5;
const HOURS_MISMATCH_THRESHOLD = 0.01;

const addGatePhoneLeadHours = (hours: number): number =>
  Number((hours + GATE_PHONE_OFFSET_HOURS).toFixed(6));
const addLongShiftBonus = (hours: number): number => hours >= 14 ? hours + 4.5 : hours;
const roundHoursForDebug = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(6));

const getEffectiveHours = (payment: any): number => {
  if (payment && (payment?.effective_hours != null || payment?.effectiveHours != null)) {
    const effective = Number(payment?.effective_hours ?? payment?.effectiveHours);
    if (Number.isFinite(effective) && effective >= 0) return addLongShiftBonus(addGatePhoneLeadHours(effective));
  }
  const actual = Number(payment?.actual_hours ?? payment?.actualHours ?? 0);
  if (actual > 0) return addLongShiftBonus(actual);
  const worked = Number(payment?.worked_hours ?? payment?.workedHours ?? 0);
  if (worked > 0) return addLongShiftBonus(worked);
  const reg = Number(payment?.regular_hours ?? payment?.regularHours ?? 0);
  const ot = Number(payment?.overtime_hours ?? payment?.overtimeHours ?? 0);
  const dt = Number(payment?.doubletime_hours ?? payment?.doubletimeHours ?? 0);
  const summed = reg + ot + dt;
  return summed > 0 ? addLongShiftBonus(summed) : 0;
};

const getHoursDebugBreakdown = (payment: any) => {
  const effectiveRaw = payment?.effective_hours ?? payment?.effectiveHours;
  const hasEffective = effectiveRaw != null;
  const effective = hasEffective ? Number(effectiveRaw) : 0;
  const effectivePlusGatePhone =
    hasEffective && Number.isFinite(effective) && effective >= 0
      ? addGatePhoneLeadHours(effective)
      : 0;
  const actual = Number(payment?.actual_hours ?? payment?.actualHours ?? 0);
  const worked = Number(payment?.worked_hours ?? payment?.workedHours ?? 0);
  const reg = Number(payment?.regular_hours ?? payment?.regularHours ?? 0);
  const ot = Number(payment?.overtime_hours ?? payment?.overtimeHours ?? 0);
  const dt = Number(payment?.doubletime_hours ?? payment?.doubletimeHours ?? 0);
  const summed = reg + ot + dt;

  const selected = getEffectiveHours(payment);
  const legacyPaystubHours = actual > 0 ? actual : summed > 0 ? summed : 0;
  const comparable = [
    roundHoursForDebug(selected),
    roundHoursForDebug(legacyPaystubHours),
    roundHoursForDebug(actual),
    roundHoursForDebug(summed),
  ];
  const spread = comparable.length > 0 ? Math.max(...comparable) - Math.min(...comparable) : 0;

  return {
    selected_hours: roundHoursForDebug(selected),
    selected_source: effectivePlusGatePhone > 0
      ? 'effective_hours+gate_phone'
      : actual > 0
        ? 'actual_hours'
        : worked > 0
          ? 'worked_hours'
          : summed > 0
            ? 'regular+ot+dt'
            : 'zero',
    effective_plus_gate_phone: roundHoursForDebug(effectivePlusGatePhone),
    actual_hours: roundHoursForDebug(actual),
    worked_hours: roundHoursForDebug(worked),
    regular_ot_dt_sum: roundHoursForDebug(summed),
    legacy_paystub_hours: roundHoursForDebug(legacyPaystubHours),
    spread_hours: roundHoursForDebug(spread),
    has_mismatch: spread > HOURS_MISMATCH_THRESHOLD,
  };
};

async function getAuthedUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (!error && data?.user?.id) return data.user;
  }
  return null;
}

/**
 * GET /api/employee-final-pay?userId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Returns per-event final pay (commission + tips + total pay) for a specific
 * employee within a date range, mirroring the HR Dashboard Payments tab data.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const debugEnabled = searchParams.get('debug') === '1' || searchParams.get('debug') === 'true';

    if (!userId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'userId, startDate, and endDate are required' },
        { status: 400 }
      );
    }

    // Fetch events in the date range (inclusive of the full endDate day).
    const endDatePlusOne = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(endDatePlusOne.getTime())) {
      return NextResponse.json({ error: 'Invalid endDate format' }, { status: 400 });
    }
    endDatePlusOne.setUTCDate(endDatePlusOne.getUTCDate() + 1);
    const endDateExclusive = endDatePlusOne.toISOString().slice(0, 10);

    const { data: events, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id, name, event_date, venue, city, state, commission_pool, tips, ticket_sales, tax_rate_percent')
      .gte('event_date', startDate)
      .lt('event_date', endDateExclusive)
      .order('event_date', { ascending: true });

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ events: [], totals: { commissions: 0, tips: 0, totalPay: 0, finalPay: 0 } });
    }

    const eventIds = events.map((e: any) => e.id);

    // Fetch vendor payment records for this user in those events
    const { data: vendorPayments, error: vpError } = await supabaseAdmin
      .from('event_vendor_payments')
      .select('event_id, effective_hours, actual_hours, worked_hours, regular_hours, regular_pay, overtime_hours, overtime_pay, doubletime_hours, doubletime_pay, commissions, tips, total_pay')
      .eq('user_id', userId)
      .in('event_id', eventIds);

    if (vpError) {
      return NextResponse.json({ error: vpError.message }, { status: 500 });
    }

    // Fetch vendor counts per event (to compute commission = adj_gross / num_vendors)
    const { data: allVendorPayments, error: allVpError } = await supabaseAdmin
      .from('event_vendor_payments')
      .select('event_id, user_id')
      .in('event_id', eventIds);

    if (allVpError) {
      return NextResponse.json({ error: allVpError.message }, { status: 500 });
    }

    const vendorCountByEvent: Record<string, number> = {};
    for (const vp of allVendorPayments || []) {
      vendorCountByEvent[vp.event_id] = (vendorCountByEvent[vp.event_id] || 0) + 1;
    }

    // Fetch event-level payment summaries (for net_sales, commission pool dollars)
    const { data: eventPayments, error: epError } = await supabaseAdmin
      .from('event_payments')
      .select('event_id, net_sales, commission_pool_dollars, commission_pool_percent')
      .in('event_id', eventIds);

    if (epError) {
      return NextResponse.json({ error: epError.message }, { status: 500 });
    }

    // Fetch payment adjustments for this user
    const { data: adjustments, error: adjError } = await supabaseAdmin
      .from('payment_adjustments')
      .select('event_id, adjustment_amount, adjustment_type')
      .eq('user_id', userId)
      .in('event_id', eventIds);

    if (adjError) {
      return NextResponse.json({ error: adjError.message }, { status: 500 });
    }

    // Build lookup maps
    const vpByEvent: Record<string, any> = {};
    for (const vp of vendorPayments || []) {
      vpByEvent[vp.event_id] = vp;
    }

    const epByEvent: Record<string, any> = {};
    for (const ep of eventPayments || []) {
      epByEvent[ep.event_id] = ep;
    }

    const adjByEvent: Record<string, any> = {};
    for (const adj of adjustments || []) {
      adjByEvent[adj.event_id] = adj;
    }

    // Build per-event final pay data
    const eventResults = events
      .filter((ev: any) => vpByEvent[ev.id]) // only events where this user has payment data
      .map((ev: any) => {
        const vp = vpByEvent[ev.id] || {};
        const ep = epByEvent[ev.id] || {};
        const adj = adjByEvent[ev.id] || {};
        const actualHours = getEffectiveHours(vp);
        const hoursDebug = getHoursDebugBreakdown(vp);

        if (debugEnabled && hoursDebug.has_mismatch) {
          console.warn('[employee-final-pay][hours-mismatch]', {
            eventId: ev.id,
            userId,
            state: ev.state,
            ...hoursDebug,
          });
        }

        const tips = Number(vp.tips || 0);
        const totalPay = Number(vp.total_pay || 0);
        const adjustmentAmount = Number(adj.adjustment_amount || 0);
        const finalPay = totalPay + adjustmentAmount;

        // Commission = (Adj. Gross * commission_pool%) / # of vendors
        // Use commission_pool_dollars if available; otherwise recalculate using the
        // authoritative rate from events.commission_pool (fraction, e.g. 0.03 for 3%)
        const netSales = Number(ep.net_sales || 0);
        const commissionPoolDollars = Number(ep.commission_pool_dollars || 0);
        const adjGrossPool = commissionPoolDollars > 0
          ? commissionPoolDollars
          : netSales * Number(ev.commission_pool || 0);
        const numVendors = vendorCountByEvent[ev.id] || 1;
        const commissions = numVendors > 0 ? adjGrossPool / numVendors : 0;

        return {
          eventId: ev.id,
          eventName: ev.name,
          eventDate: ev.event_date,
          venue: ev.venue,
          city: ev.city,
          state: ev.state,
          actualHours,
          regularPay: Number(vp.regular_pay || 0),
          overtimePay: Number(vp.overtime_pay || 0),
          doubletimePay: Number(vp.doubletime_pay || 0),
          commissions,
          tips,
          totalPay,
          adjustmentAmount,
          adjustmentType: adj.adjustment_type || null,
          finalPay,
          netSales,
          commissionPoolDollars,
          ...(debugEnabled ? { hours_debug: hoursDebug } : {}),
        };
      });

    const totals = eventResults.reduce(
      (acc: any, ev: any) => ({
        commissions: acc.commissions + ev.commissions,
        tips: acc.tips + ev.tips,
        totalPay: acc.totalPay + ev.totalPay,
        finalPay: acc.finalPay + ev.finalPay,
      }),
      { commissions: 0, tips: 0, totalPay: 0, finalPay: 0 }
    );

    return NextResponse.json({ events: eventResults, totals });
  } catch (err: any) {
    console.error('[employee-final-pay] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
