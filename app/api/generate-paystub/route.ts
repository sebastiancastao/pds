import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";
import { getMondayOfWeek } from "@/lib/utils";

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

    // Source of truth: employee profile state (fallback to request payload state).
    let paystubState = normalizeStateCode(state) || "CA";
    if (matchedUserId) {
      try {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("state")
          .eq("user_id", matchedUserId)
          .maybeSingle();
        const profileState = normalizeStateCode((profile as any)?.state);
        if (profileState) paystubState = profileState;
      } catch (e) {
        // Non-fatal; keep payload state fallback.
      }
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
    const debugEnabled = debug === true && process.env.NODE_ENV !== 'production';

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
      return actualHours >= 10 ? 12 : 9;
    };

    // Match /hr-dashboard Payroll tab behavior as closely as possible.
    // That tab uses event_payments (if present) and falls back to events table fields.
    const getPayrollInputsForEvent = (event: any) => {
      const eventPaymentSummary = event?.event_payment || event?.eventPayment || event?.event_payment_summary || null;
      const eventState = normalizeState(event?.state) || paystubState;
      const stateRates: Record<string, number> = { CA: 17.28, NY: 17.0, AZ: 14.7, WI: 15.0 };
      const baseRate = Number(eventPaymentSummary?.base_rate || stateRates[eventState] || 17.28);

      const workers = Array.isArray(event?.workers) ? event.workers : [];
      const memberCount = workers.length;
      const vendorCountEligible = workers.reduce((count: number, w: any) => {
        return isVendorDivision(w?.division) ? count + 1 : count;
      }, 0);
      const vendorCountForCommission = vendorCountEligible > 0 ? vendorCountEligible : memberCount;

      // Commission pool in dollars: event_payments first, then compute from events table.
      let commissionPoolDollars =
        Number(eventPaymentSummary?.commission_pool_dollars || 0) ||
        (Number(eventPaymentSummary?.net_sales || 0) * Number(eventPaymentSummary?.commission_pool_percent || 0)) ||
        0;

      if (commissionPoolDollars === 0 && Number(event?.commission_pool || 0) > 0) {
        const ticketSales = Number(event?.ticket_sales || 0);
        const eventTips = Number(event?.tips || 0);
        const taxRate = Number(event?.tax_rate_percent || 0);
        const totalSales = Math.max(ticketSales - eventTips, 0);
        const tax = totalSales * (taxRate / 100);
        const netSales = Number(eventPaymentSummary?.net_sales || 0) || Math.max(totalSales - tax, 0);
        commissionPoolDollars = netSales * Number(event?.commission_pool || 0);
      }

      const perVendorCommissionShare =
        vendorCountForCommission > 0 ? commissionPoolDollars / vendorCountForCommission : 0;

      const totalTipsEvent = Number(eventPaymentSummary?.total_tips || 0) || Number(event?.tips || 0);
      // Pro-rate tips by hours worked
      const totalEventHours = workers.reduce((sum: number, w: any) => {
        const pd = w?.payment_data;
        const wh = Number(w?.worked_hours || 0);
        const ah = pd?.actual_hours != null ? Number(pd.actual_hours) || 0 : 0;
        return sum + (ah > 0 ? ah : wh > 0 ? wh : (Number(pd?.regular_hours || 0) + Number(pd?.overtime_hours || 0) + Number(pd?.doubletime_hours || 0)));
      }, 0);

      return {
        eventState,
        baseRate,
        memberCount,
        vendorCountForCommission,
        perVendorCommissionShare,
        commissionPoolDollars,
        workers,
        totalTipsEvent,
        totalEventHours,
      };
    };

    type AzNyCommissionCalcItem = {
      eligible: boolean;
      actualHours: number;
      extAmtRegular: number;
      isWeeklyOT: boolean;
    };

    const computeAzNyCommissionPerVendor = (
      items: AzNyCommissionCalcItem[],
      totalCommissionPool: number
    ): number => {
      const eligibleItems = items.filter((i) => i.eligible && i.actualHours > 0);
      const vendorCount = eligibleItems.length;
      if (vendorCount <= 0) return 0;

      // Fixed-point iteration because weekly OT Ext Amt depends on commission via Loaded Rate.
      let commissionPerVendor = 0;
      for (let iter = 0; iter < 20; iter++) {
        const sumExtAmtOnRegRate = eligibleItems.reduce((sum, i) => {
          if (!i.isWeeklyOT) return sum + i.extAmtRegular;
          const totalFinalCommissionBase = Math.max(150, i.extAmtRegular + commissionPerVendor);
          // Weekly OT Ext Amt = OT Rate * hours = 1.5 * (regular Loaded Rate) * hours = 1.5 * totalFinalCommissionBase
          return sum + (1.5 * totalFinalCommissionBase);
        }, 0);

        const next = (totalCommissionPool - sumExtAmtOnRegRate) / vendorCount;
        const nextCapped = Math.max(0, next);
        if (Math.abs(nextCapped - commissionPerVendor) < 0.01) {
          commissionPerVendor = nextCapped;
          break;
        }
        commissionPerVendor = nextCapped;
      }

      return commissionPerVendor;
    };

    const getActualHoursForWorker = (worker: any): number => {
      const paymentData = worker?.payment_data;
      const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);
      const regHours = Number(paymentData?.regular_hours || 0);
      const otHours = Number(paymentData?.overtime_hours || 0);
      const dtHours = Number(paymentData?.doubletime_hours || 0);
      const actualHoursFromPayment = paymentData?.actual_hours != null ? Number(paymentData.actual_hours) || 0 : 0;
      return actualHoursFromPayment > 0
        ? actualHoursFromPayment
        : workedHoursFromTimeEntries > 0
          ? workedHoursFromTimeEntries
          : regHours + otHours + dtHours;
    };

    const getDisplayHoursForWorker = (worker: any): number => {
      const paymentData = worker?.payment_data;
      const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);
      if (workedHoursFromTimeEntries > 0) return workedHoursFromTimeEntries;
      const actualHoursFromPayment = paymentData?.actual_hours != null ? Number(paymentData.actual_hours) || 0 : 0;
      if (actualHoursFromPayment > 0) return actualHoursFromPayment;
      const regHours = Number(paymentData?.regular_hours || 0);
      const otHours = Number(paymentData?.overtime_hours || 0);
      const dtHours = Number(paymentData?.doubletime_hours || 0);
      return regHours + otHours + dtHours;
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

      const carryOverHours = round2(Math.max(0, carryOverOverride?.hours ?? baseCarryOverHours));
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
      const C = { date: 25, show: 78, venue: 150, adjGross: 218, pool: 286, numEmp: 352, comm: 406, finalPay: 470 };
      let y = 760;
      drawR("Commission Report", 190, y, { bold: true, size: 13 });
      y -= 16;
      drawR("Commission = Commission Pool / # of Employees", 25, y, { size: 7 });
      y -= 8;
      drawRL(20, y, 592);
      y -= 13;
      drawR("Date", C.date, y, { bold: true, size: 7 });
      drawR("Show", C.show, y, { bold: true, size: 7 });
      drawR("Stadium / Venue", C.venue, y, { bold: true, size: 7 });
      drawR("Adj. Gross Sales", C.adjGross, y, { bold: true, size: 7 });
      drawR("3% of Adj. Gross", C.pool, y, { bold: true, size: 7 });
      drawR("# of Employees", C.numEmp, y, { bold: true, size: 7 });
      drawR("Commission", C.comm, y, { bold: true, size: 7 });
      drawR("Final Pay", C.finalPay, y, { bold: true, size: 7 });
      y -= 4;
      drawRL(20, y, 592);
      y -= 11;
      const weekMap: Map<string, CommissionReportRow[]> = new Map();
      for (const row of rows) {
        const mon = getMondayOfWeek(row.dateStr);
        if (!weekMap.has(mon)) weekMap.set(mon, []);
        weekMap.get(mon)!.push(row);
      }
      const mondays = Array.from(weekMap.keys()).sort();
      let grandTotal = 0;
      let grandFinalPay = 0;
      let weekNum = 1;
      for (const monday of mondays) {
        const weekRows = weekMap.get(monday)!;
        let weekTotal = 0;
        let weekFinalPay = 0;
        for (const row of weekRows) {
          const showT = row.show.length > 17 ? row.show.substring(0, 17) + "..." : row.show;
          const venueT = row.stadium.length > 13 ? row.stadium.substring(0, 13) + "..." : row.stadium;
          drawR(fmtDate(row.dateStr), C.date, y, { size: 7 });
          drawR(showT, C.show, y, { size: 7 });
          drawR(venueT, C.venue, y, { size: 7 });
          drawR(fmtMoney(row.adjGrossSales), C.adjGross, y, { size: 7 });
          drawR(fmtMoney(row.commissionPool), C.pool, y, { size: 7 });
          drawR(row.numEmployees.toString(), C.numEmp, y, { size: 7 });
          drawR(fmtMoney(row.commissionPerEmployee), C.comm, y, { size: 7 });
          drawR(fmtMoney(row.finalPay), C.finalPay, y, { size: 7 });
          weekTotal += row.commissionPerEmployee;
          weekFinalPay += row.finalPay;
          y -= 11;
        }
        drawR(`Week ${weekNum} Total`, C.date, y, { bold: true, size: 7 });
        drawR(fmtMoney(weekTotal), C.comm, y, { bold: true, size: 7 });
        drawR(fmtMoney(weekFinalPay), C.finalPay, y, { bold: true, size: 7 });
        grandTotal += weekTotal;
        grandFinalPay += weekFinalPay;
        weekNum++;
        y -= 13;
      }
      drawRL(20, y + 9, 592);
      drawR("Total for Pay Period", C.date, y, { bold: true, size: 8 });
      drawR(fmtMoney(grandTotal), C.comm, y, { bold: true, size: 8 });
      drawR(fmtMoney(grandFinalPay), C.finalPay, y, { bold: true, size: 8 });
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
      const [addressLine1, addressLine2, addressLine3] = splitAddressLines(address);

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
      const caCommissionRows: CommissionReportRow[] = [];

      for (const event of events || []) {
        const worker = matchedUserId
          ? (event.workers || []).find((w: any) => w?.user_id === matchedUserId) || event.workers?.[0]
          : event.workers?.[0];
        const paymentData = worker?.payment_data;
        const workedHoursFromTimeEntries = Number(worker?.worked_hours || 0);

        const shouldRenderRow = !!worker && (workedHoursFromTimeEntries > 0 || !!paymentData);
        if (!shouldRenderRow) continue;

        const {
          baseRate,
          vendorCountForCommission,
          perVendorCommissionShare,
          commissionPoolDollars,
          workers: eventWorkers,
          totalTipsEvent,
          totalEventHours
        } = getPayrollInputsForEvent(event);

        const evtPaySummaryCa = event?.event_payment || event?.eventPayment || event?.event_payment_summary || null;
        const evtNetSalesCa = Number(evtPaySummaryCa?.net_sales || 0);

        const regHours = Number(paymentData?.regular_hours || 0);
        const otHours = Number(paymentData?.overtime_hours || 0);
        const dtHours = Number(paymentData?.doubletime_hours || 0);
        const actualHoursFromPayment = paymentData?.actual_hours != null ? Number(paymentData.actual_hours) || 0 : 0;
        const actualHours =
          actualHoursFromPayment > 0
            ? actualHoursFromPayment
            : workedHoursFromTimeEntries > 0
              ? workedHoursFromTimeEntries
              : regHours + otHours + dtHours;
        const displayHours = getDisplayHoursForWorker(worker);

        const eventId = (event?.id || "").toString();
        const priorWeeklyHours = azNyMode ? (weeklyPriorHoursByEventId[eventId]?.[worker?.user_id] || 0) : 0;
        const isWeeklyOT = azNyMode && (priorWeeklyHours + actualHours) > 40;

        const extAmtRegular = actualHours * baseRate;
        const extAmtOnRegRateNonAzNy = actualHours * baseRate * 1.5;

        let commissionAmt = 0;
        let totalFinalCommissionAmt = 0;
        let loadedRateBase = actualHours > 0 ? baseRate : 0;
        let computedOtRate = 0;
        let extAmtOnRegRate = 0;

        if (azNyMode) {
          const items: AzNyCommissionCalcItem[] = (eventWorkers || []).map((w: any) => {
            const wh = getActualHoursForWorker(w);
            const div = w?.division;
            const divNorm = normalizeDivision(div);
            const eligible = !isTrailersDivision(div) && (isVendorDivision(div) || divNorm === "") && wh > 0;
            const prior = weeklyPriorHoursByEventId[eventId]?.[w?.user_id] || 0;
            const wIsWeeklyOT = (prior + wh) > 40;
            return {
              eligible,
              actualHours: wh,
              extAmtRegular: wh * baseRate,
              isWeeklyOT: wIsWeeklyOT,
            };
          });

          const commissionPerVendorAzNy = computeAzNyCommissionPerVendor(items, commissionPoolDollars);
          const isEligibleThisWorker =
            !!worker &&
            !isTrailersDivision(worker?.division) &&
            (isVendorDivision(worker?.division) || normalizeDivision(worker?.division) === "") &&
            actualHours > 0;
          commissionAmt = isEligibleThisWorker ? commissionPerVendorAzNy : 0;

          const totalFinalCommissionBase = actualHours > 0 ? Math.max(150, extAmtRegular + commissionAmt) : 0;
          loadedRateBase = actualHours > 0 ? (totalFinalCommissionBase / actualHours) : baseRate;
          computedOtRate = isWeeklyOT ? loadedRateBase * 1.5 : 0;
          extAmtOnRegRate = isWeeklyOT ? (computedOtRate * actualHours) : extAmtRegular;
          totalFinalCommissionAmt = actualHours > 0 ? (isWeeklyOT ? extAmtOnRegRate : totalFinalCommissionBase) : 0;
        } else {
          extAmtOnRegRate = extAmtOnRegRateNonAzNy;
          commissionAmt =
            !isTrailersDivision(worker?.division) && actualHours > 0 && vendorCountForCommission > 0
              ? Math.max(0, perVendorCommissionShare - extAmtOnRegRateNonAzNy)
              : 0;
          totalFinalCommissionAmt = actualHours > 0 ? Math.max(150, extAmtOnRegRateNonAzNy + commissionAmt) : 0;
          loadedRateBase = actualHours > 0 ? (totalFinalCommissionAmt / actualHours) : baseRate;
        }

        const tipsFromPayment = Number(paymentData?.tips || 0);
        const proratedTips =
          totalEventHours > 0 && totalTipsEvent > 0
            ? totalTipsEvent * (actualHours / totalEventHours)
            : 0;
        // For paystub display/pay, use the persisted vendor tip when available;
        // fall back to pro-rated event tips if needed.
        const tips = tipsFromPayment > 0 ? tipsFromPayment : proratedTips;
        // Use stored Total Final Commission from event-dashboard payment tab (regular_pay + commissions).
        // Falls back to recomputed value if payment data has not been saved yet.
        const storedFinalCommission = Number(paymentData?.regular_pay || 0) + Number(paymentData?.commissions || 0);
        const commission = storedFinalCommission > 0 ? storedFinalCommission : totalFinalCommissionAmt;
        const other = Number(worker?.adjustment_amount || 0);

        const regPay = Number(paymentData?.regular_pay || 0);
        const otPay = Number(paymentData?.overtime_pay || 0);
        const dtPay = Number(paymentData?.doubletime_pay || 0);

        const restBreak = includeRestBreakColumn ? getRestBreakAmount(actualHours, paystubState) : 0;
        const computedTotalPay = commission + tips + restBreak;
        const computedTotalGrossPay = computedTotalPay + other;

        if (commissionPoolDollars > 0 || perVendorCommissionShare > 0) {
          caCommissionRows.push({
            dateStr: (event.event_date || '').toString().split('T')[0],
            show: (event?.artist ?? event?.name ?? '').toString(),
            stadium: (event?.venue ?? '').toString(),
            adjGrossSales: evtNetSalesCa,
            commissionPool: commissionPoolDollars,
            numEmployees: vendorCountForCommission,
            commissionPerEmployee: perVendorCommissionShare,
            finalPay: computedTotalGrossPay,
          });
        }

        totalRegHours += regHours;
        totalOtHours += otHours;
        totalDtHours += dtHours;
        totalHoursWorked += displayHours;
        totalTips += tips;
        totalCommission += commission;
        totalRestBreak += restBreak;
        totalOther += other;
        totalGross += computedTotalGrossPay;
        totalRegularPayAmount += regPay;
        totalOvertimePayAmount += otPay;
        totalDoubletimePayAmount += dtPay;
      }

      const federalIncomeAmt = parseAmount(federalIncome);
      const socialSecurityAmt = parseAmount(socialSecurity);
      const medicareAmt = parseAmount(medicare);
      const stateIncomeAmt = parseAmount(stateIncome);
      const stateDIAmt = parseAmount(stateDI);
      const miscDeductionAmt = parseAmount(miscDeduction);
      const reimbursement = parseAmount(miscReimbursement, false);
      const totalDeductions =
        federalIncomeAmt +
        socialSecurityAmt +
        medicareAmt +
        stateIncomeAmt +
        stateDIAmt +
        miscDeductionAmt;
      const mealPremiumThisPeriod = Math.abs(Number(mealPremium) || 0);
      const sickThisPeriod = Math.abs(Number(sick) || 0);
      const netPay = totalGross + mealPremiumThisPeriod + sickThisPeriod - totalDeductions + reimbursement;
      const effectiveRate = totalHoursWorked > 0 ? totalCommission / totalHoursWorked : 0;

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
      const ytdRegularPay = runningYtd(ytdSnapshot?.regular_earnings, totalRegularPayAmount);
      const ytdOvertimePay = runningYtd(ytdSnapshot?.overtime_earnings, totalOvertimePayAmount);
      const ytdDoubleTimePay = runningYtd(ytdSnapshot?.doubletime_earnings, totalDoubletimePayAmount);
      const ytdWorkedHours = Math.max(0, ytdRegularHours + ytdOvertimeHours + ytdDoubleTimeHours);
      const ytdCommission = totalCommission;
      const ytdTips = totalTips;
      const ytdRestBreak = totalRestBreak;
      const ytdMealPremium = mealPremiumThisPeriod;
      const ytdSick = sickThisPeriod;
      const ytdGross = runningYtd(ytdSnapshot?.ytd_gross, totalGross);
      const ytdFederalIncome = runningYtd(ytdSnapshot?.federal_income_ytd, federalIncomeAmt);
      const ytdSocialSecurity = runningYtd(ytdSnapshot?.social_security_ytd, socialSecurityAmt);
      const ytdMedicare = runningYtd(ytdSnapshot?.medicare_ytd, medicareAmt);
      const ytdStateIncome = runningYtd(ytdSnapshot?.ca_state_income_ytd, stateIncomeAmt);
      const ytdStateDI = runningYtd(ytdSnapshot?.ca_state_di_ytd, stateDIAmt);
      const ytdNet = runningYtd(ytdSnapshot?.ytd_net, netPay);

      // Period-specific: hours accrued this pay period = hours worked / 30
      const SICK_ACCRUAL_RATE = 30;
      const sickAccruedThisPeriod =
        totalHoursWorked > 0 ? totalHoursWorked / SICK_ACCRUAL_RATE : 0;

      // Sick leave breakdown for this pay period and YTD
      let sickTakenThisPeriod = 0;
      let sickTakenYtdFromJan = Number(sickLeave?.total_hours || 0); // fallback if DB query fails
      let sickCarryOverYtd = 0;
      let sickAccruedYtd = Number(sickLeave?.accrued_hours || 0); // fallback if DB query fails
      let sickBalanceYtd = Number(sickLeave?.balance_hours || 0); // fallback if DB query fails

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

      const overtimeRateAvg = totalOtHours > 0 ? (totalOvertimePayAmount / totalOtHours) : 0;
      const doubleTimeRateAvg = totalDtHours > 0 ? (totalDoubletimePayAmount / totalDtHours) : 0;

      const earningsRows = [
        { y: 200, label: "Regular", color: black, rate: 0, hours: 0, thisPeriod: totalRegularPayAmount, ytd: ytdRegularPay, hideThisPeriod: true },
        { y: 208, label: "Overtime", color: black, rate: overtimeRateAvg, hours: totalOtHours, thisPeriod: totalOvertimePayAmount, ytd: ytdOvertimePay },
        { y: 216, label: "Credit card tips owed", color: black, rate: 0, hours: 0, thisPeriod: totalTips, ytd: ytdTips },
        { y: 224, label: "Commission", color: black, rate: effectiveRate, hours: totalHoursWorked, thisPeriod: totalCommission, ytd: ytdCommission },
        { y: 232, label: "Double-time", color: black, rate: doubleTimeRateAvg, hours: totalDtHours, thisPeriod: totalDoubletimePayAmount, ytd: ytdDoubleTimePay },
        { y: 240, label: "Rest Break", color: black, rate: 0, hours: 0, thisPeriod: totalRestBreak, ytd: ytdRestBreak },
        { y: 248, label: "Sick", color: black, rate: 0, hours: 0, thisPeriod: sickThisPeriod, ytd: ytdSick },
        { y: 256, label: "Meal Premium", color: black, rate: 0, hours: 0, thisPeriod: mealPremiumThisPeriod, ytd: ytdMealPremium },
      ];

      for (const row of earningsRows) {
        drawTopText(row.label, 43, row.y, { size: 8, color: row.color });
        if (row.rate > 0) drawTopText(fmt(row.rate), 145, row.y, { size: 8 });
        if (row.hours > 0) drawTopText(Number(row.hours).toFixed(2), 210, row.y, { size: 8 });
        if (!(row as any).hideThisPeriod) drawTopText(fmt(row.thisPeriod), 265, row.y, { size: 8 });
      }

      drawTopLine(40, 259, 332);
      drawTopText("Gross Pay", 95, 266, { size: 8, bold: true });
      drawTopText(money(totalGross + mealPremiumThisPeriod + sickThisPeriod), 255, 266, { size: 8, bold: true });

      drawTopText("Statutory Deductions", 112, 277, { size: 8, bold: true });
      drawTopText("this period", 233, 277, { size: 8 });
      drawTopText("year to date", 289, 277, { size: 8 });
      drawTopLine(109, 284, 332);

      const deductionRows = [
        { y: 297.1, label: "Federal Income", thisPeriod: -federalIncomeAmt, ytd: ytdFederalIncome },
        { y: 304.3, label: "Social Security", thisPeriod: -socialSecurityAmt, ytd: ytdSocialSecurity },
        { y: 311.8, label: "Medicare", thisPeriod: -medicareAmt, ytd: ytdMedicare },
        { y: 319.0, label: "California State Income", thisPeriod: -stateIncomeAmt, ytd: ytdStateIncome },
        { y: 326.4, label: "California State DI", thisPeriod: -stateDIAmt, ytd: ytdStateDI },
      ];

      for (const row of deductionRows) {
        drawTopText(row.label, 112, row.y, { size: 8 });
        drawTopText(fmt(row.thisPeriod), 249, row.y, { size: 8 });
        drawTopText(fmt(row.ytd), 299, row.y, { size: 8 });
      }

      if (miscDeductionAmt > 0) {
        drawTopText("Misc Deduction", 112, 333.8, { size: 8 });
        drawTopText(fmt(-miscDeductionAmt), 249, 333.8, { size: 8 });
        drawTopText(fmt(miscDeductionAmt), 299, 333.8, { size: 8 });
      }

      drawTopLine(109, 326, 332);
      drawTopText("Net Pay", 112, 335, { size: 8, bold: true });
      drawTopText(money(netPay), 240, 335, { size: 8, bold: true });
      drawTopText(money(ytdNet), 286, 335, { size: 8, bold: true });

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

      drawTopText(`Your federal taxable wages this period are ${money(totalGross)}`, 349.4, 518.0, { size: 8 });

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
    drawText(address || '', 50, yPosition);
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

      const shouldRenderRow = useVendorLayout
        ? !!worker && (workedHoursFromTimeEntries > 0 || !!paymentData)
        : !!paymentData;

      if (shouldRenderRow) {
        const { eventState, baseRate, vendorCountForCommission, perVendorCommissionShare, commissionPoolDollars, workers: eventWorkers, totalTipsEvent, totalEventHours } = getPayrollInputsForEvent(event);
        const evtPaySummaryNonCa = event?.event_payment || event?.eventPayment || event?.event_payment_summary || null;
        const evtNetSalesNonCa = Number(evtPaySummaryNonCa?.net_sales || 0);

        const regHours = Number(paymentData?.regular_hours || 0);
        const otHours = Number(paymentData?.overtime_hours || 0);
        const dtHours = Number(paymentData?.doubletime_hours || 0);
        const actualHoursFromPayment = paymentData?.actual_hours != null ? Number(paymentData.actual_hours) || 0 : 0;
        const actualHours =
          actualHoursFromPayment > 0
            ? actualHoursFromPayment
            : workedHoursFromTimeEntries > 0
              ? workedHoursFromTimeEntries
              : regHours + otHours + dtHours;
        const displayHours = getDisplayHoursForWorker(worker);
        const hoursSource =
          actualHoursFromPayment > 0 ? 'payment_data.actual_hours' :
          workedHoursFromTimeEntries > 0 ? 'worker.worked_hours(time_entries)' :
          'sum(regular+ot+dt)';

        const isAZorNY = azNyMode;

        const eventId = (event?.id || "").toString();
        const priorWeeklyHours = isAZorNY ? (weeklyPriorHoursByEventId[eventId]?.[worker?.user_id] || 0) : 0;
        const isWeeklyOT = isAZorNY && (priorWeeklyHours + actualHours) > 40;

        const extAmtRegular = actualHours * baseRate;
        const extAmtOnRegRateNonAzNy = actualHours * baseRate * 1.5;

        // Commission Amt + Total Final Commission Amt
        let commissionAmt = 0;
        let totalFinalCommissionBase = 0;
        let loadedRateBase = actualHours > 0 ? baseRate : baseRate;
        let computedOtRate = 0;
        let extAmtOnRegRate = 0;
        let totalFinalCommissionAmt = 0;

        if (isAZorNY) {
          const items: AzNyCommissionCalcItem[] = (eventWorkers || []).map((w: any) => {
            const wh = getActualHoursForWorker(w);
            const div = w?.division;
            const divNorm = normalizeDivision(div);
            const eligible = !isTrailersDivision(div) && (isVendorDivision(div) || divNorm === "") && wh > 0;
            const prior = weeklyPriorHoursByEventId[eventId]?.[w?.user_id] || 0;
            const wIsWeeklyOT = (prior + wh) > 40;
            return {
              eligible,
              actualHours: wh,
              extAmtRegular: wh * baseRate,
              isWeeklyOT: wIsWeeklyOT,
            };
          });

          const commissionPerVendorAzNy = computeAzNyCommissionPerVendor(items, commissionPoolDollars);
          const isEligibleThisWorker =
            !!worker &&
            !isTrailersDivision(worker?.division) &&
            (isVendorDivision(worker?.division) || normalizeDivision(worker?.division) === "") &&
            actualHours > 0;

          commissionAmt = isEligibleThisWorker ? commissionPerVendorAzNy : 0;

          totalFinalCommissionBase = actualHours > 0 ? Math.max(150, extAmtRegular + commissionAmt) : 0;
          loadedRateBase = actualHours > 0 ? (totalFinalCommissionBase / actualHours) : baseRate;
          computedOtRate = isWeeklyOT ? loadedRateBase * 1.5 : 0;

          // Ext Amt on Reg Rate: AZ/NY = baseRate x hours; if weekly OT (>40h), use OT rate x hours
          extAmtOnRegRate = isWeeklyOT ? (computedOtRate * actualHours) : extAmtRegular;

          // When weekly OT applies, Ext Amt already reflects the OT multiplier on Loaded Rate, so don't add commission again.
          totalFinalCommissionAmt = actualHours > 0 ? (isWeeklyOT ? extAmtOnRegRate : totalFinalCommissionBase) : 0;
        } else {
          extAmtOnRegRate = extAmtOnRegRateNonAzNy;
          commissionAmt =
            !isTrailersDivision(worker?.division) && actualHours > 0 && vendorCountForCommission > 0
              ? Math.max(0, perVendorCommissionShare - extAmtOnRegRateNonAzNy)
              : 0;
          totalFinalCommissionAmt = actualHours > 0 ? Math.max(150, extAmtOnRegRateNonAzNy + commissionAmt) : 0;
          loadedRateBase = actualHours > 0 ? (totalFinalCommissionAmt / actualHours) : baseRate;
          computedOtRate = 0;
        }

        const tipsFromPayment = Number(paymentData?.tips || 0);
        const proratedTips =
          totalEventHours > 0 && totalTipsEvent > 0
            ? totalTipsEvent * (actualHours / totalEventHours)
            : 0;
        // For paystub display/pay, use the persisted vendor tip when available;
        // fall back to pro-rated event tips if needed.
        const tips = tipsFromPayment > 0 ? tipsFromPayment : proratedTips;
        // Use stored Total Final Commission from event-dashboard payment tab (regular_pay + commissions).
        // Falls back to recomputed value if payment data has not been saved yet.
        const storedFinalCommission = Number(paymentData?.regular_pay || 0) + Number(paymentData?.commissions || 0);
        const commission = storedFinalCommission > 0 ? storedFinalCommission : totalFinalCommissionAmt;
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
        const restBreak = includeRestBreakColumn ? getRestBreakAmount(actualHours, paystubState) : 0;

        // Total (gross) used for "This Period" and Net Pay.
        // If persisted total_pay exists and is non-zero, keep it for non-CA; otherwise use computed.
        const persistedTotal = Number(paymentData?.total_pay || 0);
        const persistedTotalGrossPay = persistedTotal + other;
        const computedTotalPay = commission + tips + restBreak;
        const computedTotalGrossPay = computedTotalPay + other;
        const total = (!useVendorLayout && persistedTotal > 0) ? persistedTotalGrossPay : computedTotalGrossPay;

        if (commissionPoolDollars > 0 || perVendorCommissionShare > 0) {
          nonCaCommissionRows.push({
            dateStr: (event.event_date || '').toString().split('T')[0],
            show: (event?.artist ?? event?.name ?? '').toString(),
            stadium: (event?.venue ?? '').toString(),
            adjGrossSales: evtNetSalesNonCa,
            commissionPool: commissionPoolDollars,
            numEmployees: vendorCountForCommission,
            commissionPerEmployee: perVendorCommissionShare,
            finalPay: total,
          });
        }

        totalRegHours += regHours;
        totalOtHours += otHours;
        totalDtHours += dtHours;
        totalHoursWorked += displayHours;
        totalTips += tips;
        totalCommission += commission;
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
            actualHoursFromPayment,
            regHours,
            otHours,
            dtHours,
            actualHours,
            hoursSource,
            eventState,
            paystubState,
            azNyMode,
            baseRate,
            perVendorCommissionShare,
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

    // Gross Pay
    yPosition -= 20;
    drawText("Gross Pay", 50, yPosition, { bold: true, size: 11 });
    drawText(`This Period: $${totalGross.toFixed(2)}`, 400, yPosition, { bold: true });

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
    let totalDeductions = 0;

    deductions.forEach(deduction => {
      totalDeductions += deduction.value;
      drawText(deduction.label, 50, yPosition, { size: 9 });
      drawText(`-${deduction.value.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
    });

    const sickLeaveDisplayY = yPosition +60;
    if (sickLeave) {
      drawText("Sick Leave Summary", 360, sickLeaveDisplayY + 12, { bold: true, size: 9 });
      drawText(`Hours Used: ${sickLeave.total_hours.toFixed(2)}`, 360, sickLeaveDisplayY, { size: 8 });
      drawText(`Hours Accrued: ${sickLeave.accrued_hours.toFixed(2)}`, 360, sickLeaveDisplayY - 12, { size: 8 });
      drawText(`Balance: ${sickLeave.balance_hours.toFixed(2)}`, 360, sickLeaveDisplayY - 24, { size: 8 });
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
    const mealPremiumAmt = Math.abs(Number(mealPremium) || 0);
    const netPay = totalGross + mealPremiumAmt - totalDeductions + reimbursement;
    drawText("Net Pay", 50, yPosition, { bold: true, size: 12 });
    drawText(`$${netPay.toFixed(2)}`, 250, yPosition, { bold: true, size: 12 });

    if (sickLeave) {
      yPosition -= 20;
      drawText("Sick Leave Summary", 50, yPosition, { bold: true, size: 10 });
      yPosition -= 12;
      drawText(`Hours Used: ${sickLeave.total_hours.toFixed(2)}`, 50, yPosition, { size: 9 });
      drawText(`Hours Accrued: ${sickLeave.accrued_hours.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
      drawText(`Balance: ${sickLeave.balance_hours.toFixed(2)}`, 50, yPosition, { size: 9 });
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
    drawText(address || '', 50, yPosition, { size: 9 });

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
