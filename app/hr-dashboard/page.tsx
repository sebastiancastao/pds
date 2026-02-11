"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption";
import "@/app/global-calendar/dashboard-styles.css";
import * as XLSX from 'xlsx';

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string;
  position: string;
  hire_date: string;
  status: "active" | "on_leave" | "inactive";
  salary: number;
  profile_photo_url?: string | null;
  state: string;
  city: string | null;
  performance_score: number;
  projects_completed: number;
  attendance_rate: number;
  customer_satisfaction: number;
};

type BackgroundCheck = {
  id: string;
  vendor_id: string;
  status?: "pending" | "approved" | "rejected" | "in_progress";
  background_check_completed?: boolean | null;
  check_date: string;
  verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function HRDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialView = (searchParams?.get("view") as "overview" | "employees" | "payments" | "forms" | "paystub" | null) || "overview";
  const initialFormState = searchParams?.get("state") || "all";

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [hrView, setHrView] = useState<"overview" | "employees" | "payments" | "forms" | "paystub">(initialView);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState<string>("");
  const [backgroundChecks, setBackgroundChecks] = useState<BackgroundCheck[]>([]);
  const [selectedState, setSelectedState] = useState<string>("all");
  const [selectedEmployeeRegion, setSelectedEmployeeRegion] = useState<string>("all");
  const [regions, setRegions] = useState<Array<{ id: string; name: string; vendor_count?: number }>>([]);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeesError, setEmployeesError] = useState<string>("");
  // Payroll tab state
  const [paymentsStartDate, setPaymentsStartDate] = useState<string>("");
  const [paymentsEndDate, setPaymentsEndDate] = useState<string>("");
  const [paymentsByVenue, setPaymentsByVenue] = useState<Array<{ venue: string; city?: string | null; state?: string | null; totalPayment: number; totalHours: number; events: any[] }>>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string>("");
  const [sendingEmails, setSendingEmails] = useState(false);
  const normalizeState = (s?: string | null) => (s || "").toUpperCase().trim();
  const normalizeDivision = (d?: string | null) => (d || "").toString().toLowerCase().trim();
  const isTrailersDivision = (d?: string | null) => normalizeDivision(d) === "trailers";
  const isVendorDivision = (d?: string | null) => {
    const div = normalizeDivision(d);
    return div === "vendor" || div === "both";
  };
  const isEventDashboardPaymentState = (s?: string | null) => {
    const st = normalizeState(s);
    return st === "CA" || st === "NV" || st === "WI";
  };
  const getRestBreakAmount = (actualHours: number, stateCode: string) => {
    const st = normalizeState(stateCode);
    if (st === "NV" || st === "WI" || st === "AZ" || st === "NY") return 0;
    if (actualHours <= 0) return 0;
    return actualHours >= 10 ? 12 : 9;
  };
  const getEffectiveHours = (payment: any): number => {
    const actual = Number(payment?.actual_hours ?? payment?.actualHours ?? 0);
    if (actual > 0) return actual;
    const worked = Number(payment?.worked_hours ?? payment?.workedHours ?? 0);
    if (worked > 0) return worked;
    const reg = Number(payment?.regular_hours ?? payment?.regularHours ?? 0);
    const ot = Number(payment?.overtime_hours ?? payment?.overtimeHours ?? 0);
    const dt = Number(payment?.doubletime_hours ?? payment?.doubletimeHours ?? 0);
    const summed = reg + ot + dt;
    return summed > 0 ? summed : 0;
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

    let commissionPerVendor = 0;
    for (let iter = 0; iter < 20; iter++) {
      const sumExtAmtOnRegRate = eligibleItems.reduce((sum, i) => {
        if (!i.isWeeklyOT) return sum + i.extAmtRegular;
        const totalFinalCommissionBase = Math.max(150, i.extAmtRegular + commissionPerVendor);
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

  // Editable adjustments: eventId -> (userId -> amount)
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, number>>>({});
  const [editingCell, setEditingCell] = useState<{ eventId: string; userId: string } | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  // Onboarding forms state
  const [onboardingForms, setOnboardingForms] = useState<any[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [formsError, setFormsError] = useState<string>('');
  const [uploadingForm, setUploadingForm] = useState(false);
  const [filterFormState, setFilterFormState] = useState<string>(initialFormState);
  const [filterFormCategory, setFilterFormCategory] = useState<string>('all');

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem('mfa_verified');
      sessionStorage.removeItem('mfa_checkpoint');
      await supabase.auth.signOut();
    } finally {
      router.push('/login');
    }
  };

  const loadEmployees = useCallback(async (stateFilter?: string, regionFilter?: string) => {
    setLoadingEmployees(true);
    setEmployeesError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      const s = stateFilter ?? selectedState;
      const r = regionFilter ?? selectedEmployeeRegion;
      if (s && s !== "all") params.append("state", s);
      if (r && r !== "all") {
        params.append("region_id", r);
        // Toggle to true to use geographic filtering if your regions use radius/center
        // params.append("geo_filter", "true");
      }

      const res = await fetch(`/api/employees${params.toString() ? `?${params.toString()}` : ""}` , {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load employees");

      setEmployees(data.employees || []);
      if (data.stats?.states) setAvailableStates(data.stats.states);
    } catch (err: any) {
      setEmployeesError(err.message || "Failed to load employees");
    }
    setLoadingEmployees(false);
  }, [selectedState, selectedEmployeeRegion]);

  const loadBackgroundChecks = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/background-checks', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load background checks');

      const vendors = json.vendors || [];
      const checks = vendors.map((v: any) => {
        const bc = v.background_check || {};
        return {
          id: bc.id || v.id,
          vendor_id: v.id,
          status: undefined,
          background_check_completed: !!bc.background_check_completed,
          check_date: bc.check_date || bc.completed_date || new Date().toISOString(),
          verified_by: bc.verified_by || null,
          completed_date: bc.completed_date || null,
          notes: bc.notes || null,
          created_at: bc.created_at || v.created_at || new Date().toISOString(),
          updated_at: bc.updated_at || v.updated_at || bc.completed_date || new Date().toISOString(),
        } as BackgroundCheck;
      });
      setBackgroundChecks(checks);
    } catch (err) {
      // ignore for now
      setBackgroundChecks([]);
    }
  }, []);

  const loadRegions = useCallback(async () => {
    try {
      setLoadingRegions(true);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/regions?with_vendor_count=true', {
        method: 'GET',
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (res.ok) {
        const data = await res.json();
        setRegions(data.regions || []);
      }
    } catch (e) {
      // ignore regions fetch error for now
    } finally {
      setLoadingRegions(false);
    }
  }, []);

  // Gate access: 'admin', 'hr', and 'exec'
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          setIsAuthorized(false);
          setAuthChecking(false);
          router.push('/login');
          return;
        }
        const { data, error } = await (supabase
          .from('users')
          .select('role')
          .eq('id', userId)
          .single() as any);
        const role = (data?.role || '').toString().trim().toLowerCase();
        if (!error && (role === 'admin' || role === 'hr' || role === 'exec')) {
          setIsAuthorized(true);
        } else {
          setIsAuthorized(false);
          router.push('/dashboard');
        }
      } catch {
        setIsAuthorized(false);
        router.push('/dashboard');
      } finally {
        setAuthChecking(false);
      }
    };
    checkAccess();
  }, [router]);

  // Load data after auth ok
  useEffect(() => {
    if (!isAuthorized) return;
    loadEmployees();
    loadBackgroundChecks();
    loadRegions();
  }, [isAuthorized, loadEmployees, loadBackgroundChecks, loadRegions]);

  // Payments loader (aligned with Global Calendar payments tab)
  const loadPaymentsData = useCallback(async () => {
    setLoadingPayments(true);
    setPaymentsError("");
    setPaymentsByVenue([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[HR PAYMENTS] loading events for HR dashboard');
      const eventsRes = await fetch('/api/all-events', {
        method: 'GET',
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (!eventsRes.ok) {
        const err = await eventsRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load events');
      }
      const eventsJson = await eventsRes.json();
      const allEvents = Array.isArray(eventsJson.events) ? eventsJson.events : [];
      console.log('[HR PAYMENTS] all events fetched', { count: allEvents.length, sample: allEvents.slice(0, 3).map((e: any) => ({ id: e.id, name: e.event_name, date: e.event_date })) });
      if (allEvents.length === 0) {
        setPaymentsError('No events found in the database.');
        setLoadingPayments(false);
        return;
      }
      let filtered = allEvents as any[];
      if (paymentsStartDate) filtered = filtered.filter(e => !e.event_date || e.event_date >= paymentsStartDate);
      if (paymentsEndDate) filtered = filtered.filter(e => !e.event_date || e.event_date <= paymentsEndDate);
      console.log('[HR PAYMENTS] filtered events', { count: filtered.length, start: paymentsStartDate, end: paymentsEndDate });
      const filteredEventIds = filtered.map((e: any) => e.id).filter(Boolean);
      const eventIds = filteredEventIds.join(',');
      if (!eventIds) { setPaymentsByVenue([]); setLoadingPayments(false); return; }
      // Fetch vendor payments for filtered events (same data model as Global Calendar)
      const payRes = await fetch(`/api/vendor-payments?event_ids=${encodeURIComponent(eventIds)}`, {
        method: 'GET',
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (!payRes.ok) {
        const err = await payRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load vendor payments');
      }
      const payJson = await payRes.json();
      const paymentsByEventId = payJson.paymentsByEvent || {};
      console.log('[HR PAYMENTS] vendor-payments response', {
        keys: Object.keys(paymentsByEventId),
        totals: {
          totalVendorPayments: payJson.totalVendorPayments,
          totalEventPayments: payJson.totalEventPayments,
          totalAdjustments: payJson.totalAdjustments,
        }
      });
      const configuredBaseRatesByState: Record<string, number> = {};
      try {
        const ratesRes = await fetch('/api/rates', {
          method: 'GET',
          headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        });
        if (ratesRes.ok) {
          const ratesJson = await ratesRes.json();
          for (const row of ratesJson?.rates || []) {
            const stateCode = normalizeState(row?.state_code);
            const baseRate = Number(row?.base_rate || 0);
            if (stateCode && baseRate > 0) configuredBaseRatesByState[stateCode] = baseRate;
          }
        } else {
          console.warn('[HR PAYMENTS] Failed to load /api/rates for base rates, using fallback values.');
        }
      } catch (e) {
        console.warn('[HR PAYMENTS] Error loading /api/rates for base rates, using fallback values.', e);
      }
      const getConfiguredBaseRate = (stateCode?: string | null) => {
        const st = normalizeState(stateCode);
        const configured = Number(configuredBaseRatesByState[st] || 0);
        if (configured > 0) return configured;
        return 17.28;
      };
      const byVenue: Record<string, { venue: string; city?: string | null; state?: string | null; totalPayment: number; totalHours: number; events: any[] }> = {};

      // Show ALL filtered events, not just those with payment data
      const eventsMap: Record<string, any> = Object.fromEntries(allEvents.map((e: any) => [e.id, e]));

      console.log('[HR PAYMENTS] Processing filtered events:', { filteredCount: filtered.length, withPaymentData: Object.keys(paymentsByEventId).length });

      // AZ/NY: fetch prior weekly hours for OT rate display (Mon..day before event)
      let weeklyHoursMap: Record<string, Record<string, number>> = {};
      const azNyEvents = filtered.filter((e: any) => {
        const st = normalizeState(e.state);
        return st === "AZ" || st === "NY";
      });
      if (azNyEvents.length > 0) {
        const weeklyHoursRequests = azNyEvents.map((e: any) => {
          const epd = paymentsByEventId[e.id];
          const userIds = epd?.vendorPayments
            ? epd.vendorPayments.map((vp: any) => vp.user_id).filter(Boolean)
            : [];
          return { event_id: e.id, event_date: e.event_date, user_ids: userIds };
        }).filter((r: any) => r.event_date && r.user_ids.length > 0);
        if (weeklyHoursRequests.length > 0) {
          try {
            const whRes = await fetch(
              `/api/weekly-hours?events=${encodeURIComponent(JSON.stringify(weeklyHoursRequests))}`,
              { headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) } }
            );
            if (whRes.ok) weeklyHoursMap = await whRes.json();
          } catch (err) {
            console.error('[HR PAYMENTS] Failed to fetch weekly hours:', err);
          }
        }
      }


      for (const eventInfo of filtered) {
        const eventId = eventInfo.id;
        const eventPaymentData = paymentsByEventId[eventId];
        const eventState = normalizeState(eventInfo.state) || "CA";
        const configuredBaseRate = getConfiguredBaseRate(eventState);

        // Initialize venue entry
        if (!byVenue[eventInfo.venue]) {
          byVenue[eventInfo.venue] = {
            venue: eventInfo.venue,
            city: eventInfo.city,
            state: eventInfo.state,
            totalPayment: 0,
            totalHours: 0,
            events: []
          };
        }

        // If no payment data exists for this event, check if there's an assigned team
        if (!eventPaymentData || !Array.isArray(eventPaymentData.vendorPayments) || eventPaymentData.vendorPayments.length === 0) {
          console.log('[HR PAYMENTS] Event without payment data, checking for team:', eventId, eventInfo.event_name);

          // Fetch event team to show assigned staff even without payment calculations
          try {
            const teamRes = await fetch(`/api/events/${eventId}/team`, {
              method: 'GET',
              headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
            });

            if (teamRes.ok) {
              const teamData = await teamRes.json();
              const teamMembers = teamData.team || [];

              if (teamMembers.length > 0) {
                console.log('[HR PAYMENTS] Found team members:', teamMembers.length);

                // Map team members to payment format with zeros
                const teamPayments = teamMembers.map((member: any) => {
                  const user = member.users;
                  const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
                  const firstName = profile?.first_name || 'N/A';
                  const lastName = profile?.last_name || '';

                  return {
                    userId: member.vendor_id,
                    firstName,
                    lastName,
                    email: user?.email || 'N/A',
                    actualHours: 0,
                    regularHours: 0,
                    regularPay: 0,
                    overtimeHours: 0,
                    overtimePay: 0,
                    doubletimeHours: 0,
                    doubletimePay: 0,
                    commissions: 0,
                    tips: 0,
                    totalPay: 0,
                    adjustmentAmount: 0,
                    finalPay: 0,
                    status: member.status // Include confirmation status
                  };
                });

                byVenue[eventInfo.venue].events.push({
                  id: eventId,
                  name: eventInfo.event_name,
                  date: eventInfo.event_date,
                  state: eventInfo.state,
                  baseRate: configuredBaseRate,
                  eventTotal: 0,
                  eventHours: 0,
                  payments: teamPayments
                });
                continue;
              }
            }
          } catch (e) {
            console.error('[HR PAYMENTS] Failed to fetch team for event:', eventId, e);
          }

          // No team found either, add empty event
          byVenue[eventInfo.venue].events.push({
            id: eventId,
            name: eventInfo.event_name,
            date: eventInfo.event_date,
            state: eventInfo.state,
            baseRate: configuredBaseRate,
            eventTotal: 0,
            eventHours: 0,
            payments: []
          });
          continue;
        }

        // Process events with payment data
        const vendorPayments = eventPaymentData.vendorPayments;
        const eventPaymentSummary = eventPaymentData.eventPayment || {};
        const summaryBaseRate = Number(eventPaymentSummary.base_rate || 0);
        const baseRate = configuredBaseRate > 0 ? configuredBaseRate : (summaryBaseRate > 0 ? summaryBaseRate : 17.28);
        console.log('[HR PAYMENTS] Event with payment data:', eventId, eventInfo.event_name, { vendorCount: vendorPayments.length });

        // Total team members on this event
        const memberCount = Array.isArray(vendorPayments) ? vendorPayments.length : 0;

        // Commission pool in dollars — try event_payments first, then compute from events table
        let commissionPoolDollars =
          Number(eventPaymentSummary.commission_pool_dollars || 0) ||
          (Number(eventPaymentSummary.net_sales || 0) * Number(eventPaymentSummary.commission_pool_percent || 0)) ||
          0;
        // Fallback: compute from the events table fields (always available after Sales tab save)
        if (commissionPoolDollars === 0 && Number(eventInfo.commission_pool || 0) > 0) {
          const ticketSales = Number(eventInfo.ticket_sales || 0);
          const eventTips = Number(eventInfo.tips || 0);
          const taxRate = Number(eventInfo.tax_rate_percent || 0);
          const totalSales = Math.max(ticketSales - eventTips, 0);
          const tax = totalSales * (taxRate / 100);
          const netSales = Number(eventPaymentSummary.net_sales || 0) || Math.max(totalSales - tax, 0);
          commissionPoolDollars = netSales * Number(eventInfo.commission_pool);
        }
        const isAZorNY = eventState === "AZ" || eventState === "NY";

        // Vendor count for commission allocation
        const vendorCountEligible = vendorPayments.reduce((count: number, p: any) => {
          return isVendorDivision(p?.users?.division) ? count + 1 : count;
        }, 0);
        const vendorCountForCommission = vendorCountEligible > 0 ? vendorCountEligible : memberCount;

        // Commission share denominator must match Event Dashboard: eligible vendor count (fallback to member count)
        const perVendorCommissionShare = vendorCountForCommission > 0
          ? commissionPoolDollars / vendorCountForCommission
          : 0;

        const commissionPerVendorAzNy = isAZorNY
          ? computeAzNyCommissionPerVendor(
            vendorPayments.map((p: any) => {
              const actualHours = getEffectiveHours(p);
              const div = p?.users?.division;
              const eligible = !isTrailersDivision(div) && isVendorDivision(div) && actualHours > 0;
              const priorWeeklyHours = weeklyHoursMap[eventId]?.[p.user_id] || 0;
              const isWeeklyOT = (priorWeeklyHours + actualHours) > 40;
              return {
                eligible,
                actualHours,
                extAmtRegular: actualHours * baseRate,
                isWeeklyOT,
              };
            }),
            commissionPoolDollars
          )
          : 0;

        // Tips: try event_payments summary first, then fall back to events table
        const totalTips = Number(eventPaymentSummary.total_tips || 0) || Number(eventInfo.tips || 0);
        // Pro-rate tips by hours worked instead of equal split
        const totalEventHours = vendorPayments.reduce((sum: number, p: any) => sum + getEffectiveHours(p), 0);

        console.log('[HR PAYMENTS] Commission/Tips for event:', eventId, {
          commissionPoolDollars, perVendorCommissionShare, totalTips, totalEventHours, memberCount, vendorCountForCommission,
          summaryPool: eventPaymentSummary.commission_pool_dollars,
          eventCommissionPool: eventInfo.commission_pool,
          summaryTips: eventPaymentSummary.total_tips,
          eventTips: eventInfo.tips,
        });

        // Map vendor payments
        const eventPayments = vendorPayments.map((payment: any) => {
          const user = payment.users;
          const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
          const rawFirstName = profile?.first_name || 'N/A';
          const rawLastName = profile?.last_name || '';
          const firstName = rawFirstName !== 'N/A' ? safeDecrypt(rawFirstName) : 'N/A';
          const lastName = rawLastName ? safeDecrypt(rawLastName) : '';
          const adjustmentAmount = Number(payment.adjustment_amount || 0);
          const actualHours = getEffectiveHours(payment);

          const memberDivision = payment?.users?.division;
          const isTrailers = (memberDivision || "").toString().toLowerCase().trim() === "trailers";

          const priorWeeklyHours = isAZorNY ? (weeklyHoursMap[eventId]?.[payment.user_id] || 0) : 0;
          const isWeeklyOT = isAZorNY && (priorWeeklyHours + actualHours) > 40;
          const extAmtRegular = actualHours * baseRate;
          const extAmtOnRegRateNonAzNy = actualHours * baseRate * 1.5;

          // Commission Amt: AZ/NY = pool / vendors; others subtract Ext Amt
          let commissionAmt;
          if (isAZorNY) {
            commissionAmt = (!isTrailers && isVendorDivision(memberDivision) && actualHours > 0) ? commissionPerVendorAzNy : 0;
          } else {
            // Non-AZ/NY parity with Event Dashboard: trailers are excluded from commission allocation.
            commissionAmt = (!isTrailers && actualHours > 0 && vendorCountForCommission > 0)
              ? Math.max(0, perVendorCommissionShare - extAmtOnRegRateNonAzNy)
              : 0;
          }

          // AZ/NY weekly OT: OT Rate is 1.5x the (regular) Loaded Rate.
          const totalFinalCommissionBase = (isAZorNY && actualHours > 0)
            ? Math.max(150, extAmtRegular + commissionAmt)
            : 0;
          const loadedRateBase = (isAZorNY && actualHours > 0)
            ? totalFinalCommissionBase / actualHours
            : baseRate;
          const otRate = (isAZorNY && isWeeklyOT) ? loadedRateBase * 1.5 : 0;

          // Ext Amt on Reg Rate: AZ/NY = baseRate x hours; if weekly OT (>40h), use OT rate x hours; others = baseRate x 1.5 x hours
          const extAmtOnRegRate = isAZorNY
            ? (isWeeklyOT ? (otRate * actualHours) : extAmtRegular)
            : extAmtOnRegRateNonAzNy;

          // Total Final Commission Amt = Ext Amt + Commission Amt; minimum $150
          const totalFinalCommissionAmt = actualHours > 0
            ? isAZorNY
              ? (isWeeklyOT ? extAmtOnRegRate : totalFinalCommissionBase)
              : Math.max(150, extAmtOnRegRate + commissionAmt)
            : 0;

          // Loaded Rate should remain the "regular" loaded rate for AZ/NY, since OT Rate is 1.5x Loaded Rate.
          const loadedRate = isAZorNY
            ? loadedRateBase
            : (actualHours > 0 ? totalFinalCommissionAmt / actualHours : baseRate);

          // Tips: pro-rated by hours worked (fall back to stored per-vendor tips if summary missing)
          const tips = (totalEventHours > 0 && totalTips > 0)
            ? totalTips * (actualHours / totalEventHours)
            : Number(payment.tips || 0);

          const restBreak = getRestBreakAmount(actualHours, eventState);
          const totalPay = totalFinalCommissionAmt + tips + restBreak;
          const finalPay = totalPay + adjustmentAmount;
          return {
            userId: payment.user_id,
            firstName,
            lastName,
            email: user?.email || 'N/A',
            actualHours,
            regularHours: actualHours,
            regularPay: extAmtOnRegRate,
            overtimeHours: 0,
            overtimePay: 0,
            otRate,
            doubletimeHours: 0,
            doubletimePay: 0,
            commissions: commissionAmt,
            tips,
            totalPay,
            adjustmentAmount,
            finalPay,
            regRate: baseRate,
            loadedRate,
            extAmtOnRegRate,
            commissionAmt,
            totalFinalCommissionAmt,
            restBreak,
            totalGrossPay: finalPay,
          };
        });
        console.log('[HR PAYMENTS] event payments mapped', { eventId, count: eventPayments.length, sample: eventPayments.slice(0,2).map((p: any) => ({ userId: p.userId, hours: p.actualHours, total: p.totalPay })) });

        const eventTotal = eventPayments.reduce((sum: number, p: any) => sum + Number(p.finalPay || 0), 0);
        const eventHours = eventPayments.reduce((sum: number, p: any) => sum + p.actualHours, 0);

        byVenue[eventInfo.venue].totalPayment += eventTotal;
        byVenue[eventInfo.venue].totalHours += eventHours;
        byVenue[eventInfo.venue].events.push({
          id: eventId,
          name: eventInfo.event_name,
          date: eventInfo.event_date,
          state: eventInfo.state,
          baseRate,
          eventTotal,
          eventHours,
          payments: eventPayments
        });
      }
      console.log('[HR PAYMENTS] venues assembled', { venueCount: Object.keys(byVenue).length });
      const venuesArr = Object.values(byVenue);
      setPaymentsByVenue(venuesArr);

      // Seed editable adjustments map from loaded data
      const initialAdjustments: Record<string, Record<string, number>> = {};
      venuesArr.forEach((v) => {
        v.events.forEach((ev: any) => {
          if (!initialAdjustments[ev.id]) initialAdjustments[ev.id] = {};
          (ev.payments || []).forEach((p: any) => {
            initialAdjustments[ev.id][p.userId] = Number(p.adjustmentAmount || 0);
          });
        });
      });
      setAdjustments(initialAdjustments);
    } catch (e: any) {
      setPaymentsError(e.message || 'Failed to load payments');
    } finally {
      setLoadingPayments(false);
    }
  }, [paymentsStartDate, paymentsEndDate]);

  // Persist a single adjustment
  const saveAdjustment = useCallback(async (eventId: string, userId: string) => {
    try {
      setSavingAdjustment(true);
      const amount = Number(adjustments[eventId]?.[userId] || 0);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/payment-adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ event_id: eventId, user_id: userId, adjustment_amount: amount }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to save adjustment');
      }

      // Update local payments state to reflect saved amount
      setPaymentsByVenue(prev => prev.map(v => {
        const events = v.events.map((ev: any) => {
          if (ev.id !== eventId) return ev;
          const payments = (ev.payments || []).map((p: any) => {
            if (p.userId !== userId) return p;
            const newAdj = amount;
            return { ...p, adjustmentAmount: newAdj, finalPay: Number(p.totalPay || 0) + newAdj, totalGrossPay: Number(p.totalPay || 0) + newAdj };
          });
          const eventTotal = payments.reduce((sum: number, p: any) => sum + Number(p.finalPay || 0), 0);
          const eventHours = payments.reduce((sum: number, p: any) => sum + p.actualHours, 0);
          return { ...ev, payments, eventTotal, eventHours };
        });
        const totalPayment = events.reduce((sum: number, ev: any) => sum + Number(ev.eventTotal || 0), 0);
        const totalHours = events.reduce((sum: number, ev: any) => sum + Number(ev.eventHours || 0), 0);
        return { ...v, events, totalPayment, totalHours };
      }));
    } finally {
      setSavingAdjustment(false);
    }
  }, [adjustments, supabase]);

  const saveAllAdjustments = useCallback(async () => {
    const entries: Array<{ eventId: string; userId: string; amount: number }> = [];
    Object.entries(adjustments).forEach(([eventId, map]) => {
      Object.entries(map || {}).forEach(([userId, amt]) => {
        entries.push({ eventId, userId, amount: Number(amt || 0) });
      });
    });
    for (const e of entries) {
      // sequential to avoid rate spikes
      await saveAdjustment(e.eventId, e.userId);
    }
    // Refresh to ensure API merge paths reflect adjustments
    await loadPaymentsData();
  }, [adjustments, saveAdjustment, loadPaymentsData]);

  const sendPaymentEmails = useCallback(async () => {
    try {
      setSendingEmails(true);
      // Collect event ids currently shown
      const eventIds: string[] = [];
      paymentsByVenue.forEach(v => v.events.forEach((ev: any) => { if (ev?.id) eventIds.push(ev.id); }));
      const unique = Array.from(new Set(eventIds));
      if (unique.length === 0) {
        alert('No events loaded. Load a date range first.');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/vendor-payments/send-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ event_ids: unique }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to send emails');
      alert(`Sent ${json.sent || 0} payment email(s).${(json.failures && json.failures.length) ? ` Failures: ${json.failures.length}` : ''}`);
    } catch (e: any) {
      alert(e.message || 'Failed to send emails');
    } finally {
      setSendingEmails(false);
    }
  }, [paymentsByVenue]);

  // Export payments to Excel
  const exportPaymentsToExcel = useCallback(() => {
    if (paymentsByVenue.length === 0) {
      alert('No payment data to export. Please load payments first.');
      return;
    }

    // Flatten data for Excel export
    const rows: any[] = [];

    paymentsByVenue.forEach(venue => {
      venue.events.forEach(event => {
        if (Array.isArray(event.payments) && event.payments.length > 0) {
          event.payments.forEach((p: any) => {
            const st = (event.state || venue.state || '').toString().toUpperCase().replace(/[^A-Z]/g, '');
            const hideRest = st === 'NV' || st === 'WI' || st === 'AZ' || st === 'NY';

            const regRate = Number(p.regRate ?? event.baseRate ?? 0);
            const loadedRate = Number(p.loadedRate ?? regRate);
            const hours = Number(p.actualHours || 0);
            const extAmtOnRegRate = Number(p.extAmtOnRegRate ?? p.regularPay ?? 0);
            const commissionAmt = Number(p.commissionAmt ?? p.commissions ?? 0);
            const totalFinalCommissionAmt = Number(p.totalFinalCommissionAmt ?? 0);
            const tips = Number(p.tips || 0);
            const restBreak = hideRest ? 0 : Number(p.restBreak || 0);
            const other = Number(p.adjustmentAmount || 0);
            const totalGrossPay = Number(p.finalPay || p.totalGrossPay || 0);

            rows.push({
              'Venue': venue.venue,
              'City': venue.city || '',
              'State': venue.state || '',
              'Event Name': event.name,
              'Event Date': event.date || '',
              'Employee': `${p.firstName || ''} ${p.lastName || ''}`.trim(),
              'Email': p.email || '',
              'Reg Rate': regRate.toFixed(2),
              'Loaded Rate': loadedRate.toFixed(2),
              'Hours': hours.toFixed(2),
              'Ext Amt on Reg Rate': extAmtOnRegRate.toFixed(2),
              'Commission Amt': commissionAmt.toFixed(2),
              'Total Final Commission Amt': totalFinalCommissionAmt.toFixed(2),
              'Tips': tips.toFixed(2),
              'Rest Break': hideRest ? 'N/A' : restBreak.toFixed(2),
              'Other': other.toFixed(2),
              'Total Gross Pay': totalGrossPay.toFixed(2),
            });
          });
        }
      });
    });

    if (rows.length === 0) {
      alert('No payment records found in the loaded data.');
      return;
    }

    // Create workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Payments');

    // Set column widths
    worksheet['!cols'] = [
      { wch: 25 }, // Venue
      { wch: 15 }, // City
      { wch: 8 },  // State
      { wch: 30 }, // Event Name
      { wch: 12 }, // Event Date
      { wch: 25 }, // Employee
      { wch: 30 }, // Email
      { wch: 10 }, // Reg Rate
      { wch: 12 }, // Loaded Rate
      { wch: 8 },  // Hours
      { wch: 18 }, // Ext Amt on Reg Rate
      { wch: 15 }, // Commission Amt
      { wch: 22 }, // Total Final Commission Amt
      { wch: 10 }, // Tips
      { wch: 12 }, // Rest Break
      { wch: 10 }, // Other
      { wch: 15 }, // Total Gross Pay
    ];

    // Generate filename with date range
    const startStr = paymentsStartDate || 'start';
    const endStr = paymentsEndDate || 'end';
    const filename = `payments_${startStr}_to_${endStr}.xlsx`;

    // Download file
    XLSX.writeFile(workbook, filename);
  }, [paymentsByVenue, paymentsStartDate, paymentsEndDate]);

  // Load onboarding forms
  const loadOnboardingForms = useCallback(async () => {
    setLoadingForms(true);
    setFormsError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (filterFormState !== 'all') params.set('state', filterFormState);
      if (filterFormCategory !== 'all') params.set('category', filterFormCategory);
      params.set('active_only', 'false'); // Show all forms for HR

      const res = await fetch(`/api/onboarding-forms?${params.toString()}`, {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load forms');
      }

      const data = await res.json();
      setOnboardingForms(data.forms || []);
    } catch (e: any) {
      setFormsError(e.message || 'Failed to load forms');
    } finally {
      setLoadingForms(false);
    }
  }, [filterFormState, filterFormCategory, supabase]);

  // Auto-load onboarding forms when navigating directly to the Forms tab via URL (?view=forms)
  useEffect(() => {
    if (hrView === "forms") {
      loadOnboardingForms();
    }
  }, [hrView, loadOnboardingForms]);

  // Upload new form
  const handleUploadForm = useCallback(async (formData: any) => {
    setUploadingForm(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/onboarding-forms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload form');
      }

      alert('Form uploaded successfully!');
      await loadOnboardingForms();
    } catch (e: any) {
      alert(e.message || 'Failed to upload form');
    } finally {
      setUploadingForm(false);
    }
  }, [supabase, loadOnboardingForms]);

  // Toggle form active status
  const toggleFormActive = useCallback(async (formId: string, currentStatus: boolean) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/onboarding-forms', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: formId, is_active: !currentStatus }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update form');
      }

      await loadOnboardingForms();
    } catch (e: any) {
      alert(e.message || 'Failed to update form');
    }
  }, [supabase, loadOnboardingForms]);

  const hrStats = {
    totalEmployees: employees.length,
    activeEmployees: employees.filter((e) => e.status === "active").length,
    onLeave: employees.filter((e) => e.status === "on_leave").length,
    inactive: employees.filter((e) => e.status === "inactive").length,
    avgAttendance: employees.length ? Math.round(employees.reduce((a, e) => a + (e.attendance_rate || 0), 0) / employees.length) : 0,
    avgPerformance: employees.length ? Math.round(employees.reduce((a, e) => a + (e.performance_score || 0), 0) / employees.length) : 0,
    pendingBackgroundChecks: backgroundChecks.filter((bc: any) =>
      typeof bc.status === 'string'
        ? bc.status === 'pending'
        : bc.background_check_completed !== true
    ).length,
    approvedBackgroundChecks: backgroundChecks.filter((bc: any) =>
      typeof bc.status === 'string'
        ? bc.status === 'approved'
        : bc.background_check_completed === true
    ).length,
  } as const;

  const departments = (() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      const key = e.department || 'General';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const palette = ['blue', 'purple', 'green', 'indigo', 'rose', 'amber'];
    let i = 0;
    return Array.from(counts.entries()).map(([name, employee_count]) => ({
      name,
      employee_count,
      color: palette[(i++) % palette.length],
    }));
  })();
  const totalDepartments = departments.length;

  const handleStateFilterChange = async (newState: string) => {
    setSelectedState(newState);
    await loadEmployees(newState, selectedEmployeeRegion);
  };

  const handleEmployeeRegionChange = async (newRegion: string) => {
    setSelectedEmployeeRegion(newRegion);
    await loadEmployees(selectedState, newRegion);
  };

  // Derived counts for state dropdown labels (from currently loaded employees)
  const stateCounts = employees.reduce<Record<string, number>>((acc, e) => {
    const key = e.state || 'N/A';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const employeeCards = useMemo(() => {
    return employees.map((employee) => {
      const firstName = employee.first_name ? safeDecrypt(employee.first_name) : "";
      const lastName = employee.last_name ? safeDecrypt(employee.last_name) : "";
      const fullName = `${firstName} ${lastName}`.trim();
      const searchText = [
        fullName,
        employee.email,
        employee.position,
        employee.department,
        employee.city,
        employee.state,
        employee.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return { employee, firstName, lastName, fullName, searchText };
    });
  }, [employees]);

  const filteredEmployeeCards = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employeeCards;
    return employeeCards.filter((card) => card.searchText.includes(q));
  }, [employeeCards, employeeSearch]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="apple-card">
          <div className="flex items-center gap-3">
            <div className="apple-spinner" />
            <span className="text-gray-600">Checking access…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-12 px-6">
        <div className="mb-12">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-5xl font-semibold text-gray-900 mb-3 keeping-tight">HR Dashboard</h1>
              <p className="text-lg text-gray-600 font-normal">Manage employees, leave requests, and workforce analytics.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-10 items-center">
          <Link href="/signup">
            <button className="apple-button apple-button-primary">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Add Employee
            </button>
          </Link>
          <Link href="/background-checks">
            <button className="apple-button apple-button-secondary">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              View Background Checks
            </button>
          </Link>
          <Link href="/onboarding">
            <button className="apple-button apple-button-secondary">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              View Onboarding Status
            </button>
          </Link>
          <Link href="/global-calendar">
            <button className="apple-button apple-button-secondary">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Global Calendar
            </button>
          </Link>
          <div className="flex-1" />
          <button onClick={handleLogout} className="apple-button apple-button-secondary">
            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
            </svg>
            Logout
          </button>
        </div>

        <div className="mb-8 border-b border-gray-200">
          <div className="flex gap-6">
            <button
              onClick={() => setHrView("overview")}
              className={`pb-4 px-2 font-semibold transition-colors relative ${
                hrView === "overview" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Overview
              {hrView === "overview" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
            </button>
            <button
              onClick={() => setHrView("employees")}
              className={`pb-4 px-2 font-semibold transition-colors relative ${
                hrView === "employees" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Employees
              {hrView === "employees" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
            </button>
            <button
              onClick={() => setHrView("payments")}
              className={`pb-4 px-2 font-semibold transition-colors relative ${
                hrView === "payments" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Payroll
              {hrView === "payments" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
            </button>
            <button
              onClick={() => setHrView("paystub")}
              className={`pb-4 px-2 font-semibold transition-colors relative ${
                hrView === "paystub" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Paystub Tools
              {hrView === "paystub" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
            </button>
            
          </div>
        </div>

        {hrView === "overview" && (
          <div className="space-y-8">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Key Metrics</h2>
                <span className="text-sm text-gray-500 font-medium">HR Dashboard</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="group relative bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-110 transition-transform duration-300">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">Employees</span>
                    </div>
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Total Employees</h3>
                    <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{hrStats.totalEmployees}</div>
                    <p className="text-sm text-blue-600 font-medium flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {hrStats.activeEmployees} active
                    </p>
                  </div>
                </div>

                <div className="group relative bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:scale-110 transition-transform duration-300">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">Departments</span>
                    </div>
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Departments</h3>
                    <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{totalDepartments}</div>
                    <p className="text-sm text-purple-600 font-medium flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      active divisions
                    </p>
                  </div>
                </div>

                <div className="group relative bg-gradient-to-br from-yellow-50 to-white border border-yellow-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/30 group-hover:scale-110 transition-transform duration-300">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">Background Checks</span>
                    </div>
                    <h3 className="text-sm font-medium text-gray-600 mb-2">Approved</h3>
                    <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{hrStats.approvedBackgroundChecks}</div>
                    <p className="text-sm text-yellow-600 font-medium flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01" />
                      </svg>
                      {hrStats.pendingBackgroundChecks} pending
                    </p>
                  </div>
                </div>

               
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Departments Overview</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {departments.map((dept) => (
                  <div key={dept.name} className="apple-card p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-gray-600">{dept.name}</div>
                        <div className="text-2xl font-bold text-gray-900">{dept.employee_count}</div>
                        <div className={`text-xs mt-1 font-medium ${dept.color === 'blue' ? 'text-blue-600' : dept.color === 'purple' ? 'text-purple-600' : dept.color === 'green' ? 'text-green-600' : 'text-indigo-600' }`}>
                          {((dept.employee_count / Math.max(hrStats.totalEmployees, 1)) * 100).toFixed(0)}% of workforce
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-semibold ${dept.color === 'blue' ? 'bg-blue-100 text-blue-700' : dept.color === 'purple' ? 'bg-purple-100 text-purple-700' : dept.color === 'green' ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700' }`}>
                        {dept.color.toUpperCase()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            
          </div>
        )}

        {hrView === "payments" && (
          <>
            <div className="apple-card mb-6">
              <h2 className="text-xl font-semibold mb-4">Filter by Date Range</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="apple-label" htmlFor="pay-start">Start Date</label>
                  <input id="pay-start" type="date" value={paymentsStartDate} onChange={(e) => setPaymentsStartDate(e.target.value)} className="apple-select" />
                </div>
                <div>
                  <label className="apple-label" htmlFor="pay-end">End Date</label>
                  <input id="pay-end" type="date" value={paymentsEndDate} onChange={(e) => setPaymentsEndDate(e.target.value)} className="apple-select" />
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <button onClick={loadPaymentsData} className={`apple-button ${loadingPayments ? 'apple-button-disabled' : 'apple-button-primary'}`} disabled={loadingPayments}>
                  {loadingPayments ? 'Loading…' : 'Load Payments'}
                </button>
                <button onClick={saveAllAdjustments} className={`apple-button ${savingAdjustment ? 'apple-button-disabled' : 'apple-button-secondary'}`} disabled={savingAdjustment}>
                  {savingAdjustment ? 'Saving…' : 'Save All Adjustments'}
                </button>
                <button onClick={exportPaymentsToExcel} className={`apple-button ${paymentsByVenue.length === 0 ? 'apple-button-disabled' : 'apple-button-secondary'}`} disabled={paymentsByVenue.length === 0}>
                  Export to Excel
                </button>
              </div>
            </div>

            {paymentsError && <div className="apple-alert apple-alert-error mb-6">{paymentsError}</div>}

            <div className="space-y-4">
              {paymentsByVenue.length === 0 && !loadingPayments ? (
                <div className="apple-empty-state">
                  <p className="text-gray-500">No payment data to show. Load a date range.</p>
                </div>
              ) : (
                paymentsByVenue.map(v => (
                  <div key={v.venue} className="apple-card">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{v.venue}</h3>
                        <p className="text-sm text-gray-500">{v.city || '—'}, {v.state || ''}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-gray-900">${v.totalPayment.toFixed(2)}</div>
                        <div className="text-sm text-gray-500">{v.totalHours.toFixed(1)} hrs</div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Event</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Date</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Hours</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Total</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {v.events.map(ev => (
                            <>
                              <tr key={ev.id} className="bg-white">
                                <td className="px-4 py-2 text-sm text-gray-900">{ev.name}</td>
                                <td className="px-4 py-2 text-sm text-gray-500">{ev.date || '—'}</td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">{(ev.eventHours || 0).toFixed(1)}</td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">${(ev.eventTotal || 0).toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td colSpan={4} className="px-4 py-2">
                                  {Array.isArray(ev.payments) && ev.payments.length > 0 ? (
                                    <div className="overflow-x-auto border rounded">
                                      <table className="min-w-full">
                                        <thead className="bg-gray-50">
                                          {(() => {
                                            const st = normalizeState(ev.state || v.state);
                                            const hideRest = st === "NV" || st === "WI" || st === "AZ" || st === "NY";
                                            const showOT = st === "AZ" || st === "NY";
                                            return (
                                              <tr>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Reg Rate</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Loaded Rate</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                                                {showOT && (
                                                  <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">OT Rate</th>
                                                )}
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Ext Amt on Reg Rate</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Commission Amt</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Total Final Commission Amt</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Tips</th>
                                                {!hideRest && (
                                                  <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Rest Break</th>
                                                )}
                                                <th className="p-2 text-right text-xs font-medium text-gray-500 uppercase">Other</th>
                                                <th className="p-2 text-right text-xs font-medium text-gray-500 uppercase">Total Gross Pay</th>
                                              </tr>
                                            );
                                          })()}
                                        </thead>
                                        <tbody className="divide-y">
                                          {ev.payments.map((p: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-gray-50">
                                              <td className="p-2">
                                                <div className="flex items-center gap-2">
                                                  <div>
                                                    <div className="text-sm font-medium text-gray-900">{p.firstName} {p.lastName}</div>
                                                    <div className="text-xs text-gray-500">{p.email}</div>
                                                  </div>
                                                  {p.status && p.totalPay === 0 && (
                                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                      p.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                                      p.status === 'pending_confirmation' ? 'bg-yellow-100 text-yellow-700' :
                                                      'bg-gray-100 text-gray-600'
                                                    }`} title="Team member assigned, awaiting Time Keeping ">
                                                      {p.status === 'confirmed' ? 'Confirmed' : p.status === 'pending_confirmation' ? 'Pending' : p.status}
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              {(() => {
                                                const st = normalizeState(ev.state || v.state);
                                                const hideRest = st === "NV" || st === "WI" || st === "AZ" || st === "NY";
                                                const showOT = st === "AZ" || st === "NY";

                                                const regRate = Number(p.regRate ?? ev.baseRate ?? 0);
                                                const loadedRate = Number(p.loadedRate ?? regRate);
                                                const hours = Number(p.actualHours || 0);
                                                const otRate = Number(p.otRate || 0);
                                                const extAmtOnRegRate = Number(p.extAmtOnRegRate ?? p.regularPay ?? 0);
                                                const commissionAmt = Number(p.commissionAmt ?? p.commissions ?? 0);
                                                const totalFinalCommissionAmt = Number(p.totalFinalCommissionAmt ?? 0);
                                                const tips = Number(p.tips || 0);
                                                const restBreak = Number(p.restBreak || 0);
                                                const totalGrossPay = Number(p.finalPay || p.totalGrossPay || 0);

                                                return (
                                                  <>
                                                    <td className="p-2 text-sm">${regRate.toFixed(2)}/hr</td>
                                                    <td className="p-2 text-sm">${loadedRate.toFixed(2)}/hr</td>
                                                    <td className="p-2 text-sm">{hours.toFixed(2)}h</td>
                                                    {showOT && (
                                                      <td className="p-2 text-sm">{otRate > 0 ? `$${otRate.toFixed(2)}/hr` : '\u2014'}</td>
                                                    )}
                                                    <td className="p-2 text-sm text-green-600">${extAmtOnRegRate.toFixed(2)}</td>
                                                    <td className="p-2 text-sm text-purple-600">{commissionAmt > 0 ? `$${commissionAmt.toFixed(2)}` : '\u2014'}</td>
                                                    <td className="p-2 text-sm text-green-600">${totalFinalCommissionAmt.toFixed(2)}</td>
                                                    <td className="p-2 text-sm text-orange-600">${tips.toFixed(2)}</td>
                                                    {!hideRest && (
                                                      <td className="p-2 text-sm text-green-600">${restBreak.toFixed(2)}</td>
                                                    )}
                                                    <td className="p-2 text-sm text-right">
                                                      {editingCell && editingCell.eventId === ev.id && editingCell.userId === p.userId ? (
                                                        <div className="flex items-center justify-end gap-2">
                                                          <span className="text-gray-500">$</span>
                                                          <input
                                                            type="number"
                                                            className="w-24 px-2 py-1 border rounded text-sm"
                                                            value={Number(((adjustments[ev.id] ?? {})[p.userId] ?? (p.adjustmentAmount ?? 0)))}
                                                            onChange={(e) => {
                                                              const val = Number(e.target.value) || 0;
                                                              setAdjustments(prev => ({
                                                                ...prev,
                                                                [ev.id]: { ...(prev[ev.id] || {}), [p.userId]: val },
                                                              }));
                                                            }}
                                                            step="1"
                                                          />
                                                          <button
                                                            onClick={async () => { await saveAdjustment(ev.id, p.userId); setEditingCell(null); }}
                                                            className="text-green-600 hover:text-green-700 text-xs font-medium"
                                                          >Save</button>
                                                          <button onClick={() => setEditingCell(null)} className="text-gray-500 hover:text-gray-600 text-xs">Cancel</button>
                                                        </div>
                                                      ) : (
                                                        <span
                                                          className={`cursor-pointer ${Number(p.adjustmentAmount || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}
                                                          onClick={() => setEditingCell({ eventId: ev.id, userId: p.userId })}
                                                          title="Click to edit"
                                                        >
                                                          {`$${Number(p.adjustmentAmount || 0).toFixed(2)}`}
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td className="p-2 text-sm font-semibold text-right">${totalGrossPay.toFixed(2)}</td>
                                                  </>
                                                );
                                              })()}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="text-sm text-gray-500 py-2">No staff scheduled for this event</div>
                                  )}
                                </td>
                              </tr>
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
        {hrView === "paystub" && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Paystub Tools</h2>
                  <p className="text-sm text-gray-500">
                    Click a tool to open it in its own page.
                  </p>
                </div>
                <span className="text-xs uppercase keeping-wider text-slate-500 px-3 py-1 border border-slate-200 rounded-full">
                  Single-click access
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/pdf-reader"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  PDF Reader
                </Link>
                <Link
                  href="/paystub-generator"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  Paystub Generator
                </Link>
              </div>
            </section>
          </div>
        )}
        {hrView === "employees" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Employees</h2>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="relative">
                  <label className="sr-only" htmlFor="employee-search">Search employees</label>
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.35-5.65a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    id="employee-search"
                    type="search"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    className="w-[18rem] md:w-[22rem] rounded-xl border border-gray-300 bg-white px-10 py-3 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-[#007AFF] focus:outline-none focus:ring-4 focus:ring-[#007AFF]/10"
                    placeholder="Search by name, email, city..."
                  />
                  {employeeSearch.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => setEmployeeSearch('')}
                      disabled={loadingEmployees}
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                      aria-label="Clear search"
                      title="Clear search"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                <label className="apple-label" htmlFor="state-filter">State</label>
                <select
                  id="state-filter"
                  value={selectedState}
                  onChange={(e) => handleStateFilterChange(e.target.value)}
                  disabled={loadingEmployees}
                  className="apple-select min-w-[12rem]"
                  title="Filter employees by state"
                >
                  <option value="all">All States{employees.length ? ` (${employees.length})` : ''}</option>
                  {availableStates.map((s) => (
                    <option key={s} value={s} title={s}>
                      {s}{stateCounts[s] ? ` (${stateCounts[s]})` : ''}
                    </option>
                  ))}
                </select>

                <label className="apple-label" htmlFor="region-filter">Region</label>
                <select
                  id="region-filter"
                  value={selectedEmployeeRegion}
                  onChange={(e) => handleEmployeeRegionChange(e.target.value)}
                  disabled={loadingEmployees || loadingRegions}
                  className="apple-select min-w-[12rem]"
                  title="Filter employees by region"
                >
                  <option value="all">
                    {loadingRegions ? 'Loading regions…' : `All Regions${regions.length ? ` (${regions.length})` : ''}`}
                  </option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id} title={r.name}>
                      {r.name}{typeof r.vendor_count === 'number' ? ` (${r.vendor_count})` : ''}
                    </option>
                  ))}
                </select>

                {(selectedState !== 'all' || selectedEmployeeRegion !== 'all') && (
                  <button
                    onClick={() => { handleStateFilterChange('all'); handleEmployeeRegionChange('all'); }}
                    className="apple-button apple-button-secondary"
                    disabled={loadingEmployees}
                    title="Clear all filters"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            </div>

            {employeesError && (
              <div className="apple-error-banner">{employeesError}</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEmployeeCards.map(({ employee: e, firstName, lastName }) => (
                  <Link key={e.id} href={`/hr/employees/${e.id}`} className="block group">
                    <div className="apple-card p-6 hover:shadow-lg transition-shadow group-hover:translate-y-[-1px]">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold">
                          {firstName?.[0] || 'E'}{lastName?.[0] || ''}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-gray-900">
                              {firstName} {lastName}
                            </h3>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              e.status === 'active' ? 'bg-green-100 text-green-700' : e.status === 'on_leave' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {e.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">{e.position} • {e.department}</p>
                          <p className="text-sm text-gray-500">{e.city || '—'}, {e.state}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              {filteredEmployeeCards.length === 0 && (
                <div className="apple-card p-12 text-center md:col-span-2 lg:col-span-3">
                  <p className="text-gray-600 font-medium">No employees found.</p>
                  {employeeSearch.trim().length > 0 && (
                    <p className="text-sm text-gray-500 mt-1">Try a different search term.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {hrView === "forms" && (
          <div className="space-y-8">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Onboarding Forms Management</h2>
                <span className="text-sm text-gray-500 font-medium">Upload & Manage Forms</span>
              </div>

              {/* Upload Form */}
              <OnboardingFormUpload
                onUpload={handleUploadForm}
                uploading={uploadingForm}
              />

              {/* Filters */}
              <div className="apple-card p-6 mb-6">
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Filter by State</label>
                    <select
                      value={filterFormState}
                      onChange={(e) => setFilterFormState(e.target.value)}
                      className="apple-input"
                    >
                      <option value="all">All States</option>
                      <option value="CA">California</option>
                      <option value="NY">New York</option>
                      <option value="AZ">Arizona</option>
                      <option value="WI">Wisconsin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Category</label>
                    <select
                      value={filterFormCategory}
                      onChange={(e) => setFilterFormCategory(e.target.value)}
                      className="apple-input"
                    >
                      <option value="all">All Categories</option>
                      <option value="background_check">Background Check</option>
                      <option value="tax">Tax</option>
                      <option value="employment">Employment</option>
                      <option value="benefits">Benefits</option>
                      <option value="compliance">Compliance</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={loadOnboardingForms}
                      disabled={loadingForms}
                      className="apple-button apple-button-primary"
                    >
                      {loadingForms ? 'Loading...' : 'Refresh Forms'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {formsError && (
                <div className="apple-error-banner mb-6">{formsError}</div>
              )}

              {/* Forms List */}
              {loadingForms ? (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <p className="mt-4 text-gray-600">Loading forms...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {onboardingForms.length === 0 ? (
                    <div className="apple-card p-12 text-center">
                      <p className="text-gray-500">No forms found. Upload a new form to get started.</p>
                    </div>
                  ) : (
                    onboardingForms.map((form) => (
                      <div key={form.id} className="apple-card p-6 hover:shadow-lg transition-shadow">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-semibold text-gray-900">{form.form_display_name}</h3>
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                form.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                              }`}>
                                {form.is_active ? 'Active' : 'Inactive'}
                              </span>
                              {form.is_required && (
                                <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">
                                  Required
                                </span>
                              )}
                              <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">
                                {form.form_category}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">
                              <strong>Form ID:</strong> {form.form_name}
                            </p>
                            {form.form_description && (
                              <p className="text-sm text-gray-600 mb-2">{form.form_description}</p>
                            )}
                            <div className="flex gap-4 text-sm text-gray-500">
                              <span><strong>State:</strong> {form.state_code || 'Universal'}</span>
                              <span><strong>Order:</strong> {form.form_order}</span>
                              <span><strong>Size:</strong> {Math.round((form.file_size || 0) / 1024)} KB</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                              Uploaded {new Date(form.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleFormActive(form.id, form.is_active)}
                              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                                form.is_active
                                  ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                  : 'bg-green-100 text-green-700 hover:bg-green-200'
                              }`}
                            >
                              {form.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HRDashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading dashboard...</div>}>
      <HRDashboardContent />
    </Suspense>
  );
}

// Onboarding Form Upload Component
function OnboardingFormUpload({ onUpload, uploading }: { onUpload: (formData: any) => void; uploading: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [formName, setFormName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [category, setCategory] = useState('tax');
  const [formOrder, setFormOrder] = useState(0);
  const [isRequired, setIsRequired] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
    } else {
      alert('Please select a valid PDF file');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formName || !displayName || !category || !pdfFile) {
      alert('Please fill in all required fields and select a PDF file');
      return;
    }

    try {
      setConverting(true);

      // Convert PDF to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const uint8Array = new Uint8Array(arrayBuffer);

        // Convert to base64 in chunks to avoid stack overflow
        const chunkSize = 32768;
        let base64 = '';
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
          base64 += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const pdfData = btoa(base64);

        const formData = {
          form_name: formName,
          form_display_name: displayName,
          form_description: description || null,
          state_code: stateCode || null,
          form_category: category,
          form_order: formOrder,
          is_required: isRequired,
          pdf_data: pdfData,
        };

        await onUpload(formData);

        // Reset form
        setFormName('');
        setDisplayName('');
        setDescription('');
        setStateCode('');
        setCategory('tax');
        setFormOrder(0);
        setIsRequired(false);
        setPdfFile(null);
        setIsExpanded(false);
        setConverting(false);
      };

      reader.onerror = () => {
        alert('Failed to read PDF file');
        setConverting(false);
      };

      reader.readAsArrayBuffer(pdfFile);
    } catch (error: any) {
      alert(error.message || 'Failed to upload form');
      setConverting(false);
    }
  };

  return (
    <div className="apple-card p-6 mb-8">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <h3 className="text-lg font-semibold text-gray-900">Upload New Form</h3>
        <svg
          className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Form ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., ca-de4, w4, i9"
                className="apple-input"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Unique identifier for the form</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Display Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., California DE-4 Form"
                className="apple-input"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                State Code
              </label>
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                className="apple-input"
              >
                <option value="">Universal (All States)</option>
                <option value="CA">California</option>
                <option value="NY">New York</option>
                <option value="AZ">Arizona</option>
                <option value="WI">Wisconsin</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="apple-input"
                required
              >
                <option value="background_check">Background Check</option>
                <option value="tax">Tax</option>
                <option value="employment">Employment</option>
                <option value="benefits">Benefits</option>
                <option value="compliance">Compliance</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Form Order
              </label>
              <input
                type="number"
                value={formOrder}
                onChange={(e) => setFormOrder(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="apple-input"
              />
              <p className="text-xs text-gray-500 mt-1">Display order in workflow</p>
            </div>

            <div className="flex items-center">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm font-medium text-gray-700">Required Form</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of the form..."
              rows={3}
              className="apple-input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              PDF File <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="apple-input"
              required
            />
            {pdfFile && (
              <p className="text-sm text-green-600 mt-2">
                Selected: {pdfFile.name} ({Math.round(pdfFile.size / 1024)} KB)
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={uploading || converting}
              className="apple-button apple-button-primary"
            >
              {converting ? 'Converting PDF...' : uploading ? 'Uploading...' : 'Upload Form'}
            </button>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              disabled={uploading || converting}
              className="apple-button apple-button-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
