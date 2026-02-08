import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { decrypt } from '@/lib/encryption';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const eventIdsParam = searchParams.get('event_ids');
    const fetchAllEvents = !eventIdsParam;
    const eventIds = eventIdsParam ? eventIdsParam.split(',').filter(Boolean) : [];

    console.log('[VENDOR-PAYMENTS] start', {
      fetchAllEvents,
      requestedEventCount: eventIds.length,
      requestedEventIds: eventIds,
    });

    // Fetch vendor payments
    let vendorQuery = supabaseAdmin
      .from('event_vendor_payments')
      .select(`
        *,
        users:user_id (
          id,
          email,
          division,
          profiles (
            first_name,
            last_name,
            phone
          )
        )
      `);
    if (!fetchAllEvents) vendorQuery = vendorQuery.in('event_id', eventIds);
    const { data: vendorPayments, error: paymentsError } = await vendorQuery;
    if (paymentsError) return NextResponse.json({ error: paymentsError.message }, { status: 500 });

    // Decrypt profile names
    const vendorPaymentsDecrypted = (vendorPayments || []).map((row: any) => {
      const user = row?.users;
      if (!user || !user.profiles) return row;
      const prof = Array.isArray(user.profiles) ? user.profiles[0] : user.profiles;
      const newProf: any = { ...prof };
      try { if (newProf.first_name) newProf.first_name = decrypt(newProf.first_name); } catch {}
      try { if (newProf.last_name) newProf.last_name = decrypt(newProf.last_name); } catch {}
      try { if (newProf.phone) newProf.phone = decrypt(newProf.phone); } catch {}
      const newUser = { ...user, profiles: Array.isArray(user.profiles) ? [newProf] : newProf };
      return { ...row, users: newUser };
    });

    console.log('[VENDOR-PAYMENTS] vendorPayments fetched', {
      count: vendorPaymentsDecrypted?.length || 0,
      sample: (vendorPaymentsDecrypted || []).slice(0, 2).map((r: any) => ({ event_id: r.event_id, user_id: r.user_id })),
    });

    // Fetch event payment summaries
    let eventPaymentsQuery = supabaseAdmin.from('event_payments').select('*');
    if (!fetchAllEvents) eventPaymentsQuery = eventPaymentsQuery.in('event_id', eventIds);
    const { data: eventPayments, error: eventPaymentsError } = await eventPaymentsQuery;
    if (eventPaymentsError) return NextResponse.json({ error: eventPaymentsError.message }, { status: 500 });

    console.log('[VENDOR-PAYMENTS] eventPayments fetched', {
      count: eventPayments?.length || 0,
      sample: (eventPayments || []).slice(0, 2).map((r: any) => ({ event_id: r.event_id, base_rate: r.base_rate })),
    });

    // Fetch payment adjustments
    let adjustmentsQuery = supabaseAdmin.from('payment_adjustments').select('*');
    if (!fetchAllEvents) adjustmentsQuery = adjustmentsQuery.in('event_id', eventIds);
    const { data: adjustments, error: adjustmentsError } = await adjustmentsQuery as any;
    if (adjustmentsError) return NextResponse.json({ error: adjustmentsError.message }, { status: 500 });

    console.log('[VENDOR-PAYMENTS] adjustments fetched', {
      count: adjustments?.length || 0,
      sample: (adjustments || []).slice(0, 2).map((r: any) => ({ event_id: r.event_id, user_id: r.user_id, amount: r.adjustment_amount })),
    });

    // Helper: compute fallback vendor payments from team + time entries if table empty
    async function computeFallbackVendorPayments(eventId: string, eventPaymentSummary: any) {
      // 1) Load event for date/state
      const { data: eventRow } = await supabaseAdmin
        .from('events')
        .select('id, event_date, state')
        .eq('id', eventId)
        .maybeSingle();
      if (!eventRow) return [] as any[];

      // 2) Team (confirmed)
      // Try with any status first (some teams may not be confirmed yet)
      const { data: teamAny } = await supabaseAdmin
        .from('event_teams')
        .select('vendor_id,status')
        .eq('event_id', eventId);
      let vendorIds = Array.from(new Set((teamAny || []).map((t: any) => t.vendor_id).filter(Boolean)));
      console.log('[VENDOR-PAYMENTS][fallback] team members (any status)', { count: vendorIds.length, statuses: Array.from(new Set((teamAny||[]).map((t:any)=>t.status))) });

      // If still empty, infer from time entries on that date (last resort)
      if (vendorIds.length === 0) {
        const dateStr0 = (eventRow.event_date || '').toString().split('T')[0];
        const start0 = new Date(`${dateStr0}T00:00:00Z`).toISOString();
        const end0 = new Date(`${dateStr0}T23:59:59.999Z`).toISOString();
        const { data: inferredEntries } = await supabaseAdmin
          .from('time_entries')
          .select('user_id')
          .gte('timestamp', start0)
          .lte('timestamp', end0);
        vendorIds = Array.from(new Set((inferredEntries || []).map((r: any) => r.user_id).filter(Boolean)));
        console.log('[VENDOR-PAYMENTS][fallback] inferred vendorIds from time_entries', { count: vendorIds.length });
      }
      if (vendorIds.length === 0) return [] as any[];

      // 3) Pull time entries for full event day (UTC day window)
      const dateStr = (eventRow.event_date || '').toString().split('T')[0];
      const startIso = new Date(`${dateStr}T00:00:00Z`).toISOString();
      const endIso = new Date(`${dateStr}T23:59:59.999Z`).toISOString();
      const { data: entries } = await supabaseAdmin
        .from('time_entries')
        .select('user_id, action, timestamp')
        .in('user_id', vendorIds)
        .gte('timestamp', startIso)
        .lte('timestamp', endIso)
        .order('timestamp', { ascending: true });

      // 4) Compute total hours per user by pairing clock_in/out
      const byUser: Record<string, any[]> = {};
      for (const uid of vendorIds) byUser[uid] = [];
      for (const e of entries || []) {
        if (!byUser[e.user_id]) byUser[e.user_id] = [];
        byUser[e.user_id].push(e);
      }

      const totalsHours: Record<string, number> = {};
      for (const uid of vendorIds) {
        const uEntries = byUser[uid] || [];
        let currentIn: string | null = null;
        let ms = 0;
        for (const row of uEntries) {
          if (row.action === 'clock_in') {
            if (!currentIn) currentIn = row.timestamp as any;
          } else if (row.action === 'clock_out') {
            if (currentIn) {
              const start = new Date(currentIn).getTime();
              const end = new Date(row.timestamp as any).getTime();
              const dur = end - start;
              if (dur > 0) ms += dur;
              currentIn = null;
            }
          }
        }
        totalsHours[uid] = ms / (1000 * 60 * 60);
      }

      // 5) Determine rates (matches event-dashboard logic)
      const stateRates: Record<string, number> = { CA: 17.28, NY: 17.0, AZ: 14.7, WI: 15.0 };
      const eventState = (eventRow.state || 'CA').toString().toUpperCase().trim();
      const baseRate = Number(eventPaymentSummary?.base_rate || stateRates[eventState] || 17.28);

      // 6) Commissions/Tips pool to distribute (if summary exists)
      const totalTips = Number(eventPaymentSummary?.total_tips || 0);
      const commissionPool = (Number(eventPaymentSummary?.net_sales || 0) * Number(eventPaymentSummary?.commission_pool_percent || 0))
        || Number(eventPaymentSummary?.commission_pool_dollars || 0)
        || Number(eventPaymentSummary?.total_commissions || 0) || 0;

      // 7) Load user division data upfront for commission/tips logic
      const { data: usersForDivision } = await supabaseAdmin
        .from('users')
        .select('id, division')
        .in('id', vendorIds);
      const divisionById: Record<string, string> = {};
      (usersForDivision || []).forEach((u: any) => { divisionById[u.id] = (u.division || '').toString().toLowerCase().trim(); });

      // Count vendor-division members (exclude trailers) — matches event-dashboard vendorCount
      const vendorCountEligible = vendorIds.reduce((count, uid) => {
        const div = divisionById[uid] || '';
        return (div === 'vendor' || div === 'both') ? count + 1 : count;
      }, 0);
      const vendorCountForCommission = vendorCountEligible > 0 ? vendorCountEligible : vendorIds.length;

      // Equal split of commission pool among eligible vendors (same as event-dashboard)
      const perVendorCommissionShare = vendorCountForCommission > 0 ? commissionPool / vendorCountForCommission : 0;

      // Total eligible hours for tips proration (exclude trailers)
      const totalEligibleHours = vendorIds.reduce((sum, uid) => {
        const div = divisionById[uid] || '';
        if (div === 'trailers') return sum;
        return sum + Number(totalsHours[uid] || 0);
      }, 0);

      // Rest break helper (matches event-dashboard)
      const getRestBreak = (hours: number, st: string) => {
        if (st === 'NV' || st === 'WI' || st === 'AZ' || st === 'NY') return 0;
        if (hours <= 0) return 0;
        return hours >= 10 ? 12 : 9;
      };

      // 8) AZ/NY has different commission logic
      const isAZorNY = eventState === 'AZ' || eventState === 'NY';

      // 10) Build per-user vendor payment rows (matches event-dashboard logic exactly)
      const rows: any[] = [];
      for (const uid of vendorIds) {
        const hours = Number(totalsHours[uid] || 0);
        const memberDivision = divisionById[uid] || '';
        const isTrailers = memberDivision === 'trailers';


        // Ext Amt on Reg Rate: AZ/NY = baseRate * hours (never 1.5x); others = baseRate * 1.5 * hours
        const extAmtOnRegRate = isAZorNY
          ? hours * baseRate
          : hours * baseRate * 1.5;

        // Commission: AZ/NY = pool / vendors; others subtract Ext Amt
        let commissions;
        if (isAZorNY) {
          commissions = !isTrailers && vendorCountForCommission > 0 && hours > 0
            ? perVendorCommissionShare
            : 0;
        } else {
          commissions = !isTrailers && vendorCountForCommission > 0
            ? Math.max(0, perVendorCommissionShare - extAmtOnRegRate)
            : 0;
        }
        // Rule (non-AZ/NY only): if Commission Amt < Ext Amt on Reg Rate, Commission Amt = 0
        if (!isAZorNY && commissions > 0 && commissions < extAmtOnRegRate) commissions = 0;

        // Total Final Commission = Ext Amt + Commission; minimum $150
        const totalFinalCommission = hours > 0
          ? Math.max(150, extAmtOnRegRate + commissions)
          : 0;

        // Tips prorated by hours, excluding trailers (same as event-dashboard)
        const tips = !isTrailers && totalEligibleHours > 0
          ? (totalTips * hours) / totalEligibleHours
          : 0;

        const restBreak = getRestBreak(hours, eventState);
        const totalPay = totalFinalCommission + tips + restBreak;

        rows.push({
          event_id: eventId,
          user_id: uid,
          actual_hours: hours,
          regular_hours: hours,
          overtime_hours: 0,
          doubletime_hours: 0,
          regular_pay: extAmtOnRegRate,
          overtime_pay: 0,
          doubletime_pay: 0,
          commissions,
          tips,
          total_pay: totalPay,
        });
      }

      // 8) Attach user data for name/email to mimic join
      if (rows.length > 0) {
        const { data: users } = await supabaseAdmin
          .from('users')
          .select('id, email, division, profiles ( first_name, last_name, phone )')
          .in('id', vendorIds);
        const byId: Record<string, any> = {};
        (users || []).forEach(u => {
          // Decrypt names for fallback path as well
          const prof = u?.profiles;
          if (prof) {
            const newProf: any = { ...prof };
            try { if (newProf.first_name) newProf.first_name = decrypt(newProf.first_name); } catch {}
            try { if (newProf.last_name) newProf.last_name = decrypt(newProf.last_name); } catch {}
            try { if (newProf.phone) newProf.phone = decrypt(newProf.phone); } catch {}
            byId[u.id] = { ...u, profiles: newProf };
          } else {
            byId[u.id] = u;
          }
        });
        rows.forEach(r => { r.users = byId[r.user_id] || null; });
      }

      return rows;
    }

    // Group by event_id and merge adjustments
    const paymentsByEvent: Record<string, any> = {};
    const eventIdsToGroup = fetchAllEvents
      ? Array.from(new Set([
          ...(vendorPayments || []).map((vp: any) => vp.event_id),
          ...(eventPayments || []).map((ep: any) => ep.event_id),
          ...(adjustments || []).map((a: any) => a.event_id),
        ].filter(Boolean)))
      : eventIds;

    console.log('[VENDOR-PAYMENTS] grouping events', {
      eventIds: eventIdsToGroup,
      totalToGroup: eventIdsToGroup.length,
    });

    // Fetch basic event metadata for display purposes
    const { data: eventsMeta, error: eventsMetaError } = await supabaseAdmin
      .from('events')
      .select('id, event_name, event_date, venue, city, state')
      .in('id', eventIdsToGroup);
    if (eventsMetaError) {
      console.log('[VENDOR-PAYMENTS] eventsMeta error', eventsMetaError.message);
    }
    const eventsMetaById: Record<string, any> = {};
    (eventsMeta || []).forEach((e: any) => { eventsMetaById[e.id] = e; });

    for (const eventId of eventIdsToGroup) {
      const eventPaymentSummary = (eventPayments || []).find((ep: any) => ep.event_id === eventId) || null;
      let eventVendorPayments = (vendorPaymentsDecrypted || []).filter((vp: any) => vp.event_id === eventId);

      // Fallback: synthesize from time entries if none persisted
      if (!eventVendorPayments || eventVendorPayments.length === 0) {
        console.log('[VENDOR-PAYMENTS] no persisted vendor payments; computing fallback', { eventId });
        try {
          eventVendorPayments = await computeFallbackVendorPayments(eventId, eventPaymentSummary);
          console.log('[VENDOR-PAYMENTS] fallback computed', {
            eventId,
            count: eventVendorPayments?.length || 0,
            sample: (eventVendorPayments || []).slice(0, 2).map((r: any) => ({ user_id: r.user_id, hours: r.actual_hours, total: r.total_pay })),
          });
        } catch {
          eventVendorPayments = [];
        }
      }

      const eventAdjustments = (adjustments || []).filter((adj: any) => adj.event_id === eventId);
      const paymentsWithAdjustments = (eventVendorPayments || []).map((vp: any) => {
        const adjustment = eventAdjustments.find((adj: any) => adj.user_id === vp.user_id);
        return {
          ...vp,
          adjustment_amount: adjustment?.adjustment_amount || 0,
          adjustment_note: adjustment?.adjustment_note || '',
        };
      });

      const adjustedCount = paymentsWithAdjustments.filter((p: any) => Number(p.adjustment_amount || 0) !== 0).length;
      console.log('[VENDOR-PAYMENTS] event assembled', {
        eventId,
        vendorPayments: paymentsWithAdjustments.length,
        adjustmentsApplied: adjustedCount,
        hasEventSummary: !!eventPaymentSummary,
      });
      paymentsByEvent[eventId] = {
        vendorPayments: paymentsWithAdjustments,
        eventPayment: eventPaymentSummary,
        eventInfo: eventsMetaById[eventId] || null,
      };
    }

    console.log('[VENDOR-PAYMENTS] done', {
      events: Object.keys(paymentsByEvent).length,
      totals: {
        totalVendorPayments: vendorPayments?.length || 0,
        totalEventPayments: eventPayments?.length || 0,
        totalAdjustments: adjustments?.length || 0,
      }
    });

    return NextResponse.json({
      success: true,
      paymentsByEvent,
      totalVendorPayments: vendorPayments?.length || 0,
      totalEventPayments: eventPayments?.length || 0,
      totalAdjustments: adjustments?.length || 0,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
