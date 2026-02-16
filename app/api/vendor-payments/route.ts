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

function getEffectiveHoursFromPaymentRow(row: any): number {
  const actual = Number(row?.actual_hours ?? 0);
  if (actual > 0) return actual;
  const worked = Number(row?.worked_hours ?? 0);
  if (worked > 0) return worked;
  const reg = Number(row?.regular_hours ?? 0);
  const ot = Number(row?.overtime_hours ?? 0);
  const dt = Number(row?.doubletime_hours ?? 0);
  const summed = reg + ot + dt;
  return summed > 0 ? summed : 0;
}

function normalizePaymentHours(row: any) {
  const actual = Number(row?.actual_hours ?? 0);
  if (actual > 0) return row;
  const effective = getEffectiveHoursFromPaymentRow(row);
  if (effective <= 0) return row;
  return {
    ...row,
    actual_hours: effective,
  };
}

function mergePaymentRowsWithFallback(primary: any, fallback: any) {
  if (!fallback) return normalizePaymentHours(primary);

  const primaryHours = getEffectiveHoursFromPaymentRow(primary);
  const fallbackHours = getEffectiveHoursFromPaymentRow(fallback);
  const shouldBackfillHours = primaryHours <= 0 && fallbackHours > 0;

  const merged = {
    ...primary,
    users: primary?.users || fallback?.users || null,
    ...(shouldBackfillHours
      ? {
          actual_hours: Number(fallback?.actual_hours || 0),
          regular_hours: Number(fallback?.regular_hours || 0),
          overtime_hours: Number(fallback?.overtime_hours || 0),
          doubletime_hours: Number(fallback?.doubletime_hours || 0),
        }
      : {}),
  };

  return normalizePaymentHours(merged);
}

function timeToSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (![hh, mm, ss].every((n) => Number.isFinite(n))) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
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
      if (!user || !user.profiles) return normalizePaymentHours(row);
      const prof = Array.isArray(user.profiles) ? user.profiles[0] : user.profiles;
      const newProf: any = { ...prof };
      try { if (newProf.first_name) newProf.first_name = decrypt(newProf.first_name); } catch {}
      try { if (newProf.last_name) newProf.last_name = decrypt(newProf.last_name); } catch {}
      try { if (newProf.phone) newProf.phone = decrypt(newProf.phone); } catch {}
      const newUser = { ...user, profiles: Array.isArray(user.profiles) ? [newProf] : newProf };
      return normalizePaymentHours({ ...row, users: newUser });
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

    // Fetch configured state rates (same source as /api/rates).
    const configuredBaseRatesByState: Record<string, number> = {};
    const { data: stateRatesRows, error: stateRatesError } = await supabaseAdmin
      .from('state_rates')
      .select('state_code, base_rate');
    if (stateRatesError) {
      console.warn('[VENDOR-PAYMENTS] state_rates fetch failed; using defaults', stateRatesError.message);
    } else {
      for (const row of stateRatesRows || []) {
        const stateCode = (row?.state_code || '').toString().toUpperCase().trim();
        const baseRate = Number((row as any)?.base_rate || 0);
        if (stateCode && baseRate > 0) configuredBaseRatesByState[stateCode] = baseRate;
      }
    }
    const getConfiguredBaseRate = (stateCode?: string | null) => {
      const st = (stateCode || '').toString().toUpperCase().trim();
      const configured = Number(configuredBaseRatesByState[st] || 0);
      return configured > 0 ? configured : 0;
    };

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
        .select('id, event_date, state, start_time, end_time, ends_next_day')
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
        const { data: inferredByEventId } = await supabaseAdmin
          .from('time_entries')
          .select('user_id')
          .eq('event_id', eventId);
        vendorIds = Array.from(new Set((inferredByEventId || []).map((r: any) => r.user_id).filter(Boolean)));
      }
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

      // 3) Pull time entries using the same strategy as Event Dashboard Time Sheet:
      // prefer entries linked by event_id, then fall back to date windows.
      const dateStr = (eventRow.event_date || '').toString().split('T')[0];
      const startSec = timeToSeconds((eventRow as any)?.start_time);
      const endSec = timeToSeconds((eventRow as any)?.end_time);
      const endsNextDay =
        Boolean((eventRow as any)?.ends_next_day) ||
        (startSec !== null && endSec !== null && endSec <= startSec);
      const startDate = new Date(`${dateStr}T00:00:00Z`);
      const endDate = new Date(`${dateStr}T23:59:59.999Z`);
      if (endsNextDay) endDate.setUTCDate(endDate.getUTCDate() + 1);
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();

      let entries: any[] = [];
      const { data: byEventId } = await supabaseAdmin
        .from('time_entries')
        .select('user_id, action, timestamp, started_at, event_id')
        .in('user_id', vendorIds)
        .eq('event_id', eventId)
        .order('timestamp', { ascending: true });
      entries = byEventId || [];

      if (endsNextDay || entries.length === 0) {
        const { data: byTimestamp } = await supabaseAdmin
          .from('time_entries')
          .select('id, user_id, action, timestamp, started_at, event_id')
          .in('user_id', vendorIds)
          .gte('timestamp', startIso)
          .lte('timestamp', endIso)
          .order('timestamp', { ascending: true });
        const merged: any[] = [];
        const seen = new Set<string>();
        for (const row of [...entries, ...(byTimestamp || [])]) {
          if (row?.event_id && row.event_id !== eventId) continue;
          const key = row?.id ? `id:${row.id}` : `k:${row?.user_id}|${row?.action}|${row?.timestamp || row?.started_at || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(row);
        }
        entries = merged;
      }

      if (entries.length === 0) {
        const { data: byStartedAt } = await supabaseAdmin
          .from('time_entries')
          .select('user_id, action, timestamp, started_at, event_id')
          .in('user_id', vendorIds)
          .gte('started_at', startIso)
          .lte('started_at', endIso)
          .order('started_at', { ascending: true });
        entries = byStartedAt || [];
      }

      // 4) Compute total hours per user by pairing clock_in/out
      const byUser: Record<string, any[]> = {};
      for (const uid of vendorIds) byUser[uid] = [];
      for (const e of entries || []) {
        if (!byUser[e.user_id]) byUser[e.user_id] = [];
        byUser[e.user_id].push(e);
      }

      const totalsHours: Record<string, number> = {};
      for (const uid of vendorIds) {
        const uEntries = [...(byUser[uid] || [])].sort((a, b) => {
          const ta = new Date((a?.timestamp || a?.started_at || '') as any).getTime();
          const tb = new Date((b?.timestamp || b?.started_at || '') as any).getTime();
          if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
          if (!Number.isFinite(ta)) return 1;
          if (!Number.isFinite(tb)) return -1;
          return ta - tb;
        });
        let currentIn: string | null = null;
        let ms = 0;
        for (const row of uEntries) {
          const ts = row?.timestamp || row?.started_at || null;
          if (!ts) continue;
          if (row.action === 'clock_in') {
            if (!currentIn) currentIn = ts as any;
          } else if (row.action === 'clock_out') {
            if (currentIn) {
              const start = new Date(currentIn).getTime();
              const end = new Date(ts as any).getTime();
              const dur = end - start;
              if (dur > 0) ms += dur;
              currentIn = null;
            }
          }
        }
        // Detect meals (explicit or auto from gaps) and deduct from ms
        const mealStarts = uEntries.filter(r => r.action === 'meal_start');
        const mealEndsArr = uEntries.filter(r => r.action === 'meal_end');
        let fMealStart: string | null = null;
        let lMealEnd: string | null = null;
        let sMealStart: string | null = null;
        let sMealEnd: string | null = null;
        if (mealStarts.length > 0) {
          fMealStart = mealStarts[0]?.timestamp || mealStarts[0]?.started_at || null;
          if (mealStarts.length > 1) sMealStart = mealStarts[1]?.timestamp || mealStarts[1]?.started_at || null;
        }
        if (mealEndsArr.length > 0) {
          lMealEnd = mealEndsArr[0]?.timestamp || mealEndsArr[0]?.started_at || null;
          if (mealEndsArr.length > 1) sMealEnd = mealEndsArr[1]?.timestamp || mealEndsArr[1]?.started_at || null;
        }
        // Auto-detect meals from gaps if no explicit meal actions
        if (mealStarts.length === 0 && mealEndsArr.length === 0) {
          const workIntervals: Array<{ start: Date; end: Date }> = [];
          let ci: string | null = null;
          for (const row of uEntries) {
            const ts = row?.timestamp || row?.started_at || null;
            if (!ts) continue;
            if (row.action === 'clock_in') { if (!ci) ci = ts; }
            else if (row.action === 'clock_out' && ci) {
              workIntervals.push({ start: new Date(ci), end: new Date(ts) });
              ci = null;
            }
          }
          if (workIntervals.length >= 2) {
            workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
            const gaps: Array<{ start: Date; end: Date }> = [];
            for (let gi = 0; gi < workIntervals.length - 1 && gaps.length < 2; gi++) {
              const gapMs = workIntervals[gi + 1].start.getTime() - workIntervals[gi].end.getTime();
              if (gapMs > 0) gaps.push({ start: workIntervals[gi].end, end: workIntervals[gi + 1].start });
            }
            if (gaps[0]) { fMealStart = gaps[0].start.toISOString(); lMealEnd = gaps[0].end.toISOString(); }
            if (gaps[1]) { sMealStart = gaps[1].start.toISOString(); sMealEnd = gaps[1].end.toISOString(); }
          }
        }
        if (fMealStart && lMealEnd) {
          const m1 = new Date(lMealEnd).getTime() - new Date(fMealStart).getTime();
          if (m1 > 0) ms = Math.max(ms - m1, 0);
        }
        if (sMealStart && sMealEnd) {
          const m2 = new Date(sMealEnd).getTime() - new Date(sMealStart).getTime();
          if (m2 > 0) ms = Math.max(ms - m2, 0);
        }

        totalsHours[uid] = ms / (1000 * 60 * 60);
      }

      // 5) Determine rates (matches event-dashboard logic)
      const eventState = (eventRow.state || 'CA').toString().toUpperCase().trim();
      const configuredBaseRate = getConfiguredBaseRate(eventState);
      const summaryBaseRate = Number(eventPaymentSummary?.base_rate || 0);
      const baseRate = configuredBaseRate > 0 ? configuredBaseRate : (summaryBaseRate > 0 ? summaryBaseRate : 17.28);

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

    // ── Compute meal deductions per user per event ──
    // Fetch time_entries for meal_start/meal_end + clock_in/clock_out to detect auto-meals
    const allEventIdsForMeals = fetchAllEvents
      ? Array.from(new Set([
          ...(vendorPayments || []).map((vp: any) => vp.event_id),
          ...(eventPayments || []).map((ep: any) => ep.event_id),
          ...(adjustments || []).map((a: any) => a.event_id),
        ].filter(Boolean)))
      : eventIds;

    // mealDeductionHours[eventId][userId] = hours to deduct
    const mealDeductionHours: Record<string, Record<string, number>> = {};

    if (allEventIdsForMeals.length > 0) {
      // Fetch events metadata for date windows
      const { data: eventsForMeals } = await supabaseAdmin
        .from('events')
        .select('id, event_date, start_time, end_time, ends_next_day')
        .in('id', allEventIdsForMeals);

      for (const evt of eventsForMeals || []) {
        const eid = evt.id;
        const dateStr = (evt.event_date || '').toString().split('T')[0];
        if (!dateStr) continue;

        const startSec = timeToSeconds((evt as any)?.start_time);
        const endSec = timeToSeconds((evt as any)?.end_time);
        const endsNextDay = Boolean((evt as any)?.ends_next_day) ||
          (startSec !== null && endSec !== null && endSec <= startSec);
        const startDate = new Date(`${dateStr}T00:00:00Z`);
        const endDate = new Date(`${dateStr}T23:59:59.999Z`);
        if (endsNextDay) endDate.setUTCDate(endDate.getUTCDate() + 1);

        // Fetch time entries for this event (by event_id + by date range)
        const { data: byEventId } = await supabaseAdmin
          .from('time_entries')
          .select('id, user_id, action, timestamp, event_id')
          .eq('event_id', eid)
          .order('timestamp', { ascending: true });

        let entries: any[] = byEventId || [];

        if (endsNextDay || entries.length === 0) {
          const { data: byTs } = await supabaseAdmin
            .from('time_entries')
            .select('id, user_id, action, timestamp, event_id')
            .gte('timestamp', startDate.toISOString())
            .lte('timestamp', endDate.toISOString())
            .order('timestamp', { ascending: true });
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const row of [...entries, ...(byTs || [])]) {
            if (row?.event_id && row.event_id !== eid) continue;
            const key = row?.id ? `id:${row.id}` : `k:${row?.user_id}|${row?.action}|${row?.timestamp || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(row);
          }
          entries = merged;
        }

        // Group by user
        const byUser: Record<string, any[]> = {};
        for (const e of entries) {
          if (!byUser[e.user_id]) byUser[e.user_id] = [];
          byUser[e.user_id].push(e);
        }

        mealDeductionHours[eid] = {};

        for (const [uid, userEntries] of Object.entries(byUser)) {
          const sorted = [...userEntries].sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          const mealStarts = sorted.filter(e => e.action === 'meal_start');
          const mealEnds = sorted.filter(e => e.action === 'meal_end');

          let firstMealStart: string | null = null;
          let lastMealEnd: string | null = null;
          let secondMealStart: string | null = null;
          let secondMealEnd: string | null = null;

          if (mealStarts.length > 0) {
            firstMealStart = mealStarts[0].timestamp;
            if (mealStarts.length > 1) secondMealStart = mealStarts[1].timestamp;
          }
          if (mealEnds.length > 0) {
            lastMealEnd = mealEnds[0].timestamp;
            if (mealEnds.length > 1) secondMealEnd = mealEnds[1].timestamp;
          }

          // Auto-detect meals from gaps if no explicit meal actions
          const hasExplicitMeals = mealStarts.length > 0 || mealEnds.length > 0;
          if (!hasExplicitMeals) {
            const clockEntries = sorted.filter(e => e.action === 'clock_in' || e.action === 'clock_out');
            const workIntervals: Array<{ start: Date; end: Date }> = [];
            let currentIn: string | null = null;
            for (const ce of clockEntries) {
              if (ce.action === 'clock_in') {
                if (!currentIn) currentIn = ce.timestamp;
              } else if (ce.action === 'clock_out' && currentIn) {
                workIntervals.push({ start: new Date(currentIn), end: new Date(ce.timestamp) });
                currentIn = null;
              }
            }
            if (workIntervals.length >= 2) {
              workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
              const gaps: Array<{ start: Date; end: Date }> = [];
              for (let i = 0; i < workIntervals.length - 1 && gaps.length < 2; i++) {
                const gapMs = workIntervals[i + 1].start.getTime() - workIntervals[i].end.getTime();
                if (gapMs > 0) gaps.push({ start: workIntervals[i].end, end: workIntervals[i + 1].start });
              }
              if (gaps[0]) { firstMealStart = gaps[0].start.toISOString(); lastMealEnd = gaps[0].end.toISOString(); }
              if (gaps[1]) { secondMealStart = gaps[1].start.toISOString(); secondMealEnd = gaps[1].end.toISOString(); }
            }
          }

          // Calculate deduction in hours
          let deductMs = 0;
          if (firstMealStart && lastMealEnd) {
            const m1 = new Date(lastMealEnd).getTime() - new Date(firstMealStart).getTime();
            if (m1 > 0) deductMs += m1;
          }
          if (secondMealStart && secondMealEnd) {
            const m2 = new Date(secondMealEnd).getTime() - new Date(secondMealStart).getTime();
            if (m2 > 0) deductMs += m2;
          }
          if (deductMs > 0) {
            mealDeductionHours[eid][uid] = deductMs / (1000 * 60 * 60);
          }
        }
      }
    }
    console.log('[VENDOR-PAYMENTS] meal deductions computed', {
      eventsWithDeductions: Object.keys(mealDeductionHours).filter(k => Object.keys(mealDeductionHours[k]).length > 0).length,
    });

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

      // If persisted rows are missing team members or missing hours, merge fallback rows from time_entries.
      const persistedByUserId = new Set((eventVendorPayments || []).map((vp: any) => vp?.user_id).filter(Boolean));
      const rowsMissingHours = (eventVendorPayments || []).some((vp: any) => getEffectiveHoursFromPaymentRow(vp) <= 0);
      let teamVendorIds: string[] = [];
      if (eventId) {
        const { data: teamRows } = await supabaseAdmin
          .from('event_teams')
          .select('vendor_id')
          .eq('event_id', eventId);
        teamVendorIds = Array.from(new Set((teamRows || []).map((t: any) => t.vendor_id).filter(Boolean)));
      }
      const hasMissingTeamRows = teamVendorIds.some((uid) => !persistedByUserId.has(uid));
      const shouldMergeFallback =
        !eventVendorPayments ||
        eventVendorPayments.length === 0 ||
        rowsMissingHours ||
        hasMissingTeamRows;

      if (shouldMergeFallback) {
        const reason =
          !eventVendorPayments || eventVendorPayments.length === 0
            ? 'no persisted rows'
            : rowsMissingHours
              ? 'persisted rows missing hours'
              : 'persisted rows missing team members';
        console.log('[VENDOR-PAYMENTS] computing fallback rows', { eventId, reason });
        try {
          const fallbackRows = await computeFallbackVendorPayments(eventId, eventPaymentSummary);
          const fallbackByUserId: Record<string, any> = {};
          for (const row of fallbackRows || []) {
            if (!row?.user_id) continue;
            fallbackByUserId[row.user_id] = row;
          }

          const mergedByUserId: Record<string, any> = {};
          for (const row of eventVendorPayments || []) {
            if (!row?.user_id) continue;
            mergedByUserId[row.user_id] = mergePaymentRowsWithFallback(row, fallbackByUserId[row.user_id]);
          }
          for (const row of fallbackRows || []) {
            if (!row?.user_id) continue;
            if (!mergedByUserId[row.user_id]) {
              mergedByUserId[row.user_id] = normalizePaymentHours(row);
            }
          }

          eventVendorPayments = Object.values(mergedByUserId);
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
      const eventMealDeductions = mealDeductionHours[eventId] || {};
      const paymentsWithAdjustments = (eventVendorPayments || []).map((vp: any) => {
        const adjustment = eventAdjustments.find((adj: any) => adj.user_id === vp.user_id);
        const row = normalizePaymentHours({
          ...vp,
          adjustment_amount: adjustment?.adjustment_amount || 0,
          adjustment_note: adjustment?.adjustment_note || '',
        });
        // Deduct meal time from ALL hour fields to match timesheet tab display
        const mealDeduct = eventMealDeductions[row.user_id] || 0;
        if (mealDeduct > 0) {
          if (Number(row.actual_hours || 0) > 0) {
            row.actual_hours = Math.max(Number(row.actual_hours) - mealDeduct, 0);
          }
          if (Number(row.regular_hours || 0) > 0) {
            row.regular_hours = Math.max(Number(row.regular_hours) - mealDeduct, 0);
          }
          if (Number(row.worked_hours || 0) > 0) {
            row.worked_hours = Math.max(Number(row.worked_hours) - mealDeduct, 0);
          }
        }
        return row;
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
