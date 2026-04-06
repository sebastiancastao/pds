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
  region_id?: string | null;
  region_name?: string | null;
  worked_venues?: string[];
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

type SickLeaveStatus = "pending" | "approved" | "denied";

type SickLeaveRecord = {
  id: string;
  user_id: string;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number;
  status: SickLeaveStatus;
  reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  employee_name: string;
  employee_email: string;
  employee_state: string | null;
  employee_city: string | null;
};

type SickLeaveAccrual = {
  user_id: string;
  employee_name: string;
  employee_email: string;
  employee_state: string | null;
  employee_city: string | null;
  worked_hours: number;
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  carry_over_hours: number;
  carry_over_days: number;
  year_to_date_hours: number;
  year_to_date_days: number;
  used_hours: number;
  used_days: number;
  balance_hours: number;
  balance_days: number;
  request_count: number;
};

type SickLeaveStats = {
  total: number;
  pending: number;
  approved: number;
  denied: number;
  total_hours: number;
};

const sickLeaveStatusStyles: Record<SickLeaveStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  approved: "bg-green-100 text-green-700 border-green-200",
  denied: "bg-red-100 text-red-700 border-red-200",
};

const fallbackSickLeaveStatusStyle = "bg-gray-100 text-gray-700 border-gray-200";

function HRDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialView = (searchParams?.get("view") as "overview" | "employees" | "sickleave" | "payments" | "forms" | "paystub" | null) || "overview";
  const initialFormState = searchParams?.get("state") || "all";

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [hrView, setHrView] = useState<"overview" | "employees" | "sickleave" | "payments" | "forms" | "paystub">(initialView);

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
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalFile, setApprovalFile] = useState<File | null>(null);
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState<string>('');
  const [approvalSubmissions, setApprovalSubmissions] = useState<Array<{ id: string; file_name: string; status: string; submitted_at: string }>>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [mileageByEvent, setMileageByEvent] = useState<Record<string, Record<string, { miles: number | null; mileagePay: number; differentialMiles?: number }>>>({});
  const [mileageApprovals, setMileageApprovals] = useState<Record<string, Record<string, { mileage: boolean; travel: boolean }>>>({});
  const getMileageApproval = (eventId: string, userId: string) =>
    mileageApprovals[eventId]?.[userId] ?? { mileage: true, travel: true };
  const setMileageApproval = async (eventId: string, userId: string, field: 'mileage' | 'travel', value: boolean) => {
    setMileageApprovals(prev => ({
      ...prev,
      [eventId]: { ...(prev[eventId] || {}), [userId]: { ...(prev[eventId]?.[userId] ?? { mileage: true, travel: true }), [field]: value } },
    }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/mileage-approvals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ event_id: eventId, user_id: userId, field, approved: value }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('[HR PAYMENTS] Failed to save mileage approval:', j.error || res.status);
      }
    } catch (e) {
      console.error('[HR PAYMENTS] Failed to save mileage approval:', e);
    }
  };
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
  const GATE_PHONE_OFFSET_HOURS = 0.5;
  const addGatePhoneLeadHours = (hours: number): number => {
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    return Number((hours + GATE_PHONE_OFFSET_HOURS).toFixed(6));
  };
  const getRestBreakAmount = (actualHours: number, stateCode: string) => {
    if (actualHours <= 0) return 0;
    return actualHours >= 10 ? 12.5 : 9;
  };
  const formatHoursHHMM = (decimalHours: number): string => {
    const totalMinutes = Math.floor(Math.abs(decimalHours) * 60);
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${hh}:${String(mm).padStart(2, "0")}`;
  };
  const roundHoursToTwoDecimals = (decimalHours: number): number => {
    if (!Number.isFinite(decimalHours)) return 0;
    const absHours = Math.abs(decimalHours);
    const roundedHours = Math.round((absHours + 1e-9) * 100) / 100;
    return decimalHours < 0 ? -roundedHours : roundedHours;
  };
  const formatHoursDecimal = (decimalHours: number): string => {
    return roundHoursToTwoDecimals(decimalHours).toFixed(2);
  };
  const roundUpThousandsToNextHundred = (amount: number): number => {
    if (!Number.isFinite(amount)) return 0;
    const absAmount = Math.abs(amount);
    if (absAmount < 1000) {
      // Normalize to 3 decimals first to absorb floating drift near .005 boundaries.
      // Example: 237.024999999 should behave like 237.025 -> 237.03.
      const normalizedThousandths = Math.round((absAmount + 1e-9) * 1000) / 1000;
      const roundedCents = Math.round((normalizedThousandths + 1e-9) * 100) / 100;
      return amount < 0 ? -roundedCents : roundedCents;
    }
    const roundedMagnitude = Math.round((absAmount + 1e-9) / 100) * 100;
    return amount < 0 ? -roundedMagnitude : roundedMagnitude;
  };
  
  const formatPayrollMoney = (amount: number): string =>
    roundUpThousandsToNextHundred(amount).toFixed(2);
  const formatExactMoney = (amount: number): string =>
    (Number.isFinite(amount) ? amount : 0).toFixed(2);
  const getEffectiveHours = (payment: any): number => {
    // Payroll tab: when hours are computed from timesheet effective_hours,
    // include the Gate/Phone lead time (30 minutes).
    if (payment && (payment?.effective_hours != null || payment?.effectiveHours != null)) {
      const effective = Number(payment?.effective_hours ?? payment?.effectiveHours);
      if (Number.isFinite(effective) && effective >= 0) return addGatePhoneLeadHours(effective);
    }
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
  const sortPaymentsAlphabetically = (payments: any[]) => {
    return [...payments].sort((a, b) => {
      const aFirst = (a?.firstName || "").toString().trim();
      const bFirst = (b?.firstName || "").toString().trim();
      const aLast = (a?.lastName || "").toString().trim();
      const bLast = (b?.lastName || "").toString().trim();
      const aEmail = (a?.email || "").toString().trim();
      const bEmail = (b?.email || "").toString().trim();

      // Payroll should sort by last name A->Z, then first name.
      const aLastKey = aLast || aFirst || aEmail;
      const bLastKey = bLast || bFirst || bEmail;
      const lastNameCompare = aLastKey.localeCompare(bLastKey, undefined, { sensitivity: "base" });
      if (lastNameCompare !== 0) return lastNameCompare;

      const aFirstKey = aFirst || aEmail;
      const bFirstKey = bFirst || bEmail;
      const firstNameCompare = aFirstKey.localeCompare(bFirstKey, undefined, { sensitivity: "base" });
      if (firstNameCompare !== 0) return firstNameCompare;

      return aEmail.localeCompare(bEmail, undefined, { sensitivity: "base" });
    });
  };

  type OtherAdjustmentType = "reimbursement_1" | "meal_break";
  const DEFAULT_OTHER_ADJUSTMENT_TYPE: OtherAdjustmentType = "reimbursement_1";
  const normalizeOtherAdjustmentType = (value?: string | null): OtherAdjustmentType => {
    const normalized = (value || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/-/g, "_");
    return normalized === "meal_break" ? "meal_break" : "reimbursement_1";
  };
  const getOtherAdjustmentTypeLabel = (value?: string | null): string =>
    normalizeOtherAdjustmentType(value) === "meal_break" ? "Meal Break" : "Reimbursement 1";

  // Editable adjustments: eventId -> (userId -> amount)
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, number>>>({});
  const [adjustmentTypes, setAdjustmentTypes] = useState<Record<string, Record<string, OtherAdjustmentType>>>({});
  const [editingCell, setEditingCell] = useState<{ eventId: string; userId: string } | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  // Onboarding forms state
  const [onboardingForms, setOnboardingForms] = useState<any[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [formsError, setFormsError] = useState<string>('');
  const [uploadingForm, setUploadingForm] = useState(false);
  const [filterFormState, setFilterFormState] = useState<string>(initialFormState);
  const [filterFormCategory, setFilterFormCategory] = useState<string>('all');
  const [sickLeaves, setSickLeaves] = useState<SickLeaveRecord[]>([]);
  const [sickLeaveAccruals, setSickLeaveAccruals] = useState<SickLeaveAccrual[]>([]);
  const [loadingSickLeaves, setLoadingSickLeaves] = useState(false);
  const [sickLeavesError, setSickLeavesError] = useState("");
  const [sickLeaveStatusFilter, setSickLeaveStatusFilter] = useState<"all" | SickLeaveStatus>("all");
  const [sickLeaveSearch, setSickLeaveSearch] = useState("");
  const [updatingSickLeaveId, setUpdatingSickLeaveId] = useState<string | null>(null);
  const [addingUsedHoursUserId, setAddingUsedHoursUserId] = useState<string | null>(null);
  const [removingUsedHoursUserId, setRemovingUsedHoursUserId] = useState<string | null>(null);
  const [editingSickAccrualKey, setEditingSickAccrualKey] = useState<string | null>(null);
  const [sickLeaveStats, setSickLeaveStats] = useState<SickLeaveStats>({
    total: 0,
    pending: 0,
    approved: 0,
    denied: 0,
    total_hours: 0,
  });

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
        params.append("geo_filter", "true");
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
    setMileageByEvent({});
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
        const eventPaymentSummary = eventPaymentData?.eventPayment || {};
        const eventState = normalizeState(eventInfo.state) || "CA";
        const configuredBaseRate = getConfiguredBaseRate(eventState);
        // Sales-tab parity: prefer persisted net_sales from event_payments (saved by Sales tab), fallback to event fields.
        const eventTips = Number(eventInfo.tips || 0);
        const ticketSales = Number(eventInfo.ticket_sales || 0);
        const totalSales = Math.max(ticketSales - eventTips, 0);
        const taxRate = Number(eventInfo.tax_rate_percent || 0);
        const tax = totalSales * (taxRate / 100);
        const persistedAdjustedGrossRaw = Number(eventPaymentSummary?.net_sales);
        const hasPersistedAdjustedGross =
          eventPaymentSummary?.net_sales !== null &&
          eventPaymentSummary?.net_sales !== undefined &&
          eventPaymentSummary?.net_sales !== "" &&
          Number.isFinite(persistedAdjustedGrossRaw);
        const adjustedGrossAmount = hasPersistedAdjustedGross
          ? Math.max(persistedAdjustedGrossRaw, 0)
          : Math.max(totalSales - tax, 0);
        const commissionPoolPercent =
          Number(eventInfo.commission_pool ?? eventPaymentSummary.commission_pool_percent ?? 0) || 0;
        const eventCommissionDollarsRaw =
          adjustedGrossAmount * commissionPoolPercent;
        const eventCommissionDollars = Number.isFinite(eventCommissionDollarsRaw) ? eventCommissionDollarsRaw : 0;
        const eventTotalTips = eventTips;

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

                let vendorsWithHours = 0;
                if (eventCommissionDollars > 0) {
                  try {
                    const tsRes = await fetch(`/api/events/${eventId}/timesheet`, {
                      method: 'GET',
                      headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
                    });
                    if (tsRes.ok) {
                      const tsJson = await tsRes.json();
                      const totals = tsJson?.totals || {};
                      const byDivision = teamMembers.reduce((count: number, member: any) => {
                        const uid = (member?.vendor_id || member?.user_id || member?.users?.id || '').toString();
                        const ms = Number(totals?.[uid] || 0);
                        return (isVendorDivision(member?.users?.division) && ms > 0) ? count + 1 : count;
                      }, 0);
                      const fallbackAny = teamMembers.reduce((count: number, member: any) => {
                        const uid = (member?.vendor_id || member?.user_id || member?.users?.id || '').toString();
                        const ms = Number(totals?.[uid] || 0);
                        return ms > 0 ? count + 1 : count;
                      }, 0);
                      vendorsWithHours = byDivision > 0 ? byDivision : fallbackAny;
                    }
                  } catch (e) {
                    console.warn('[HR PAYMENTS] Unable to load timesheet totals for commission-per-vendor fallback', { eventId, error: e });
                  }
                }
                const commissionPerVendor = vendorsWithHours > 0 ? (eventCommissionDollars / vendorsWithHours) : 0;

                // Map team members to payment format with zeros
                const teamPayments = sortPaymentsAlphabetically(
                  teamMembers.map((member: any) => {
                    const user = member.users;
                    const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
                    const firstName = profile?.first_name || 'N/A';
                    const lastName = profile?.last_name || '';

                    return {
                      userId: (member.vendor_id || member.user_id || user?.id || '').toString(),
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
                      adjustmentType: DEFAULT_OTHER_ADJUSTMENT_TYPE,
                      finalPay: 0,
                      status: member.status // Include confirmation status
                    };
                  })
                );

                byVenue[eventInfo.venue].events.push({
                  id: eventId,
                  name: eventInfo.event_name,
                  date: eventInfo.event_date,
                  commissionPerVendor,
                  vendorsWithHours,
                  state: eventInfo.state,
                  baseRate: configuredBaseRate,
                  commissionDollars: eventCommissionDollars,
                  adjustedGrossAmount,
                  totalTips: eventTotalTips,
                  totalRestBreak: 0,
                  totalOther: 0,
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
            commissionPerVendor: 0,
            vendorsWithHours: 0,
            state: eventInfo.state,
            baseRate: configuredBaseRate,
            commissionDollars: eventCommissionDollars,
            adjustedGrossAmount,
            totalTips: eventTotalTips,
            totalRestBreak: 0,
            totalOther: 0,
            eventTotal: 0,
            eventHours: 0,
            payments: []
          });
          continue;
        }

        // Process events with payment data
        const vendorPayments = eventPaymentData.vendorPayments;
        const summaryBaseRate = Number(eventPaymentSummary.base_rate || 0);
        const baseRate = configuredBaseRate > 0 ? configuredBaseRate : (summaryBaseRate > 0 ? summaryBaseRate : 17.28);
        console.log('[HR PAYMENTS] Event with payment data:', eventId, eventInfo.event_name, { vendorCount: vendorPayments.length });

        // Total team members on this event
        const memberCount = Array.isArray(vendorPayments) ? vendorPayments.length : 0;

        // Commission pool in dollars — try event_payments first, then compute from events table
        const commissionPoolDollars = eventCommissionDollars;
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

        // Tips: try event_payments summary first, then fall back to events table
        const totalTips = eventTotalTips;
        const useEqualTips = eventInfo?.event_date ? String(eventInfo.event_date).slice(0, 10) >= '2026-03-30' : true;
        // Equal tips (>= 2026-03-30): count eligible vendors. Prorated (< 2026-03-30): sum eligible hours.
        const tipsEligiblePool = vendorPayments.reduce((acc: number, p: any) => {
          if (p.tips_deleted === true) return acc;
          if (useEqualTips) return acc + 1;
          return acc + roundHoursToTwoDecimals(getEffectiveHours(p));
        }, 0);

        console.log('[HR PAYMENTS] Commission/Tips for event:', eventId, {
          commissionPoolDollars, perVendorCommissionShare, totalTips, tipsEligiblePool, memberCount, vendorCountForCommission,
          summaryPool: eventPaymentSummary.commission_pool_dollars,
          eventCommissionPool: eventInfo.commission_pool,
          summaryTips: eventPaymentSummary.total_tips,
          eventTips: eventInfo.tips,
        });

        // Map vendor payments
        const eventPayments = sortPaymentsAlphabetically(
          vendorPayments.map((payment: any) => {
            const user = payment.users;
            const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
            const rawFirstName = profile?.first_name || 'N/A';
            const rawLastName = profile?.last_name || '';
            const firstName = rawFirstName !== 'N/A' ? safeDecrypt(rawFirstName) : 'N/A';
            const lastName = rawLastName ? safeDecrypt(rawLastName) : '';
            const paymentUserId = (payment.user_id || payment.userId || user?.id || '').toString();
            const adjustmentAmount = Number(payment.adjustment_amount || 0);
            const adjustmentType = normalizeOtherAdjustmentType(payment.adjustment_note);
            const actualHours = getEffectiveHours(payment);
            const roundedPayrollHours = roundHoursToTwoDecimals(actualHours);

            const memberDivision = payment?.users?.division;
            const isTrailers = (memberDivision || "").toString().toLowerCase().trim() === "trailers";

            const priorWeeklyHours = isAZorNY ? (weeklyHoursMap[eventId]?.[payment.user_id] || 0) : 0;
            const isWeeklyOT = isAZorNY && (priorWeeklyHours + actualHours) > 40;
            const extAmtRegular = Math.round(roundedPayrollHours * baseRate * 100) / 100;
            const extAmtOnRegRateNonAzNy = Math.round(roundedPayrollHours * baseRate * 1.5 * 100) / 100;

            // Keep AZ/NY weekly-OT logic unchanged, but mirror Event Dashboard math for CA/NV/WI.
            let commissionAmt = 0;
            let otRate = 0;
            let extAmtOnRegRate = extAmtOnRegRateNonAzNy;
            let totalFinalCommissionAmt = 0;
            let loadedRate = 0;

            if (isAZorNY) {
              // Preliminary commission (CA formula on non-OT ext amt) used only to compute loaded rate for weekly OT
              const prelimCommission = (!isTrailers && roundedPayrollHours > 0 && vendorCountForCommission > 0)
                ? Math.max(0, perVendorCommissionShare - extAmtOnRegRateNonAzNy)
                : 0;
              const totalFinalCommissionBase = roundedPayrollHours > 0
                ? Math.max(150, extAmtRegular + prelimCommission)
                : 0;
              const loadedRateBase = roundedPayrollHours > 0
                ? totalFinalCommissionBase / roundedPayrollHours
                : baseRate;
              otRate = isWeeklyOT ? loadedRateBase * 1.5 : 0;
              extAmtOnRegRate = isWeeklyOT ? Math.round(otRate * roundedPayrollHours * 100) / 100 : extAmtOnRegRateNonAzNy;
              // Final commission uses CA formula against the resolved extAmtOnRegRate
              const rawCommissionAmt = (!isTrailers && roundedPayrollHours > 0 && vendorCountForCommission > 0)
                ? Math.max(0, perVendorCommissionShare - extAmtOnRegRate)
                : 0;
              commissionAmt = payment.commission_deleted === true
                ? 0
                : payment.commission_override != null
                ? Number(payment.commission_override)
                : rawCommissionAmt;
              totalFinalCommissionAmt = roundedPayrollHours > 0
                ? extAmtOnRegRate + commissionAmt
                : 0;
              loadedRate = loadedRateBase;
            } else {
              const rawTotalFinalCommission = isTrailers
                ? extAmtOnRegRateNonAzNy
                : Math.max(extAmtOnRegRateNonAzNy, perVendorCommissionShare);
              const rawCommissionAmt = (!isTrailers && roundedPayrollHours > 0 && vendorCountForCommission > 0)
                ? Math.max(0, rawTotalFinalCommission - extAmtOnRegRateNonAzNy)
                : 0;
              commissionAmt = payment.commission_deleted === true
                ? 0
                : payment.commission_override != null
                ? Number(payment.commission_override)
                : rawCommissionAmt;
              extAmtOnRegRate = extAmtOnRegRateNonAzNy;
              totalFinalCommissionAmt = roundedPayrollHours > 0 ? extAmtOnRegRateNonAzNy + commissionAmt : 0;
            }

            const totalFinalCommissionForLoadedRate =
              adjustmentAmount !== 0
                ? (totalFinalCommissionAmt + adjustmentAmount)
                : totalFinalCommissionAmt;
            const minLoadedRate = ['NY', 'WI', 'NV', 'AZ'].includes(eventState) ? 25.92 : 28.5;
            loadedRate = roundedPayrollHours > 0
              ? Math.max(minLoadedRate, totalFinalCommissionForLoadedRate / roundedPayrollHours)
              : 0;

            // Tips: respect per-vendor overrides/deletions, then equal or prorated, then fall back to stored value
            const tips = payment.tips_deleted === true
              ? 0
              : payment.tips_override != null
              ? Number(payment.tips_override)
              : (tipsEligiblePool > 0 && totalTips > 0)
              ? (useEqualTips ? totalTips / tipsEligiblePool : totalTips * (roundedPayrollHours / tipsEligiblePool))
              : Number(payment.tips || 0);

            const restBreak = getRestBreakAmount(actualHours, eventState);
            const totalPay = totalFinalCommissionAmt + tips + restBreak;
            const finalPay = totalPay + adjustmentAmount;
            return {
              userId: paymentUserId,
              firstName,
              lastName,
              email: user?.email || 'N/A',
              division: memberDivision,
              actualHours,
              regularHours: roundedPayrollHours,
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
              adjustmentType,
              finalPay,
              regRate: baseRate,
              loadedRate,
              extAmtOnRegRate,
              commissionAmt,
              totalFinalCommissionAmt,
              restBreak,
              totalGrossPay: finalPay,
            };
          })
        );
        console.log('[HR PAYMENTS] event payments mapped', { eventId, count: eventPayments.length, sample: eventPayments.slice(0,2).map((p: any) => ({ userId: p.userId, hours: p.actualHours, total: p.totalPay })) });

        const eventTotal = eventPayments.reduce((sum: number, p: any) => sum + Number(p.finalPay || 0), 0);
        const eventHours = eventPayments.reduce((sum: number, p: any) => sum + p.actualHours, 0);
        const eventTotalRestBreak = eventPayments.reduce((sum: number, p: any) => sum + Number(p.restBreak || 0), 0);
        const eventTotalOther = eventPayments.reduce((sum: number, p: any) => sum + Number(p.adjustmentAmount || 0), 0);
        const vendorsWithHoursByDivision = eventPayments.reduce((count: number, p: any) => {
          const hours = Number(p.actualHours || 0);
          return (isVendorDivision(p?.division) && hours > 0) ? count + 1 : count;
        }, 0);
        const vendorsWithHoursFallback = eventPayments.reduce((count: number, p: any) => {
          return Number(p.actualHours || 0) > 0 ? count + 1 : count;
        }, 0);
        const vendorsWithHours = vendorsWithHoursByDivision > 0 ? vendorsWithHoursByDivision : vendorsWithHoursFallback;
        const safeCommissionPoolDollars = Number.isFinite(commissionPoolDollars) ? commissionPoolDollars : 0;
        const commissionPerVendor = vendorsWithHours > 0 ? (safeCommissionPoolDollars / vendorsWithHours) : 0;

        byVenue[eventInfo.venue].totalPayment += eventTotal;
        byVenue[eventInfo.venue].totalHours += eventHours;
        byVenue[eventInfo.venue].events.push({
          id: eventId,
          name: eventInfo.event_name,
          date: eventInfo.event_date,
          commissionPerVendor,
          vendorsWithHours,
          state: eventInfo.state,
          baseRate,
          commissionDollars: eventCommissionDollars,
          adjustedGrossAmount,
          totalTips: eventTotalTips,
          totalRestBreak: eventTotalRestBreak,
          totalOther: eventTotalOther,
          eventTotal,
          eventHours,
          payments: eventPayments
        });
      }
      console.log('[HR PAYMENTS] venues assembled', { venueCount: Object.keys(byVenue).length });
      const venuesArr = Object.values(byVenue);
      setPaymentsByVenue(venuesArr);

      // Fetch mileage pay data + approvals for all loaded events
      const allEventIdsForMileage = venuesArr.flatMap(v => v.events.map((ev: any) => ev.id)).filter(Boolean);
      if (allEventIdsForMileage.length > 0) {
        try {
          const authHeaders = { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) };
          const idsParam = encodeURIComponent(allEventIdsForMileage.join(','));
          const [mileageRes, approvalsRes] = await Promise.all([
            fetch(`/api/mileage-pay?event_ids=${idsParam}`, { headers: authHeaders }),
            fetch(`/api/mileage-approvals?event_ids=${idsParam}`, { headers: authHeaders }),
          ]);
          if (mileageRes.ok) {
            const mileageJson = await mileageRes.json();
            setMileageByEvent(mileageJson.mileage || {});
          }
          if (approvalsRes.ok) {
            const approvalsJson = await approvalsRes.json();
            // Convert DB nulls to true (null = not yet reviewed = approved)
            const loaded: Record<string, Record<string, { mileage: boolean; travel: boolean }>> = {};
            for (const [evId, users] of Object.entries(approvalsJson.approvals || {})) {
              loaded[evId] = {};
              for (const [uid, vals] of Object.entries(users as any)) {
                const v = vals as { mileage: boolean | null; travel: boolean | null };
                loaded[evId][uid] = {
                  mileage: v.mileage ?? true,
                  travel: v.travel ?? true,
                };
              }
            }
            setMileageApprovals(loaded);
          }
        } catch (e) {
          console.warn('[HR PAYMENTS] Failed to fetch mileage data:', e);
        }
      }

      // Seed editable adjustments map from loaded data
      const initialAdjustments: Record<string, Record<string, number>> = {};
      const initialAdjustmentTypes: Record<string, Record<string, OtherAdjustmentType>> = {};
      venuesArr.forEach((v) => {
        v.events.forEach((ev: any) => {
          if (!initialAdjustments[ev.id]) initialAdjustments[ev.id] = {};
          if (!initialAdjustmentTypes[ev.id]) initialAdjustmentTypes[ev.id] = {};
          (ev.payments || []).forEach((p: any) => {
            const paymentUserId = (p.userId || '').toString();
            if (!paymentUserId) return;
            initialAdjustments[ev.id][paymentUserId] = Number(p.adjustmentAmount || 0);
            initialAdjustmentTypes[ev.id][paymentUserId] = normalizeOtherAdjustmentType(p.adjustmentType);
          });
        });
      });
      setAdjustments(initialAdjustments);
      setAdjustmentTypes(initialAdjustmentTypes);
    } catch (e: any) {
      setPaymentsError(e.message || 'Failed to load payments');
    } finally {
      setLoadingPayments(false);
    }
  }, [paymentsStartDate, paymentsEndDate]);

  // Persist a single adjustment
  const saveAdjustment = useCallback(async (eventId: string, userId: string): Promise<boolean> => {
    try {
      setSavingAdjustment(true);
      if (!eventId || !userId) {
        throw new Error('Missing event or user id for adjustment save');
      }

      const amount = Number(adjustments[eventId]?.[userId] || 0);
      const adjustmentType = normalizeOtherAdjustmentType(adjustmentTypes[eventId]?.[userId]);
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const basePayload = {
        event_id: eventId,
        user_id: userId,
        adjustment_amount: amount,
      };

      // Backward-compatible save: try with type metadata first, then retry without note.
      let res = await fetch('/api/payment-adjustments', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...basePayload, adjustment_note: adjustmentType }),
      });

      if (!res.ok) {
        res = await fetch('/api/payment-adjustments', {
          method: 'POST',
          headers,
          body: JSON.stringify(basePayload),
        });
      }

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
            const totalFinalCommissionAmt = Number(p.totalFinalCommissionAmt || 0);
            const totalFinalCommissionForLoadedRate =
              newAdj !== 0
                ? (totalFinalCommissionAmt + newAdj)
                : totalFinalCommissionAmt;
            const rawHours = roundHoursToTwoDecimals(Number(p.actualHours || 0));
            const loadedRate = rawHours > 0
              ? Math.max(28.5, totalFinalCommissionForLoadedRate / rawHours)
              : 0;
            return {
              ...p,
              adjustmentAmount: newAdj,
              adjustmentType,
              loadedRate,
              finalPay: Number(p.totalPay || 0) + newAdj,
              totalGrossPay: Number(p.totalPay || 0) + newAdj,
            };
          });
          const eventTotal = payments.reduce((sum: number, p: any) => sum + Number(p.finalPay || 0), 0);
          const eventHours = payments.reduce((sum: number, p: any) => sum + p.actualHours, 0);
          const totalOther = payments.reduce((sum: number, p: any) => sum + Number(p.adjustmentAmount || 0), 0);
          return { ...ev, payments, totalOther, eventTotal, eventHours };
        });
        const totalPayment = events.reduce((sum: number, ev: any) => sum + Number(ev.eventTotal || 0), 0);
        const totalHours = events.reduce((sum: number, ev: any) => sum + Number(ev.eventHours || 0), 0);
        return { ...v, events, totalPayment, totalHours };
      }));
      return true;
    } catch (e: any) {
      const message = e?.message || 'Failed to save adjustment';
      setPaymentsError(message);
      alert(message);
      return false;
    } finally {
      setSavingAdjustment(false);
    }
  }, [adjustments, adjustmentTypes, supabase]);

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

  const loadApprovalSubmissions = useCallback(async () => {
    setLoadingSubmissions(true);
    try {
      const { data, error } = await supabase
        .from('payroll_approval_submissions')
        .select('id, file_name, status, submitted_at')
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      setApprovalSubmissions(data ?? []);
    } catch (e: any) {
      console.error('[loadApprovalSubmissions]', e.message);
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  const sendToApproval = useCallback(async () => {
    if (!approvalFile) {
      setApprovalError('Please select an Excel file to attach.');
      return;
    }
    setSendingApproval(true);
    setApprovalError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append('file', approvalFile);
      const res = await fetch('/api/payroll/send-approval', {
        method: 'POST',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to send email');
      setShowApprovalModal(false);
      setApprovalFile(null);
      await loadApprovalSubmissions();
      alert('Payroll approval email sent successfully.');
    } catch (e: any) {
      setApprovalError(e.message || 'Failed to send approval email');
    } finally {
      setSendingApproval(false);
    }
  }, [approvalFile, loadApprovalSubmissions]);

  // Export payments to Excel
  const exportPaymentsToExcel = useCallback(() => {
    if (paymentsByVenue.length === 0) {
      alert('No payment data to export. Please load payments first.');
      return;
    }

    // Event-level summary rows (matches payroll header metrics in UI)
    const summaryRows: any[] = [];
    // Employee-level detail rows
    const rows: any[] = [];

    paymentsByVenue.forEach(venue => {
      venue.events.forEach(event => {
        const totalExtAmtRegRate = Array.isArray(event.payments)
          ? event.payments.reduce((sum: number, p: any) => sum + Number(p.extAmtOnRegRate ?? p.regularPay ?? 0), 0)
          : 0;

        summaryRows.push({
          'Venue': venue.venue,
          'City': venue.city || '',
          'State': venue.state || '',
          'Event': event.name || '',
          'Date': event.date || '',
          'Hours': formatHoursHHMM(Number(event.eventHours || 0)),
          'Adjusted Gross Amount': Number(Number(event.adjustedGrossAmount || 0).toFixed(2)),
          'Total Commission': Number(Number(event.commissionDollars || 0).toFixed(2)),
          'Commission per Vendor': Number(roundUpThousandsToNextHundred(Number(event.commissionPerVendor || 0)).toFixed(2)),
          'Vendors w/ Hours': Number(event.vendorsWithHours || 0),
          'Total Tips': Number(Number(event.totalTips || 0).toFixed(2)),
          'Total Rest Break': Number(Number(event.totalRestBreak || 0).toFixed(2)),
          'Total Other': Number(Number(event.totalOther || 0).toFixed(2)),
          'Total Mileage Pay': Number(Number(Array.isArray(event.payments) ? event.payments.reduce((s: number, p: any) => s + (getMileageApproval(event.id, p.userId).mileage ? Number((mileageByEvent[event.id] || {})[p.userId]?.mileagePay || 0) : 0), 0) : 0).toFixed(2)),
          'Total Travel Pay': Number(Number(Array.isArray(event.payments) ? event.payments.reduce((s: number, p: any) => { if (!getMileageApproval(event.id, p.userId).travel) return s; const dm = (mileageByEvent[event.id] || {})[p.userId]?.differentialMiles ?? null; return s + (dm !== null ? ((dm * 2) / 60) * Number(p.regRate ?? event.baseRate ?? 0) : 0); }, 0) : 0).toFixed(2)),
          'Total': Number(Number(event.eventTotal || 0).toFixed(2)),
          'Total Ext Amt Reg Rate': Number(Number(totalExtAmtRegRate).toFixed(2)),
        });

        if (Array.isArray(event.payments) && event.payments.length > 0) {
          event.payments.forEach((p: any) => {
            const st = (event.state || venue.state || '').toString().toUpperCase().replace(/[^A-Z]/g, '');
            const hideRest = false;

            const regRate = Number(p.regRate ?? event.baseRate ?? 0);
            const loadedRate = Number(p.loadedRate ?? regRate);
            const hours = Number(p.actualHours || 0);
            const hoursHHMM = formatHoursHHMM(hours);
            const hoursInDecimal = roundHoursToTwoDecimals(hours);
            const extAmtOnRegRate = Number(p.extAmtOnRegRate ?? p.regularPay ?? 0);
            const commissionAmt = Number(p.commissionAmt ?? p.commissions ?? 0);
            const totalFinalCommissionAmt = Number(p.totalFinalCommissionAmt ?? 0);
            const other = Number(p.adjustmentAmount || 0);
            const tips = Number(p.tips || 0);
            const restBreak = hideRest ? 0 : Number(p.restBreak || 0);
            const _mileagePayExport = Number((mileageByEvent[event.id] || {})[p.userId]?.mileagePay || 0);
            const mileageMiles = (mileageByEvent[event.id] || {})[p.userId]?.miles ?? null;
            const diffMilesExport = (mileageByEvent[event.id] || {})[p.userId]?.differentialMiles ?? null;
            const _travelHoursExport = diffMilesExport !== null ? (diffMilesExport * 2) / 60 : 0;
            const _travelPayExport = _travelHoursExport * Number(p.regRate ?? event.baseRate ?? 0);
            const exportApproval = getMileageApproval(event.id, p.userId);
            const mileagePay = exportApproval.mileage ? _mileagePayExport : 0;
            const travelPayExport = exportApproval.travel ? _travelPayExport : 0;
            const travelHoursExport = exportApproval.travel ? _travelHoursExport : 0;
            const totalGrossPay = Number(p.finalPay || p.totalGrossPay || 0) + mileagePay + travelPayExport;

            rows.push({
              'Venue': venue.venue,
              'City': venue.city || '',
              'State': venue.state || '',
              'Event Name': event.name,
              'Event Date': event.date || '',
              'Employee': `${p.firstName || ''} ${p.lastName || ''}`.trim(),
              'Email': p.email || '',
              'Reg Rate': formatPayrollMoney(regRate),
              'Rate in Effect': formatPayrollMoney(loadedRate),
              'Hours': hoursHHMM,
              'Hours in Decimal': hoursInDecimal,
              'Ext Amt on Reg Rate': Number(Number(extAmtOnRegRate).toFixed(2)),
              'Commission Amt': Number(roundUpThousandsToNextHundred(commissionAmt).toFixed(2)),
              'Total Final Commission Amt': Number(roundUpThousandsToNextHundred(totalFinalCommissionAmt).toFixed(2)),
              'Tips': Number(roundUpThousandsToNextHundred(tips).toFixed(2)),
              'Rest Break': hideRest ? 'N/A' : Number(roundUpThousandsToNextHundred(restBreak).toFixed(2)),
              'Mileage Miles': mileageMiles !== null ? mileageMiles : 'N/A',
              'Mileage Pay': Number(roundUpThousandsToNextHundred(mileagePay).toFixed(2)),
              'Travel Differential Miles': diffMilesExport !== null ? diffMilesExport : 'N/A',
              'Travel Hours': diffMilesExport !== null ? Number(travelHoursExport.toFixed(4)) : 'N/A',
              'Travel Pay': Number(roundUpThousandsToNextHundred(travelPayExport).toFixed(2)),
              'Other': Number(roundUpThousandsToNextHundred(other).toFixed(2)),
              'Total Gross Pay': Number(roundUpThousandsToNextHundred(totalGrossPay).toFixed(2)),
            });
          });
        }
      });
    });

    if (summaryRows.length === 0 && rows.length === 0) {
      alert('No payment records found in the loaded data.');
      return;
    }

    // Add totals row to Event Summaries sheet
    if (summaryRows.length > 0) {
      const sumNum = (key: string) => summaryRows.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0);
      summaryRows.push({
        'Venue': 'TOTAL',
        'City': '',
        'State': '',
        'Event': '',
        'Date': '',
        'Hours': Number(paymentsByVenue.reduce((s: number, v: any) => s + v.events.reduce((es: number, ev: any) => es + Number(ev.eventHours || 0), 0), 0).toFixed(2)),
        'Adjusted Gross Amount': Number(sumNum('Adjusted Gross Amount').toFixed(2)),
        'Total Commission': Number(sumNum('Total Commission').toFixed(2)),
        'Commission per Vendor': '',
        'Vendors w/ Hours': '',
        'Total Tips': Number(sumNum('Total Tips').toFixed(2)),
        'Total Rest Break': Number(sumNum('Total Rest Break').toFixed(2)),
        'Total Other': Number(sumNum('Total Other').toFixed(2)),
        'Total Mileage Pay': Number(sumNum('Total Mileage Pay').toFixed(2)),
        'Total Travel Pay': Number(sumNum('Total Travel Pay').toFixed(2)),
        'Total': Number(sumNum('Total').toFixed(2)),
        'Total Ext Amt Reg Rate': Number(sumNum('Total Ext Amt Reg Rate').toFixed(2)),
      });
    }

    // Add totals row to Payments sheet
    if (rows.length > 0) {
      const sumNum = (key: string) => rows.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0);
      rows.push({
        'Venue': 'TOTAL',
        'City': '',
        'State': '',
        'Event Name': '',
        'Event Date': '',
        'Employee': '',
        'Email': '',
        'Reg Rate': '',
        'Rate in Effect': '',
        'Hours': '',
        'Hours in Decimal': Number(sumNum('Hours in Decimal').toFixed(2)),
        'Ext Amt on Reg Rate': Number(sumNum('Ext Amt on Reg Rate').toFixed(2)),
        'Commission Amt': Number(sumNum('Commission Amt').toFixed(2)),
        'Total Final Commission Amt': Number(sumNum('Total Final Commission Amt').toFixed(2)),
        'Tips': Number(sumNum('Tips').toFixed(2)),
        'Rest Break': Number(rows.reduce((s, r) => s + (typeof r['Rest Break'] === 'number' ? r['Rest Break'] : 0), 0).toFixed(2)),
        'Mileage Miles': '',
        'Mileage Pay': Number(sumNum('Mileage Pay').toFixed(2)),
        'Travel Hours': '',
        'Travel Pay': Number(sumNum('Travel Pay').toFixed(2)),
        'Other': Number(sumNum('Other').toFixed(2)),
        'Total Gross Pay': Number(sumNum('Total Gross Pay').toFixed(2)),
      });
    }

    // Create workbook
    const workbook = XLSX.utils.book_new();

    if (summaryRows.length > 0) {
      const summaryWorksheet = XLSX.utils.json_to_sheet(summaryRows);
      summaryWorksheet['!cols'] = [
        { wch: 25 }, // Venue
        { wch: 15 }, // City
        { wch: 8 },  // State
        { wch: 30 }, // Event
        { wch: 12 }, // Date
        { wch: 10 }, // Hours
        { wch: 22 }, // Adjusted Gross Amount
        { wch: 18 }, // Total Commission
        { wch: 22 }, // Commission per Vendor
        { wch: 16 }, // Vendors w/ Hours
        { wch: 12 }, // Total Tips
        { wch: 18 }, // Total Rest Break
        { wch: 12 }, // Total Other
        { wch: 12 }, // Total
        { wch: 22 }, // Total Ext Amt Reg Rate
      ];
      XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Event Summaries');
    }

    if (rows.length > 0) {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 25 }, // Venue
        { wch: 15 }, // City
        { wch: 8 },  // State
        { wch: 30 }, // Event Name
        { wch: 12 }, // Event Date
        { wch: 25 }, // Employee
        { wch: 30 }, // Email
        { wch: 10 }, // Reg Rate
        { wch: 12 }, // Rate in Effect
        { wch: 8 },  // Hours
        { wch: 16 }, // Hours in Decimal
        { wch: 18 }, // Ext Amt on Reg Rate
        { wch: 15 }, // Commission Amt
        { wch: 22 }, // Total Final Commission Amt
        { wch: 10 }, // Tips
        { wch: 12 }, // Rest Break
        { wch: 10 }, // Other
        { wch: 15 }, // Total Gross Pay
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Payments');
    }

    // Generate filename with date range
    const startStr = paymentsStartDate || 'start';
    const endStr = paymentsEndDate || 'end';
    const filename = `payments_${startStr}_to_${endStr}.xlsx`;

    // Download file
    XLSX.writeFile(workbook, filename);
  }, [paymentsByVenue, paymentsStartDate, paymentsEndDate, mileageByEvent]);

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

  const loadSickLeaves = useCallback(async () => {
    setLoadingSickLeaves(true);
    setSickLeavesError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/hr/sick-leaves", {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load sick leave records");
      }

      setSickLeaves(Array.isArray(data.records) ? data.records : []);
      setSickLeaveAccruals(Array.isArray(data.accruals) ? data.accruals : []);
      setSickLeaveStats({
        total: Number(data.stats?.total || 0),
        pending: Number(data.stats?.pending || 0),
        approved: Number(data.stats?.approved || 0),
        denied: Number(data.stats?.denied || 0),
        total_hours: Number(data.stats?.total_hours || 0),
      });
    } catch (err: any) {
      setSickLeaves([]);
      setSickLeaveAccruals([]);
      setSickLeaveStats({ total: 0, pending: 0, approved: 0, denied: 0, total_hours: 0 });
      setSickLeavesError(err?.message || "Failed to load sick leave records");
    } finally {
      setLoadingSickLeaves(false);
    }
  }, []);

  useEffect(() => {
    if (hrView === "sickleave") {
      loadSickLeaves();
    }
  }, [hrView, loadSickLeaves]);

  useEffect(() => {
    if (hrView === "payments") {
      loadApprovalSubmissions();
    }
  }, [hrView, loadApprovalSubmissions]);

  const updateSickLeaveStatus = useCallback(async (id: string, status: SickLeaveStatus) => {
    setUpdatingSickLeaveId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/hr/sick-leaves", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id, status }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update sick leave status");
      }

      await loadSickLeaves();
    } catch (err: any) {
      alert(err?.message || "Failed to update sick leave status");
    } finally {
      setUpdatingSickLeaveId(null);
    }
  }, [loadSickLeaves]);

  const addUsedHours = useCallback(
    async (userId: string, employeeName: string) => {
      const input = window.prompt(`Add used sick leave hours for ${employeeName}:`, "8");
      if (input == null) return;

      const parsedHours = Number(input.trim());
      if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
        alert("Please enter a valid positive number of hours.");
        return;
      }

      setAddingUsedHoursUserId(userId);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/hr/sick-leaves", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            user_id: userId,
            duration_hours: Number(parsedHours.toFixed(2)),
            reason: "Manual used-hours entry from HR dashboard",
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to add used sick leave hours");
        }

        await loadSickLeaves();
      } catch (err: any) {
        alert(err?.message || "Failed to add used sick leave hours");
      } finally {
        setAddingUsedHoursUserId(null);
      }
    },
    [loadSickLeaves]
  );

  const removeUsedHours = useCallback(
    async (userId: string, employeeName: string, usedHours: number) => {
      if (!Number.isFinite(usedHours) || usedHours <= 0) {
        alert("This employee has no used hours to remove.");
        return;
      }

      const suggested = Math.min(usedHours, 8);
      const input = window.prompt(
        `Take away used sick leave hours for ${employeeName} (current used: ${usedHours.toFixed(2)}):`,
        suggested.toFixed(2)
      );
      if (input == null) return;

      const parsedHours = Number(input.trim());
      if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
        alert("Please enter a valid positive number of hours.");
        return;
      }

      setRemovingUsedHoursUserId(userId);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/hr/sick-leaves", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            user_id: userId,
            duration_hours: Number(parsedHours.toFixed(2)),
            operation: "remove",
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to remove used sick leave hours");
        }

        await loadSickLeaves();
      } catch (err: any) {
        alert(err?.message || "Failed to remove used sick leave hours");
      } finally {
        setRemovingUsedHoursUserId(null);
      }
    },
    [loadSickLeaves]
  );

  const editSickAccrualHours = useCallback(
    async (
      userId: string,
      employeeName: string,
      field: "carry_over" | "year_to_date",
      currentHours: number
    ) => {
      const fieldLabel = field === "carry_over" ? "Carry Over" : "Year to Date";
      const input = window.prompt(
        `Set ${fieldLabel} hours for ${employeeName}:`,
        Number(currentHours || 0).toFixed(2)
      );
      if (input == null) return;

      const parsedHours = Number(input.trim());
      if (!Number.isFinite(parsedHours) || parsedHours < 0) {
        alert("Please enter a valid number of hours (0 or greater).");
        return;
      }

      const key = `${field}:${userId}`;
      setEditingSickAccrualKey(key);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/hr/sick-leaves", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            user_id: userId,
            operation: "set_adjustment",
            adjustment_field: field,
            target_hours: Number(parsedHours.toFixed(2)),
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Failed to update ${fieldLabel} hours`);
        }

        await loadSickLeaves();
      } catch (err: any) {
        alert(err?.message || `Failed to update ${fieldLabel} hours`);
      } finally {
        setEditingSickAccrualKey(null);
      }
    },
    [loadSickLeaves]
  );

  const formatSickLeaveDate = (value?: string | null) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString();
  };

  const formatSickLeaveHours = (hours: number) => {
    if (!Number.isFinite(hours)) return "0.00";
    return Number(hours).toFixed(2);
  };

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

  const regionNameById = useMemo(() => {
    return regions.reduce<Record<string, string>>((acc, region) => {
      if (region.id) acc[region.id] = region.name || region.id;
      return acc;
    }, {});
  }, [regions]);

  const exportEmployeeRosterToExcel = useCallback(() => {
    if (employees.length === 0) {
      alert("No employee data to export.");
      return;
    }

    const colWidths = [
      { wch: 30 }, // User Name
      { wch: 32 }, // Email
      { wch: 20 }, // City
      { wch: 10 }, // State
      { wch: 24 }, // Region
      { wch: 60 }, // Venues Worked
    ];

    const toRow = (employee: typeof employees[number]) => {
      const firstName = employee.first_name ? safeDecrypt(employee.first_name) : "";
      const lastName = employee.last_name ? safeDecrypt(employee.last_name) : "";
      const fullName = `${firstName} ${lastName}`.trim() || employee.email || "N/A";
      const regionName = employee.region_name
        || (employee.region_id ? (regionNameById[employee.region_id] || "Unassigned") : "Unassigned");

      return {
        "User Name": fullName,
        Email: employee.email || "",
        City: employee.city || "",
        State: employee.state || "",
        Region: regionName,
        "Venues Worked": Array.isArray(employee.worked_venues) ? employee.worked_venues.join(", ") : "",
      };
    };

    const workbook = XLSX.utils.book_new();

    // All employees sheet
    const allSheet = XLSX.utils.json_to_sheet(employees.map(toRow));
    allSheet["!cols"] = colWidths;
    XLSX.utils.book_append_sheet(workbook, allSheet, "All Employees");

    // Per-region sheets (includes San Diego and any other active regions)
    const regionGroups = new Map<string, typeof employees>();
    employees.forEach((employee) => {
      const regionName = employee.region_name
        || (employee.region_id ? (regionNameById[employee.region_id] || "Unassigned") : "Unassigned");
      if (!regionGroups.has(regionName)) regionGroups.set(regionName, []);
      regionGroups.get(regionName)!.push(employee);
    });

    const sortedRegions = Array.from(regionGroups.keys()).sort((a, b) => {
      if (a === "Unassigned") return 1;
      if (b === "Unassigned") return -1;
      return a.localeCompare(b);
    });

    sortedRegions.forEach((regionName) => {
      const regionSheet = XLSX.utils.json_to_sheet(regionGroups.get(regionName)!.map(toRow));
      regionSheet["!cols"] = colWidths;
      XLSX.utils.book_append_sheet(workbook, regionSheet, regionName.slice(0, 31));
    });

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `employee_roster_${today}.xlsx`);
  }, [employees, regionNameById]);

  const filteredSickLeaveAccruals = useMemo(() => {
    const q = sickLeaveSearch.trim().toLowerCase();
    if (!q) return sickLeaveAccruals;
    return sickLeaveAccruals.filter((record) => {
      const text = [
        record.employee_name,
        record.employee_email,
        record.employee_city,
        record.employee_state,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [sickLeaveAccruals, sickLeaveSearch]);

  const sickLeaveAccrualTotals = useMemo(() => {
    return sickLeaveAccruals.reduce(
      (acc, row) => {
        acc.totalAccruedHours += Number(row.accrued_hours || 0);
        acc.totalCarryOverHours += Number(row.carry_over_hours || 0);
        acc.totalBalanceHours += Number(row.balance_hours || 0);
        return acc;
      },
      { totalAccruedHours: 0, totalCarryOverHours: 0, totalBalanceHours: 0 }
    );
  }, [sickLeaveAccruals]);

  const filteredSickLeaveRecords = useMemo(() => {
    const q = sickLeaveSearch.trim().toLowerCase();
    return sickLeaves.filter((record) => {
      const matchesStatus = sickLeaveStatusFilter === "all" || record.status === sickLeaveStatusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;

      const text = [
        record.employee_name,
        record.employee_email,
        record.employee_city,
        record.employee_state,
        record.reason,
        record.status,
        record.start_date,
        record.end_date,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(q);
    });
  }, [sickLeaves, sickLeaveSearch, sickLeaveStatusFilter]);

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
            <button onClick={handleLogout} className="apple-button apple-button-secondary">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
              </svg>
              Logout
            </button>
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
          <Link href="/supplement-onboarding">
            <button className="apple-button apple-button-secondary">
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Supplement Onboarding
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
              onClick={() => setHrView("sickleave")}
              className={`pb-4 px-2 font-semibold transition-colors relative ${
                hrView === "sickleave" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Sick Leave
              {hrView === "sickleave" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
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
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Key Metrics</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={exportEmployeeRosterToExcel}
                    className={`apple-button ${employees.length === 0 ? "apple-button-disabled" : "apple-button-secondary"}`}
                    disabled={employees.length === 0}
                  >
                    Export Employee Roster
                  </button>
                  <span className="text-sm text-gray-500 font-medium">HR Dashboard</span>
                </div>
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
                <button onClick={() => { setApprovalError(''); setShowApprovalModal(true); }} className="apple-button apple-button-primary">
                  Send to Approval
                </button>
                <Link href="/payroll-approvals">
                  <button className="apple-button apple-button-secondary">View Approvals</button>
                </Link>
              </div>
            </div>

            {/* Send to Approval Modal */}
            {showApprovalModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-8">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-gray-900">Send Payroll for Approval</h2>
                    <button
                      onClick={() => { setShowApprovalModal(false); setApprovalFile(null); setApprovalError(''); }}
                      className="text-gray-400 hover:text-gray-600 transition-colors text-2xl leading-none"
                      aria-label="Close"
                    >
                      &times;
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mb-5">
                    Upload the payroll Excel file to send it as an attachment for approval.
                  </p>
                  <label className="apple-label" htmlFor="approval-file">Excel File (.xlsx / .xls)</label>
                  <input
                    id="approval-file"
                    type="file"
                    accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="block w-full mt-1 mb-4 text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                    onChange={(e) => {
                      setApprovalFile(e.target.files?.[0] ?? null);
                      setApprovalError('');
                    }}
                  />
                  {approvalFile && (
                    <p className="text-xs text-gray-500 mb-4">Selected: <span className="font-medium text-gray-700">{approvalFile.name}</span></p>
                  )}
                  {approvalError && (
                    <div className="apple-alert apple-alert-error mb-4">{approvalError}</div>
                  )}
                  <div className="flex gap-3 justify-end mt-2">
                    <button
                      onClick={() => { setShowApprovalModal(false); setApprovalFile(null); setApprovalError(''); }}
                      className="apple-button apple-button-secondary"
                      disabled={sendingApproval}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={sendToApproval}
                      className={`apple-button ${sendingApproval || !approvalFile ? 'apple-button-disabled' : 'apple-button-primary'}`}
                      disabled={sendingApproval || !approvalFile}
                    >
                      {sendingApproval ? 'Sending…' : 'Send Email'}
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                        <div className="text-2xl font-bold text-gray-900">${formatPayrollMoney(v.totalPayment)}</div>
                        <div className="text-sm text-gray-500">{formatHoursDecimal(v.totalHours)} hrs</div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Event</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Date</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Hours</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Adjusted Gross Amount</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Total Commission</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Commission per Vendor</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Total Tips</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Total Rest Break</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Total Other</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Total</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {v.events.map(ev => (
                            <>
                              <tr key={ev.id} className="bg-white">
                                <td className="px-4 py-2 text-sm text-gray-900">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Event</div>
                                  <div>{ev.name}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-500">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Date</div>
                                  <div>{ev.date || '—'}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Hours</div>
                                  <div>{formatHoursDecimal(ev.eventHours || 0)}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Adjusted Gross Amount</div>
                                  <div>${formatExactMoney(Number(ev.adjustedGrossAmount || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total Commission</div>
                                  <div>${formatExactMoney(Number(ev.commissionDollars || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Commission per Vendor</div>
                                  <div>${formatPayrollMoney(Number(ev.commissionPerVendor || 0))}</div>
                                  <div className="text-[10px] text-gray-400">{Number(ev.vendorsWithHours || 0)} vendors w/ hours</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total Tips</div>
                                  <div>${formatExactMoney(Number(ev.totalTips || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total Rest Break</div>
                                  <div>${formatExactMoney(Number(ev.totalRestBreak || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total Other</div>
                                  <div>${formatExactMoney(Number(ev.totalOther || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total</div>
                                  <div>${formatExactMoney(Number(ev.eventTotal || 0))}</div>
                                </td>
                              </tr>
                              <tr>
                                <td colSpan={10} className="px-4 py-2">
                                  {Array.isArray(ev.payments) && ev.payments.length > 0 ? (
                                    <div className="overflow-x-auto border rounded">
                                      <table className="min-w-full">
                                        <thead className="bg-gray-50">
                                          {(() => {
                                            const st = normalizeState(ev.state || v.state);
                                            const hideRest = false;
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
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Mileage Pay</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Travel Pay</th>
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
                                                const hideRest = false;
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
                                                const _mileagePay = Number((mileageByEvent[ev.id] || {})[p.userId]?.mileagePay || 0);
                                                const differentialMiles = (mileageByEvent[ev.id] || {})[p.userId]?.differentialMiles ?? null;
                                                const _travelHours = differentialMiles !== null ? (differentialMiles * 2) / 60 : 0;
                                                const _travelPay = _travelHours * regRate;
                                                const approval = getMileageApproval(ev.id, p.userId);
                                                const mileagePay = approval.mileage ? _mileagePay : 0;
                                                const travelPay = approval.travel ? _travelPay : 0;
                                                const totalGrossPay = Number(p.finalPay || p.totalGrossPay || 0) + mileagePay + travelPay;
                                                const currentAdjustmentType = normalizeOtherAdjustmentType(
                                                  ((adjustmentTypes[ev.id] ?? {})[p.userId] ?? p.adjustmentType ?? DEFAULT_OTHER_ADJUSTMENT_TYPE)
                                                );
                                                const currentAdjustmentTypeLabel = getOtherAdjustmentTypeLabel(currentAdjustmentType);

                                                return (
                                                  <>
                                                    <td className="p-2 text-sm">${formatPayrollMoney(regRate)}/hr</td>
                                                    <td className="p-2 text-sm">${formatPayrollMoney(loadedRate)}/hr</td>
                                                    <td className="p-2 text-sm">{formatHoursDecimal(hours)}</td>
                                                    {showOT && (
                                                      <td className="p-2 text-sm">{otRate > 0 ? `$${formatPayrollMoney(otRate)}/hr` : '\u2014'}</td>
                                                    )}
                                                    <td className="p-2 text-sm text-green-600">${formatExactMoney(extAmtOnRegRate)}</td>
                                                    <td className="p-2 text-sm text-purple-600">{commissionAmt > 0 ? `$${formatPayrollMoney(commissionAmt)}` : '\u2014'}</td>
                                                    <td className="p-2 text-sm text-green-600">${formatPayrollMoney(totalFinalCommissionAmt)}</td>
                                                    <td className="p-2 text-sm text-orange-600">${formatPayrollMoney(tips)}</td>
                                                    {!hideRest && (
                                                      <td className="p-2 text-sm text-green-600">${formatPayrollMoney(restBreak)}</td>
                                                    )}
                                                    <td className="p-2 text-sm text-blue-600">
                                                      {_mileagePay > 0 ? (
                                                        <div className="flex flex-col gap-0.5">
                                                          <span className={approval.mileage ? '' : 'line-through text-gray-400'}>${formatPayrollMoney(approval.mileage ? _mileagePay : 0)}</span>
                                                          {(() => { const md = (mileageByEvent[ev.id] || {})[p.userId]; return md?.differentialMiles != null && md.differentialMiles > 0 ? <div className="text-[10px] text-gray-400">{md.differentialMiles} mi diff × 2 × $0.71</div> : null; })()}
                                                          <div className="flex gap-1 mt-0.5">
                                                            <button type="button" onClick={() => setMileageApproval(ev.id, p.userId, 'mileage', true)} className={`text-[10px] px-1.5 py-0.5 rounded border ${approval.mileage ? 'bg-green-100 border-green-400 text-green-700 font-semibold' : 'border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600'}`}>✓</button>
                                                            <button type="button" onClick={() => setMileageApproval(ev.id, p.userId, 'mileage', false)} className={`text-[10px] px-1.5 py-0.5 rounded border ${!approval.mileage ? 'bg-red-100 border-red-400 text-red-700 font-semibold' : 'border-gray-300 text-gray-400 hover:border-red-400 hover:text-red-600'}`}>✗</button>
                                                          </div>
                                                        </div>
                                                      ) : '\u2014'}
                                                    </td>
                                                    <td className="p-2 text-sm text-indigo-600">
                                                      {_travelPay > 0 ? (
                                                        <div className="flex flex-col gap-0.5">
                                                          <span className={approval.travel ? '' : 'line-through text-gray-400'}>${formatPayrollMoney(approval.travel ? _travelPay : 0)}</span>
                                                          {differentialMiles !== null && differentialMiles > 0 && <div className="text-[10px] text-gray-400">{differentialMiles} mi diff × 2 ÷ 60 × ${formatPayrollMoney(regRate)}/hr</div>}
                                                          <div className="flex gap-1 mt-0.5">
                                                            <button type="button" onClick={() => setMileageApproval(ev.id, p.userId, 'travel', true)} className={`text-[10px] px-1.5 py-0.5 rounded border ${approval.travel ? 'bg-green-100 border-green-400 text-green-700 font-semibold' : 'border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600'}`}>✓</button>
                                                            <button type="button" onClick={() => setMileageApproval(ev.id, p.userId, 'travel', false)} className={`text-[10px] px-1.5 py-0.5 rounded border ${!approval.travel ? 'bg-red-100 border-red-400 text-red-700 font-semibold' : 'border-gray-300 text-gray-400 hover:border-red-400 hover:text-red-600'}`}>✗</button>
                                                          </div>
                                                        </div>
                                                      ) : '\u2014'}
                                                    </td>
                                                    <td className="p-2 text-sm text-right">
                                                      {editingCell && editingCell.eventId === ev.id && editingCell.userId === p.userId ? (
                                                        <div className="flex flex-col items-end gap-1">
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
                                                          </div>
                                                          <select
                                                            className="w-32 px-2 py-1 border rounded text-xs text-right"
                                                            value={currentAdjustmentType}
                                                            onChange={(e) => {
                                                              const nextType = normalizeOtherAdjustmentType(e.target.value);
                                                              setAdjustmentTypes(prev => ({
                                                                ...prev,
                                                                [ev.id]: { ...(prev[ev.id] || {}), [p.userId]: nextType },
                                                              }));
                                                            }}
                                                          >
                                                            <option value="reimbursement_1">Reimbursement 1</option>
                                                            <option value="meal_break">Meal Break</option>
                                                          </select>
                                                          <div className="flex items-center gap-2">
                                                            <button
                                                              type="button"
                                                              onClick={async () => {
                                                                const saved = await saveAdjustment(ev.id, p.userId);
                                                                if (saved) setEditingCell(null);
                                                              }}
                                                              className="text-green-600 hover:text-green-700 text-xs font-medium"
                                                            >Save</button>
                                                            <button type="button" onClick={() => setEditingCell(null)} className="text-gray-500 hover:text-gray-600 text-xs">Cancel</button>
                                                          </div>
                                                        </div>
                                                      ) : (
                                                        <button
                                                          type="button"
                                                          className={`text-right ${Number(p.adjustmentAmount || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}
                                                          onClick={() => setEditingCell({ eventId: ev.id, userId: p.userId })}
                                                          title="Click to edit"
                                                        >
                                                          <div>{`$${formatPayrollMoney(Number(p.adjustmentAmount || 0))}`}</div>
                                                          <div className="text-[10px] text-gray-400">{currentAdjustmentTypeLabel}</div>
                                                        </button>
                                                      )}
                                                    </td>
                                                    <td className="p-2 text-sm font-semibold text-right">${formatPayrollMoney(totalGrossPay)}</td>
                                                  </>
                                                );
                                              })()}
                                            </tr>
                                          ))}
                                          {(() => {
                                            const st = normalizeState(ev.state || v.state);
                                            const hideRest = false;
                                            const showOT = st === "AZ" || st === "NY";
                                            const payments: any[] = ev.payments;
                                            const totHours = payments.reduce((s: number, p: any) => s + Number(p.actualHours || 0), 0);
                                            const totExt = payments.reduce((s: number, p: any) => s + Number(p.extAmtOnRegRate ?? p.regularPay ?? 0), 0);
                                            const totComm = payments.reduce((s: number, p: any) => s + Number(p.commissionAmt ?? p.commissions ?? 0), 0);
                                            const totFinalComm = payments.reduce((s: number, p: any) => s + Number(p.totalFinalCommissionAmt ?? 0), 0);
                                            const totTips = payments.reduce((s: number, p: any) => s + Number(p.tips || 0), 0);
                                            const totRest = payments.reduce((s: number, p: any) => s + Number(p.restBreak || 0), 0);
                                            const totOther = payments.reduce((s: number, p: any) => s + Number(p.adjustmentAmount || 0), 0);
                                            const totMileage = payments.reduce((s: number, p: any) => {
                                              const appr = getMileageApproval(ev.id, p.userId);
                                              return s + (appr.mileage ? Number((mileageByEvent[ev.id] || {})[p.userId]?.mileagePay || 0) : 0);
                                            }, 0);
                                            const totTravel = payments.reduce((s: number, p: any) => {
                                              const appr = getMileageApproval(ev.id, p.userId);
                                              if (!appr.travel) return s;
                                              const diffMiles = (mileageByEvent[ev.id] || {})[p.userId]?.differentialMiles ?? null;
                                              const rate = Number(p.regRate ?? ev.baseRate ?? 0);
                                              return s + (diffMiles !== null ? ((diffMiles * 2) / 60) * rate : 0);
                                            }, 0);
                                            const totGross = payments.reduce((s: number, p: any) => s + Number(p.finalPay || p.totalGrossPay || 0), 0) + totMileage + totTravel;
                                            return (
                                              <tr style={{ backgroundColor: '#e5e7eb' }} className="font-semibold text-sm border-t-2 border-gray-400">
                                                <td className="p-2 uppercase tracking-wide">Total</td>
                                                <td className="p-2"></td>
                                                <td className="p-2"></td>
                                                <td className="p-2">{totHours.toFixed(2)}</td>
                                                {showOT && <td className="p-2"></td>}
                                                <td className="p-2 text-green-600">${formatExactMoney(totExt)}</td>
                                                <td className="p-2 text-purple-600">${formatPayrollMoney(totComm)}</td>
                                                <td className="p-2 text-green-600">${formatPayrollMoney(totFinalComm)}</td>
                                                <td className="p-2 text-orange-600">${formatPayrollMoney(totTips)}</td>
                                                {!hideRest && <td className="p-2 text-green-600">${formatPayrollMoney(totRest)}</td>}
                                                <td className="p-2 text-blue-600">${formatPayrollMoney(totMileage)}</td>
                                                <td className="p-2 text-indigo-600">${formatPayrollMoney(totTravel)}</td>
                                                <td className="p-2 text-right">${formatPayrollMoney(totOther)}</td>
                                                <td className="p-2 text-right">${formatPayrollMoney(totGross)}</td>
                                              </tr>
                                            );
                                          })()}
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
                          <tr key="venue-totals" style={{ backgroundColor: '#e5e7eb' }} className="font-semibold text-sm border-t-2 border-gray-400">
                            <td className="px-4 py-2 text-gray-900 uppercase tracking-wide">Total</td>
                            <td className="px-4 py-2"></td>
                            <td className="px-4 py-2 text-gray-900 text-right">{v.events.reduce((s: number, ev: any) => s + Number(ev.eventHours || 0), 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.adjustedGrossAmount || 0), 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.commissionDollars || 0), 0))}</td>
                            <td className="px-4 py-2"></td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.totalTips || 0), 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.totalRestBreak || 0), 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.totalOther || 0), 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.eventTotal || 0), 0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Approval Submissions History */}
            <div className="apple-card mt-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Payroll Approval Submissions</h2>
                <button
                  onClick={loadApprovalSubmissions}
                  className="apple-button apple-button-secondary text-sm"
                  disabled={loadingSubmissions}
                >
                  {loadingSubmissions ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {loadingSubmissions ? (
                <p className="text-sm text-gray-500">Loading submissions…</p>
              ) : approvalSubmissions.length === 0 ? (
                <p className="text-sm text-gray-500">No approval submissions yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {approvalSubmissions.map(s => (
                        <tr key={s.id}>
                          <td className="px-4 py-2 text-gray-800 font-medium">{s.file_name}</td>
                          <td className="px-4 py-2 text-gray-500">
                            {new Date(s.submitted_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              s.status === 'submitted' ? 'bg-blue-100 text-blue-700' :
                              s.status === 'approved'  ? 'bg-green-100 text-green-700' :
                                                         'bg-red-100 text-red-700'
                            }`}>
                              {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

        {hrView === "sickleave" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Sick Leave Management</h2>
              <button
                onClick={loadSickLeaves}
                disabled={loadingSickLeaves}
                className="apple-button apple-button-secondary"
              >
                {loadingSickLeaves ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="apple-card p-5">
                <p className="text-sm text-gray-500">Total Requests</p>
                <p className="text-3xl font-semibold text-gray-900">{sickLeaveStats.total}</p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-yellow-700">Pending</p>
                <p className="text-3xl font-semibold text-yellow-700">{sickLeaveStats.pending}</p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-green-700">Approved</p>
                <p className="text-3xl font-semibold text-green-700">{sickLeaveStats.approved}</p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-red-700">Denied</p>
                <p className="text-3xl font-semibold text-red-700">{sickLeaveStats.denied}</p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-purple-700">Total Hours</p>
                <p className="text-3xl font-semibold text-purple-700">{formatSickLeaveHours(sickLeaveStats.total_hours)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="apple-card p-5">
                <p className="text-sm text-blue-700">Employees With Earned Hours</p>
                <p className="text-3xl font-semibold text-blue-700">{sickLeaveAccruals.length}</p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-violet-700">Total Carry Over Hours</p>
                <p className="text-3xl font-semibold text-violet-700">
                  {formatSickLeaveHours(sickLeaveAccrualTotals.totalCarryOverHours)}
                </p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-indigo-700">Total Earned Hours</p>
                <p className="text-3xl font-semibold text-indigo-700">
                  {formatSickLeaveHours(sickLeaveAccrualTotals.totalAccruedHours)}
                </p>
              </div>
              <div className="apple-card p-5">
                <p className="text-sm text-emerald-700">Total Available Balance</p>
                <p className="text-3xl font-semibold text-emerald-700">
                  {formatSickLeaveHours(sickLeaveAccrualTotals.totalBalanceHours)}
                </p>
              </div>
            </div>

            <div className="apple-card p-6">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <label className="sr-only" htmlFor="sick-leave-search">Search sick leave employees and records</label>
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
                    id="sick-leave-search"
                    type="search"
                    value={sickLeaveSearch}
                    onChange={(e) => setSickLeaveSearch(e.target.value)}
                    className="w-[18rem] md:w-[24rem] rounded-xl border border-gray-300 bg-white px-10 py-3 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-[#007AFF] focus:outline-none focus:ring-4 focus:ring-[#007AFF]/10"
                    placeholder="Search by employee, email, reason, city..."
                  />
                </div>

                <label className="apple-label" htmlFor="sick-leave-status-filter">Status</label>
                <select
                  id="sick-leave-status-filter"
                  value={sickLeaveStatusFilter}
                  onChange={(e) => setSickLeaveStatusFilter(e.target.value as "all" | SickLeaveStatus)}
                  className="apple-select min-w-[12rem]"
                  title="Filter sick leave requests by status"
                >
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="denied">Denied</option>
                </select>
              </div>
            </div>

            {sickLeavesError && (
              <div className="apple-error-banner">{sickLeavesError}</div>
            )}

            <div className="apple-card overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 uppercase keeping-wider">Employee Sick Leave Balances</h3>
                <p className="text-xs text-gray-500 mt-1">Users with earned hours, calculated as 1 hour per 30 worked.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Carry Over</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Year to Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Worked</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Earned</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Used</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Requests</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {loadingSickLeaves && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                          Loading earned sick leave balances...
                        </td>
                      </tr>
                    )}
                    {!loadingSickLeaves && filteredSickLeaveAccruals.map((record) => (
                      <tr key={record.user_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 align-top">
                          <p className="text-sm font-semibold text-gray-900">{record.employee_name}</p>
                          <p className="text-xs text-gray-500">{record.employee_email}</p>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-blue-700">
                          <button
                            type="button"
                            onClick={() =>
                              editSickAccrualHours(
                                record.user_id,
                                record.employee_name,
                                "carry_over",
                                Number(record.carry_over_hours || 0)
                              )
                            }
                            disabled={editingSickAccrualKey === `carry_over:${record.user_id}`}
                            className="underline decoration-dotted underline-offset-2 hover:text-blue-800 disabled:opacity-50"
                            title="Edit carry over hours"
                          >
                            {editingSickAccrualKey === `carry_over:${record.user_id}`
                              ? "Saving..."
                              : formatSickLeaveHours(record.carry_over_hours)}
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-indigo-700">
                          <button
                            type="button"
                            onClick={() =>
                              editSickAccrualHours(
                                record.user_id,
                                record.employee_name,
                                "year_to_date",
                                Number(record.year_to_date_hours || 0)
                              )
                            }
                            disabled={editingSickAccrualKey === `year_to_date:${record.user_id}`}
                            className="underline decoration-dotted underline-offset-2 hover:text-indigo-800 disabled:opacity-50"
                            title="Edit year to date hours"
                          >
                            {editingSickAccrualKey === `year_to_date:${record.user_id}`
                              ? "Saving..."
                              : formatSickLeaveHours(record.year_to_date_hours)}
                          </button>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-gray-700">
                          {formatSickLeaveHours(record.worked_hours)}
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-indigo-700 font-semibold">
                          {formatSickLeaveHours(record.accrued_hours)}
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-gray-700">
                          {formatSickLeaveHours(record.used_hours)}
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-emerald-700 font-semibold">
                          {formatSickLeaveHours(record.balance_hours)}
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-gray-700">
                          {record.request_count}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => addUsedHours(record.user_id, record.employee_name)}
                              disabled={addingUsedHoursUserId === record.user_id}
                              className="px-2 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50"
                            >
                              {addingUsedHoursUserId === record.user_id ? "Adding..." : "Add Used Hours"}
                            </button>
                            <button
                              onClick={() =>
                                removeUsedHours(record.user_id, record.employee_name, Number(record.used_hours || 0))
                              }
                              disabled={
                                removingUsedHoursUserId === record.user_id ||
                                Number(record.used_hours || 0) <= 0
                              }
                              className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                            >
                              {removingUsedHoursUserId === record.user_id ? "Removing..." : "Take Away Used Hours"}
                            </button>
                            <Link
                              href={`/hr/employees/${record.user_id}`}
                              className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                            >
                              Employee
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!loadingSickLeaves && filteredSickLeaveAccruals.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-500">
                          No employees with earned sick leave hours match the current search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="apple-card overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 uppercase keeping-wider">Sick Leave Requests</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Dates</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Hours</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Reason</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Approved</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {loadingSickLeaves && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                          Loading sick leave records...
                        </td>
                      </tr>
                    )}
                    {!loadingSickLeaves && filteredSickLeaveRecords.map((record) => {
                      const status = record.status;
                      const statusClass = sickLeaveStatusStyles[status] ?? fallbackSickLeaveStatusStyle;
                      return (
                        <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 align-top">
                            <p className="text-sm font-semibold text-gray-900">{record.employee_name}</p>
                            <p className="text-xs text-gray-500">{record.employee_email}</p>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <p className="text-sm text-gray-900">
                              {formatSickLeaveDate(record.start_date)} - {formatSickLeaveDate(record.end_date)}
                            </p>
                            <p className="text-xs text-gray-500">Created {formatSickLeaveDate(record.created_at)}</p>
                          </td>
                          <td className="px-4 py-3 align-top text-sm text-gray-900">
                            {formatSickLeaveHours(record.duration_hours)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`px-3 py-1 text-xs font-semibold capitalize keeping-wide border rounded-full ${statusClass}`}>
                              {status}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-sm text-gray-700 max-w-[18rem]">
                            {record.reason || "-"}
                          </td>
                          <td className="px-4 py-3 align-top text-sm text-gray-700">
                            {record.approved_at ? formatSickLeaveDate(record.approved_at) : "-"}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/hr/employees/${record.user_id}`}
                                className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                              >
                                Employee
                              </Link>
                              <button
                                onClick={() => updateSickLeaveStatus(record.id, "approved")}
                                disabled={updatingSickLeaveId === record.id || status === "approved"}
                                className="px-2 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => updateSickLeaveStatus(record.id, "denied")}
                                disabled={updatingSickLeaveId === record.id || status === "denied"}
                                className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                              >
                                Deny
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingSickLeaves && filteredSickLeaveRecords.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                          No sick leave requests found for the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
