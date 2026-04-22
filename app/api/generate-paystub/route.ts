import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { getMondayOfWeek } from "@/lib/utils";
import { calculateDistanceMiles } from "@/lib/geocoding";
import { distributePoolByHoursRule } from "@/lib/payroll-distribution";
import { safeDecrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const CARRY_OVER_OVERRIDE_REASON_MARKER = "HR_CARRY_OVER_OVERRIDE";
const YEAR_TO_DATE_OVERRIDE_REASON_MARKER = "HR_YEAR_TO_DATE_OVERRIDE";

interface EventEarning {
  date: string;
  eventName: string;
  regularRate: number;
  regularHours: number;
  overtimeRate: number;
  overtimeHours: number;
  doubletimeRate: number;
  doubletimeHours: number;
  tips: number;
  commission: number;
  total: number;
}

interface SickLeaveSummary {
  total_hours: number;
  total_days: number;
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  carry_over_hours: number;
  carry_over_days: number;
  year_to_date_hours?: number;
  year_to_date_days?: number;
  balance_hours: number;
  balance_days: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      // Employee info
      employeeName,
      ssn,
      address,
      employeeId,

      // Pay period
      payPeriodStart,
      payPeriodEnd,
      payDate,

      // Deductions
      federalIncome,
      socialSecurity,
      medicare,
      stateIncome,
      stateDI,
      state,

      // Other
      miscDeduction,
      miscReimbursement,
      mealPremium = 0,
      sick = 0,

      // Events data
      events = []
      ,
      sickLeave = null,
      matchedUserId = null,
      debug = false
    } = body;

    const normalizeState = (s?: string | null) => (s || "").toString().toUpperCase().trim();
    const normalizeStateCode = (s?: string | null) => {
      const st = normalizeState(s);
      const map: Record<string, string> = {
        CALIFORNIA: "CA",
        NEVADA: "NV",
        WISCONSIN: "WI",
        "NEW YORK": "NY",
        ARIZONA: "AZ",
      };
      return map[st] || st;
    };
    const toFiniteNumber = (value: unknown): number | null => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const toPlainText = (value: unknown) => (value ?? "").toString().trim();
    const decryptText = (value: unknown) => {
      const raw = toPlainText(value);
      return raw ? safeDecrypt(raw).trim() : "";
    };
    const buildProfileAddress = (profile: any) => {
      const street = decryptText(profile?.address);
      const city = decryptText(profile?.city);
      const decryptedState = decryptText(profile?.state);
      const stateCode = normalizeStateCode(decryptedState) || decryptedState;
      const zipCode = decryptText(profile?.zip_code);
      const locality = [
        city,
        [stateCode, zipCode].filter(Boolean).join(" "),
      ].filter(Boolean).join(", ");
      return [street, locality].filter(Boolean).join(", ");
    };

    // Source of truth: employee profile state (fallback to request payload state).
    let paystubState = normalizeStateCode(state) || "CA";
    let displayAddress = decryptText(address);
    const sickLeaveSummary =
      sickLeave && typeof sickLeave === "object"
        ? (sickLeave as Partial<SickLeaveSummary>)
        : null;
    let profileSickCarryOverHours = toFiniteNumber(sickLeaveSummary?.carry_over_hours);
    if (matchedUserId) {
      try {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("state, address, city, zip_code, sick_leave_carry_over_hours")
          .eq("user_id", matchedUserId)
          .maybeSingle();
        const profileState = normalizeStateCode(decryptText((profile as any)?.state));
        if (profileState) paystubState = profileState;
        const savedCarryOverHours = toFiniteNumber((profile as any)?.sick_leave_carry_over_hours);
        if (savedCarryOverHours !== null) {
          profileSickCarryOverHours = savedCarryOverHours;
        }
        if (!displayAddress) {
          const profileAddress = buildProfileAddress(profile);
          if (profileAddress) displayAddress = profileAddress;
        }
      } catch (e) {
        // Non-fatal; keep payload state fallback.
      }
    }

    // Fetch state rates from DB (same source as event-dashboard)
    const dbStateRates: Record<string, number> = {};
    try {
      const { data: stateRatesRows } = await supabaseAdmin
        .from('state_rates')
        .select('state_code, base_rate');
      for (const row of stateRatesRows || []) {
        if (row?.state_code) dbStateRates[row.state_code.toUpperCase()] = Number(row.base_rate);
      }
    } catch (e) {
      // Non-fatal; fallback rates will be used.
    }

    const isCalifornia = paystubState === "CA";
    const hasAzNyEvent = Array.isArray(events) && events.some((e: any) => {
      const st = normalizeState(e?.state);
      return st === "AZ" || st === "NY";
    });
    // AZ/NY mode is primarily driven by employee/paystub state, but fall back to event state if needed.
    const azNyMode = paystubState === "AZ" || paystubState === "NY" || hasAzNyEvent;

    const useVendorLayout =
      paystubState === "CA" ||
      paystubState === "NV" ||
      paystubState === "WI" ||
      paystubState === "AZ" ||
      paystubState === "NY";
    const includeRestBreakColumn = paystubState === "CA";
    const debugEnabled =
      debug === true ||
      debug === "1" ||
      debug === "true";

    const normalizeDivision = (d?: string | null) => (d || "").toString().toLowerCase().trim();
    const isTrailersDivision = (d?: string | null) => normalizeDivision(d) === "trailers";
    const isVendorDivision = (d?: string | null) => {
      const div = normalizeDivision(d);
      return div === "vendor" || div === "both";
    };

    if (debugEnabled) {
      console.log('[GENERATE-PAYSTUB][debug] request', {
        paystubState,
        isCalifornia,
        matchedUserId,
        eventsCount: Array.isArray(events) ? events.length : 0,
      });
    }

    const getRestBreakAmount = (actualHours: number, stateCode: string): number => {
      const st = normalizeState(stateCode);
      if (st === "NV" || st === "WI" || st === "AZ" || st === "NY") return 0;
      if (!Number.isFinite(actualHours) || actualHours <= 0) return 0;
      return actualHours >= 14 ? 17 : actualHours >= 10 ? 12.5 : 9;
    };

    const timesheetHoursByEventUser: Record<string, Record<string, number>> = {};
    const getTimesheetHoursForWorker = (event: any, worker: any): number => {
      const eventId = (event?.id || "").toString();
      const userId = (worker?.user_id || "").toString();
      if (!eventId || !userId) return 0;
      const hours = Number(timesheetHoursByEventUser[eventId]?.[userId] || 0);
      return Number.isFinite(hours) && hours > 0 ? hours : 0;
    };

    // Match /hr-dashboard Payroll tab behavior as closely as possible.
    // That tab uses event_payments (if present) and falls back to events table fields.
    const getPayrollInputsForEvent = (event: any) => {
      const eventPaymentSummary = event?.event_payment || event?.eventPayment || event?.event_payment_summary || null;
      const eventState = normalizeState(event?.state) || paystubState;
      const fallbackRates: Record<string, number> = { CA: 17.28, NY: 17.0, AZ: 14.7, WI: 15.0 };
      const stateBaseRate = dbStateRates[eventState] || fallbackRates[eventState] || 17.28;
      const baseRate = Number(eventPaymentSummary?.base_rate || stateBaseRate);

      const workers = Array.isArray(event?.workers) ? event.workers : [];
      const workersWithHours = workers.filter((w: any) => {
        const workerHours = getActualHoursForWorker(event, w);
        return workerHours > 0;
      });
      const memberCount = workersWithHours.length > 0 ? workersWithHours.length : workers.length;

      // Commission pool in dollars: event_payments first, then compute from events table.
      let commissionPoolDollars =
        Number(eventPaymentSummary?.commission_pool_dollars || 0) ||
        (Number(eventPaymentSummary?.net_sales || 0) * Number(eventPaymentSummary?.commission_pool_percent || 0)) ||
        0;

      if (commissionPoolDollars === 0 && Number(event?.commission_pool || 0) > 0) {
        const ticketSales = Number(event?.ticket_sales || 0);
        const eventTips = Number(event?.tips || 0);
        const eventFees = Number(event?.fees || 0);
        const eventOtherIncome = Number(event?.other_income || 0);
        const taxRate = Number(event?.tax_rate_percent || 0);
        const totalSales = Math.max(ticketSales - eventTips, 0);
        const tax = totalSales * (taxRate / 100);
        const netSales = Number(eventPaymentSummary?.net_sales || 0) || Math.max(totalSales - tax - eventFees + eventOtherIncome, 0);
        commissionPoolDollars = netSales * Number(event?.commission_pool || 0);
      }

      const totalTipsEvent = Number(eventPaymentSummary?.total_tips || 0) || Number(event?.tips || 0);
      const eligibleMembers = workers.flatMap((w: any) => {
        const workerId = (w?.user_id || "").toString();
        const workerHours = getActualHoursForWorker(event, w);
        if (!workerId || isTrailersDivision(w?.division) || workerHours <= 0) return [];
        return [{ id: workerId, hours: workerHours }];
      });
      const commissionDistribution = distributePoolByHoursRule({
        totalAmount: commissionPoolDollars,
        members: eligibleMembers,
      });
      const tipsDistribution = distributePoolByHoursRule({
        totalAmount: totalTipsEvent,
        members: eligibleMembers,
      });
      const commissionEligibleCount =
        commissionDistribution.eligibleCount > 0 ? commissionDistribution.eligibleCount : memberCount;

      return {
        eventState,
        baseRate,
        memberCount,
        commissionEligibleCount,
        commissionPoolDollars,
        workers,
        totalTipsEvent,
        commissionSharesByUser: commissionDistribution.amountsById,
        tipsSharesByUser: tipsDistribution.amountsById,
      };
    };

    // Mirror HR dashboard getEffectiveHours: use effective_hours + 0.5h gate/phone lead when available.
    const GATE_PHONE_OFFSET_HOURS = 0.5;
    const HOURS_MISMATCH_THRESHOLD = 0.01;
    const addGatePhoneLeadHours = (hours: number): number =>
      Number((hours + GATE_PHONE_OFFSET_HOURS).toFixed(6));
    const addLongShiftBonus = (hours: number): number => hours >= 14 ? hours + 4.5 : hours;
    const roundHoursForDebug = (value: number): number =>
      Number((Number.isFinite(value) ? value : 0).toFixed(6));
    const getEffectiveHoursBreakdownFromPayment = (paymentData: any): {
      hours: number;
      source: string;
      effectivePlusGatePhone: number;
      actual: number;
      worked: number;
      summed: number;
    } => {
      if (!paymentData) {
        return {
          hours: 0,
          source: "none",
          effectivePlusGatePhone: 0,
          actual: 0,
          worked: 0,
          summed: 0,
        };
      }

      const effectiveRaw = paymentData?.effective_hours ?? paymentData?.effectiveHours;
      const hasEffective = effectiveRaw != null;
      const effective = hasEffective ? Number(effectiveRaw) : 0;
      const effectivePlusGatePhone =
        hasEffective && Number.isFinite(effective) && effective >= 0
          ? addGatePhoneLeadHours(effective)
          : 0;

      const actual = Number(paymentData?.actual_hours ?? paymentData?.actualHours ?? 0);
      const worked = Number(paymentData?.worked_hours ?? paymentData?.workedHours ?? 0);
      const reg = Number(paymentData?.regular_hours ?? paymentData?.regularHours ?? 0);
      const ot = Number(paymentData?.overtime_hours ?? paymentData?.overtimeHours ?? 0);
      const dt = Number(paymentData?.doubletime_hours ?? paymentData?.doubletimeHours ?? 0);
      const summed = reg + ot + dt;

      if (effectivePlusGatePhone > 0) {
        return { hours: addLongShiftBonus(effectivePlusGatePhone), source: "effective_hours+gate_phone", effectivePlusGatePhone, actual, worked, summed };
      }
      if (actual > 0) {
        return { hours: addLongShiftBonus(actual), source: "actual_hours", effectivePlusGatePhone, actual, worked, summed };
      }
      if (worked > 0) {
        return { hours: addLongShiftBonus(worked), source: "worked_hours", effectivePlusGatePhone, actual, worked, summed };
      }
      if (summed > 0) {
        return { hours: addLongShiftBonus(summed), source: "regular+ot+dt", effectivePlusGatePhone, actual, worked, summed };
      }
      return { hours: 0, source: "zero", effectivePlusGatePhone, actual, worked, summed };
    };
    const getEffectiveHoursFromPayment = (paymentData: any): number =>
      getEffectiveHoursBreakdownFromPayment(paymentData).hours;

    const getActualHoursForWorker = (event: any, worker: any): number => {
      const timesheetHours = getTimesheetHoursForWorker(event, worker);
      if (timesheetHours > 0) return addLongShiftBonus(timesheetHours);

      const paymentData = worker?.payment_data;
      const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);
      const regHours = Number(paymentData?.regular_hours || 0);
      const otHours = Number(paymentData?.overtime_hours || 0);
      const dtHours = Number(paymentData?.doubletime_hours || 0);
      const hoursFromPayment = getEffectiveHoursFromPayment(paymentData);
      return hoursFromPayment > 0
        ? hoursFromPayment
        : workedHoursFromTimeEntries > 0
          ? addLongShiftBonus(workedHoursFromTimeEntries)
          : addLongShiftBonus(regHours + otHours + dtHours);
    };

    const getDisplayHoursForWorker = (event: any, worker: any): number => getActualHoursForWorker(event, worker);

    const getLegacyDisplayHoursForWorker = (worker: any): number => {
      const paymentData = worker?.payment_data;
      const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);
      if (workedHoursFromTimeEntries > 0) return workedHoursFromTimeEntries;
      const actualHoursFromPayment = Number(paymentData?.actual_hours || 0);
      if (actualHoursFromPayment > 0) return actualHoursFromPayment;
      const regHours = Number(paymentData?.regular_hours || 0);
      const otHours = Number(paymentData?.overtime_hours || 0);
      const dtHours = Number(paymentData?.doubletime_hours || 0);
      return regHours + otHours + dtHours;
    };

    const getHoursComparison = (event: any, worker: any, actualHours: number, displayHours: number) => {
      const paymentData = worker?.payment_data;
      const paymentBreakdown = getEffectiveHoursBreakdownFromPayment(paymentData);
      const workerTimeEntriesHours = Number(worker?.worked_hours || 0);
      const timesheetHours = getTimesheetHoursForWorker(event, worker);
      const legacyDisplayHours = getLegacyDisplayHoursForWorker(worker);
      const paystubSelectedHours = getActualHoursForWorker(event, worker);
      const hrDashboardPayrollHours = paymentBreakdown.hours;
      const eventDashboardPaymentApproxHours =
        timesheetHours > 0
          ? timesheetHours
          : hrDashboardPayrollHours > 0
            ? hrDashboardPayrollHours
            : workerTimeEntriesHours;

      const comparable = [
        roundHoursForDebug(hrDashboardPayrollHours),
        roundHoursForDebug(paystubSelectedHours),
        roundHoursForDebug(legacyDisplayHours),
        roundHoursForDebug(eventDashboardPaymentApproxHours),
      ];
      const spread = comparable.length > 0 ? Math.max(...comparable) - Math.min(...comparable) : 0;

      return {
        selected_source: timesheetHours > 0
          ? "event_timesheet(time_entries)"
          : paymentBreakdown.hours > 0
            ? `payment_data.${paymentBreakdown.source}`
            : workerTimeEntriesHours > 0
              ? "worker.worked_hours(time_entries)"
              : "sum(regular+ot+dt)",
        payment_effective_plus_gate_phone: roundHoursForDebug(paymentBreakdown.effectivePlusGatePhone),
        payment_actual_hours: roundHoursForDebug(paymentBreakdown.actual),
        payment_worked_hours: roundHoursForDebug(paymentBreakdown.worked),
        payment_regular_ot_dt_sum: roundHoursForDebug(paymentBreakdown.summed),
        worker_time_entries_hours: roundHoursForDebug(workerTimeEntriesHours),
        event_dashboard_timesheet_hours: roundHoursForDebug(timesheetHours),
        hr_dashboard_payroll_hours: roundHoursForDebug(hrDashboardPayrollHours),
        event_dashboard_payment_approx_hours: roundHoursForDebug(eventDashboardPaymentApproxHours),
        paystub_selected_hours: roundHoursForDebug(paystubSelectedHours),
        paystub_display_hours: roundHoursForDebug(displayHours),
        computed_actual_hours: roundHoursForDebug(actualHours),
        legacy_paystub_display_hours: roundHoursForDebug(legacyDisplayHours),
        spread_hours: roundHoursForDebug(spread),
        has_mismatch: spread > HOURS_MISMATCH_THRESHOLD,
      };
    };

    const logHoursMismatchIfAny = (
      context: { mode: "CA" | "NON_CA"; eventId: string; eventState: string; paystubState: string; userId: string },
      comparison: ReturnType<typeof getHoursComparison>
    ) => {
      if (!debugEnabled) return;
      if (!comparison.has_mismatch) return;
      console.warn("[GENERATE-PAYSTUB][hours-mismatch]", {
        ...context,
        ...comparison,
      });
    };

    const GATE_PHONE_OFFSET_MS = GATE_PHONE_OFFSET_HOURS * 60 * 60 * 1000;
    const parseEventTimeToSeconds = (value: unknown): number | null => {
      const raw = (value || "").toString().trim();
      if (!raw) return null;
      const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (!match) return null;
      const hh = Number(match[1]);
      const mm = Number(match[2]);
      const ss = Number(match[3] || 0);
      if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
      return hh * 3600 + mm * 60 + ss;
    };
    const getTimeEntryTs = (entry: any): string | null =>
      (entry?.timestamp || entry?.started_at || null) as string | null;
    const getDisplayedWorkedHoursFromEntries = (userEntriesRaw: any[]): number => {
      const userEntries = [...(userEntriesRaw || [])].sort((a, b) => {
        const tA = getTimeEntryTs(a) ? new Date(getTimeEntryTs(a) as string).getTime() : Number.NaN;
        const tB = getTimeEntryTs(b) ? new Date(getTimeEntryTs(b) as string).getTime() : Number.NaN;
        if (!Number.isFinite(tA) && !Number.isFinite(tB)) return 0;
        if (!Number.isFinite(tA)) return 1;
        if (!Number.isFinite(tB)) return -1;
        return tA - tB;
      });

      let apiTotalMs = 0;
      let currentClockIn: string | null = null;
      const workIntervals: Array<{ start: Date; end: Date }> = [];
      const clockIns: string[] = [];
      const clockOuts: string[] = [];
      const mealStarts: string[] = [];
      const mealEnds: string[] = [];

      for (const entry of userEntries) {
        const action = (entry?.action || "").toString();
        const ts = getTimeEntryTs(entry);
        if (!ts) continue;

        if (action === "clock_in") {
          clockIns.push(ts);
          if (!currentClockIn) currentClockIn = ts;
          continue;
        }
        if (action === "clock_out") {
          clockOuts.push(ts);
          if (currentClockIn) {
            const startMs = new Date(currentClockIn).getTime();
            const endMs = new Date(ts).getTime();
            const duration = endMs - startMs;
            if (duration > 0) {
              apiTotalMs += duration;
              workIntervals.push({ start: new Date(currentClockIn), end: new Date(ts) });
            }
            currentClockIn = null;
          }
          continue;
        }
        if (action === "meal_start") {
          mealStarts.push(ts);
          continue;
        }
        if (action === "meal_end") {
          mealEnds.push(ts);
        }
      }

      let firstMealStart: string | null = mealStarts[0] || null;
      let lastMealEnd: string | null = mealEnds[0] || null;
      let secondMealStart: string | null = mealStarts[1] || null;
      let secondMealEnd: string | null = mealEnds[1] || null;

      const hasExplicitMeals = mealStarts.length > 0 || mealEnds.length > 0;
      if (!hasExplicitMeals && workIntervals.length >= 2) {
        workIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
        const gaps: Array<{ start: Date; end: Date }> = [];
        for (let i = 0; i < workIntervals.length - 1; i++) {
          const gapStart = workIntervals[i].end;
          const gapEnd = workIntervals[i + 1].start;
          const gapMs = gapEnd.getTime() - gapStart.getTime();
          if (gapMs > 0) gaps.push({ start: gapStart, end: gapEnd });
          if (gaps.length >= 2) break;
        }
        if (gaps[0]) {
          firstMealStart = gaps[0].start.toISOString();
          lastMealEnd = gaps[0].end.toISOString();
        }
        if (gaps[1]) {
          secondMealStart = gaps[1].start.toISOString();
          secondMealEnd = gaps[1].end.toISOString();
        }
      }

      const firstIn = clockIns.length > 0 ? clockIns[0] : null;
      const lastOut = clockOuts.length > 0 ? clockOuts[clockOuts.length - 1] : null;

      const firstInMs = firstIn ? new Date(firstIn).getTime() : Number.NaN;
      const lastOutMs = lastOut ? new Date(lastOut).getTime() : Number.NaN;
      const meal1Ms =
        firstMealStart && lastMealEnd
          ? Math.max(new Date(lastMealEnd).getTime() - new Date(firstMealStart).getTime(), 0)
          : 0;
      const meal2Ms =
        secondMealStart && secondMealEnd
          ? Math.max(new Date(secondMealEnd).getTime() - new Date(secondMealStart).getTime(), 0)
          : 0;
      const mealMs = meal1Ms + meal2Ms;

      let spanNetMs = 0;
      if (Number.isFinite(firstInMs) && Number.isFinite(lastOutMs) && lastOutMs > firstInMs) {
        spanNetMs = Math.max(lastOutMs - firstInMs - mealMs, 0);
      }

      let totalMs = 0;
      if (apiTotalMs > 0 && spanNetMs > 0) {
        totalMs = Math.min(apiTotalMs, spanNetMs);
      } else if (spanNetMs > 0) {
        totalMs = spanNetMs;
      } else if (apiTotalMs > 0) {
        totalMs = Math.max(apiTotalMs - mealMs, 0);
      }

      if (totalMs > 0 && firstIn) {
        totalMs += GATE_PHONE_OFFSET_MS;
      }

      return totalMs > 0 ? totalMs / (1000 * 60 * 60) : 0;
    };
    const buildTimesheetHoursByEventUser = async (): Promise<Record<string, Record<string, number>>> => {
      const out: Record<string, Record<string, number>> = {};

      for (const event of events || []) {
        const eventId = (event?.id || "").toString();
        const eventDate = (event?.event_date || "").toString().split("T")[0];
        const workers = Array.isArray(event?.workers) ? event.workers : [];
        const userIds: string[] = Array.from(
          new Set(workers.map((w: any) => (w?.user_id || "").toString()).filter((v: string) => !!v))
        ) as string[];

        out[eventId] = {};
        for (const uid of userIds) out[eventId][uid] = 0;

        if (!eventId || !eventDate || userIds.length === 0) continue;

        const startSec = parseEventTimeToSeconds(event?.start_time);
        const endSec = parseEventTimeToSeconds(event?.end_time);
        const endsNextDay =
          Boolean(event?.ends_next_day) ||
          (startSec !== null && endSec !== null && endSec <= startSec);

        const startDate = new Date(`${eventDate}T00:00:00Z`);
        const endDate = new Date(`${eventDate}T23:59:59.999Z`);
        if (endsNextDay) {
          endDate.setUTCDate(endDate.getUTCDate() + 1);
        }
        const startIso = startDate.toISOString();
        const endIso = endDate.toISOString();

        let source: "event_id" | "timestamp_window" | "started_at_window" = "event_id";
        let entries: any[] = [];

        const { data: byEventId, error: byEventIdError } = await supabaseAdmin
          .from("time_entries")
          .select("id, user_id, action, timestamp, started_at, event_id")
          .in("user_id", userIds)
          .eq("event_id", eventId)
          .order("timestamp", { ascending: true });

        if (byEventIdError && debugEnabled) {
          console.warn("[GENERATE-PAYSTUB][debug] timesheet by event_id error", {
            eventId,
            error: byEventIdError.message,
          });
        }
        entries = byEventId || [];

        if (endsNextDay) {
          const { data: byTimestampNextDay, error: byTimestampNextDayError } = await supabaseAdmin
            .from("time_entries")
            .select("id, user_id, action, timestamp, started_at, event_id")
            .in("user_id", userIds)
            .or(`event_id.eq.${eventId},event_id.is.null`)
            .gte("timestamp", startIso)
            .lte("timestamp", endIso)
            .order("timestamp", { ascending: true });

          if (byTimestampNextDayError && debugEnabled) {
            console.warn("[GENERATE-PAYSTUB][debug] timesheet next-day merge error", {
              eventId,
              error: byTimestampNextDayError.message,
            });
          } else if (byTimestampNextDay && byTimestampNextDay.length > 0) {
            const merged: any[] = [];
            const seen = new Set<string>();
            for (const row of [...entries, ...byTimestampNextDay]) {
              if (row?.event_id && row.event_id !== eventId) continue;
              const key = row?.id
                ? `id:${row.id}`
                : `k:${row?.user_id}|${row?.action}|${row?.timestamp || row?.started_at}`;
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(row);
            }
            entries = merged;
          }
        }

        if (!entries || entries.length === 0) {
          const { data: byTimestamp, error: byTimestampError } = await supabaseAdmin
            .from("time_entries")
            .select("id, user_id, action, timestamp, started_at, event_id")
            .in("user_id", userIds)
            .or(`event_id.eq.${eventId},event_id.is.null`)
            .gte("timestamp", startIso)
            .lte("timestamp", endIso)
            .order("timestamp", { ascending: true });

          if (!byTimestampError && byTimestamp && byTimestamp.length > 0) {
            entries = byTimestamp;
            source = "timestamp_window";
          } else {
            const { data: byStartedAt, error: byStartedAtError } = await supabaseAdmin
              .from("time_entries")
              .select("id, user_id, action, timestamp, started_at, event_id")
              .in("user_id", userIds)
              .or(`event_id.eq.${eventId},event_id.is.null`)
              .gte("started_at", startIso)
              .lte("started_at", endIso)
              .order("started_at", { ascending: true });

            if (!byStartedAtError && byStartedAt && byStartedAt.length > 0) {
              entries = byStartedAt;
              source = "started_at_window";
            } else if (debugEnabled && (byTimestampError || byStartedAtError)) {
              console.warn("[GENERATE-PAYSTUB][debug] timesheet fallback errors", {
                eventId,
                byTimestampError: byTimestampError?.message || null,
                byStartedAtError: byStartedAtError?.message || null,
              });
            }
          }
        }

        const entriesByUser: Record<string, any[]> = {};
        for (const uid of userIds) entriesByUser[uid] = [];
        for (const row of entries || []) {
          const uid = (row?.user_id || "").toString();
          if (!uid || !entriesByUser[uid]) continue;
          entriesByUser[uid].push(row);
        }

        for (const uid of userIds) {
          out[eventId][uid] = getDisplayedWorkedHoursFromEntries(entriesByUser[uid] || []);
        }

        if (debugEnabled) {
          console.log("[GENERATE-PAYSTUB][debug] event timesheet hours source", {
            eventId,
            source,
            users: userIds.length,
            entries: (entries || []).length,
            sample: userIds.slice(0, 5).map((uid) => ({
              userId: uid,
              hours: roundHoursForDebug(out[eventId][uid] || 0),
            })),
          });
        }
      }

      return out;
    };

    const getAdjustedGrossForEvent = (event: any): number => {
      const eventPaymentSummary = event?.event_payment || event?.eventPayment || event?.event_payment_summary || null;
      const hasSalesInputs =
        event?.ticket_sales !== null &&
        event?.ticket_sales !== undefined &&
        event?.ticket_sales !== "";
      const eventTips = Number(event?.tips || 0);
      const eventFees = Number(event?.fees || 0);
      const eventOtherIncome = Number(event?.other_income || 0);
      const ticketSales = Number(event?.ticket_sales || 0);
      const totalSales = Math.max(ticketSales - eventTips, 0);
      const taxRate = Number(event?.tax_rate_percent || 0);
      const tax = totalSales * (taxRate / 100);
      const adjustedGrossFromSales = Math.max(totalSales - tax - eventFees + eventOtherIncome, 0);
      if (hasSalesInputs) return adjustedGrossFromSales;

      // Fallback when sales fields are missing on the event payload.
      const persistedAdjustedGrossRaw = Number(eventPaymentSummary?.net_sales);
      const hasPersistedAdjustedGross =
        eventPaymentSummary?.net_sales !== null &&
        eventPaymentSummary?.net_sales !== undefined &&
        eventPaymentSummary?.net_sales !== "" &&
        Number.isFinite(persistedAdjustedGrossRaw);

      if (hasPersistedAdjustedGross) {
        return Math.max(persistedAdjustedGrossRaw, 0);
      }
      return adjustedGrossFromSales;
    };

    const isUsedSickLeaveRow = (row: any): boolean => {
      const status = String(row?.status || "").toLowerCase().trim();
      if (status !== "approved") return false;
      const reasonUpper = String(row?.reason || "").toUpperCase();
      if (
        reasonUpper.includes(CARRY_OVER_OVERRIDE_REASON_MARKER) ||
        reasonUpper.includes(YEAR_TO_DATE_OVERRIDE_REASON_MARKER)
      ) {
        return false;
      }
      return true;
    };

    const toDateSafe = (value: any): Date | null => {
      if (!value) return null;
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const getAccrualOverrideFieldFromReason = (
      reason: unknown
    ): "carry_over" | "year_to_date" | null => {
      const reasonUpper = String(reason || "").toUpperCase();
      if (reasonUpper.includes(CARRY_OVER_OVERRIDE_REASON_MARKER)) return "carry_over";
      if (reasonUpper.includes(YEAR_TO_DATE_OVERRIDE_REASON_MARKER)) return "year_to_date";
      return null;
    };

    const normalizeSickStatus = (raw: unknown): "pending" | "approved" | "denied" => {
      const normalized = String(raw || "pending").toLowerCase();
      if (normalized === "approved") return "approved";
      if (normalized === "denied") return "denied";
      return "pending";
    };

    const round2 = (n: number) => Number(n.toFixed(2));
    const round3 = (n: number) => Number(n.toFixed(3));
    const capDeductionValuesToGross = (values: number[], grossPay: number): number[] => {
      let remainingGross = round2(Math.max(0, grossPay));
      return values.map((value) => {
        const normalizedValue = round2(Math.max(0, Number(value || 0)));
        const appliedValue = round2(Math.min(normalizedValue, remainingGross));
        remainingGross = round2(Math.max(0, remainingGross - appliedValue));
        return appliedValue;
      });
    };
    const roundPayrollAmount = (amount: number): number => {
      if (!Number.isFinite(amount)) return 0;
      const absAmount = Math.abs(amount);
      const normalizedThousandths = Math.round((absAmount + 1e-9) * 1000) / 1000;
      const roundedCents = Math.round((normalizedThousandths + 1e-9) * 100) / 100;
      return amount < 0 ? -roundedCents : roundedCents;
    };
    const roundPayrollHours = (decimalHours: number): number => {
      if (!Number.isFinite(decimalHours)) return 0;
      const absHours = Math.abs(decimalHours);
      const roundedHours = Math.round((absHours + 1e-9) * 100) / 100;
      return decimalHours < 0 ? -roundedHours : roundedHours;
    };

    const computeSickAccrualSnapshotForPayPeriod = async (
      userId: string,
      periodStart: string,
      periodEnd: string
    ) => {
      const PAGE_SIZE = 1000;
      const periodStartDate = new Date(`${periodStart}T00:00:00.000Z`);
      const periodEndDate = new Date(`${periodEnd}T23:59:59.999Z`);
      const yearStartDate = new Date(Date.UTC(periodEndDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0));

      // Match HR sick-leaves logic: only count time_entries tied to events where the vendor is on event_teams.
      const vendorEventIds = new Set<string>();
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: teams, error: teamsError } = await supabaseAdmin
          .from("event_teams")
          .select("event_id")
          .eq("vendor_id", userId)
          .range(from, from + PAGE_SIZE - 1);
        if (teamsError) throw teamsError;
        if (!teams || teams.length === 0) break;
        for (const row of teams as Array<{ event_id: string | null }>) {
          if (row?.event_id) vendorEventIds.add(row.event_id);
        }
        if (teams.length < PAGE_SIZE) break;
      }

      let workedHours = 0;
      let workedHoursYtd = 0;
      if (vendorEventIds.size > 0) {
        const entriesByUserEvent = new Map<string, Array<{ action: string; timestamp: string }>>();
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data: timeRows, error: timeRowsError } = await supabaseAdmin
            .from("time_entries")
            .select("event_id, action, timestamp")
            .eq("user_id", userId)
            .in("action", ["clock_in", "clock_out"])
            .order("timestamp", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
          if (timeRowsError) throw timeRowsError;
          if (!timeRows || timeRows.length === 0) break;

          for (const row of timeRows as Array<{ event_id: string | null; action: string | null; timestamp: string | null }>) {
            if (!row?.event_id || !vendorEventIds.has(row.event_id)) continue;
            if (!row?.action || !row?.timestamp) continue;
            const action = String(row.action).toLowerCase();
            if (action !== "clock_in" && action !== "clock_out") continue;
            const key = `${userId}::${row.event_id}`;
            const existing = entriesByUserEvent.get(key) ?? [];
            existing.push({ action, timestamp: row.timestamp });
            entriesByUserEvent.set(key, existing);
          }

          if (timeRows.length < PAGE_SIZE) break;
        }

        for (const entries of entriesByUserEvent.values()) {
          entries.sort((a, b) => {
            const aTime = new Date(a.timestamp).getTime();
            const bTime = new Date(b.timestamp).getTime();
            if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0;
            return aTime - bTime;
          });

          let clockIn: string | null = null;
          for (const row of entries) {
            if (row.action === "clock_in") {
              clockIn = row.timestamp;
              continue;
            }
            if (row.action === "clock_out" && clockIn) {
              const shiftHours = Math.max(
                0,
                (new Date(row.timestamp).getTime() - new Date(clockIn).getTime()) / (1000 * 60 * 60)
              );
              workedHours += shiftHours;
              const clockOutAt = toDateSafe(row.timestamp);
              if (clockOutAt && clockOutAt >= yearStartDate && clockOutAt <= periodEndDate) {
                workedHoursYtd += shiftHours;
              }
              clockIn = null;
            }
          }
        }
      }

      let sickHoursAllTime = 0;
      let sickHoursYtd = 0;
      let sickHoursBeforeYear = 0;
      let sickHoursThisPeriod = 0;
      let carryOverOverride: { hours: number; ts: number } | null = null;
      let yearToDateOverride: { hours: number; ts: number } | null = null;

      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: sickRows, error: sickRowsError } = await supabaseAdmin
          .from("sick_leaves")
          .select("duration_hours, status, start_date, approved_at, created_at, updated_at, reason")
          .eq("user_id", userId)
          .range(from, from + PAGE_SIZE - 1);
        if (sickRowsError) throw sickRowsError;
        if (!sickRows || sickRows.length === 0) break;

        for (const row of sickRows as Array<{
          duration_hours: number | string | null;
          status: string | null;
          start_date: string | null;
          approved_at: string | null;
          created_at: string | null;
          updated_at: string | null;
          reason: string | null;
        }>) {
          const overrideField = getAccrualOverrideFieldFromReason(row.reason);
          if (overrideField) {
            const overrideHours = Number(row.duration_hours || 0);
            const ts =
              toDateSafe(row.updated_at)?.getTime() ||
              toDateSafe(row.created_at)?.getTime() ||
              toDateSafe(row.approved_at)?.getTime() ||
              toDateSafe(row.start_date)?.getTime() ||
              0;
            if (overrideField === "carry_over") {
              if (!carryOverOverride || ts >= carryOverOverride.ts) {
                carryOverOverride = { hours: round2(overrideHours), ts };
              }
            } else if (!yearToDateOverride || ts >= yearToDateOverride.ts) {
              yearToDateOverride = { hours: round2(overrideHours), ts };
            }
            continue;
          }

          if (normalizeSickStatus(row.status) !== "approved") continue;
          const duration = Number(row.duration_hours || 0);
          if (!Number.isFinite(duration) || duration <= 0) continue;

          sickHoursAllTime += duration;
          const usedAt =
            toDateSafe(row.start_date) ||
            toDateSafe(row.approved_at) ||
            toDateSafe(row.created_at);

          if (!usedAt || usedAt < yearStartDate) {
            sickHoursBeforeYear += duration;
            continue;
          }
          if (usedAt <= periodEndDate) {
            sickHoursYtd += duration;
          }
          if (usedAt >= periodStartDate && usedAt <= periodEndDate) {
            sickHoursThisPeriod += duration;
          }
        }

        if (sickRows.length < PAGE_SIZE) break;
      }

      const workedHoursRounded = round3(workedHours);
      const workedHoursYtdRounded = round3(workedHoursYtd);
      const workedHoursBeforeYear = round3(Math.max(0, workedHoursRounded - workedHoursYtdRounded));
      const baseYearToDateHours = round2(workedHoursYtdRounded / 30);
      const accruedHoursBeforeYear = round2(workedHoursBeforeYear / 30);
      const baseCarryOverHours = round2(Math.max(0, accruedHoursBeforeYear - round2(sickHoursBeforeYear)));

      const carryOverHours = round2(
        Math.max(0, profileSickCarryOverHours ?? carryOverOverride?.hours ?? baseCarryOverHours)
      );
      const yearToDateHours = round2(Math.max(0, yearToDateOverride?.hours ?? baseYearToDateHours));
      const takenYtdHours = round2(Math.max(0, sickHoursYtd));
      const takenThisPeriodHours = round2(Math.max(0, sickHoursThisPeriod));
      const balanceYtdHours = round2(Math.max(0, carryOverHours + yearToDateHours - takenYtdHours));
      const accruedAllTimeHours = round2(carryOverHours + yearToDateHours);
      const balanceAllTimeHours = round2(Math.max(0, accruedAllTimeHours - round2(sickHoursAllTime)));

      return {
        carryOverHours,
        yearToDateHours,
        takenYtdHours,
        takenThisPeriodHours,
        balanceYtdHours,
        accruedAllTimeHours,
        balanceAllTimeHours,
      };
    };

    // AZ/NY weekly OT needs prior weekly hours per worker per event (Mon..day before event)
    const weeklyPriorHoursByEventId: Record<string, Record<string, number>> = {};
    if (azNyMode) {
      for (const e of events || []) {
        const eventId = (e?.id ?? "").toString();
        if (!eventId) continue;

        const dateStr = (e?.event_date || "").toString().split("T")[0];
        if (!dateStr) {
          weeklyPriorHoursByEventId[eventId] = {};
          continue;
        }
        const monday = getMondayOfWeek(dateStr);
        const userIds = Array.from(
          new Set(
            (e?.workers || [])
              .map((w: any) => (w?.user_id ?? "").toString())
              .filter((v: string) => !!v)
          )
        ) as string[];
        const hoursByUser: Record<string, number> = {};
        for (const uid of userIds) hoursByUser[uid] = 0;

        if (monday !== dateStr && userIds.length > 0) {
          const startIso = new Date(`${monday}T00:00:00Z`).toISOString();
          const endIso = new Date(`${dateStr}T00:00:00Z`).toISOString();
          const { data: entries } = await supabaseAdmin
            .from("time_entries")
            .select("user_id, action, timestamp")
            .in("user_id", userIds)
            .gte("timestamp", startIso)
            .lt("timestamp", endIso)
            .in("action", ["clock_in", "clock_out"])
            .order("timestamp", { ascending: true });

          const entriesByUser: Record<string, any[]> = {};
          for (const uid of userIds) entriesByUser[uid] = [];
          for (const row of entries || []) {
            if (!entriesByUser[row.user_id]) entriesByUser[row.user_id] = [];
            entriesByUser[row.user_id].push(row);
          }

          for (const uid of userIds) {
            let currentIn: string | null = null;
            let ms = 0;
            for (const row of entriesByUser[uid] || []) {
              if (row.action === "clock_in") {
                if (!currentIn) currentIn = row.timestamp;
              } else if (row.action === "clock_out") {
                if (currentIn) {
                  const dur = new Date(row.timestamp).getTime() - new Date(currentIn).getTime();
                  if (dur > 0) ms += dur;
                  currentIn = null;
                }
              }
            }
            hoursByUser[uid] = ms / (1000 * 60 * 60);
          }
        }

        weeklyPriorHoursByEventId[eventId] = hoursByUser;
      }
    }

    const computedTimesheetHours = await buildTimesheetHoursByEventUser();
    for (const [eventId, byUser] of Object.entries(computedTimesheetHours)) {
      timesheetHoursByEventUser[eventId] = byUser;
    }

    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();

    // Load fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let yPosition = height - 50;

    // Helper function to draw text
    const drawText = (text: string, x: number, y: number, options: any = {}) => {
      page.drawText(text, {
        x,
        y,
        size: options.size || 10,
        font: options.bold ? fontBold : font,
        color: rgb(0, 0, 0),
        ...options
      });
    };

    // Helper function to draw line
    const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: 0.5,
        color: rgb(0, 0, 0)
      });
    };

    type CommissionReportRow = {
      dateStr: string;
      show: string;
      stadium: string;
      adjGrossSales: number;
      commissionPool: number;
      numEmployees: number;
      commissionPerEmployee: number;
      hoursWorked: number;
      rateInEffect: number;
      variableIncentive: number;
      tips: number;
      restBreak: number;
      finalPay: number;
    };

    const addCommissionReportPage = (
      rows: CommissionReportRow[]
    ) => {
      if (rows.length === 0) return;
      const reportPage = pdfDoc.addPage([612, 792]);
      const fmtMoney = (n: number) =>
        `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const fmtDate = (ds: string) => {
        if (!ds) return "";
        const [yy, mm, dd] = ds.split("-");
        return `${parseInt(mm)}/${parseInt(dd)}/${yy}`;
      };
      const drawR = (text: string, x: number, y: number, opts: any = {}) => {
        reportPage.drawText(text, {
          x, y,
          size: opts.size || 8,
          font: opts.bold ? fontBold : font,
          color: rgb(0, 0, 0),
          ...opts,
        });
      };
      const drawRL = (x1: number, y1: number, x2: number) => {
        reportPage.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: 0.5, color: rgb(0, 0, 0) });
      };
      const C = { date: 20, show: 58, venue: 105, adjGross: 152, pool: 192, numEmp: 232, comm: 275, hours: 313, rate: 345, varInc: 377, tips: 425, restPay: 456, finalPay: 487 };
      const splitReportAddressLines = (rawAddress?: string | null) => {
        const str = (rawAddress || "").toString().trim();
        if (!str) return ["", "", ""] as const;
        const parts = str.split(",").map((part) => part.trim()).filter(Boolean);
        if (parts.length <= 1) return [str, "", ""] as const;
        if (parts.length === 2) return [parts[0], parts[1], ""] as const;
        return [parts[0], parts.slice(1, parts.length - 1).join(", "), parts[parts.length - 1]] as const;
      };
      const [reportAddressLine1, reportAddressLine2, reportAddressLine3] = splitReportAddressLines(displayAddress);
      const reportIdentityLines = [
        (employeeName || "").trim(),
        reportAddressLine1,
        reportAddressLine2,
        reportAddressLine3,
      ].filter((line): line is string => Boolean(line && line.trim()));
      let y = 760;
      drawR("Commission Report", 190, y, { bold: true, size: 13 });
      let identityBottomY = y;
      if (reportIdentityLines.length > 0) {
        drawR(reportIdentityLines[0], 395, y, { bold: true, size: 9 });
        reportIdentityLines.slice(1).forEach((line, index) => {
          const lineY = y - 10 - (index * 8);
          drawR(line, 395, lineY, { size: 8 });
          identityBottomY = lineY;
        });
      }
      const legendY = y - 16;
      drawR("Commission = Commission Pool / # of Employees", 25, legendY, { size: 7 });
      y = Math.min(legendY - 8, identityBottomY - 10);
      drawRL(20, y, 592);
      y -= 13;
      // Header row 1
      drawR("Show Date /", C.date, y, { bold: true, size: 6 });
      drawR("Event Name /", C.show, y, { bold: true, size: 6 });
      drawR("Venue /", C.venue, y, { bold: true, size: 6 });
      drawR("Adjusted", C.adjGross, y, { bold: true, size: 6 });
      drawR("% of Adj.", C.pool, y, { bold: true, size: 6 });
      drawR("# of", C.numEmp, y, { bold: true, size: 6 });
      drawR("Commission", C.comm, y, { bold: true, size: 6 });
      drawR("Hours", C.hours, y, { bold: true, size: 6 });
      drawR("Rate in", C.rate, y, { bold: true, size: 6 });
      drawR("Variable", C.varInc, y, { bold: true, size: 6 });
      drawR("Tips", C.tips, y, { bold: true, size: 6 });
      drawR("Rest Pay", C.restPay, y, { bold: true, size: 6 });
      drawR("Final Pay", C.finalPay, y, { bold: true, size: 6 });
      y -= 7;
      // Header row 2
      drawR("Event Date", C.date, y, { bold: true, size: 6 });
      drawR("Show Name", C.show, y, { bold: true, size: 6 });
      drawR("Stadium Name", C.venue, y, { bold: true, size: 6 });
      drawR("Gross Sales", C.adjGross, y, { bold: true, size: 6 });
      drawR("Gross Sales", C.pool, y, { bold: true, size: 6 });
      drawR("Employees", C.numEmp, y, { bold: true, size: 6 });
      drawR("Paid", C.comm, y, { bold: true, size: 6 });
      drawR("Worked", C.hours, y, { bold: true, size: 6 });
      drawR("Effect", C.rate, y, { bold: true, size: 6 });
      drawR("Incentive Pay", C.varInc, y, { bold: true, size: 6 });
      y -= 4;
      drawRL(20, y, 592);
      y -= 11;
      let grandAdjustedGross = 0;
      let grandCommissionPool = 0;
      let grandEmployees = 0;
      let grandCommission = 0;
      let grandHoursWorked = 0;
      let grandCommissionPaid = 0;
      let grandVariableIncentive = 0;
      let grandTips = 0;
      let grandRestPay = 0;
      let grandFinalPay = 0;
      for (const row of rows) {
        const showT = row.show.length > 12 ? row.show.substring(0, 12) + "..." : row.show;
        const venueT = row.stadium.length > 10 ? row.stadium.substring(0, 10) + "..." : row.stadium;
        drawR(fmtDate(row.dateStr), C.date, y, { size: 6 });
        drawR(showT, C.show, y, { size: 6 });
        drawR(venueT, C.venue, y, { size: 6 });
        drawR(fmtMoney(row.adjGrossSales), C.adjGross, y, { size: 6 });
        drawR(fmtMoney(row.commissionPool), C.pool, y, { size: 6 });
        drawR(row.numEmployees.toString(), C.numEmp, y, { size: 6 });
        drawR(fmtMoney(row.commissionPerEmployee), C.comm, y, { size: 6 });
        drawR(Number(row.hoursWorked).toFixed(2), C.hours, y, { size: 6 });
        drawR(`$${Number(row.rateInEffect).toFixed(2)}`, C.rate, y, { size: 6 });
        drawR(fmtMoney(row.variableIncentive), C.varInc, y, { size: 6 });
        drawR(fmtMoney(row.tips), C.tips, y, { size: 6 });
        drawR(fmtMoney(row.restBreak), C.restPay, y, { size: 6 });
        drawR(fmtMoney(row.finalPay), C.finalPay, y, { size: 6 });
        grandAdjustedGross += row.adjGrossSales;
        grandCommissionPool += row.commissionPool;
        grandEmployees += row.numEmployees;
        grandCommission += row.commissionPerEmployee;
        grandHoursWorked += row.hoursWorked;
        grandCommissionPaid += row.commissionPerEmployee + row.variableIncentive;
        grandVariableIncentive += row.variableIncentive;
        grandTips += row.tips;
        grandRestPay += row.restBreak;
        grandFinalPay += row.finalPay;
        y -= 11;
      }
      drawRL(20, y + 9, 592);
      const averageRateInEffect = grandHoursWorked > 0 ? (grandCommissionPaid / grandHoursWorked) : 0;
      drawR("Total for Pay Period", C.date, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandAdjustedGross), C.adjGross, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandCommissionPool), C.pool, y, { bold: true, size: 6 });
      drawR(grandEmployees.toString(), C.numEmp, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandCommission), C.comm, y, { bold: true, size: 6 });
      drawR(Number(grandHoursWorked).toFixed(2), C.hours, y, { bold: true, size: 6 });
      drawR(`$${averageRateInEffect.toFixed(2)}`, C.rate, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandVariableIncentive), C.varInc, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandTips), C.tips, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandRestPay), C.restPay, y, { bold: true, size: 6 });
      drawR(fmtMoney(grandFinalPay), C.finalPay, y, { bold: true, size: 6 });
    };

    if (paystubState === "CA") {
      const parseAmount = (value: any, absolute = true) => {
        const raw = (value ?? "").toString().replace(/,/g, "").trim();
        const parsed = Number.parseFloat(raw);
        if (!Number.isFinite(parsed)) return 0;
        return absolute ? Math.abs(parsed) : parsed;
      };

      const formatDateDisplay = (value?: string | null) => {
        const str = (value || "").toString().trim();
        if (!str) return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
          const [yy, mm, dd] = str.split("-");
          return `${mm}/${dd}/${yy}`;
        }
        const asDate = new Date(str);
        if (!Number.isNaN(asDate.getTime())) {
          const mm = String(asDate.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(asDate.getUTCDate()).padStart(2, "0");
          const yy = asDate.getUTCFullYear();
          return `${mm}/${dd}/${yy}`;
        }
        return str;
      };

      const fmt = (value: number) =>
        Number(value || 0).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      const money = (value: number) => `$${fmt(value)}`;
      const formatHoursHHMM = (value: number) => {
        const hours = Number(value || 0);
        if (!Number.isFinite(hours)) return "00:00";
        const sign = hours < 0 ? "-" : "";
        const totalMinutes = Math.round(Math.abs(hours) * 60);
        const hh = Math.floor(totalMinutes / 60);
        const mm = totalMinutes % 60;
        return `${sign}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      };
      const topY = (valueFromTop: number) => height - valueFromTop;
      const drawTopText = (text: string, x: number, yFromTop: number, options: any = {}) => {
        drawText(text, x, topY(yFromTop), options);
      };
      const drawTopLine = (x1: number, yFromTop: number, x2: number) => {
        drawLine(x1, topY(yFromTop), x2, topY(yFromTop));
      };

      const splitAddressLines = (rawAddress?: string | null) => {
        const str = (rawAddress || "").toString().trim();
        if (!str) return ["", "", ""];
        const parts = str.split(",").map((p) => p.trim()).filter(Boolean);
        if (parts.length <= 1) return [str, "", ""];
        if (parts.length === 2) return [parts[0], parts[1], ""];
        return [parts[0], parts.slice(1, parts.length - 1).join(", "), parts[parts.length - 1]];
      };

      const ssnDigits = (ssn || "").replace(/\D/g, "");
      const maskedSsn = ssnDigits.length >= 4 ? `XXX-XX-${ssnDigits.slice(-4)}` : (ssn || "XXX-XX-XXXX");
      const accountMask = ssnDigits.length >= 4 ? `XXXXXX${ssnDigits.slice(-4)}` : "XXXXXXXXXX";
      const routingMask = "XXXXXXXXX";
      const [addressLine1, addressLine2, addressLine3] = splitAddressLines(displayAddress);

      // Derive pay period from actual event dates so it always coincides
      // with the events loaded in the paystub generator.
      // Form values take priority; fall back to earliest/latest event date.
      const eventDatesArr = (events || [])
        .map((e: any) => (e?.event_date || "").toString().split("T")[0])
        .filter(Boolean)
        .sort();
      const effectivePeriodStart = (payPeriodStart || "").trim() || (eventDatesArr[0] ?? "");
      const effectivePeriodEnd = (payPeriodEnd || "").trim() || (eventDatesArr[eventDatesArr.length - 1] ?? "");
      // payDate falls back to the period end date when not provided (batch mode)
      const effectivePayDate = (payDate || "").trim() || effectivePeriodEnd;

      const payDateFormatted = formatDateDisplay(effectivePayDate);
      const payDateDigits = (payDateFormatted || effectivePayDate || "").replace(/\D/g, "");
      const statementNumberSeed = `${payDateDigits}${ssnDigits}${(employeeId || "").replace(/\D/g, "")}`;
      const statementNumber = (statementNumberSeed.slice(-7) || "0000000").padStart(7, "0");

      // Pre-fetch differential miles per event for travel pay calculation (mirrors HR dashboard formula)
      const differentialMilesByEventId: Record<string, number> = {};
      const mileageApprovedByEvent: Record<string, boolean> = {};
      if (matchedUserId) {
        const eventIds = (events || []).map((e: any) => String(e.id)).filter(Boolean);
        if (eventIds.length > 0) {
          const [{ data: approvalRows }, { data: profile }] = await Promise.all([
            supabaseAdmin
              .from('event_payment_approvals')
              .select('event_id, travel_approved, mileage_approved')
              .in('event_id', eventIds)
              .eq('user_id', matchedUserId),
            supabaseAdmin
              .from('profiles')
              .select('latitude, longitude')
              .eq('user_id', matchedUserId)
              .maybeSingle(),
          ]);

          const travelApprovedByEvent: Record<string, boolean> = {};
          for (const row of approvalRows || []) {
            travelApprovedByEvent[String(row.event_id)] = row.travel_approved ?? true;
            mileageApprovedByEvent[String(row.event_id)] = row.mileage_approved ?? true;
          }

          if (profile?.latitude && profile?.longitude) {
            const userLat = Number(profile.latitude);
            const userLng = Number(profile.longitude);

            const { data: homeVenueRow } = await supabaseAdmin
              .from('vendor_venue_assignments')
              .select('venue_id')
              .eq('vendor_id', matchedUserId)
              .limit(1)
              .maybeSingle();

            let distToHomeVenue = 0;
            if (homeVenueRow?.venue_id) {
              const { data: homeVenue } = await supabaseAdmin
                .from('venue_reference')
                .select('latitude, longitude')
                .eq('id', homeVenueRow.venue_id)
                .maybeSingle();
              if (homeVenue?.latitude && homeVenue?.longitude) {
                distToHomeVenue = calculateDistanceMiles(userLat, userLng, Number(homeVenue.latitude), Number(homeVenue.longitude));
              }
            }

            const venueNames = [...new Set((events || []).map((e: any) => e.venue).filter(Boolean))];
            const { data: venueRows } = await supabaseAdmin
              .from('venue_reference')
              .select('venue_name, latitude, longitude')
              .in('venue_name', venueNames);

            const venueByName: Record<string, any> = {};
            for (const v of venueRows || []) {
              venueByName[(v.venue_name || '').toLowerCase().trim()] = v;
            }

            for (const event of events || []) {
              const eventId = String(event.id);
              if (travelApprovedByEvent[eventId] === false) continue;
              const venue = venueByName[(event.venue || '').toLowerCase().trim()];
              if (!venue?.latitude || !venue?.longitude) continue;
              const evLat = Number(venue.latitude);
              const evLng = Number(venue.longitude);
              if (!Number.isFinite(evLat) || !Number.isFinite(evLng)) continue;
              const distToEvent = calculateDistanceMiles(userLat, userLng, evLat, evLng);
              differentialMilesByEventId[eventId] = Math.max(0, distToEvent - distToHomeVenue);
            }
          }
        }
      }

      let totalRegHours = 0;
      let totalOtHours = 0;
      let totalDtHours = 0;
      let totalHoursWorked = 0;
      let totalTips = 0;
      let totalCommission = 0;
      let totalRestBreak = 0;
      let totalOther = 0;
      let totalGross = 0;
      let totalRegularPayAmount = 0;
      let totalOvertimePayAmount = 0;
      let totalDoubletimePayAmount = 0;
      let totalVariableIncentive = 0;
      let totalTravelPay = 0;
      let totalMileageReimbursement = 0;
      let totalFinalCommission = 0;
      const caCommissionRows: CommissionReportRow[] = [];

      for (const event of events || []) {
        const worker = matchedUserId
          ? (event.workers || []).find((w: any) => w?.user_id === matchedUserId) || event.workers?.[0]
          : event.workers?.[0];
        const paymentData = worker?.payment_data;
        const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);

        // Include any event where the worker is present; events with no hours/payment contribute $0 gracefully.
        if (!worker) continue;

        const {
          eventState,
          baseRate,
          commissionEligibleCount,
          commissionPoolDollars,
          workers: eventWorkers,
          totalTipsEvent,
          commissionSharesByUser,
          tipsSharesByUser,
        } = getPayrollInputsForEvent(event);

        const adjustedGrossForReport = getAdjustedGrossForEvent(event);

        const regHours = Number(paymentData?.regular_hours || 0);
        const otHours = Number(paymentData?.overtime_hours || 0);
        const dtHours = Number(paymentData?.doubletime_hours || 0);
        const hoursFromPayment = getEffectiveHoursFromPayment(paymentData);
        const actualHours = getActualHoursForWorker(event, worker);
        const payrollHours = roundPayrollHours(actualHours);
        const displayHours = getDisplayHoursForWorker(event, worker);
        const hoursComparison = getHoursComparison(event, worker, actualHours, displayHours);

        const eventId = (event?.id || "").toString();
        logHoursMismatchIfAny(
          {
            mode: "CA",
            eventId,
            eventState,
            paystubState,
            userId: (worker?.user_id || "").toString(),
          },
          hoursComparison
        );
        const priorWeeklyHours = azNyMode ? (weeklyPriorHoursByEventId[eventId]?.[worker?.user_id] || 0) : 0;
        const isWeeklyOT = azNyMode && (priorWeeklyHours + actualHours) > 40;
        const workerUserId = (worker?.user_id || "").toString();
        const distributedCommissionShare =
          !isTrailersDivision(worker?.division) && workerUserId
            ? Number(commissionSharesByUser[workerUserId] || 0)
            : 0;
        const distributedTipsShare =
          !isTrailersDivision(worker?.division) && workerUserId
            ? Number(tipsSharesByUser[workerUserId] || 0)
            : 0;

        const extAmtRegular = roundPayrollAmount(payrollHours * baseRate);
        const extAmtOnRegRateNonAzNy = roundPayrollAmount(payrollHours * baseRate * 1.5);

        let commissionAmt = 0;
        let totalFinalCommissionAmt = 0;
        let loadedRateBase = payrollHours > 0 ? baseRate : 0;
        let computedOtRate = 0;
        let extAmtOnRegRate = 0;

        if (azNyMode) {
          const isEligibleThisWorker =
            !!worker &&
            !isTrailersDivision(worker?.division) &&
            payrollHours > 0;
          const prelimCommission = isEligibleThisWorker
            ? Math.max(0, distributedCommissionShare - extAmtOnRegRateNonAzNy)
            : 0;
          const totalFinalCommissionBase = payrollHours > 0 ? Math.max(150, extAmtRegular + prelimCommission) : 0;
          loadedRateBase = payrollHours > 0 ? (totalFinalCommissionBase / payrollHours) : baseRate;
          computedOtRate = isWeeklyOT ? loadedRateBase * 1.5 : 0;
          extAmtOnRegRate = isWeeklyOT ? roundPayrollAmount(computedOtRate * payrollHours) : extAmtOnRegRateNonAzNy;
          commissionAmt = isEligibleThisWorker
            ? Math.max(0, distributedCommissionShare - extAmtOnRegRate)
            : 0;
          totalFinalCommissionAmt = payrollHours > 0 ? extAmtOnRegRate + commissionAmt : 0;
        } else {
          extAmtOnRegRate = extAmtOnRegRateNonAzNy;
          commissionAmt =
            !isTrailersDivision(worker?.division) && payrollHours > 0 && commissionEligibleCount > 0
              ? Math.max(0, distributedCommissionShare - extAmtOnRegRateNonAzNy)
              : 0;
          // Mirror event-dashboard payment tab: totalFinalCommission = Math.max(extAmtOnRegRate, distributedCommissionShare)
          // extAmtOnRegRateNonAzNy + commissionAmt already equals that; no $150 minimum here.
          totalFinalCommissionAmt = payrollHours > 0 ? extAmtOnRegRateNonAzNy + commissionAmt : 0;
          loadedRateBase = payrollHours > 0 ? (totalFinalCommissionAmt / payrollHours) : baseRate;
        }

        const storedVariableIncentive =
          paymentData?.variable_incentive != null && Number.isFinite(Number(paymentData.variable_incentive))
            ? Number(paymentData.variable_incentive)
            : null;
        const tips = roundPayrollAmount(distributedTipsShare);
        const commission = roundPayrollAmount(totalFinalCommissionAmt);
        // Commission report "Final Pay" should include commission pay plus tips/rest,
        // matching the paystub generator UI/export semantics.
        const reportFinalCommissionAmt = roundPayrollAmount(totalFinalCommissionAmt);
        const other = Number(worker?.adjustment_amount || 0);

        const regPay = Number(paymentData?.regular_pay || 0);
        const otPay = Number(paymentData?.overtime_pay || 0);
        const dtPay = Number(paymentData?.doubletime_pay || 0);

        const restBreak = roundPayrollAmount(includeRestBreakColumn ? getRestBreakAmount(actualHours, paystubState) : 0);
        const reportCommissionShare = roundPayrollAmount(distributedCommissionShare);
        const reportVariableIncentive = storedVariableIncentive != null
          ? roundPayrollAmount(storedVariableIncentive)
          : roundPayrollAmount(Math.max(0, totalFinalCommissionAmt - distributedCommissionShare));
        const reportFinalPay = roundPayrollAmount(
          reportCommissionShare + reportVariableIncentive + tips + restBreak
        );
        const computedTotalPay = reportFinalPay;
        const computedTotalGrossPay = computedTotalPay + other;

        const reportCommissionPool = Math.max(0, adjustedGrossForReport * 0.03);

        if ((adjustedGrossForReport > 0 && commissionEligibleCount > 0) || reportFinalPay > 0) {
          // Match HR dashboard payroll logic:
          // Commission Pay = distributed share, Variable Incentive = excess above that share.
          caCommissionRows.push({
            dateStr: (event.event_date || '').toString().split('T')[0],
            show: (event?.event_name ?? event?.name ?? event?.artist ?? '').toString(),
            stadium: (event?.venue ?? '').toString(),
            adjGrossSales: adjustedGrossForReport,
            commissionPool: reportCommissionPool,
            numEmployees: commissionEligibleCount,
            commissionPerEmployee: reportCommissionShare,
            hoursWorked: displayHours,
            rateInEffect: loadedRateBase,
            variableIncentive: reportVariableIncentive,
            tips,
            restBreak,
            finalPay: reportFinalPay,
          });
        }

        totalRegHours += regHours;
        totalOtHours += otHours;
        totalDtHours += dtHours;
        totalHoursWorked += displayHours;
        totalTips += tips;
        // Split commission pay like HR dashboard:
        // When eligible + pool exists: Commission = pool share, Variable Incentive = excess above pool.
        // Otherwise (no pool or ineligible): Commission = full final pay, Variable Incentive = 0.
        const isEligibleForPool =
          !isTrailersDivision(worker?.division) &&
          payrollHours > 0 &&
          commissionEligibleCount > 0 &&
          distributedCommissionShare > 0;
        const pdfCommissionShare = isEligibleForPool ? reportCommissionShare : reportFinalCommissionAmt;
        const pdfVariableIncentive = isEligibleForPool ? reportVariableIncentive : 0;
        totalCommission += pdfCommissionShare;
        totalVariableIncentive += pdfVariableIncentive;
        totalFinalCommission += reportFinalCommissionAmt;
        totalRestBreak += restBreak;
        totalOther += other;
        totalGross += computedTotalGrossPay;
        totalRegularPayAmount += regPay;
        totalOvertimePayAmount += otPay;
        totalDoubletimePayAmount += dtPay;
        // Travel pay = (differentialMiles × 2 / 60) × loadedRate — mirrors HR dashboard formula
        const differentialMiles = differentialMilesByEventId[eventId] ?? 0;
        const travelPay = (differentialMiles * 2 / 60) * loadedRateBase;
        totalTravelPay += travelPay;
        // Mileage reimbursement = differentialMiles × 2 × $0.71 (IRS rate)
        const mileageApproved = mileageApprovedByEvent[eventId] ?? true;
        totalMileageReimbursement += mileageApproved ? differentialMiles * 2 * 0.71 : 0;
      }

      const federalIncomeAmt = round2(parseAmount(federalIncome));
      const socialSecurityAmt = round2(parseAmount(socialSecurity));
      const medicareAmt = round2(parseAmount(medicare));
      const stateIncomeAmt = round2(parseAmount(stateIncome));
      const stateDIAmt = round2(parseAmount(stateDI));
      const miscDeductionAmt = round2(parseAmount(miscDeduction));
      const reimbursement = round2(parseAmount(miscReimbursement, false));
      const rawTotalDeductions = round2(
        federalIncomeAmt +
        socialSecurityAmt +
        medicareAmt +
        stateIncomeAmt +
        stateDIAmt +
        miscDeductionAmt
      );
      const totalRegularPayRounded = round2(totalRegularPayAmount);
      const totalOvertimePayRounded = round2(totalOvertimePayAmount);
      const totalFinalCommissionRounded = round2(totalFinalCommission);
      const totalCommissionRounded = round2(totalCommission);
      const totalDoubletimePayRounded = round2(totalDoubletimePayAmount);
      const totalVariableIncentiveRounded = round2(totalVariableIncentive);
      const totalTravelPayRounded = round2(totalTravelPay);
      const totalTipsRounded = round2(totalTips);
      const totalRestBreakRounded = round2(totalRestBreak);
      const totalMileageReimbursementRounded = round2(totalMileageReimbursement);
      const mealPremiumThisPeriod = round2(Math.abs(Number(mealPremium) || 0));
      const sickThisPeriod = round2(Math.abs(Number(sick) || 0));
      const grossPayThisPeriod = round2(
        totalOvertimePayAmount +
        totalTips +
        totalCommission +
        totalDoubletimePayAmount +
        totalVariableIncentive +
        totalTravelPay +
        totalRestBreak +
        sickThisPeriod +
        mealPremiumThisPeriod
      );
      const appliedStatutoryDeductions = round2(Math.min(rawTotalDeductions, grossPayThisPeriod));
      const netPay = round2(grossPayThisPeriod - appliedStatutoryDeductions + reimbursement + totalMileageReimbursementRounded);
      const effectiveRate = totalHoursWorked > 0 ? round2(totalFinalCommissionRounded / totalHoursWorked) : 0;

      let ytdSnapshot: any = null;
      if (matchedUserId) {
        try {
          const { data } = await supabaseAdmin
            .from("payroll_deductions")
            .select(
              "pay_date, ytd_gross, ytd_net, federal_income_ytd, social_security_ytd, medicare_ytd, ca_state_income_ytd, ca_state_di_ytd, regular_hours, overtime_hours, doubletime_hours, regular_earnings, overtime_earnings, doubletime_earnings"
            )
            .eq("user_id", matchedUserId)
            .order("pay_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          ytdSnapshot = data || null;
        } catch {
          ytdSnapshot = null;
        }
      }

      const toIsoDate = (value: any): string | null => {
        const str = (value || "").toString().trim();
        if (!str) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const d = new Date(str);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };

      const payDateIso = toIsoDate(effectivePayDate);
      const snapshotDateIso = toIsoDate(ytdSnapshot?.pay_date);
      const snapshotIncludesCurrent =
        payDateIso && snapshotDateIso ? snapshotDateIso >= payDateIso : null;

      const runningYtd = (previous: any, current: number) => {
        const prev = Number(previous || 0);
        if (!Number.isFinite(prev) || prev <= 0) return current;
        if (snapshotIncludesCurrent === true) return prev;
        if (snapshotIncludesCurrent === false) return prev + current;
        return Math.max(prev, current);
      };

      const ytdRegularHours = runningYtd(ytdSnapshot?.regular_hours, totalRegHours);
      const ytdOvertimeHours = runningYtd(ytdSnapshot?.overtime_hours, totalOtHours);
      const ytdDoubleTimeHours = runningYtd(ytdSnapshot?.doubletime_hours, totalDtHours);
      const ytdRegularPay = round2(runningYtd(ytdSnapshot?.regular_earnings, totalRegularPayRounded));
      const ytdOvertimePay = round2(runningYtd(ytdSnapshot?.overtime_earnings, totalOvertimePayRounded));
      const ytdWorkedHours = Math.max(0, ytdRegularHours + ytdOvertimeHours + ytdDoubleTimeHours);
      const ytdCommission = round2(totalFinalCommissionRounded);
      const ytdTips = round2(totalTipsRounded);
      const ytdRestBreak = round2(totalRestBreakRounded);
      const ytdMealPremium = round2(mealPremiumThisPeriod);
      const ytdSick = round2(sickThisPeriod);
      const ytdGross = round2(runningYtd(ytdSnapshot?.ytd_gross, grossPayThisPeriod));
      const ytdFederalIncome = round2(runningYtd(ytdSnapshot?.federal_income_ytd, federalIncomeAmt));
      const ytdSocialSecurity = round2(runningYtd(ytdSnapshot?.social_security_ytd, socialSecurityAmt));
      const ytdMedicare = round2(runningYtd(ytdSnapshot?.medicare_ytd, medicareAmt));
      const ytdStateIncome = round2(runningYtd(ytdSnapshot?.ca_state_income_ytd, stateIncomeAmt));
      const ytdStateDI = round2(runningYtd(ytdSnapshot?.ca_state_di_ytd, stateDIAmt));
      const ytdNet = round2(runningYtd(ytdSnapshot?.ytd_net, netPay));

      // Period-specific: hours accrued this pay period = hours worked / 30
      const SICK_ACCRUAL_RATE = 30;
      const sickAccruedThisPeriod =
        totalHoursWorked > 0 ? totalHoursWorked / SICK_ACCRUAL_RATE : 0;

      // Sick leave breakdown for this pay period and YTD
      let sickTakenThisPeriod = 0;
      let sickTakenYtdFromJan = toFiniteNumber(sickLeaveSummary?.total_hours) ?? 0; // fallback if DB query fails
      let sickCarryOverYtd =
        profileSickCarryOverHours ?? toFiniteNumber(sickLeaveSummary?.carry_over_hours) ?? 0;
      let sickAccruedYtd = toFiniteNumber(sickLeaveSummary?.year_to_date_hours) ?? 0; // fallback if DB query fails
      let sickBalanceYtd = toFiniteNumber(sickLeaveSummary?.balance_hours) ?? 0; // fallback if DB query fails

      if (matchedUserId && (effectivePeriodStart || effectivePeriodEnd)) {
        try {
          const periodEnd = effectivePeriodEnd || new Date().toISOString().slice(0, 10);
          const periodYear = periodEnd.substring(0, 4);
          const yearStart = periodYear ? `${periodYear}-01-01` : periodEnd;
          const periodStart = effectivePeriodStart || yearStart || periodEnd;

          const sickSnapshot = await computeSickAccrualSnapshotForPayPeriod(
            matchedUserId,
            periodStart,
            periodEnd
          );
          sickTakenThisPeriod = sickSnapshot.takenThisPeriodHours;
          sickTakenYtdFromJan = sickSnapshot.takenYtdHours;
          sickCarryOverYtd = sickSnapshot.carryOverHours;
          sickAccruedYtd = sickSnapshot.yearToDateHours;
          sickBalanceYtd = sickSnapshot.balanceYtdHours;
        } catch {
          // Non-fatal: keep fallback values
        }
      }

      const black = rgb(0, 0, 0);
      const gray = rgb(0.45, 0.45, 0.45);

      drawTopText("Company Code", 42, 48, { size: 7, bold: true });
      drawTopText("Loc/Dept", 108, 48, { size: 7, bold: true });
      drawTopText("Number", 150, 48, { size: 7, bold: true });
      drawTopText("Page", 188, 48, { size: 7, bold: true });
      drawTopText("KW / SZU 25574901", 42, 56, { size: 7 });
      drawTopText("01/", 112, 56, { size: 7 });
      drawTopText(statementNumber, 150, 56, { size: 7 });
      drawTopText("1 of 1", 188, 56, { size: 7 });
      drawTopText("Print & Design Solutions Inc", 42, 64, { size: 8, bold: true });
      drawTopText("31111 Agoura Road", 42, 72, { size: 8 });
      drawTopText("Ste 110", 42, 80, { size: 8 });
      drawTopText("Westlake Village, CA 91361", 42, 89, { size: 8 });

      drawTopText("Earnings Statement", 320, 50, { size: 14, bold: true });
      drawTopText("Period Starting:", 330, 72, { size: 8 });
      drawTopText("Period Ending:", 330, 79, { size: 8 });
      drawTopText("Pay Date:", 330, 87, { size: 8 });
      drawTopText(formatDateDisplay(effectivePeriodStart), 396, 72, { size: 8 });
      drawTopText(formatDateDisplay(effectivePeriodEnd), 396, 79, { size: 8 });
      drawTopText(payDateFormatted, 396, 87, { size: 8 });

      drawTopText("Taxable Filing Status: Single", 42, 128, { size: 8 });
      drawTopText("Exemptions/Allowances:", 42, 135, { size: 8 });
      drawTopText("Tax Override:", 168, 135, { size: 8 });
      drawTopText("Federal:", 60, 142, { size: 8 });
      drawTopText("Std W/H Table", 97, 142, { size: 8 });
      drawTopText("State:", 60, 149, { size: 8 });
      drawTopText("0", 96, 149, { size: 8 });
      drawTopText("Local:", 60, 157, { size: 8 });
      drawTopText("0", 96, 157, { size: 8 });
      drawTopText("Federal:", 170, 142, { size: 8 });
      drawTopText("State:", 170, 149, { size: 8 });
      drawTopText("Local:", 170, 157, { size: 8 });
      drawTopText(`Social Security Number:${maskedSsn}`, 42, 164, { size: 8 });

      drawTopText(employeeName || "", 364, 133, { size: 11, bold: true });
      if (addressLine1) drawTopText(addressLine1, 364, 144, { size: 10 });
      if (addressLine2) drawTopText(addressLine2, 364, 154, { size: 10 });
      if (addressLine3) drawTopText(addressLine3, 364, 164, { size: 10 });

      drawTopText("Earning", 42, 185, { size: 8, bold: true });
      drawTopText("Rate in effect", 128, 185, { size: 8 });
      drawTopText("Hours", 200, 185, { size: 8 });
      drawTopText("This Period", 255, 185, { size: 8 });
      drawTopLine(40, 192, 332);

      const overtimeRateAvg = totalOtHours > 0 ? round2(totalOvertimePayRounded / totalOtHours) : 0;

      const earningsRows = [
        { y: 200, label: "Regular", color: black, rate: 0, hours: 0, thisPeriod: totalRegularPayRounded, ytd: ytdRegularPay, hideThisPeriod: true },
        { y: 208, label: "Overtime", color: black, rate: overtimeRateAvg, hours: totalOtHours, thisPeriod: totalOvertimePayRounded, ytd: ytdOvertimePay },
        { y: 216, label: "Commission", color: black, rate: effectiveRate, hours: totalHoursWorked, thisPeriod: totalCommissionRounded, ytd: ytdCommission },
        { y: 224, label: "Variable Incentive", color: black, rate: 0, hours: 0, thisPeriod: totalVariableIncentiveRounded, ytd: totalVariableIncentiveRounded },
        { y: 232, label: "Credit card tips owed", color: black, rate: 0, hours: 0, thisPeriod: totalTipsRounded, ytd: ytdTips },
        { y: 240, label: "Rest Break Pay", color: black, rate: 0, hours: 0, thisPeriod: totalRestBreakRounded, ytd: ytdRestBreak },
        { y: 248, label: "Travel Pay", color: black, rate: 0, hours: 0, thisPeriod: totalTravelPayRounded, ytd: totalTravelPayRounded },
        { y: 256, label: "Sick Pay", color: black, rate: 0, hours: 0, thisPeriod: sickThisPeriod, ytd: ytdSick },
        { y: 264, label: "Meal Premium", color: black, rate: 0, hours: 0, thisPeriod: mealPremiumThisPeriod, ytd: ytdMealPremium },
      ];

      for (const row of earningsRows) {
        drawTopText(row.label, 43, row.y, { size: 8, color: row.color });
        if (row.rate > 0) drawTopText(fmt(row.rate), 145, row.y, { size: 8 });
        if (row.hours > 0) drawTopText(Number(row.hours).toFixed(2), 210, row.y, { size: 8 });
        if (!(row as any).hideThisPeriod) drawTopText(fmt(row.thisPeriod), 265, row.y, { size: 8 });
      }

      drawTopLine(40, 267, 332);
      drawTopText("Gross Pay", 95, 274, { size: 8, bold: true });
      drawTopText(money(grossPayThisPeriod), 255, 274, { size: 8, bold: true });

      drawTopText("Statutory Deductions", 112, 285, { size: 8, bold: true });
      drawTopText("this period", 233, 285, { size: 8 });
      drawTopText("year to date", 289, 285, { size: 8 });
      drawTopLine(109, 292, 332);

      const deductionRows = [
        { y: 305.1, label: "Federal Income", thisPeriod: federalIncomeAmt, ytd: ytdFederalIncome },
        { y: 312.3, label: "Social Security", thisPeriod: socialSecurityAmt, ytd: ytdSocialSecurity },
        { y: 319.8, label: "Medicare", thisPeriod: medicareAmt, ytd: ytdMedicare },
        { y: 327.0, label: "California State Income", thisPeriod: stateIncomeAmt, ytd: ytdStateIncome },
        { y: 334.4, label: "California State DI", thisPeriod: stateDIAmt, ytd: ytdStateDI },
      ];

      if (miscDeductionAmt > 0) {
        deductionRows.push({ y: 341.8, label: "Misc Deduction", thisPeriod: miscDeductionAmt, ytd: miscDeductionAmt });
      }

      const appliedDeductionValues = capDeductionValuesToGross(
        deductionRows.map((row) => row.thisPeriod),
        grossPayThisPeriod
      );

      deductionRows.forEach((row, index) => {
        const appliedThisPeriod = appliedDeductionValues[index] || 0;
        drawTopText(row.label, 112, row.y, { size: 8 });
        drawTopText(fmt(-appliedThisPeriod), 249, row.y, { size: 8 });
        drawTopText(fmt(row.ytd), 299, row.y, { size: 8 });
      });

      drawTopLine(109, 334, 332);
      drawTopText("Net Pay Adjustments", 112, 343, { size: 8, bold: true });
      drawTopText("this period", 233, 343, { size: 8 });
      drawTopText("year to date", 289, 343, { size: 8 });
      drawTopLine(109, 350, 332);
      drawTopText("Miscellaneous Reimbursement", 112, 360, { size: 8 });
      drawTopText(fmt(reimbursement), 249, 360, { size: 8 });
      drawTopText(fmt(reimbursement), 299, 360, { size: 8 });
      drawTopText("Mileage Reimbursement", 112, 368, { size: 8 });
      drawTopText(fmt(totalMileageReimbursementRounded), 249, 368, { size: 8 });
      drawTopText(fmt(totalMileageReimbursementRounded), 299, 368, { size: 8 });
      drawTopLine(109, 375, 332);
      drawTopText("Net Pay", 112, 383, { size: 8, bold: true });
      drawTopText(money(netPay), 240, 383, { size: 8, bold: true });
      drawTopText(money(ytdNet), 286, 383, { size: 8, bold: true });

      drawTopText("Other Benefits and", 353, 182, { size: 8, bold: true });
      drawTopText("Information", 353, 187, { size: 8, bold: true });
      drawTopText("this period", 474, 187, { size: 8 });
      drawTopText("year to date", 530, 187, { size: 8 });
      drawTopLine(353, 192, 560);
      drawTopText("Sick", 353, 207.7, { size: 8 });
      drawTopText("Carry Over", 362.6, 214.9, { size: 8 });
      drawTopText("- Accrued Hours", 358.5, 222.1, { size: 8 });
      drawTopText("- Taken Hours", 358.3, 229.8, { size: 8 });
      drawTopText("- Balance", 358.2, 237.0, { size: 8 });
      drawTopText(formatHoursHHMM(0), 492.9, 214.9, { size: 8 });
      drawTopText(formatHoursHHMM(sickAccruedThisPeriod), 492.9, 222.1, { size: 8 });
      drawTopText(formatHoursHHMM(sickTakenThisPeriod), 492.9, 229.8, { size: 8 });
      drawTopText(formatHoursHHMM(sickCarryOverYtd), 548.1, 214.9, { size: 8 });
      drawTopText(formatHoursHHMM(sickAccruedYtd), 547.6, 222.1, { size: 8 });
      drawTopText(formatHoursHHMM(sickTakenYtdFromJan), 551.4, 229.8, { size: 8 });
      drawTopText(formatHoursHHMM(sickBalanceYtd), 547.7, 237.0, { size: 8 });

      drawTopText("Deposits", 353.1, 251.4, { size: 8, bold: true });
      drawTopText("account number", 353, 259.1, { size: 8 });
      drawTopText("transit/ABA", 471.8, 259.3, { size: 8 });
      drawTopText("amount", 542.8, 258.6, { size: 8 });
      drawTopText(accountMask, 353, 269.9, { size: 8 });
      drawTopText(routingMask, 469.2, 266.3, { size: 8 });
      drawTopText(fmt(netPay), 544.2, 268.4, { size: 8 });

      // Important Notes (commission rate explanation)
      if (totalCommission > 0) {
        drawTopText("IMPORTANT NOTES", 353, 290, { bold: true, size: 8 });
        drawTopText("Total Hours Worked:", 353, 300, { size: 8 });
        drawTopText(Number(totalHoursWorked).toFixed(2), 492.9, 300, { size: 8 });
        drawTopText("** Effective Rate = Total Commissions / Total Hours Worked", 353, 312, { size: 7 });
        drawTopText("See Attached Commission Report in Employee Portal", 353, 322, { size: 7 });
      }

      drawTopText(`Your federal taxable wages this period are ${money(grossPayThisPeriod)}`, 349.4, 518.0, { size: 8 });

      drawTopText("Print & Design Solutions Inc", 111.9, 562.7, { size: 8 });
      drawTopText("31111 Agoura Road", 112.0, 570.1, { size: 8 });
      drawTopText("Ste 110", 111.8, 577.5, { size: 8 });
      drawTopText("Westlake Village, CA 91361", 111.8, 584.7, { size: 8 });
      drawTopText("Pay Date:", 328.6, 572.7, { size: 9, bold: true });
      drawTopText(payDateFormatted, 415.1, 571.1, { size: 9 });

      drawTopLine(90, 607.5, 560);
      drawTopText("Deposited to the account", 94.2, 614.5, { size: 8, bold: true });
      drawTopText("account number", 246, 614.3, { size: 8 });
      drawTopText("transit/ABA", 353, 614.3, { size: 8 });
      drawTopText("amount", 525.3, 614.3, { size: 8 });
      drawTopText("Checking DirectDeposit", 94.2, 625.3, { size: 8 });
      drawTopText(accountMask, 246, 624.1, { size: 8 });
      drawTopText(routingMask, 353, 624.1, { size: 8 });
      drawTopText(fmt(netPay), 527.0, 624.1, { size: 8 });
      drawTopText("THIS IS NOT A CHECK", 292, 652, { size: 18, bold: true, color: gray });

      drawTopText(employeeName || "", 139.2, 682.4, { size: 11, bold: true });
      if (addressLine1) drawTopText(addressLine1, 138.9, 693.0, { size: 10 });
      if (addressLine2) drawTopText(addressLine2, 139.2, 703.5, { size: 10 });
      if (addressLine3) drawTopText(addressLine3, 139.2, 714.0, { size: 10 });

      addCommissionReportPage(caCommissionRows);
      const pdfBytes = await pdfDoc.save();

      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="paystub-${employeeName?.replace(/\s/g, '_')}-${effectivePayDate}.pdf"`
        }
      });
    }

    // Company Header
    drawText("Print & Design Solutions Inc", 50, yPosition, { bold: true, size: 12 });
    yPosition -= 15;
    drawText("31111 Agoura Road", 50, yPosition);
    yPosition -= 12;
    drawText("Ste 110", 50, yPosition);
    yPosition -= 12;
    drawText("Westlake Village, CA 91361", 50, yPosition);

    // Earnings Statement Header (right side)
    yPosition = height - 50;
    drawText("Earnings Statement", 400, yPosition, { bold: true, size: 14 });
    yPosition -= 20;
    drawText(`Period Starting: ${payPeriodStart || ''}`, 400, yPosition);
    yPosition -= 12;
    drawText(`Period Ending: ${payPeriodEnd || ''}`, 400, yPosition);
    yPosition -= 12;
    drawText(`Pay Date: ${payDate || ''}`, 400, yPosition);

    // Employee Information
    yPosition = height - 140;
    drawText(employeeName || '', 50, yPosition, { bold: true, size: 11 });
    yPosition -= 15;
    drawText(displayAddress || '', 50, yPosition);
    yPosition -= 15;
    drawText(`SSN: ${ssn || 'XXX-XX-XXXX'}`, 50, yPosition);

    // Earnings Table Header
    yPosition -= 30;
    const tableTop = yPosition;
    drawText("Earnings", 50, yPosition, { bold: true, size: 11 });
    yPosition -= 20;

    // Table column headers (compact vendor layout: CA/NV/WI)
    const vendorColXWithRestBreak = {
      event: 50,
      eventName: 78,
      regRate: 183,
      otRate: 228,
      hoursWorked: 273,
      comm: 330,
      tips: 395,
      restBreak: 435,
      other: 475,
      totalGross: 515,
    } as const;

    const vendorColXNoRestBreak = {
      event: 50,
      eventName: 88,
      regRate: 193,
      otRate: 238,
      hoursWorked: 283,
      comm: 340,
      tips: 405,
      other: 460,
      totalGross: 515,
    } as const;

    const defaultColX = {
      event: 50,
      regRate: 140,
      regHrs: 175,
      otRate: 205,
      otHrs: 240,
      dtRate: 270,
      dtHrs: 305,
      tips: 335,
      comm: 390,
      total: 460,
    } as const;

    drawLine(50, yPosition + 15, 560, yPosition + 15);
    if (useVendorLayout) {
      const colX = includeRestBreakColumn ? vendorColXWithRestBreak : vendorColXNoRestBreak;
      drawText("Event", colX.event, yPosition, { size: 8, bold: true });
      drawText("Event Name", colX.eventName, yPosition, { size: 8, bold: true });
      drawText("REG RATE", colX.regRate, yPosition, { size: 8, bold: true });
      drawText("OT RATE", (colX as typeof vendorColXWithRestBreak | typeof vendorColXNoRestBreak).otRate, yPosition, { size: 8, bold: true });
      drawText("Hours Worked", colX.hoursWorked, yPosition, { size: 7, bold: true });
      drawText("Comm Amt", colX.comm, yPosition, { size: 8, bold: true });
      drawText("Tips", colX.tips, yPosition, { size: 8, bold: true });
      if (includeRestBreakColumn) {
        drawText("Rest Break", (colX as typeof vendorColXWithRestBreak).restBreak, yPosition, { size: 7, bold: true });
      }
      drawText("Other", colX.other, yPosition, { size: 8, bold: true });
      drawText("Total Gross", colX.totalGross, yPosition, { size: 7, bold: true });
    } else {
      const colX = defaultColX;
      drawText("Event", colX.event, yPosition, { size: 8, bold: true });
      drawText("Rate", colX.regRate, yPosition, { size: 8, bold: true });
      drawText("Hrs", colX.regHrs, yPosition, { size: 8, bold: true });
      drawText("Rate", colX.otRate, yPosition, { size: 8, bold: true });
      drawText("Hrs", colX.otHrs, yPosition, { size: 8, bold: true });
      drawText("Rate", colX.dtRate, yPosition, { size: 8, bold: true });
      drawText("Hrs", colX.dtHrs, yPosition, { size: 8, bold: true });
      drawText("Tips", colX.tips, yPosition, { size: 8, bold: true });
      drawText("Commission", colX.comm, yPosition, { size: 8, bold: true });
      drawText("Total", colX.total, yPosition, { size: 8, bold: true });

      drawText("Regular", colX.regRate, yPosition + 10, { size: 7 });
      drawText("Overtime", colX.otRate, yPosition + 10, { size: 7 });
      drawText("Double Time", colX.dtRate, yPosition + 10, { size: 7 });
    }

    yPosition -= 15;
    drawLine(50, yPosition + 10, 560, yPosition + 10);

    // Calculate totals
    let totalRegHours = 0;
    let totalOtHours = 0;
    let totalDtHours = 0;
    let totalHoursWorked = 0;
    let totalTips = 0;
    let totalCommission = 0;
    let totalRestBreak = 0;
    let totalOther = 0;
    let totalGross = 0;
    const nonCaCommissionRows: CommissionReportRow[] = [];

    // Draw event rows
    events.forEach((event: any, index: number) => {
      const worker = matchedUserId
        ? (event.workers || []).find((w: any) => w?.user_id === matchedUserId) || event.workers?.[0]
        : event.workers?.[0]; // fallback
      const paymentData = worker?.payment_data;

      const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);
      const actualHoursForRender = worker ? getActualHoursForWorker(event, worker) : 0;

      const shouldRenderRow = useVendorLayout
        ? !!worker && (actualHoursForRender > 0 || workedHoursFromTimeEntries > 0 || !!paymentData)
        : !!paymentData;

      if (shouldRenderRow) {
        const {
          eventState,
          baseRate,
          commissionEligibleCount,
          commissionPoolDollars,
          workers: eventWorkers,
          totalTipsEvent,
          commissionSharesByUser,
          tipsSharesByUser,
        } = getPayrollInputsForEvent(event);
        const adjustedGrossForReport = getAdjustedGrossForEvent(event);

        const regHours = Number(paymentData?.regular_hours || 0);
        const otHours = Number(paymentData?.overtime_hours || 0);
        const dtHours = Number(paymentData?.doubletime_hours || 0);
        const hoursFromPaymentNonCa = getEffectiveHoursFromPayment(paymentData);
        const actualHours = getActualHoursForWorker(event, worker);
        const payrollHours = roundPayrollHours(actualHours);
        const displayHours = getDisplayHoursForWorker(event, worker);
        const hoursComparison = getHoursComparison(event, worker, actualHours, displayHours);
        const workerUserId = (worker?.user_id || "").toString();
        const distributedCommissionShare =
          !isTrailersDivision(worker?.division) && workerUserId
            ? Number(commissionSharesByUser[workerUserId] || 0)
            : 0;
        const distributedTipsShare =
          !isTrailersDivision(worker?.division) && workerUserId
            ? Number(tipsSharesByUser[workerUserId] || 0)
            : 0;

        const isAZorNY = azNyMode;

        const eventId = (event?.id || "").toString();
        logHoursMismatchIfAny(
          {
            mode: "NON_CA",
            eventId,
            eventState,
            paystubState,
            userId: (worker?.user_id || "").toString(),
          },
          hoursComparison
        );
        const priorWeeklyHours = isAZorNY ? (weeklyPriorHoursByEventId[eventId]?.[worker?.user_id] || 0) : 0;
        const isWeeklyOT = isAZorNY && (priorWeeklyHours + actualHours) > 40;

        const extAmtRegular = roundPayrollAmount(payrollHours * baseRate);
        const extAmtOnRegRateNonAzNy = roundPayrollAmount(payrollHours * baseRate * 1.5);

        // Commission Amt + Total Final Commission Amt
        let commissionAmt = 0;
        let totalFinalCommissionBase = 0;
        let loadedRateBase = payrollHours > 0 ? baseRate : baseRate;
        let computedOtRate = 0;
        let extAmtOnRegRate = 0;
        let totalFinalCommissionAmt = 0;

        if (isAZorNY) {
          const isEligibleThisWorker =
            !!worker &&
            !isTrailersDivision(worker?.division) &&
            payrollHours > 0;
          const prelimCommission = isEligibleThisWorker
            ? Math.max(0, distributedCommissionShare - extAmtOnRegRateNonAzNy)
            : 0;
          totalFinalCommissionBase = payrollHours > 0 ? Math.max(150, extAmtRegular + prelimCommission) : 0;
          loadedRateBase = payrollHours > 0 ? (totalFinalCommissionBase / payrollHours) : baseRate;
          computedOtRate = isWeeklyOT ? loadedRateBase * 1.5 : 0;
          extAmtOnRegRate = isWeeklyOT ? roundPayrollAmount(computedOtRate * payrollHours) : extAmtOnRegRateNonAzNy;
          commissionAmt = isEligibleThisWorker
            ? Math.max(0, distributedCommissionShare - extAmtOnRegRate)
            : 0;
          totalFinalCommissionAmt = payrollHours > 0 ? extAmtOnRegRate + commissionAmt : 0;
        } else {
          extAmtOnRegRate = extAmtOnRegRateNonAzNy;
          commissionAmt =
            !isTrailersDivision(worker?.division) && payrollHours > 0 && commissionEligibleCount > 0
              ? Math.max(0, distributedCommissionShare - extAmtOnRegRateNonAzNy)
              : 0;
          // Mirror event-dashboard payment tab: totalFinalCommission = Math.max(extAmtOnRegRate, distributedCommissionShare)
          // extAmtOnRegRateNonAzNy + commissionAmt already equals that; no $150 minimum here.
          totalFinalCommissionAmt = payrollHours > 0 ? extAmtOnRegRateNonAzNy + commissionAmt : 0;
          loadedRateBase = payrollHours > 0 ? (totalFinalCommissionAmt / payrollHours) : baseRate;
          computedOtRate = 0;
        }

        const storedVariableIncentive =
          paymentData?.variable_incentive != null && Number.isFinite(Number(paymentData.variable_incentive))
            ? Number(paymentData.variable_incentive)
            : null;
        const tips = roundPayrollAmount(distributedTipsShare);
        const commission = roundPayrollAmount(totalFinalCommissionAmt);
        // Commission report "Final Pay" should include commission pay plus tips/rest,
        // matching the paystub generator UI/export semantics.
        const reportFinalCommissionAmt = roundPayrollAmount(totalFinalCommissionAmt);
        const other = Number(worker?.adjustment_amount || 0);

        const regPay = Number(paymentData?.regular_pay || 0);
        const otPay = Number(paymentData?.overtime_pay || 0);
        const dtPay = Number(paymentData?.doubletime_pay || 0);

        // Vendor layout REG/OT rate display
        // AZ/NY: REG RATE shows the regular Loaded Rate; if weekly OT applies, show OT RATE instead (1.5x Loaded Rate).
        // Non-AZ/NY vendor layout: REG RATE shows the Loaded Rate and OT RATE is blank.
        const loadedRate = loadedRateBase;
        const regRate = (isAZorNY && isWeeklyOT) ? 0 : loadedRate;
        const otRate = (isAZorNY && isWeeklyOT) ? computedOtRate : 0;

        // Paystub should follow the employee/paystub state for rest break display/calculation.
        // (Event state can be missing/mismatched, which would incorrectly suppress rest break.)
        const restBreak = roundPayrollAmount(includeRestBreakColumn ? getRestBreakAmount(actualHours, paystubState) : 0);

        // Total (gross) used for "This Period" and Net Pay.
        // If persisted total_pay exists and is non-zero, keep it for non-CA; otherwise use computed.
        const persistedTotal = Number(paymentData?.total_pay || 0);
        const persistedTotalGrossPay = persistedTotal + other;
        const reportCommissionShare = roundPayrollAmount(distributedCommissionShare);
        const reportVariableIncentive = storedVariableIncentive != null
          ? roundPayrollAmount(storedVariableIncentive)
          : roundPayrollAmount(Math.max(0, totalFinalCommissionAmt - distributedCommissionShare));
        const reportFinalPay = roundPayrollAmount(
          reportCommissionShare + reportVariableIncentive + tips + restBreak
        );
        const computedTotalPay = reportFinalPay;
        const computedTotalGrossPay = computedTotalPay + other;
        const total = (!useVendorLayout && persistedTotal > 0) ? persistedTotalGrossPay : computedTotalGrossPay;

        const reportCommissionPool = Math.max(0, adjustedGrossForReport * 0.03);

        if ((adjustedGrossForReport > 0 && commissionEligibleCount > 0) || reportFinalPay > 0) {
          // Match HR dashboard payroll logic:
          // Commission Pay = distributed share, Variable Incentive = excess above that share.
          nonCaCommissionRows.push({
            dateStr: (event.event_date || '').toString().split('T')[0],
            show: (event?.event_name ?? event?.name ?? event?.artist ?? '').toString(),
            stadium: (event?.venue ?? '').toString(),
            adjGrossSales: adjustedGrossForReport,
            commissionPool: reportCommissionPool,
            numEmployees: commissionEligibleCount,
            commissionPerEmployee: reportCommissionShare,
            hoursWorked: displayHours,
            rateInEffect: loadedRateBase,
            variableIncentive: reportVariableIncentive,
            tips,
            restBreak,
            finalPay: reportFinalPay,
          });
        }

        totalRegHours += regHours;
        totalOtHours += otHours;
        totalDtHours += dtHours;
        totalHoursWorked += displayHours;
        totalTips += tips;
        const isEligibleForPool =
          !isTrailersDivision(worker?.division) &&
          payrollHours > 0 &&
          commissionEligibleCount > 0 &&
          distributedCommissionShare > 0;
        totalCommission += isEligibleForPool ? reportCommissionShare : reportFinalCommissionAmt;
        totalRestBreak += restBreak;
        totalOther += other;
        totalGross += total;

        const eventDateStr = (event.event_date || '').toString().split('T')[0];
        const eventDateObj = eventDateStr ? new Date(`${eventDateStr}T00:00:00Z`) : new Date(event.event_date);
        const eventDate = `${eventDateObj.getUTCDate()}-${eventDateObj.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
        const eventNameRaw = event?.artist ?? event?.name ?? event?.event_name ?? '';
        const eventName = (eventNameRaw || '').toString();
        const displayName = eventName
          ? (eventName.length > 22 ? eventName.substring(0, 22) + '...' : eventName)
          : '(Unnamed)';

        if (debugEnabled) {
          console.log('[GENERATE-PAYSTUB][debug] event row', {
            eventId: event?.id,
            pickedWorkerUserId: worker?.user_id,
            matchedUserId,
            workedHoursFromTimeEntries,
            actualHoursFromPayment: hoursFromPaymentNonCa,
            regHours,
            otHours,
            dtHours,
            actualHours,
            hoursSource: hoursComparison.selected_source,
            hoursComparison,
            eventState,
            paystubState,
            azNyMode,
            baseRate,
            distributedCommissionShare,
            extAmtOnRegRate,
            commissionAmt,
            totalFinalCommissionAmt,
            tips,
            restBreak,
            other,
            total,
          });
        }

        if (useVendorLayout) {
          const colX = includeRestBreakColumn ? vendorColXWithRestBreak : vendorColXNoRestBreak;
          drawText(eventDate, colX.event, yPosition, { size: 8 });
          drawText(displayName, colX.eventName, yPosition, { size: 7 });
          if (regRate > 0) drawText(`$${regRate.toFixed(2)}`, colX.regRate, yPosition, { size: 8 });
          if (otRate > 0) drawText(`$${otRate.toFixed(2)}`, (colX as typeof vendorColXWithRestBreak | typeof vendorColXNoRestBreak).otRate, yPosition, { size: 8 });
          if (displayHours > 0) drawText(displayHours.toFixed(2), colX.hoursWorked, yPosition, { size: 8 });
          if (commission > 0) drawText(`$${commission.toFixed(2)}`, colX.comm, yPosition, { size: 8 });
          if (tips > 0) drawText(`$${tips.toFixed(2)}`, colX.tips, yPosition, { size: 8 });
          if (includeRestBreakColumn) {
            // Always render rest break so it's visible (even when $0.00).
            drawText(`$${restBreak.toFixed(2)}`, (colX as typeof vendorColXWithRestBreak).restBreak, yPosition, { size: 8 });
          }
          if (other !== 0) drawText(`${other >= 0 ? '$' : '-$'}${Math.abs(other).toFixed(2)}`, colX.other, yPosition, { size: 8 });
          if (total > 0) drawText(`$${total.toFixed(2)}`, colX.totalGross, yPosition, { size: 8 });
        } else {
          const colX = defaultColX;
          drawText(`${eventDate} ${displayName}`, colX.event, yPosition, { size: 8 });
          if (regHours > 0) drawText(`$${(regHours > 0 ? (regPay / regHours) : 0).toFixed(2)}`, colX.regRate, yPosition, { size: 8 });
          if (regHours > 0) drawText(regHours.toString(), colX.regHrs, yPosition, { size: 8 });
          if (otHours > 0) drawText(`$${(otHours > 0 ? (otPay / otHours) : 0).toFixed(2)}`, colX.otRate, yPosition, { size: 8 });
          if (otHours > 0) drawText(otHours.toString(), colX.otHrs, yPosition, { size: 8 });
          if (dtHours > 0) drawText(`$${(dtHours > 0 ? (dtPay / dtHours) : 0).toFixed(2)}`, colX.dtRate, yPosition, { size: 8 });
          if (dtHours > 0) drawText(dtHours.toString(), colX.dtHrs, yPosition, { size: 8 });
          if (tips > 0) drawText(`$${tips.toFixed(2)}`, colX.tips, yPosition, { size: 8 });
          if (commission > 0) drawText(`$${commission.toFixed(2)}`, colX.comm, yPosition, { size: 8 });
          drawText(`$${total.toFixed(2)}`, colX.total, yPosition, { size: 8 });
        }

        yPosition -= 12;
      }
    });

    // This Period totals
    drawLine(50, yPosition + 10, 560, yPosition + 10);
    yPosition -= 5;
    drawText("This Period", 50, yPosition, { size: 8, bold: true });
    if (useVendorLayout) {
      const colX = includeRestBreakColumn ? vendorColXWithRestBreak : vendorColXNoRestBreak;
      drawText(totalHoursWorked.toFixed(2), colX.hoursWorked, yPosition, { size: 8, bold: true });
      drawText(`$${totalCommission.toFixed(2)}`, colX.comm, yPosition, { size: 8, bold: true });
      drawText(`$${totalTips.toFixed(2)}`, colX.tips, yPosition, { size: 8, bold: true });
      if (includeRestBreakColumn) {
        drawText(`$${totalRestBreak.toFixed(2)}`, (colX as typeof vendorColXWithRestBreak).restBreak, yPosition, { size: 8, bold: true });
      }
      if (totalOther !== 0) drawText(`${totalOther >= 0 ? '$' : '-$'}${Math.abs(totalOther).toFixed(2)}`, colX.other, yPosition, { size: 8, bold: true });
      drawText(`$${totalGross.toFixed(2)}`, colX.totalGross, yPosition, { size: 8, bold: true });
    } else {
      const colX = defaultColX;
      drawText(totalRegHours.toFixed(2), colX.regHrs, yPosition, { size: 8, bold: true });
      drawText(totalOtHours.toFixed(2), colX.otHrs, yPosition, { size: 8, bold: true });
      drawText(totalDtHours.toFixed(2), colX.dtHrs, yPosition, { size: 8, bold: true });
      drawText(`$${totalTips.toFixed(2)}`, colX.tips, yPosition, { size: 8, bold: true });
      drawText(`$${totalCommission.toFixed(2)}`, colX.comm, yPosition, { size: 8, bold: true });
      drawText(`$${totalGross.toFixed(2)}`, colX.total, yPosition, { size: 8, bold: true });
    }

    yPosition -= 15;
    drawLine(50, yPosition + 10, 560, yPosition + 10);

    const mealPremiumAmt = round2(Math.abs(Number(mealPremium) || 0));
    const currentGrossPay = round2(totalGross + mealPremiumAmt);

    // Gross Pay
    yPosition -= 20;
    drawText("Gross Pay", 50, yPosition, { bold: true, size: 11 });
    drawText(`This Period: $${currentGrossPay.toFixed(2)}`, 400, yPosition, { bold: true });

    // Deductions
    yPosition -= 30;
    drawText("Statutory Deductions", 50, yPosition, { bold: true, size: 11 });
    drawText("this period", 250, yPosition, { size: 9 });

    const deductions = [
      { label: "Federal Income", value: parseFloat(federalIncome || '0') },
      { label: "Social Security", value: parseFloat(socialSecurity || '0') },
      { label: "Medicare", value: parseFloat(medicare || '0') },
      { label: `${state} State Income`, value: parseFloat(stateIncome || '0') },
      { label: `${state} State DI`, value: parseFloat(stateDI || '0') }
    ];

    if (miscDeduction && parseFloat(miscDeduction) > 0) {
      deductions.push({ label: "Misc Deduction", value: parseFloat(miscDeduction) });
    }

    yPosition -= 15;
    const appliedDeductionValues = capDeductionValuesToGross(
      deductions.map((deduction) => deduction.value),
      currentGrossPay
    );
    let appliedTotalDeductions = 0;

    deductions.forEach((deduction, index) => {
      const appliedValue = appliedDeductionValues[index] || 0;
      appliedTotalDeductions += appliedValue;
      drawText(deduction.label, 50, yPosition, { size: 9 });
      drawText(`-${appliedValue.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
    });

    const sickLeaveDisplayY = yPosition +60;
    if (sickLeave) {
      drawText("Sick Leave Summary", 360, sickLeaveDisplayY + 12, { bold: true, size: 9 });
      drawText(`Hours Used: ${sickLeave.total_hours.toFixed(2)}`, 360, sickLeaveDisplayY, { size: 8 });
      drawText(`Carry Over: ${Number(sickLeave.carry_over_hours || 0).toFixed(2)}`, 360, sickLeaveDisplayY - 12, { size: 8 });
      drawText(`Hours Accrued: ${sickLeave.accrued_hours.toFixed(2)}`, 360, sickLeaveDisplayY - 24, { size: 8 });
      drawText(`Balance: ${sickLeave.balance_hours.toFixed(2)}`, 360, sickLeaveDisplayY - 36, { size: 8 });
    }

    // Reimbursement
    const reimbursement = parseFloat(miscReimbursement || '0');
    if (reimbursement > 0) {
      drawText("Misc Reimbursement", 50, yPosition, { size: 9 });
      drawText(`+${reimbursement.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
    }

    // Net Pay
    yPosition -= 10;
    drawLine(50, yPosition + 10, 350, yPosition + 10);
    yPosition -= 5;
    const netPay = currentGrossPay - round2(appliedTotalDeductions) + reimbursement;
    drawText("Net Pay", 50, yPosition, { bold: true, size: 12 });
    drawText(`$${netPay.toFixed(2)}`, 250, yPosition, { bold: true, size: 12 });

    if (sickLeave) {
      yPosition -= 20;
      drawText("Sick Leave Summary", 50, yPosition, { bold: true, size: 10 });
      yPosition -= 12;
      drawText(`Hours Used: ${sickLeave.total_hours.toFixed(2)}`, 50, yPosition, { size: 9 });
      drawText(`Carry Over: ${Number(sickLeave.carry_over_hours || 0).toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
      drawText(`Hours Accrued: ${sickLeave.accrued_hours.toFixed(2)}`, 50, yPosition, { size: 9 });
      drawText(`Balance: ${sickLeave.balance_hours.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
    }

    // Important Notes (commission rate explanation)
    if (totalCommission > 0) {
      yPosition -= 15;
      drawText("IMPORTANT NOTES", 50, yPosition, { bold: true, size: 9 });
      yPosition -= 12;
      drawText(`Total Hours Worked: ${totalHoursWorked.toFixed(2)}`, 50, yPosition, { size: 8 });
      yPosition -= 11;
      drawText("** Effective Rate = Total Commissions / Total Hours Worked", 50, yPosition, { size: 8 });
      yPosition -= 11;
      drawText("See Attached Commission Report in Employee Portal", 50, yPosition, { size: 8 });
    }

    // Direct Deposit Info (bottom stub)
    yPosition = 100;
    drawLine(50, yPosition + 20, 560, yPosition + 20);
    yPosition -= 10;
    drawText("Print & Design Solutions Inc", 50, yPosition, { size: 9 });
    drawText(`Pay Date: ${payDate || ''}`, 400, yPosition, { bold: true });
    yPosition -= 15;
    drawText("31111 Agoura Road, Ste 110", 50, yPosition, { size: 9 });
    yPosition -= 12;
    drawText("Westlake Village, CA 91361", 50, yPosition, { size: 9 });

    yPosition -= 20;
    drawText("Deposited to account", 50, yPosition, { size: 9 });
    drawText(`$${netPay.toFixed(2)}`, 400, yPosition, { bold: true });
    yPosition -= 15;
    drawText("THIS IS NOT A CHECK", 350, yPosition, { size: 11, bold: true, color: rgb(0.5, 0.5, 0.5) });

    yPosition -= 15;
    drawText(employeeName || '', 50, yPosition, { size: 9 });
    yPosition -= 12;
    drawText(displayAddress || '', 50, yPosition, { size: 9 });

    addCommissionReportPage(nonCaCommissionRows);

    // Serialize the PDF
    const pdfBytes = await pdfDoc.save();

    // Return PDF as response
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="paystub-${employeeName?.replace(/\s/g, '_')}-${payDate}.pdf"`
      }
    });
  } catch (error: any) {
    console.error('Error generating paystub:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate paystub' }, { status: 500 });
  }
}
