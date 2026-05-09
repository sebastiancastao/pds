import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getMondayOfWeek } from '@/lib/utils';
import { getRegionFallbackCommissionPoolPercent, isSanDiegoRegion } from '@/lib/commission-pool';
import { distributePoolByHoursRule } from '@/lib/payroll-distribution';
import { computePayPeriodCommission, isPeriodRateState } from '@/lib/pay-period-commission';
import { computeSanDiegoHourlyBreakdown, SAN_DIEGO_BASE_RATE } from '@/lib/san-diego-payroll';
import { attachRegionMetadataToEvents } from '@/lib/event-region';

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
const normalizeDivision = (value?: string | null) => (value || '').toString().toLowerCase().trim();
const isTrailersDivision = (value?: string | null) => normalizeDivision(value) === 'trailers';
const isExplicitNonVendorDivision = (value?: string | null) => {
  const division = normalizeDivision(value);
  return division !== '' && division !== 'vendor' && division !== 'both';
};
const normalizeState = (value?: string | null) => (value || '').toString().toUpperCase().trim();
const roundMoney = (value: number): number =>
  Math.round(((Number.isFinite(value) ? value : 0) + Number.EPSILON) * 100) / 100;
const roundHours = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));
const getMinimumLoadedRate = (stateCode?: string | null): number =>
  ['NY', 'WI', 'NV', 'AZ'].includes(normalizeState(stateCode)) ? 25.92 : 28.5;

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

    const { data: rawEvents, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id, name, event_date, venue, city, state, commission_pool, tips, ticket_sales, tax_rate_percent, fees, other_income')
      .gte('event_date', startDate)
      .lt('event_date', endDateExclusive)
      .order('event_date', { ascending: true });

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    if (!rawEvents || rawEvents.length === 0) {
      return NextResponse.json({
        events: [],
        totals: { commissions: 0, commissionPaidTotal: 0, tips: 0, totalPay: 0, finalPay: 0 },
      });
    }

    const events = await attachRegionMetadataToEvents(supabaseAdmin, rawEvents || []);

    const eventIds = events.map((e: any) => e.id);

    // Fetch vendor payment records for this user in those events
    const { data: vendorPayments, error: vpError } = await supabaseAdmin
      .from('event_vendor_payments')
      .select('event_id, effective_hours, actual_hours, worked_hours, regular_hours, regular_pay, overtime_hours, overtime_pay, doubletime_hours, doubletime_pay, commissions, variable_incentive, tips, total_pay')
      .eq('user_id', userId)
      .in('event_id', eventIds);

    if (vpError) {
      return NextResponse.json({ error: vpError.message }, { status: 500 });
    }

    // Fetch all vendor payments in those events so we can distribute pools with the short-shift rule.
    const { data: allVendorPayments, error: allVpError } = await supabaseAdmin
      .from('event_vendor_payments')
      .select(`
        event_id,
        user_id,
        effective_hours,
        actual_hours,
        worked_hours,
        regular_hours,
        overtime_hours,
        doubletime_hours,
        commission_override,
        commission_deleted,
        tips_deleted,
        users:user_id (
          division
        )
      `)
      .in('event_id', eventIds);

    if (allVpError) {
      return NextResponse.json({ error: allVpError.message }, { status: 500 });
    }

    const allVendorPaymentsByEvent: Record<string, any[]> = {};
    for (const vp of allVendorPayments || []) {
      if (!allVendorPaymentsByEvent[vp.event_id]) allVendorPaymentsByEvent[vp.event_id] = [];
      allVendorPaymentsByEvent[vp.event_id].push(vp);
    }

    // Fetch event-level payment summaries (for net_sales, commission pool dollars)
    const { data: eventPayments, error: epError } = await supabaseAdmin
      .from('event_payments')
      .select('event_id, net_sales, commission_pool_dollars, commission_pool_percent, total_tips, base_rate')
      .in('event_id', eventIds);

    if (epError) {
      return NextResponse.json({ error: epError.message }, { status: 500 });
    }

    const { data: stateRates, error: stateRatesError } = await supabaseAdmin
      .from('state_rates')
      .select('state_code, base_rate');

    if (stateRatesError) {
      return NextResponse.json({ error: stateRatesError.message }, { status: 500 });
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

    const { data: eventLinkedReimbursements, error: eventLinkedReimbursementsError } = await supabaseAdmin
      .from('vendor_reimbursement_requests')
      .select('event_id, approved_amount')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .not('event_id', 'is', null)
      .in('event_id', eventIds);

    if (eventLinkedReimbursementsError) {
      return NextResponse.json({ error: eventLinkedReimbursementsError.message }, { status: 500 });
    }

    const { data: standaloneReimbursements, error: standaloneReimbursementsError } = await supabaseAdmin
      .from('vendor_reimbursement_requests')
      .select('id, approved_amount, approved_pay_date, description, purchase_date, created_at')
      .eq('user_id', userId)
      .eq('status', 'approved')
      .is('event_id', null)
      .not('approved_pay_date', 'is', null)
      .gte('approved_pay_date', startDate)
      .lt('approved_pay_date', endDateExclusive)
      .order('approved_pay_date', { ascending: true });

    if (standaloneReimbursementsError) {
      return NextResponse.json({ error: standaloneReimbursementsError.message }, { status: 500 });
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

    const baseRateByState: Record<string, number> = {};
    for (const row of stateRates || []) {
      const stateCode = normalizeState(row?.state_code);
      const baseRate = Number(row?.base_rate || 0);
      if (stateCode && baseRate > 0) baseRateByState[stateCode] = baseRate;
    }

    const sdEventsForUser = (events || []).filter((ev: any) => vpByEvent[ev.id] && isSanDiegoRegion(ev));
    const weeklyPriorHoursByEventId: Record<string, number> = {};
    await Promise.all(
      sdEventsForUser.map(async (ev: any) => {
        const dateStr = (ev?.event_date || '').toString().split('T')[0];
        if (!dateStr) {
          weeklyPriorHoursByEventId[ev.id] = 0;
          return;
        }

        const monday = getMondayOfWeek(dateStr);
        if (monday === dateStr) {
          weeklyPriorHoursByEventId[ev.id] = 0;
          return;
        }

        const startIso = new Date(`${monday}T00:00:00Z`).toISOString();
        const endIso = new Date(`${dateStr}T00:00:00Z`).toISOString();
        const { data: entries } = await supabaseAdmin
          .from('time_entries')
          .select('action, timestamp')
          .eq('user_id', userId)
          .gte('timestamp', startIso)
          .lt('timestamp', endIso)
          .in('action', ['clock_in', 'clock_out'])
          .order('timestamp', { ascending: true });

        let currentClockIn: string | null = null;
        let totalMs = 0;
        for (const entry of entries || []) {
          if (entry.action === 'clock_in') {
            if (!currentClockIn) currentClockIn = entry.timestamp;
            continue;
          }

          if (entry.action === 'clock_out' && currentClockIn) {
            const durationMs = new Date(entry.timestamp).getTime() - new Date(currentClockIn).getTime();
            if (durationMs > 0) totalMs += durationMs;
            currentClockIn = null;
          }
        }

        weeklyPriorHoursByEventId[ev.id] = totalMs / (1000 * 60 * 60);
      })
    );

    const distributionByEvent: Record<string, {
      commissionPoolDollars: number;
      commissionSharesByUser: Record<string, number>;
      tipsSharesByUser: Record<string, number>;
    }> = {};
    for (const ev of events || []) {
      const isEventSD = isSanDiegoRegion(ev);
      const eventRows = allVendorPaymentsByEvent[ev.id] || [];
      const ep = epByEvent[ev.id] || {};
      const ticketSales = Number(ev.ticket_sales || 0);
      const eventTips = Number(ev.tips || 0);
      const eventFees = Number(ev.fees || 0);
      const eventOtherIncome = Number(ev.other_income || 0);
      const taxRate = Number(ev.tax_rate_percent || 0);
      const totalSales = Math.max(ticketSales - eventTips, 0);
      const tax = totalSales * (taxRate / 100);
      const netSales = Number(ep.net_sales || 0) || Math.max(totalSales - tax - eventFees + eventOtherIncome, 0);
      const savedPercent = Number(ep.commission_pool_percent || 0);
      const configuredPercent = Number(ev.commission_pool || 0);
      const fallbackPercent = Number(getRegionFallbackCommissionPoolPercent(ev) || 0);
      const resolvedCommissionPoolPercent =
        isEventSD ? 0 :
        (Number.isFinite(savedPercent) && savedPercent > 0 ? savedPercent : 0) ||
        (Number.isFinite(configuredPercent) && configuredPercent > 0 ? configuredPercent : 0) ||
        (Number.isFinite(fallbackPercent) && fallbackPercent > 0 ? fallbackPercent : 0);
      const commissionPoolDollars = isEventSD
        ? 0
        : Number(ep.commission_pool_dollars || 0) > 0
        ? Number(ep.commission_pool_dollars || 0)
        : netSales * resolvedCommissionPoolPercent;
      const totalTipsEvent = Number(ep.total_tips || 0) || Number(ev.tips || 0);
      const commissionEligibleMembers = isEventSD ? [] : eventRows.flatMap((row: any) => {
        const paymentUserId = (row.user_id || '').toString();
        const actualHours = roundHours(getEffectiveHours(row));
        if (
          !paymentUserId ||
          isExplicitNonVendorDivision(row?.users?.division) ||
          isTrailersDivision(row?.users?.division) ||
          row?.commission_deleted === true ||
          actualHours <= 0
        ) {
          return [];
        }
        return [{ id: paymentUserId, hours: actualHours }];
      });
      const tipsEligibleMembers = eventRows.flatMap((row: any) => {
        const paymentUserId = (row.user_id || '').toString();
        const actualHours = roundHours(getEffectiveHours(row));
        if (
          !paymentUserId ||
          isTrailersDivision(row?.users?.division) ||
          row?.tips_deleted === true ||
          actualHours <= 0
        ) {
          return [];
        }
        return [{ id: paymentUserId, hours: actualHours }];
      });
      distributionByEvent[ev.id] = {
        commissionPoolDollars,
        commissionSharesByUser: distributePoolByHoursRule({
          totalAmount: commissionPoolDollars,
          members: commissionEligibleMembers,
          allShortShiftMode: 'equal',
        }).amountsById,
        tipsSharesByUser: distributePoolByHoursRule({
          totalAmount: totalTipsEvent,
          members: tipsEligibleMembers,
          allShortShiftMode: 'equal',
        }).amountsById,
      };
    }

    const adjByEvent: Record<string, any> = {};
    for (const adj of adjustments || []) {
      adjByEvent[adj.event_id] = adj;
    }

    const reimbursementsByEvent: Record<string, number> = {};
    for (const reimbursement of eventLinkedReimbursements || []) {
      if (!reimbursement?.event_id) continue;
      reimbursementsByEvent[reimbursement.event_id] =
        Number(reimbursementsByEvent[reimbursement.event_id] || 0) +
        Number(reimbursement.approved_amount || 0);
    }

    const payPeriodCommission = computePayPeriodCommission({
      events: (events || []).map((ev: any) => ({
        eventId: (ev?.id || '').toString(),
        state: ev?.state,
        commissionPoolDollars: Number(distributionByEvent[ev.id]?.commissionPoolDollars || 0),
        workers: (allVendorPaymentsByEvent[ev.id] || []).map((row: any) => ({
          userId: (row?.user_id || '').toString(),
          division: row?.users?.division,
          hours: roundHours(getEffectiveHours(row)),
          commissionDeleted: row?.commission_deleted === true,
          commissionOverride:
            row?.commission_override != null && Number.isFinite(Number(row.commission_override))
              ? Number(row.commission_override)
              : null,
        })),
      })),
    });

    const fallbackBaseRates: Record<string, number> = { CA: 17.28, NY: 17.0, AZ: 14.7, WI: 15.0 };

    // Build per-event final pay data
    const eventResults = events
      .filter((ev: any) => vpByEvent[ev.id]) // only events where this user has payment data
      .map((ev: any) => {
        const vp = vpByEvent[ev.id] || {};
        const ep = epByEvent[ev.id] || {};
        const adj = adjByEvent[ev.id] || {};
        const isEventSD = isSanDiegoRegion(ev);
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

        const storedTips = Number(vp.tips || 0);
        const adjustmentAmount = Number(adj.adjustment_amount || 0);
        const reimbursementAmount = Number(reimbursementsByEvent[ev.id] || 0);
        const netSales = Number(ep.net_sales || 0);
        const commissionPoolDollars = isEventSD
          ? 0
          : Number(ep.commission_pool_dollars || distributionByEvent[ev.id]?.commissionPoolDollars || 0);
        const distributedCommission = isEventSD ? 0 : Number(distributionByEvent[ev.id]?.commissionSharesByUser?.[userId] || 0);
        const distributedTips = Number(distributionByEvent[ev.id]?.tipsSharesByUser?.[userId] || 0);
        const resolvedTips = distributedTips > 0 ? distributedTips : storedTips;
        const usesPeriodRate = isPeriodRateState(ev.state);
        const periodWorker = payPeriodCommission.byEvent?.[ev.id]?.[userId];
        const eventState = normalizeState(ev.state);
        const baseRate = isEventSD
          ? SAN_DIEGO_BASE_RATE
          : Number(ep.base_rate || 0) ||
            Number(baseRateByState[eventState] || 0) ||
            fallbackBaseRates[eventState] ||
            17.28;
        const persistedCommissionPaidTotal =
          Number(vp.regular_pay || 0) +
          Number(vp.overtime_pay || 0) +
          Number(vp.doubletime_pay || 0) +
          Number(vp.commissions || 0);
        const sanDiegoHourlyBreakdown = isEventSD
          ? computeSanDiegoHourlyBreakdown(
              actualHours,
              baseRate,
              Number(weeklyPriorHoursByEventId[ev.id] || 0)
            )
          : null;
        const commissionPay = roundMoney(
          isEventSD
            ? 0
            : usesPeriodRate
              ? Number(periodWorker?.commissionPay || 0)
              : distributedCommission
        );
        const commissionPaidTotal = roundMoney(
          isEventSD
            ? Number(sanDiegoHourlyBreakdown?.totalPay || 0)
            : usesPeriodRate
              ? Number(periodWorker?.commissionPaidTotal || 0)
              : persistedCommissionPaidTotal
        );
        const variableIncentive = roundMoney(
          isEventSD
            ? 0
            : usesPeriodRate
              ? Number(periodWorker?.variableIncentive || 0)
              : Math.max(0, commissionPaidTotal - commissionPay)
        );
        const loadedRate = roundMoney(
          isEventSD
            ? Number(sanDiegoHourlyBreakdown?.blendedRate || baseRate)
            : actualHours > 0
              ? Math.max(
                  getMinimumLoadedRate(eventState),
                  (commissionPaidTotal + adjustmentAmount) / actualHours
                )
              : 0
        );
        const rateInEffect = roundMoney(
          isEventSD
            ? Number(sanDiegoHourlyBreakdown?.blendedRate || baseRate)
            : usesPeriodRate
              ? Number(periodWorker?.rowRateInEffect || 0)
              : loadedRate
        );
        const commissions = isEventSD ? 0 : commissionPay;
        const regularPay = isEventSD
          ? Number(sanDiegoHourlyBreakdown?.regularPay || 0)
          : Number(vp.regular_pay || 0);
        const overtimePay = isEventSD
          ? Number(sanDiegoHourlyBreakdown?.overtimePay || 0)
          : Number(vp.overtime_pay || 0);
        const doubletimePay = isEventSD
          ? Number(sanDiegoHourlyBreakdown?.doubletimePay || 0)
          : Number(vp.doubletime_pay || 0);
        const totalPay = roundMoney(
          isEventSD
            ? commissionPaidTotal + resolvedTips
            : Number(vp.total_pay || 0)
        );
        const finalPay = totalPay + adjustmentAmount + reimbursementAmount;

        return {
          eventId: ev.id,
          eventName: ev.name,
          eventDate: ev.event_date,
          venue: ev.venue,
          city: ev.city,
          state: ev.state,
          usesPeriodRate,
          actualHours,
          regularPay,
          overtimePay,
          doubletimePay,
          commissions,
          commissionPay,
          rateInEffect,
          variableIncentive,
          commissionPaidTotal,
          tips: resolvedTips,
          totalPay,
          adjustmentAmount,
          reimbursementAmount,
          adjustmentType: adj.adjustment_type || null,
          finalPay,
          netSales,
          commissionPoolDollars,
          ...(debugEnabled ? { hours_debug: hoursDebug } : {}),
        };
      });

    const normalizedEventResults = (() => {
      const payPeriodRows = eventResults.filter(
        (ev: any) => ev.usesPeriodRate === true && Number(ev.actualHours || 0) > 0
      );
      const payPeriodTotals = payPeriodRows.reduce(
        (acc: any, ev: any) => ({
          commission: acc.commission + Number(ev.commissionPay || 0),
          hoursWorked: acc.hoursWorked + Number(ev.actualHours || 0),
        }),
        { commission: 0, hoursWorked: 0 }
      );
      const payPeriodRateInEffect =
        payPeriodTotals.hoursWorked > 0
          ? roundMoney(payPeriodTotals.commission / payPeriodTotals.hoursWorked)
          : 0;

      const normalizedRows = eventResults.map((ev: any) => {
        if (ev.usesPeriodRate !== true || Number(ev.actualHours || 0) <= 0) {
          return ev;
        }

        const minimumRateInEffect = getMinimumLoadedRate(ev.state);
        const variableIncentive = roundMoney(
          Math.max(0, minimumRateInEffect - payPeriodRateInEffect) * Number(ev.actualHours || 0)
        );
        const commissionPaidTotal = roundMoney(Number(ev.commissionPay || 0) + variableIncentive);
        const restPay = roundMoney(
          Math.max(0, Number(ev.totalPay || 0) - Number(ev.commissionPaidTotal || 0) - Number(ev.tips || 0))
        );
        const totalPay = roundMoney(commissionPaidTotal + Number(ev.tips || 0) + restPay);
        const finalPay = roundMoney(
          totalPay + Number(ev.adjustmentAmount || 0) + Number(ev.reimbursementAmount || 0)
        );

        return {
          ...ev,
          variableIncentive,
          commissionPaidTotal,
          totalPay,
          finalPay,
        };
      });

      if (debugEnabled) {
        console.log('[employee-final-pay][debug] period-rate normalization', {
          userId,
          rowCount: payPeriodRows.length,
          totalCommission: roundMoney(payPeriodTotals.commission),
          totalHoursWorked: roundHours(payPeriodTotals.hoursWorked),
          payPeriodRateInEffect,
        });
      }

      return normalizedRows;
    })();

    const standaloneResults = (standaloneReimbursements || []).map((row: any) => ({
      id: row.id,
      approvedAmount: Number(row.approved_amount || 0),
      approvedPayDate: row.approved_pay_date,
      description: row.description || '',
      purchaseDate: row.purchase_date,
      createdAt: row.created_at,
    }));

    const standaloneTotal = standaloneResults.reduce(
      (sum: number, reimbursement: any) => sum + Number(reimbursement.approvedAmount || 0),
      0
    );

    const totals = normalizedEventResults.reduce(
      (acc: any, ev: any) => ({
        commissions: acc.commissions + ev.commissions,
        commissionPaidTotal: acc.commissionPaidTotal + ev.commissionPaidTotal,
        tips: acc.tips + ev.tips,
        totalPay: acc.totalPay + ev.totalPay,
        reimbursements: acc.reimbursements + ev.reimbursementAmount,
        finalPay: acc.finalPay + ev.finalPay,
      }),
      { commissions: 0, commissionPaidTotal: 0, tips: 0, totalPay: 0, reimbursements: 0, finalPay: 0 }
    );

    totals.reimbursements += standaloneTotal;
    totals.finalPay += standaloneTotal;

    return NextResponse.json({
      events: normalizedEventResults,
      standaloneReimbursements: standaloneResults,
      totals,
    });
  } catch (err: any) {
    console.error('[employee-final-pay] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
