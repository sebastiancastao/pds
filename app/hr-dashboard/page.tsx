"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { distributePoolByHoursRule, shortShiftModeForDate } from "@/lib/payroll-distribution";
import { isSanDiegoRegion } from "@/lib/commission-pool";
import { computePayPeriodCommission, isPeriodRateState } from "@/lib/pay-period-commission";
import { computeSanDiegoHourlyBreakdown, SAN_DIEGO_BASE_RATE } from "@/lib/san-diego-payroll";
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

type EmployeeStatusFilter = "active" | "inactive" | "all";

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
  period_worked_hours: number | null;
  period_earned_hours: number | null;
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

type SickLeavePeriodFilter = {
  start: string;
  end: string;
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
const emptySickLeavePeriod: SickLeavePeriodFilter = { start: "", end: "" };
const PAYROLL_DIRTY_STORAGE_KEY = "pds-payroll-data-dirty-at";

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
  const [selectedEmployeeStatus, setSelectedEmployeeStatus] = useState<EmployeeStatusFilter>("active");
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
  const [payrollGroupBy, setPayrollGroupBy] = useState<'venue' | 'vendor'>('vendor');
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalFile, setApprovalFile] = useState<File | null>(null);
  const [sendingApproval, setSendingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState<string>('');
  const [approvalSubmissions, setApprovalSubmissions] = useState<Array<{ id: string; file_name: string; status: string; submitted_at: string }>>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [mileageByEvent, setMileageByEvent] = useState<Record<string, Record<string, { miles: number | null; mileagePay: number; differentialMiles?: number }>>>({});
  const [mileageApprovals, setMileageApprovals] = useState<Record<string, Record<string, { mileage: boolean; travel: boolean }>>>({});
  // Sick leave pay sheet (queued sick-leave payroll) state
  type SickLeavePaysheet = {
    id: string;
    user_id: string;
    hours: number;
    rate: number;
    amount: number;
    payment_date: string;
    status: "queued" | "paid";
    notes: string | null;
    employee_name: string;
    employee_email: string;
  };
  const [sickPaysheets, setSickPaysheets] = useState<SickLeavePaysheet[]>([]);
  const [loadingSickPaysheets, setLoadingSickPaysheets] = useState(false);
  const [sickPaysheetError, setSickPaysheetError] = useState<string>("");
  const [sickPaysheetSuccess, setSickPaysheetSuccess] = useState<string>("");
  const [creatingSickPaysheet, setCreatingSickPaysheet] = useState(false);
  const [updatingSickPaysheetId, setUpdatingSickPaysheetId] = useState<string | null>(null);
  const [sickPayBaseRatesByState, setSickPayBaseRatesByState] = useState<Record<string, number>>({});
  const [sickPaysheetForm, setSickPaysheetForm] = useState({
    userId: "",
    paymentDate: "",
    hours: "",
    rate: "",
    notes: "",
  });
  // Payment cycles (recurring pay periods that auto-fill sick-leave paysheets)
  type PaymentCycle = {
    id: string;
    label: string;
    start_date: string;
    end_date: string;
    pay_date: string;
    frequency: string;
    status: "open" | "processed";
    paysheet_count?: number;
  };
  type CyclePreviewRow = {
    user_id: string;
    name: string;
    email: string;
    state: string;
    sick_hours: number;
    worked_hours: number;
    rate: number;
    amount: number;
    already_has_paysheet: boolean;
  };
  const [paymentCycles, setPaymentCycles] = useState<PaymentCycle[]>([]);
  const [cycleConfig, setCycleConfig] = useState<{ frequency: string; anchor_date: string; pay_offset_days: number } | null>(null);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [cycleError, setCycleError] = useState("");
  const [cycleSuccess, setCycleSuccess] = useState("");
  const [savingCadence, setSavingCadence] = useState(false);
  const [cadenceForm, setCadenceForm] = useState({ frequency: "biweekly", anchorDate: "", payOffsetDays: "0" });
  const [retrieveCycle, setRetrieveCycle] = useState<PaymentCycle | null>(null);
  const [retrieveRows, setRetrieveRows] = useState<CyclePreviewRow[]>([]);
  const [retrieveSelected, setRetrieveSelected] = useState<Set<string>>(new Set());
  const [retrieving, setRetrieving] = useState(false);
  const [processingCycle, setProcessingCycle] = useState(false);
  // Create salaried user modal
  const [showCreateSalariedModal, setShowCreateSalariedModal] = useState(false);
  const [createSalariedForm, setCreateSalariedForm] = useState({
    firstName: '', lastName: '', email: '', role: 'worker' as 'worker' | 'manager' | 'finance' | 'exec' | 'hr',
    division: 'vendor' as 'vendor' | 'trailers' | 'both',
    annualSalary: '', department: '', position: '',
  });
  const [createSalariedError, setCreateSalariedError] = useState('');
  const [createSalariedLoading, setCreateSalariedLoading] = useState(false);
  const [createSalariedSuccess, setCreateSalariedSuccess] = useState('');

  // Convert existing user to salaried modal
  const [showConvertSalariedModal, setShowConvertSalariedModal] = useState(false);
  const [convertSalariedForm, setConvertSalariedForm] = useState({
    userId: '',
    annualSalary: '',
    department: '',
    position: '',
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  const [convertSalariedSearch, setConvertSalariedSearch] = useState('');
  const [convertSalariedError, setConvertSalariedError] = useState('');
  const [convertSalariedSuccess, setConvertSalariedSuccess] = useState('');
  const [convertSalariedLoading, setConvertSalariedLoading] = useState(false);
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

  const saveMileageAmountOverride = async (eventId: string, userId: string, field: 'mileage' | 'travel', amount: number) => {
    if (field === 'mileage') {
      setMileagePayOverrides(prev => ({ ...prev, [eventId]: { ...(prev[eventId] || {}), [userId]: amount } }));
    } else {
      setTravelPayOverrides(prev => ({ ...prev, [eventId]: { ...(prev[eventId] || {}), [userId]: amount } }));
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/mileage-approvals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ event_id: eventId, user_id: userId, field, amount_override: amount, approved: true }),
      });
    } catch (e) {
      console.error('[HR PAYMENTS] Failed to save mileage amount override:', e);
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
  const getRestBreakAmount = (actualHours: number, stateCode: string, eventSanDiego = false) => {
    if (eventSanDiego) return 0;
    if (actualHours <= 0) return 0;
    return actualHours >= 14 ? 17 : actualHours >= 10 ? 12.5 : 9;
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
  const usesPeriodRateBreakdown = (stateCode?: string | null): boolean =>
    isPeriodRateState(normalizeState(stateCode));
  const computeTravelPay = (diffMiles: number, stateCode: string | null | undefined, rateInEffect: number): number => {
    const stateMin = normalizeState(stateCode) === 'CA' ? 28.50 : 25.94;
    const travelRate = Math.max(stateMin, rateInEffect);
    return (diffMiles / 30) * travelRate;
  };
  const getEffectiveHours = (payment: any): number => {
    // `effective_hours` already reflects the canonical HR timesheet payable hours.
    if (payment && (payment?.effective_hours != null || payment?.effectiveHours != null)) {
      const effective = Number(payment?.effective_hours ?? payment?.effectiveHours);
      if (Number.isFinite(effective) && effective >= 0) return effective;
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

  type OtherAdjustmentType = "reimbursement_1" | "meal_break" | "bonus";
  const DEFAULT_OTHER_ADJUSTMENT_TYPE: OtherAdjustmentType = "meal_break";
  const normalizeOtherAdjustmentType = (value?: string | null): OtherAdjustmentType => {
    const normalized = (value || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/-/g, "_");
    if (normalized === "meal_break") return "meal_break";
    if (normalized === "bonus") return "bonus";
    return "reimbursement_1";
  };
  const getOtherAdjustmentTypeLabel = (value?: string | null): string => {
    const t = normalizeOtherAdjustmentType(value);
    if (t === "meal_break") return "Meal Break Premium";
    if (t === "bonus") return "Bonus";
    return "Reimbursement 1";
  };
  const parseAdjustmentNote = (note: string | null | undefined, totalAmount: number): {
    reimbursementAmount: number;
    otherAmount: number;
    otherType: OtherAdjustmentType;
  } => {
    if (note) {
      try {
        const parsed = JSON.parse(note);
        if (parsed && typeof parsed === 'object') {
          return {
            reimbursementAmount: Number(parsed.reimbursement || 0),
            otherAmount: Number(parsed.otherAmount || 0),
            otherType: normalizeOtherAdjustmentType(parsed.otherType),
          };
        }
      } catch {}
    }
    const t = normalizeOtherAdjustmentType(note);
    return {
      reimbursementAmount: t === 'reimbursement_1' ? totalAmount : 0,
      otherAmount: t !== 'reimbursement_1' ? totalAmount : 0,
      otherType: t !== 'reimbursement_1' ? t : 'meal_break',
    };
  };

  // Editable adjustments: eventId -> (userId -> amount)
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, number>>>({});
  const [reimbursementAmounts, setReimbursementAmounts] = useState<Record<string, Record<string, number>>>({});
  const [adjustmentTypes, setAdjustmentTypes] = useState<Record<string, Record<string, OtherAdjustmentType>>>({});
  const [editingCell, setEditingCell] = useState<{ eventId: string; userId: string; column: 'reimbursement' | 'other' } | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [mileagePayOverrides, setMileagePayOverrides] = useState<Record<string, Record<string, number>>>({});
  const [travelPayOverrides, setTravelPayOverrides] = useState<Record<string, Record<string, number>>>({});
  const [editingMileageCell, setEditingMileageCell] = useState<{ eventId: string; userId: string; field: 'mileage' | 'travel' } | null>(null);
  const [editingMileageValue, setEditingMileageValue] = useState<string>('');
  const [tipsEqualMode, setTipsEqualMode] = useState<Record<string, boolean>>({});

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
  const [sickLeavePeriodStart, setSickLeavePeriodStart] = useState("");
  const [sickLeavePeriodEnd, setSickLeavePeriodEnd] = useState("");
  const [appliedSickLeavePeriod, setAppliedSickLeavePeriod] =
    useState<SickLeavePeriodFilter>(emptySickLeavePeriod);
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

  const loadEmployees = useCallback(async (
    stateFilter?: string,
    regionFilter?: string,
    statusFilter?: EmployeeStatusFilter
  ) => {
    setLoadingEmployees(true);
    setEmployeesError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      const s = stateFilter ?? selectedState;
      const r = regionFilter ?? selectedEmployeeRegion;
      const status = statusFilter ?? selectedEmployeeStatus;
      if (s && s !== "all") params.append("state", s);
      if (r && r !== "all") {
        params.append("region_id", r);
        params.append("geo_filter", "true");
      }
      if (status !== "active") params.append("status", status);

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
  }, [selectedState, selectedEmployeeRegion, selectedEmployeeStatus]);

  const submitCreateSalariedUser = useCallback(async () => {
    const { firstName, lastName, email, role, division, annualSalary, department, position } = createSalariedForm;
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      setCreateSalariedError('First name, last name, and email are required.');
      return;
    }
    if (!annualSalary || isNaN(Number(annualSalary)) || Number(annualSalary) < 0) {
      setCreateSalariedError('Please enter a valid annual salary.');
      return;
    }
    setCreateSalariedLoading(true);
    setCreateSalariedError('');
    setCreateSalariedSuccess('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeaders = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      // Step 1: invite user
      const inviteRes = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ invites: [{ email: email.trim().toLowerCase(), role, division, firstName: firstName.trim(), lastName: lastName.trim() }] }),
      });
      const inviteJson = await inviteRes.json();
      if (!inviteRes.ok) throw new Error(inviteJson.error || 'Failed to invite user');
      const inviteResult = inviteJson.results?.[0];
      if (inviteResult?.status === 'error') throw new Error(inviteResult.message || 'Invite failed');

      // Step 2: find user id for the invited user to save salary
      const usersRes = await fetch(`/api/users/all`, {
        headers: authHeaders,
      });
      let userId: string | null = null;
      if (usersRes.ok) {
        const usersJson = await usersRes.json();
        const match = (usersJson.users || []).find((u: any) => u.email === email.trim().toLowerCase());
        userId = match?.id ?? null;
      }

      if (userId) {
        await fetch('/api/salaries', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            user_id: userId,
            annual_salary: Number(annualSalary),
            department: department.trim() || null,
            position: position.trim() || null,
            employment_type: 'salaried',
          }),
        });
      }

      setCreateSalariedSuccess(`Invite sent to ${email.trim()}. Salary will be saved once the user completes registration.`);
      setCreateSalariedForm({ firstName: '', lastName: '', email: '', role: 'worker', division: 'vendor', annualSalary: '', department: '', position: '' });
      await loadEmployees();
    } catch (err: any) {
      setCreateSalariedError(err.message || 'Failed to create salaried user');
    }
    setCreateSalariedLoading(false);
  }, [createSalariedForm, loadEmployees]);

  const submitConvertExistingToSalaried = useCallback(async () => {
    const { userId, annualSalary, department, position, effectiveDate } = convertSalariedForm;
    if (!userId) {
      setConvertSalariedError('Please select an employee.');
      return;
    }
    if (!annualSalary || isNaN(Number(annualSalary)) || Number(annualSalary) < 0) {
      setConvertSalariedError('Please enter a valid annual salary.');
      return;
    }
    setConvertSalariedLoading(true);
    setConvertSalariedError('');
    setConvertSalariedSuccess('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const authHeaders = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      const res = await fetch('/api/salaries', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          user_id: userId,
          annual_salary: Number(annualSalary),
          department: department.trim() || null,
          position: position.trim() || null,
          employment_type: 'salaried',
          effective_date: effectiveDate || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to convert user to salaried');
      setConvertSalariedSuccess('Employee converted to salaried.');
      setConvertSalariedForm({
        userId: '',
        annualSalary: '',
        department: '',
        position: '',
        effectiveDate: new Date().toISOString().slice(0, 10),
      });
      setConvertSalariedSearch('');
      await loadEmployees();
    } catch (err: any) {
      setConvertSalariedError(err.message || 'Failed to convert user to salaried');
    }
    setConvertSalariedLoading(false);
  }, [convertSalariedForm, loadEmployees]);

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
    setPayrollGroupBy('vendor');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[HR PAYMENTS] loading events for HR dashboard');
      const eventsRes = await fetch(`/api/all-events?ts=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
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
        try {
          window.localStorage.removeItem(PAYROLL_DIRTY_STORAGE_KEY);
        } catch {
          // Ignore storage failures.
        }
        setLoadingPayments(false);
        return;
      }
      let filtered = allEvents as any[];
      if (paymentsStartDate) filtered = filtered.filter(e => !e.event_date || e.event_date >= paymentsStartDate);
      if (paymentsEndDate) filtered = filtered.filter(e => !e.event_date || e.event_date <= paymentsEndDate);
      console.log('[HR PAYMENTS] filtered events', { count: filtered.length, start: paymentsStartDate, end: paymentsEndDate });
      const filteredEventIds = filtered.map((e: any) => e.id).filter(Boolean);
      const eventIds = filteredEventIds.join(',');
      if (!eventIds) {
        try {
          window.localStorage.removeItem(PAYROLL_DIRTY_STORAGE_KEY);
        } catch {
          // Ignore storage failures.
        }
        setPaymentsByVenue([]);
        setLoadingPayments(false);
        return;
      }
      // Fetch vendor payments for filtered events (same data model as Global Calendar)
      const payRes = await fetch(`/api/vendor-payments?event_ids=${encodeURIComponent(eventIds)}&ts=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
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
      const weeklyTrackedEvents = filtered.filter((e: any) => {
        const st = normalizeState(e.state);
        return st === "AZ" || st === "NY" || isSanDiegoRegion(e);
      });
      if (weeklyTrackedEvents.length > 0) {
        const weeklyHoursRequests = weeklyTrackedEvents.map((e: any) => {
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
        const persistedTotalTipsRaw = Number(eventPaymentSummary?.total_tips);
        const hasPersistedTotalTips =
          eventPaymentSummary?.total_tips !== null &&
          eventPaymentSummary?.total_tips !== undefined &&
          eventPaymentSummary?.total_tips !== "" &&
          Number.isFinite(persistedTotalTipsRaw);
        const eventFees = Number(eventInfo.fees || 0);
        const eventOtherIncome = Number(eventInfo.other_income || 0);
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
          : Math.max(totalSales - tax - eventFees + eventOtherIncome, 0);
        const isEventSD = isSanDiegoRegion(eventInfo);
        const commissionPoolPercent =
          isEventSD ? 0 :
          Number(eventInfo.commission_pool ?? eventPaymentSummary.commission_pool_percent ?? 0) || 0;
        const eventCommissionDollarsRaw =
          adjustedGrossAmount * commissionPoolPercent;
        const eventCommissionDollars = Number.isFinite(eventCommissionDollarsRaw) ? eventCommissionDollarsRaw : 0;
        const eventTotalTips = hasPersistedTotalTips
          ? Math.max(persistedTotalTipsRaw, 0)
          : Math.max(eventTips, 0);

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
                      commissionDeleted: false,
                      commissionOverride: null,
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
                  event_type: eventInfo.event_type || 'normal',
                  isSanDiegoHourly: isEventSD,
                  commissionPerVendor,
                  vendorsWithHours,
                  state: eventInfo.state,
                  baseRate: isEventSD ? SAN_DIEGO_BASE_RATE : configuredBaseRate,
                  commissionDollars: eventCommissionDollars,
                  commissionPoolDollars: eventCommissionDollars,
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
            event_type: eventInfo.event_type || 'normal',
            isSanDiegoHourly: isEventSD,
            commissionPerVendor: 0,
            vendorsWithHours: 0,
            state: eventInfo.state,
            baseRate: isEventSD ? SAN_DIEGO_BASE_RATE : configuredBaseRate,
            commissionDollars: eventCommissionDollars,
            commissionPoolDollars: eventCommissionDollars,
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
        const baseRate = isEventSD
          ? SAN_DIEGO_BASE_RATE
          : configuredBaseRate > 0
            ? configuredBaseRate
            : (summaryBaseRate > 0 ? summaryBaseRate : 17.28);
        console.log('[HR PAYMENTS] Event with payment data:', eventId, eventInfo.event_name, { vendorCount: vendorPayments.length });

        // Total team members on this event
        const memberCount = Array.isArray(vendorPayments) ? vendorPayments.length : 0;

        // Commission pool in dollars — prefer calculated, fall back to stored commission_pool_dollars, then total_commissions
        const commissionPoolDollars = isEventSD
          ? 0
          : eventCommissionDollars > 0
          ? eventCommissionDollars
          : (Number(eventPaymentSummary?.commission_pool_dollars || 0) || Number(eventPaymentSummary?.total_commissions || 0) || 0);
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
        const commissionSharesByUser = distributePoolByHoursRule({
          totalAmount: commissionPoolDollars,
          members: vendorPayments.flatMap((payment: any) => {
            const paymentUserId = (payment.user_id || payment.userId || payment?.users?.id || '').toString();
            const payrollHours = roundHoursToTwoDecimals(getEffectiveHours(payment));
            const _divComm = normalizeDivision(payment?.users?.division);
            const _isExplicitNonVendor = _divComm !== '' && !isVendorDivision(_divComm);
            if (!paymentUserId || _isExplicitNonVendor || payment.commission_deleted === true || payrollHours <= 0) return [];
            return [{ id: paymentUserId, hours: payrollHours }];
          }),
          allShortShiftMode: shortShiftModeForDate(eventInfo.event_date),
        }).amountsById;
        const tipsSharesByUser = distributePoolByHoursRule({
          totalAmount: totalTips,
          members: vendorPayments.flatMap((payment: any) => {
            const paymentUserId = (payment.user_id || payment.userId || payment?.users?.id || '').toString();
            const payrollHours = roundHoursToTwoDecimals(getEffectiveHours(payment));
            if (!paymentUserId || payment.tips_deleted === true || isTrailersDivision(payment?.users?.division) || payrollHours <= 0) return [];
            return [{ id: paymentUserId, hours: payrollHours }];
          }),
          allShortShiftMode: shortShiftModeForDate(eventInfo.event_date),
        }).amountsById;

        console.log('[HR PAYMENTS] Commission/Tips for event:', eventId, {
          commissionPoolDollars, perVendorCommissionShare, totalTips, memberCount, vendorCountForCommission,
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
            const parsedAdj = parseAdjustmentNote(payment.adjustment_note, adjustmentAmount);
            const actualHours = getEffectiveHours(payment);
            const roundedPayrollHours = roundHoursToTwoDecimals(actualHours);

            const memberDivision = payment?.users?.division;
            const isTrailers = (memberDivision || "").toString().toLowerCase().trim() === "trailers";
            const _divDisplay = normalizeDivision(memberDivision);
            const _isExplicitNonVendorDisplay = _divDisplay !== '' && !isVendorDivision(_divDisplay);
            const commissionShare = (isEventSD || _isExplicitNonVendorDisplay) ? 0 : Number(commissionSharesByUser[paymentUserId] || 0);

            const priorWeeklyHours = (isAZorNY || isEventSD) ? (weeklyHoursMap[eventId]?.[payment.user_id] || 0) : 0;
            const isWeeklyOT = isAZorNY && (priorWeeklyHours + actualHours) > 40;
            const extAmtRegular = Math.round(roundedPayrollHours * baseRate * 100) / 100;
            const extAmtOnRegRateNonAzNy = Math.round(roundedPayrollHours * baseRate * 1.5 * 100) / 100;

            // Keep AZ/NY weekly-OT logic unchanged, but mirror Event Dashboard math for CA/NV/WI.
            let commissionAmt = 0;
            let otRate = 0;
            let extAmtOnRegRate = extAmtOnRegRateNonAzNy;
            let totalFinalCommissionAmt = 0;
            let loadedRate = 0;
            let regularHours = roundedPayrollHours;
            let overtimeHours = 0;
            let overtimePay = 0;
            let doubletimeHours = 0;
            let doubletimePay = 0;
            let regularPay = extAmtOnRegRateNonAzNy;

            if (isEventSD) {
              const sanDiegoBreakdown = computeSanDiegoHourlyBreakdown(
                roundedPayrollHours,
                baseRate,
                priorWeeklyHours
              );
              regularHours = sanDiegoBreakdown.regularHours;
              overtimeHours = sanDiegoBreakdown.overtimeHours;
              overtimePay = sanDiegoBreakdown.overtimePay;
              doubletimeHours = sanDiegoBreakdown.doubletimeHours;
              doubletimePay = sanDiegoBreakdown.doubletimePay;
              regularPay = sanDiegoBreakdown.regularPay;
              extAmtOnRegRate = sanDiegoBreakdown.totalPay;
              totalFinalCommissionAmt = sanDiegoBreakdown.totalPay;
              loadedRate = sanDiegoBreakdown.blendedRate;
              commissionAmt = 0;
            } else if (isAZorNY) {
              // Preliminary commission (CA formula on non-OT ext amt) used only to compute loaded rate for weekly OT
              const prelimCommission = (!isTrailers && roundedPayrollHours > 0 && commissionShare > 0)
                ? Math.max(0, commissionShare - extAmtOnRegRateNonAzNy)
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
              const rawCommissionAmt = (!isTrailers && roundedPayrollHours > 0 && commissionShare > 0)
                ? Math.max(0, commissionShare - extAmtOnRegRate)
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
                : Math.max(extAmtOnRegRateNonAzNy, commissionShare);
              const rawCommissionAmt = (!isTrailers && roundedPayrollHours > 0 && commissionShare > 0)
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

            if (!isEventSD) {
              regularPay = extAmtOnRegRate;
            }

            const totalFinalCommissionForLoadedRate =
              adjustmentAmount !== 0
                ? (totalFinalCommissionAmt + adjustmentAmount)
                : totalFinalCommissionAmt;
            const minLoadedRate = ['NY', 'WI', 'NV', 'AZ'].includes(eventState) ? 25.92 : 28.5;
            loadedRate = isEventSD
              ? (roundedPayrollHours > 0 ? totalFinalCommissionAmt / roundedPayrollHours : baseRate)
              : roundedPayrollHours > 0
                ? Math.max(minLoadedRate, totalFinalCommissionForLoadedRate / roundedPayrollHours)
                : 0;

            // Tips: respect per-vendor overrides/deletions, then equal or prorated, then fall back to stored value
            const tips = payment.tips_deleted === true
              ? 0
              : payment.tips_override != null
              ? Number(payment.tips_override)
              : totalTips > 0
              ? Number(tipsSharesByUser[paymentUserId] || 0)
              : Number(payment.tips || 0);

            const restBreak = getRestBreakAmount(actualHours, eventState, isEventSD);
            const totalPay = totalFinalCommissionAmt + tips + restBreak;
            const finalPay = totalPay + adjustmentAmount;
            return {
              userId: paymentUserId,
              firstName,
              lastName,
              email: user?.email || 'N/A',
              division: memberDivision,
              actualHours,
              regularHours,
              commissionShare,
              regularPay,
              overtimeHours,
              overtimePay,
              otRate,
              doubletimeHours,
              doubletimePay,
              commissions: commissionAmt,
              commissionDeleted: payment.commission_deleted === true,
              commissionOverride: payment.commission_override != null ? Number(payment.commission_override) : null,
              tips,
              totalPay,
              adjustmentAmount,
              adjustmentNote: payment.adjustment_note ?? null,
              adjustmentType,
              reimbursementAmount: parsedAdj.reimbursementAmount,
              otherAmount: parsedAdj.otherAmount,
              finalPay,
              regRate: baseRate,
              loadedRate,
              extAmtOnRegRate,
              commissionAmt,
              totalFinalCommissionAmt,
              restBreak,
              totalGrossPay: finalPay,
              isSanDiegoHourly: isEventSD,
            };
          })
        );
        console.log('[HR PAYMENTS] event payments mapped', { eventId, count: eventPayments.length, sample: eventPayments.slice(0,2).map((p: any) => ({ userId: p.userId, hours: p.actualHours, total: p.totalPay })) });

        const eventTotal = eventPayments.reduce((sum: number, p: any) => sum + Number(p.finalPay || 0), 0);
        const eventHours = eventPayments.reduce((sum: number, p: any) => sum + p.actualHours, 0);
        const eventTotalRestBreak = eventPayments.reduce((sum: number, p: any) => sum + (isEventSD ? 0 : Number(p.restBreak || 0)), 0);
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
          event_type: eventInfo.event_type || 'normal',
          isSanDiegoHourly: isEventSD,
          commissionPerVendor,
          vendorsWithHours,
          state: eventInfo.state,
          baseRate,
          commissionDollars: eventCommissionDollars,
          commissionPoolDollars: safeCommissionPoolDollars,
          adjustedGrossAmount,
          totalTips: eventTotalTips,
          totalRestBreak: eventTotalRestBreak,
          totalOther: eventTotalOther,
          eventTotal,
          eventHours,
          tipsDistributionMode: eventInfo.tips_distribution_mode || 'prorated',
          payments: eventPayments
        });
      }
      console.log('[HR PAYMENTS] venues assembled', { venueCount: Object.keys(byVenue).length });
      const venuesArr = Object.values(byVenue);
      setPaymentsByVenue(venuesArr);

      // Initialize tips distribution mode from persisted event data
      const initialTipsMode: Record<string, boolean> = {};
      venuesArr.forEach((v: any) => {
        v.events.forEach((ev: any) => {
          if (ev.tipsDistributionMode === 'equal') initialTipsMode[ev.id] = true;
        });
      });
      setTipsEqualMode(initialTipsMode);

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
            const loadedMileageOverrides: Record<string, Record<string, number>> = {};
            const loadedTravelOverrides: Record<string, Record<string, number>> = {};
            for (const [evId, users] of Object.entries(approvalsJson.approvals || {})) {
              loaded[evId] = {};
              for (const [uid, vals] of Object.entries(users as any)) {
                const v = vals as { mileage: boolean | null; travel: boolean | null; mileage_amount?: number | null; travel_amount?: number | null };
                loaded[evId][uid] = {
                  mileage: v.mileage ?? true,
                  travel: v.travel ?? true,
                };
                if (v.mileage_amount != null) {
                  if (!loadedMileageOverrides[evId]) loadedMileageOverrides[evId] = {};
                  loadedMileageOverrides[evId][uid] = v.mileage_amount;
                }
                if (v.travel_amount != null) {
                  if (!loadedTravelOverrides[evId]) loadedTravelOverrides[evId] = {};
                  loadedTravelOverrides[evId][uid] = v.travel_amount;
                }
              }
            }
            setMileageApprovals(loaded);
            setMileagePayOverrides(loadedMileageOverrides);
            setTravelPayOverrides(loadedTravelOverrides);
          }
        } catch (e) {
          console.warn('[HR PAYMENTS] Failed to fetch mileage data:', e);
        }
      }

      // Seed editable adjustments map from loaded data
      const initialAdjustments: Record<string, Record<string, number>> = {};
      const initialReimbursements: Record<string, Record<string, number>> = {};
      const initialAdjustmentTypes: Record<string, Record<string, OtherAdjustmentType>> = {};
      venuesArr.forEach((v) => {
        v.events.forEach((ev: any) => {
          if (!initialAdjustments[ev.id]) initialAdjustments[ev.id] = {};
          if (!initialReimbursements[ev.id]) initialReimbursements[ev.id] = {};
          if (!initialAdjustmentTypes[ev.id]) initialAdjustmentTypes[ev.id] = {};
          (ev.payments || []).forEach((p: any) => {
            const paymentUserId = (p.userId || '').toString();
            if (!paymentUserId) return;
            const _initParsed = parseAdjustmentNote(p.adjustmentNote ?? p.adjustmentType, Number(p.adjustmentAmount || 0));
            // Don't seed amounts into state — state starts undefined so display falls back to
            // payment object fields (reimbursementAmount/otherAmount) which are always correct.
            // State is only populated when the user explicitly edits or after a save.
            initialAdjustmentTypes[ev.id][paymentUserId] = _initParsed.otherType;
          });
        });
      });
      setAdjustmentTypes(initialAdjustmentTypes);
      try {
        window.localStorage.removeItem(PAYROLL_DIRTY_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }
    } catch (e: any) {
      setPaymentsError(e.message || 'Failed to load payments');
    } finally {
      setLoadingPayments(false);
    }
  }, [paymentsStartDate, paymentsEndDate]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const maybeReloadDirtyPayroll = () => {
      try {
        const dirtyAt = window.localStorage.getItem(PAYROLL_DIRTY_STORAGE_KEY);
        if (!dirtyAt) return;
        if (loadingPayments) return;
        void loadPaymentsData();
      } catch {
        // Ignore storage failures.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        maybeReloadDirtyPayroll();
      }
    };

    maybeReloadDirtyPayroll();
    window.addEventListener("focus", maybeReloadDirtyPayroll);
    window.addEventListener("pageshow", maybeReloadDirtyPayroll);
    window.addEventListener("storage", maybeReloadDirtyPayroll);
    window.addEventListener("pds:payroll-data-dirty", maybeReloadDirtyPayroll as EventListener);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", maybeReloadDirtyPayroll);
      window.removeEventListener("pageshow", maybeReloadDirtyPayroll);
      window.removeEventListener("storage", maybeReloadDirtyPayroll);
      window.removeEventListener("pds:payroll-data-dirty", maybeReloadDirtyPayroll as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadingPayments, loadPaymentsData]);

  // Persist a single adjustment
  const saveAdjustment = useCallback(async (eventId: string, userId: string): Promise<boolean> => {
    try {
      setSavingAdjustment(true);
      if (!eventId || !userId) {
        throw new Error('Missing event or user id for adjustment save');
      }

      // Find the current saved payment to preserve the other column's value if state is missing
      let savedReimbursement = 0;
      let savedOther = 0;
      for (const v of paymentsByVenue) {
        for (const ev of (v.events || [])) {
          if (ev.id !== eventId) continue;
          const p = (ev.payments || []).find((p: any) => p.userId === userId);
          if (p) { savedReimbursement = Number(p.reimbursementAmount || 0); savedOther = Number(p.otherAmount || 0); }
        }
      }
      const reimbursementAmt = reimbursementAmounts[eventId]?.[userId] !== undefined
        ? Number(reimbursementAmounts[eventId][userId] || 0)
        : savedReimbursement;
      const otherAmt = adjustments[eventId]?.[userId] !== undefined
        ? Number(adjustments[eventId][userId] || 0)
        : savedOther;
      const otherType = normalizeOtherAdjustmentType(adjustmentTypes[eventId]?.[userId]);
      const totalAmount = reimbursementAmt + otherAmt;
      const notePayload = JSON.stringify({ reimbursement: reimbursementAmt, otherAmount: otherAmt, otherType });
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const res = await fetch('/api/payment-adjustments', {
        method: 'POST',
        headers,
        body: JSON.stringify({ event_id: eventId, user_id: userId, adjustment_amount: totalAmount, adjustment_note: notePayload }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to save adjustment');
      }

      // Update local payments state to reflect saved amounts
      setPaymentsByVenue(prev => prev.map(v => {
        const events = v.events.map((ev: any) => {
          if (ev.id !== eventId) return ev;
          const payments = (ev.payments || []).map((p: any) => {
            if (p.userId !== userId) return p;
            return {
              ...p,
              adjustmentAmount: totalAmount,
              adjustmentNote: notePayload,
              adjustmentType: notePayload,
              reimbursementAmount: reimbursementAmt,
              otherAmount: otherAmt,
              finalPay: Number(p.totalPay || 0) + totalAmount,
              totalGrossPay: Number(p.totalPay || 0) + totalAmount,
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
      // Sync both states to the confirmed saved values so subsequent saves read correct amounts
      setReimbursementAmounts(prev => ({ ...prev, [eventId]: { ...(prev[eventId] || {}), [userId]: reimbursementAmt } }));
      setAdjustments(prev => ({ ...prev, [eventId]: { ...(prev[eventId] || {}), [userId]: otherAmt } }));
      return true;
    } catch (e: any) {
      const message = e?.message || 'Failed to save adjustment';
      setPaymentsError(message);
      alert(message);
      return false;
    } finally {
      setSavingAdjustment(false);
    }
  }, [adjustments, reimbursementAmounts, adjustmentTypes, supabase, paymentsByVenue]);

  const payPeriodCommission = useMemo(() => {
    const events = paymentsByVenue.flatMap((venue) => venue.events || []);
    return computePayPeriodCommission({
      events: events.map((event: any) => ({
        eventId: (event?.id || "").toString(),
        state: event?.state,
        date: event?.date,
        commissionPoolDollars: Number(event?.commissionPoolDollars ?? event?.commissionDollars ?? 0),
        workers: (event?.payments || []).map((payment: any) => ({
          userId: (payment?.userId || "").toString(),
          division: payment?.division,
          hours: roundHoursToTwoDecimals(Number(payment?.actualHours || 0)),
          commissionDeleted: payment?.commissionDeleted === true,
          commissionOverride: payment?.commissionOverride ?? null,
        })),
      })),
    });
  }, [paymentsByVenue]);

  const paymentsByVendor = useMemo(() => {
    const byVendor: Record<string, {
      userId: string; firstName: string; lastName: string; email: string;
      totalHours: number; totalPay: number;
      events: Array<{ event: any; venue: string; city: string | null; state: string | null; payment: any }>;
    }> = {};
    paymentsByVenue.forEach(v => {
      (v.events || []).forEach((ev: any) => {
        (ev.payments || []).forEach((p: any) => {
          const key = p.userId || p.email || `${p.firstName}_${p.lastName}`;
          if (!byVendor[key]) {
            byVendor[key] = {
              userId: p.userId, firstName: p.firstName || '', lastName: p.lastName || '', email: p.email || '',
              totalHours: 0, totalPay: 0, events: [],
            };
          }
          byVendor[key].totalHours += Number(p.actualHours || 0);
          byVendor[key].totalPay += Number(p.finalPay || 0);
          byVendor[key].events.push({ event: ev, venue: v.venue, city: v.city ?? null, state: v.state ?? null, payment: p });
        });
      });
    });
    return Object.values(byVendor).sort((a, b) => {
      const aLast = (a.lastName || '').toLowerCase();
      const bLast = (b.lastName || '').toLowerCase();
      if (aLast !== bLast) return aLast.localeCompare(bLast);
      return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
    });
  }, [paymentsByVenue]);

  const getDisplayedPaymentBreakdown = useCallback((event: any, payment: any) => {
    const stateCode = normalizeState(event?.state);
    const regRate = Number(payment?.regRate ?? event?.baseRate ?? 0);
    const hours = Number(payment?.actualHours || 0);
    const isTrailers = (payment?.division || "").toString().toLowerCase().trim() === "trailers";
    const isEventSD = event?.isSanDiegoHourly === true || payment?.isSanDiegoHourly === true || isSanDiegoRegion(event);
    const regularHours = Number(payment?.regularHours || 0);
    const regularPay = Number(payment?.regularPay || 0);
    const overtimeHours = Number(payment?.overtimeHours || 0);
    const overtimePay = Number(payment?.overtimePay || 0);
    const doubletimeHours = Number(payment?.doubletimeHours || 0);
    const doubletimePay = Number(payment?.doubletimePay || 0);

    if (isEventSD) {
      const hourlyPay = regularPay + overtimePay + doubletimePay;
      return {
        rateInEffect: hours > 0 ? (hourlyPay / hours) : Number(payment?.loadedRate ?? regRate),
        commissionPay: 0,
        variableIncentive: 0,
        commissionPaidTotal: hourlyPay,
        regRate,
        hours,
        isTrailers,
        usesPeriodRate: false,
        regularHours,
        regularPay,
        overtimeHours,
        overtimePay,
        doubletimeHours,
        doubletimePay,
      };
    }

    if (usesPeriodRateBreakdown(stateCode)) {
      const periodWorker = payPeriodCommission.byEvent?.[event?.id]?.[payment?.userId];
      const rateInEffect = Number(periodWorker?.rateInEffect || 0);
      const commissionPay = Number(periodWorker?.commissionPay || 0);
      const variableIncentive = Number(periodWorker?.variableIncentive || 0);
      const commissionPaidTotal = Number(periodWorker?.commissionPaidTotal || 0);

      return {
        rateInEffect,
        commissionPay,
        variableIncentive,
        commissionPaidTotal,
        regRate,
        hours,
        isTrailers,
        usesPeriodRate: true,
        regularHours,
        regularPay,
        overtimeHours,
        overtimePay,
        doubletimeHours,
        doubletimePay,
      };
    }

    const totalFinalCommissionAmt = Number(payment?.totalFinalCommissionAmt ?? 0);
    const commissionPay = Number(payment?.commissionShare ?? event?.commissionPerVendor ?? 0);
    const variableIncentive = hours > 0 && !isTrailers
      ? Math.max(0, totalFinalCommissionAmt - commissionPay)
      : 0;

    return {
      rateInEffect: Number(payment?.loadedRate ?? regRate),
      commissionPay,
      variableIncentive,
      commissionPaidTotal: totalFinalCommissionAmt,
      regRate,
      hours,
      isTrailers,
      usesPeriodRate: false,
      regularHours,
      regularPay,
      overtimeHours,
      overtimePay,
      doubletimeHours,
      doubletimePay,
    };
  }, [payPeriodCommission]);

  const getDisplayedTips = useCallback((event: any, payment: any): number => {
    const paymentHours = Number(payment?.actualHours || 0);
    if (paymentHours <= 0 || isTrailersDivision(payment?.division)) return 0;
    const totalTips = Number(event?.totalTips || 0);
    if (totalTips <= 0) return 0;
    const payments: any[] = Array.isArray(event?.payments) ? event.payments : [];
    const eligible = payments.filter(
      (p: any) => Number(p?.actualHours || 0) > 0 && !isTrailersDivision(p?.division)
    );
    if (eligible.length === 0) return 0;
    if (tipsEqualMode[event?.id]) {
      // Equal mode: everyone eligible gets the same share
      return totalTips / eligible.length;
    } else {
      // Prorated mode: proportional to hours worked
      const totalEligibleHours = eligible.reduce((sum: number, p: any) => sum + Number(p?.actualHours || 0), 0);
      if (totalEligibleHours <= 0) return 0;
      return (paymentHours / totalEligibleHours) * totalTips;
    }
  }, [tipsEqualMode]);

  const getDisplayedEventTotals = useCallback((event: any) => {
    const payments: any[] = Array.isArray(event?.payments) ? event.payments : [];
    const isEventSD = event?.isSanDiegoHourly === true || isSanDiegoRegion(event);
    const eventHours = payments.reduce((sum: number, payment: any) => {
      return sum + Number(payment?.actualHours || 0);
    }, 0);
    const totalRegularHours = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).regularHours;
    }, 0);
    const totalRegularPay = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).regularPay;
    }, 0);
    const totalOvertimeHours = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).overtimeHours;
    }, 0);
    const totalOvertimePay = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).overtimePay;
    }, 0);
    const totalDoubletimeHours = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).doubletimeHours;
    }, 0);
    const totalDoubletimePay = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).doubletimePay;
    }, 0);
    const totalCommissionPay = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).commissionPay;
    }, 0);
    const totalVariableIncentive = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).variableIncentive;
    }, 0);
    const totalCommissionPaid = payments.reduce((sum: number, payment: any) => {
      return sum + getDisplayedPaymentBreakdown(event, payment).commissionPaidTotal;
    }, 0);
    const totalTips = payments.reduce((sum: number, payment: any) => sum + Number(payment?.tips || 0), 0);
    const totalRestBreak = payments.reduce((sum: number, payment: any) => sum + (isEventSD ? 0 : Number(payment?.restBreak || 0)), 0);
    const totalReimbursement = payments.reduce((sum: number, payment: any) => {
      const stateVal = reimbursementAmounts[event.id]?.[payment.userId];
      return sum + (stateVal !== undefined ? Number(stateVal || 0) : Number(payment?.reimbursementAmount || 0));
    }, 0);
    const totalOther = payments.reduce((sum: number, payment: any) => {
      const stateVal = adjustments[event.id]?.[payment.userId];
      return sum + (stateVal !== undefined ? Number(stateVal || 0) : Number(payment?.otherAmount || 0));
    }, 0);
    const totalMileagePay = payments.reduce((sum: number, payment: any) => {
      const override = (mileagePayOverrides[event.id] || {})[payment.userId];
      if (override !== undefined) return sum + override;
      return sum + (getMileageApproval(event.id, payment.userId).mileage
        ? Number((mileageByEvent[event.id] || {})[payment.userId]?.mileagePay || 0)
        : 0);
    }, 0);
    const totalTravelPay = payments.reduce((sum: number, payment: any) => {
      const override = (travelPayOverrides[event.id] || {})[payment.userId];
      if (override !== undefined) return sum + override;
      const approval = getMileageApproval(event.id, payment.userId);
      if (!approval.travel) return sum;
      const diffMiles = (mileageByEvent[event.id] || {})[payment.userId]?.differentialMiles ?? null;
      if (diffMiles === null) return sum;
      const breakdown = getDisplayedPaymentBreakdown(event, payment);
      return sum + computeTravelPay(diffMiles, event?.state, breakdown.rateInEffect);
    }, 0);
    const totalGross = totalCommissionPaid + totalTips + totalRestBreak + totalReimbursement + totalOther + totalMileagePay + totalTravelPay;

    return {
      eventHours,
      totalRegularHours,
      totalRegularPay,
      totalOvertimeHours,
      totalOvertimePay,
      totalDoubletimeHours,
      totalDoubletimePay,
      totalCommissionPay,
      totalVariableIncentive,
      totalCommissionPaid,
      totalTips,
      totalRestBreak,
      totalReimbursement,
      totalOther,
      totalMileagePay,
      totalTravelPay,
      totalGross,
    };
  }, [getDisplayedPaymentBreakdown, mileageByEvent, mileageApprovals, mileagePayOverrides, travelPayOverrides, adjustmentTypes, reimbursementAmounts, adjustments]);

  const getDisplayedVendorTotals = useCallback((vendor: {
    userId?: string;
    events: Array<{ event: any; venue: string; city: string | null; state: string | null; payment: any }>;
  }) => {
    const result = vendor.events.reduce((totals, { event, payment }) => {
      const breakdown = getDisplayedPaymentBreakdown(event, payment);
      const isEventSD =
        event?.isSanDiegoHourly === true ||
        payment?.isSanDiegoHourly === true ||
        isSanDiegoRegion(event);
      const tips = Number(payment?.tips || 0);
      const restBreak = isEventSD ? 0 : Number(payment?.restBreak || 0);
      const other = Number(payment?.adjustmentAmount || 0);
      const approval = getMileageApproval(event.id, payment.userId);
      const diffMiles = (mileageByEvent[event.id] || {})[payment.userId]?.differentialMiles ?? null;
      const mileageOverrideV = (mileagePayOverrides[event.id] || {})[payment.userId];
      const travelOverrideV = (travelPayOverrides[event.id] || {})[payment.userId];
      const mileagePay = mileageOverrideV !== undefined ? mileageOverrideV
        : (approval.mileage ? Number((mileageByEvent[event.id] || {})[payment.userId]?.mileagePay || 0) : 0);
      const travelPay = travelOverrideV !== undefined ? travelOverrideV
        : (approval.travel && diffMiles !== null ? computeTravelPay(diffMiles, event?.state, breakdown.rateInEffect) : 0);

      totals.totalHours += Number(payment?.actualHours || 0);
      totals.totalRegularHours += isEventSD ? breakdown.regularHours : 0;
      totals.totalRegularPay += isEventSD ? breakdown.regularPay : 0;
      totals.totalOvertimeHours += isEventSD ? breakdown.overtimeHours : 0;
      totals.totalOvertimePay += isEventSD ? breakdown.overtimePay : 0;
      totals.totalDoubletimeHours += isEventSD ? breakdown.doubletimeHours : 0;
      totals.totalDoubletimePay += isEventSD ? breakdown.doubletimePay : 0;
      const stateReimb = reimbursementAmounts[event.id]?.[payment.userId];
      const stateOther = adjustments[event.id]?.[payment.userId];
      const rowReimbursement = stateReimb !== undefined ? Number(stateReimb || 0) : Number(payment?.reimbursementAmount || 0);
      const rowOther = stateOther !== undefined ? Number(stateOther || 0) : Number(payment?.otherAmount || 0);
      totals.totalCommissionPay += isEventSD ? 0 : breakdown.commissionPay;
      totals.totalVariableIncentive += isEventSD ? 0 : breakdown.variableIncentive;
      totals.totalCommissionPaid += breakdown.commissionPaidTotal;
      totals.totalTips += tips;
      totals.totalRestBreak += restBreak;
      totals.totalMileagePay += mileagePay;
      totals.totalTravelPay += travelPay;
      totals.totalReimbursement += rowReimbursement;
      totals.totalOther += rowOther;
      totals.totalGross += breakdown.commissionPaidTotal + tips + restBreak + rowReimbursement + rowOther + mileagePay + travelPay;

      return totals;
    }, {
      totalHours: 0,
      totalRegularHours: 0,
      totalRegularPay: 0,
      totalOvertimeHours: 0,
      totalOvertimePay: 0,
      totalDoubletimeHours: 0,
      totalDoubletimePay: 0,
      totalCommissionPay: 0,
      totalVariableIncentive: 0,
      totalCommissionPaid: 0,
      totalTips: 0,
      totalRestBreak: 0,
      totalMileagePay: 0,
      totalTravelPay: 0,
      totalReimbursement: 0,
      totalOther: 0,
      totalGross: 0,
    });
    const periodUserTotals = vendor.userId ? payPeriodCommission.byUser?.[vendor.userId] : undefined;
    if (periodUserTotals) {
      result.totalVariableIncentive = periodUserTotals.totalVariableIncentive;
    }
    return result;
  }, [getDisplayedPaymentBreakdown, mileageByEvent, mileageApprovals, mileagePayOverrides, travelPayOverrides, payPeriodCommission, adjustmentTypes, reimbursementAmounts, adjustments]);

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
    const allVendorDetailRows: any[] = [];
    const vendorRows: any[] = [];
    const hourlyRows: any[] = [];
    const commissionTravelRows: any[] = [];
    const commissionNoTravelRows: any[] = [];
    const hourlyOnlyKeys = [
      'Regular Time Hours',
      'Regular Time Pay',
      'Overtime Hours',
      'Overtime Pay',
      'Double Time Hours',
      'Double Time Pay',
    ] as const;

    const buildDetailRow = (
      vendor: any,
      event: any,
      venue: string,
      city: string | null,
      state: string | null,
      payment: any
    ) => {
      const isEventSD = event?.isSanDiegoHourly === true || isSanDiegoRegion(event);
      const hideRest = isEventSD;
      const breakdown = getDisplayedPaymentBreakdown(event, payment);
      const regRate = breakdown.regRate;
      const loadedRate = breakdown.rateInEffect;
      const hours = breakdown.hours;
      const hoursHHMM = formatHoursHHMM(hours);
      const hoursInDecimal = roundHoursToTwoDecimals(hours);
      const displayedCommissionPay = breakdown.commissionPay;
      const variableIncentive = breakdown.variableIncentive;
      const reimbursementExport = Number(payment.reimbursementAmount ?? 0);
      const other = Number(payment.otherAmount ?? 0);
      const adjustmentAmt = reimbursementExport + other;
      const tips = getDisplayedTips(event, payment);
      const restBreak = hideRest ? 0 : Number(payment.restBreak || 0);
      const rawMileagePay = Number((mileageByEvent[event.id] || {})[payment.userId]?.mileagePay || 0);
      const mileageMiles = (mileageByEvent[event.id] || {})[payment.userId]?.miles ?? null;
      const diffMilesExport = (mileageByEvent[event.id] || {})[payment.userId]?.differentialMiles ?? null;
      const exportApproval = getMileageApproval(event.id, payment.userId);
      const mileagePay = exportApproval.mileage ? rawMileagePay : 0;
      const travelHoursExport = 0;
      const travelPayExport = exportApproval.travel && diffMilesExport !== null ? computeTravelPay(diffMilesExport, state, loadedRate) : 0;
      const totalGrossPay =
        breakdown.commissionPaidTotal +
        tips +
        restBreak +
        adjustmentAmt +
        mileagePay +
        travelPayExport;
      const category = isEventSD
        ? 'Hourly'
        : travelPayExport > 0
          ? 'Commission - Travel Pay'
          : 'Commission - No Travel Pay';
      const baseRow = {
        'First Name': vendor.firstName || payment.firstName || '',
        'Last Name': vendor.lastName || payment.lastName || '',
        'Vendor Email': vendor.email || payment.email || '',
        'Category': category,
        'Venue': venue,
        'City': city || '',
        'State': state || '',
        'Event Name': event.name,
        'Event Date': event.date || '',
        'Reg Rate': formatPayrollMoney(regRate),
        'Rate in Effect': formatPayrollMoney(loadedRate),
        'Hours': hoursHHMM,
        'Hours in Decimal': hoursInDecimal,
        'Commission Pay': isEventSD ? 0 : Number(displayedCommissionPay.toFixed(2)),
        'Variable Incentive': isEventSD ? 0 : Number(variableIncentive.toFixed(2)),
        'Tips': Number(roundUpThousandsToNextHundred(tips).toFixed(2)),
        'Rest Break': hideRest ? 'N/A' : Number(roundUpThousandsToNextHundred(restBreak).toFixed(2)),
        'Mileage Miles': !exportApproval.mileage ? 0 : (mileageMiles !== null ? mileageMiles : 'N/A'),
        'Mileage Pay': Number(roundUpThousandsToNextHundred(mileagePay).toFixed(2)),
        'Travel Differential Miles': !exportApproval.travel ? 0 : (diffMilesExport !== null ? diffMilesExport : 'N/A'),
        'Travel Hours': !exportApproval.travel ? 0 : (diffMilesExport !== null ? Number(travelHoursExport.toFixed(4)) : 'N/A'),
        'Travel Pay': Number(roundUpThousandsToNextHundred(travelPayExport).toFixed(2)),
        'Reimbursement': Number(roundUpThousandsToNextHundred(reimbursementExport).toFixed(2)),
        'Other': Number(roundUpThousandsToNextHundred(other).toFixed(2)),
        'Total Gross Pay': Number(roundUpThousandsToNextHundred(totalGrossPay).toFixed(2)),
      };

      if (!isEventSD) return baseRow;

      return {
        ...baseRow,
        'Regular Time Hours': Number(breakdown.regularHours.toFixed(2)),
        'Regular Time Pay': Number(roundUpThousandsToNextHundred(breakdown.regularPay).toFixed(2)),
        'Overtime Hours': Number(breakdown.overtimeHours.toFixed(2)),
        'Overtime Pay': Number(roundUpThousandsToNextHundred(breakdown.overtimePay).toFixed(2)),
        'Double Time Hours': Number(breakdown.doubletimeHours.toFixed(2)),
        'Double Time Pay': Number(roundUpThousandsToNextHundred(breakdown.doubletimePay).toFixed(2)),
      };
    };

    const appendTotalsRow = (targetRows: any[], sourceRows?: any[], label = 'TOTAL') => {
      const rowsToSum = sourceRows ?? targetRows;
      if (rowsToSum.length === 0) return;
      const sumNum = (key: string) => rowsToSum.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0);
      const includeHourlyColumns = hourlyOnlyKeys.some((key) =>
        rowsToSum.some((row) => Object.prototype.hasOwnProperty.call(row, key))
      );
      const totalRow: any = {
        'First Name': label,
        'Last Name': '',
        'Vendor Email': '',
        'Category': '',
        'Venue': '',
        'City': '',
        'State': '',
        'Event Name': '',
        'Event Date': '',
        'Reg Rate': '',
        'Rate in Effect': '',
        'Hours': '',
        'Hours in Decimal': Number(sumNum('Hours in Decimal').toFixed(2)),
        'Commission Pay': Number(sumNum('Commission Pay').toFixed(2)),
        'Variable Incentive': Number(sumNum('Variable Incentive').toFixed(2)),
        'Tips': Number(sumNum('Tips').toFixed(2)),
        'Rest Break': Number(rowsToSum.reduce((s, r) => s + (typeof r['Rest Break'] === 'number' ? r['Rest Break'] : 0), 0).toFixed(2)),
        'Mileage Miles': '',
        'Mileage Pay': Number(sumNum('Mileage Pay').toFixed(2)),
        'Travel Differential Miles': '',
        'Travel Hours': '',
        'Travel Pay': Number(sumNum('Travel Pay').toFixed(2)),
        'Reimbursement': Number(sumNum('Reimbursement').toFixed(2)),
        'Other': Number(sumNum('Other').toFixed(2)),
        'Total Gross Pay': Number(sumNum('Total Gross Pay').toFixed(2)),
      };

      if (includeHourlyColumns) {
        totalRow['Regular Time Hours'] = Number(sumNum('Regular Time Hours').toFixed(2));
        totalRow['Regular Time Pay'] = Number(sumNum('Regular Time Pay').toFixed(2));
        totalRow['Overtime Hours'] = Number(sumNum('Overtime Hours').toFixed(2));
        totalRow['Overtime Pay'] = Number(sumNum('Overtime Pay').toFixed(2));
        totalRow['Double Time Hours'] = Number(sumNum('Double Time Hours').toFixed(2));
        totalRow['Double Time Pay'] = Number(sumNum('Double Time Pay').toFixed(2));
      }

      targetRows.push(totalRow);
    };

    const detailColumnConfig = [
      { key: 'First Name', wch: 18 },
      { key: 'Last Name', wch: 18 },
      { key: 'Vendor Email', wch: 30 },
      { key: 'Category', wch: 26 },
      { key: 'Venue', wch: 25 },
      { key: 'City', wch: 15 },
      { key: 'State', wch: 8 },
      { key: 'Event Name', wch: 30 },
      { key: 'Event Date', wch: 12 },
      { key: 'Reg Rate', wch: 10 },
      { key: 'Rate in Effect', wch: 12 },
      { key: 'Hours', wch: 8 },
      { key: 'Hours in Decimal', wch: 16 },
      { key: 'Regular Time Hours', wch: 18 },
      { key: 'Regular Time Pay', wch: 18 },
      { key: 'Overtime Hours', wch: 14 },
      { key: 'Overtime Pay', wch: 14 },
      { key: 'Double Time Hours', wch: 18 },
      { key: 'Double Time Pay', wch: 18 },
      { key: 'Commission Pay', wch: 16 },
      { key: 'Variable Incentive', wch: 18 },
      { key: 'Tips', wch: 10 },
      { key: 'Rest Break', wch: 12 },
      { key: 'Mileage Miles', wch: 14 },
      { key: 'Mileage Pay', wch: 12 },
      { key: 'Travel Differential Miles', wch: 22 },
      { key: 'Travel Hours', wch: 12 },
      { key: 'Travel Pay', wch: 12 },
      { key: 'Reimbursement', wch: 15 },
      { key: 'Other', wch: 10 },
      { key: 'Total Gross Pay', wch: 15 },
    ];

    paymentsByVenue.forEach(venue => {
      venue.events.forEach(event => {
        const eventPayments = Array.isArray(event.payments) ? event.payments : [];
        const totalDisplayedCommissionPay = eventPayments.reduce((sum: number, p: any) => {
          const breakdown = getDisplayedPaymentBreakdown(event, p);
          return sum + breakdown.commissionPay;
        }, 0);
        const totalDisplayedVariableIncentive = eventPayments.reduce((sum: number, p: any) => {
          const breakdown = getDisplayedPaymentBreakdown(event, p);
          return sum + breakdown.variableIncentive;
        }, 0);
        const totalDisplayedCommissionPaid = eventPayments.reduce((sum: number, p: any) => {
          const breakdown = getDisplayedPaymentBreakdown(event, p);
          return sum + breakdown.commissionPaidTotal;
        }, 0);
        const isEventSD = event?.isSanDiegoHourly === true || isSanDiegoRegion(event);
        const totalDisplayedRestBreak = eventPayments.reduce((sum: number, p: any) => sum + (isEventSD ? 0 : Number(p.restBreak || 0)), 0);
        const totalDisplayedOther = eventPayments.reduce((sum: number, p: any) => sum + Number(p.adjustmentAmount || 0), 0);
        const totalDisplayedTravelPay = eventPayments.reduce((sum: number, p: any) => {
          const approval = getMileageApproval(event.id, p.userId);
          if (!approval.travel) return sum;
          const diffMiles = (mileageByEvent[event.id] || {})[p.userId]?.differentialMiles ?? null;
          if (diffMiles === null) return sum;
          const breakdown = getDisplayedPaymentBreakdown(event, p);
          return sum + computeTravelPay(diffMiles, event?.state, breakdown.rateInEffect);
        }, 0);
        const totalDisplayedMileagePay = eventPayments.reduce((sum: number, p: any) => {
          return sum + (getMileageApproval(event.id, p.userId).mileage
            ? Number((mileageByEvent[event.id] || {})[p.userId]?.mileagePay || 0)
            : 0);
        }, 0);
        const totalDisplayedGrossPay = eventPayments.reduce((sum: number, p: any) => {
          const breakdown = getDisplayedPaymentBreakdown(event, p);
          return sum + breakdown.commissionPaidTotal + getDisplayedTips(event, p) + (isEventSD ? 0 : Number(p.restBreak || 0)) + Number(p.adjustmentAmount || 0);
        }, 0) + totalDisplayedMileagePay + totalDisplayedTravelPay;

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
          'Total Rest Break': Number(Number(totalDisplayedRestBreak).toFixed(2)),
          'Total Other': Number(Number(totalDisplayedOther).toFixed(2)),
          'Total Mileage Pay': Number(Number(totalDisplayedMileagePay).toFixed(2)),
          'Total Travel Pay': Number(Number(totalDisplayedTravelPay).toFixed(2)),
          'Total': Number(Number(totalDisplayedGrossPay).toFixed(2)),
          'Total Ext Amt Reg Rate': Number(Number(totalDisplayedCommissionPay).toFixed(2)),
        });

      });
    });

    paymentsByVendor.forEach((vendor) => {
      const vendorTotals = getDisplayedVendorTotals(vendor);
      const vendorDetailRows = [...vendor.events]
        .sort((a, b) => {
          const aDate = (a?.event?.date || '').toString();
          const bDate = (b?.event?.date || '').toString();
          if (aDate !== bDate) return aDate.localeCompare(bDate);
          return ((a?.event?.name || '').toString()).localeCompare((b?.event?.name || '').toString());
        })
        .map(({ event, venue, city, state, payment }) =>
          buildDetailRow(vendor, event, venue, city, state, payment)
        );

      allVendorDetailRows.push(...vendorDetailRows);
      vendorRows.push(...vendorDetailRows);

      vendorDetailRows.forEach((row) => {
        const category = row['Category'];
        if (category === 'Hourly') {
          hourlyRows.push(row);
        } else if (category === 'Commission - Travel Pay') {
          commissionTravelRows.push(row);
        } else {
          commissionNoTravelRows.push(row);
        }
      });

      if (vendorDetailRows.length > 0) {
        const vendorLabel = [vendor.firstName, vendor.lastName].filter(Boolean).join(' ') || 'Vendor';
        appendTotalsRow(vendorRows, vendorDetailRows, `TOTAL - ${vendorLabel}`);
      }
    });

    if (summaryRows.length === 0 && allVendorDetailRows.length === 0) {
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

    appendTotalsRow(vendorRows, allVendorDetailRows);
    appendTotalsRow(hourlyRows);
    appendTotalsRow(commissionTravelRows);
    appendTotalsRow(commissionNoTravelRows);

    // Build By Venue & Event sheet: venue/event first, employee columns, financial columns, grand total
    const byVenueEventRows: any[] = [];
    const bveTotals = { hoursDecimal: 0, commissionPay: 0, variableIncentive: 0, tips: 0, restBreak: 0, mileagePay: 0, travelPay: 0, reimbursement: 0, other: 0, totalGrossPay: 0 };
    paymentsByVenue.forEach((venueGroup: any) => {
      venueGroup.events.forEach((event: any) => {
        const eventPayments = Array.isArray(event.payments) ? event.payments : [];
        eventPayments.forEach((payment: any) => {
          const isEventSD = event?.isSanDiegoHourly === true || isSanDiegoRegion(event);
          const breakdown = getDisplayedPaymentBreakdown(event, payment);
          const loadedRate = breakdown.rateInEffect;
          const hoursInDecimal = roundHoursToTwoDecimals(breakdown.hours);
          const commPay = isEventSD ? 0 : Number(breakdown.commissionPay.toFixed(2));
          const varIncentive = isEventSD ? 0 : Number(breakdown.variableIncentive.toFixed(2));
          const tipsRaw = getDisplayedTips(event, payment);
          const tips = Number(roundUpThousandsToNextHundred(tipsRaw).toFixed(2));
          const restBreak = isEventSD ? 'N/A' : Number(roundUpThousandsToNextHundred(Number(payment.restBreak || 0)).toFixed(2));
          const mileageMiles = (mileageByEvent[event.id] || {})[payment.userId]?.miles ?? null;
          const rawMileagePay = Number((mileageByEvent[event.id] || {})[payment.userId]?.mileagePay || 0);
          const diffMiles = (mileageByEvent[event.id] || {})[payment.userId]?.differentialMiles ?? null;
          const exportApproval = getMileageApproval(event.id, payment.userId);
          const mileagePay = exportApproval.mileage ? Number(roundUpThousandsToNextHundred(rawMileagePay).toFixed(2)) : 0;
          const travelHours = 0;
          const travelPay = exportApproval.travel && diffMiles !== null ? Number(roundUpThousandsToNextHundred(computeTravelPay(diffMiles, event?.state, breakdown.rateInEffect)).toFixed(2)) : 0;
          const reimbursementBve = Number(roundUpThousandsToNextHundred(Number(payment.reimbursementAmount ?? 0)).toFixed(2));
          const other = Number(roundUpThousandsToNextHundred(Number(payment.otherAmount ?? 0)).toFixed(2));
          const adjAmtBve = reimbursementBve + other;
          const totalGrossPay = Number(roundUpThousandsToNextHundred(
            breakdown.commissionPaidTotal + tipsRaw + (isEventSD ? 0 : Number(payment.restBreak || 0)) + adjAmtBve + mileagePay + travelPay
          ).toFixed(2));
          bveTotals.hoursDecimal += hoursInDecimal;
          bveTotals.commissionPay += commPay;
          bveTotals.variableIncentive += varIncentive;
          bveTotals.tips += tips;
          bveTotals.restBreak += typeof restBreak === 'number' ? restBreak : 0;
          bveTotals.mileagePay += mileagePay;
          bveTotals.travelPay += travelPay;
          bveTotals.reimbursement += reimbursementBve;
          bveTotals.other += other;
          bveTotals.totalGrossPay += totalGrossPay;
          byVenueEventRows.push({
            'Venue': venueGroup.venue,
            'City': venueGroup.city || '',
            'State': venueGroup.state || '',
            'Event Name': event.name,
            'Event Date': event.date || '',
            'First Name': payment.firstName || '',
            'Last Name': payment.lastName || '',
            'Email': payment.email || '',
            'Reg Rate': formatPayrollMoney(breakdown.regRate),
            'Rate in Effect': formatPayrollMoney(loadedRate),
            'Hours': formatHoursHHMM(breakdown.hours),
            'Hours in Decimal': hoursInDecimal,
            'Commission Pay': commPay,
            'Variable Incentive': varIncentive,
            'Tips': tips,
            'Rest Break': restBreak,
            'Mileage Miles': !exportApproval.mileage ? 0 : (mileageMiles !== null ? mileageMiles : 'N/A'),
            'Mileage Pay': mileagePay,
            'Travel Differential Miles': !exportApproval.travel ? 0 : (diffMiles !== null ? diffMiles : 'N/A'),
            'Travel Hours': !exportApproval.travel ? 0 : (diffMiles !== null ? Number(travelHours.toFixed(4)) : 'N/A'),
            'Travel Pay': travelPay,
            'Reimbursement': reimbursementBve,
            'Other': other,
            'Total Gross Pay': totalGrossPay,
          });
        });
      });
    });
    if (byVenueEventRows.length > 0) {
      byVenueEventRows.push({
        'Venue': 'TOTAL', 'City': '', 'State': '', 'Event Name': '', 'Event Date': '',
        'First Name': '', 'Last Name': '', 'Email': '', 'Reg Rate': '', 'Rate in Effect': '', 'Hours': '',
        'Hours in Decimal': Number(bveTotals.hoursDecimal.toFixed(2)),
        'Commission Pay': Number(bveTotals.commissionPay.toFixed(2)),
        'Variable Incentive': Number(bveTotals.variableIncentive.toFixed(2)),
        'Tips': Number(bveTotals.tips.toFixed(2)),
        'Rest Break': Number(bveTotals.restBreak.toFixed(2)),
        'Mileage Miles': '',
        'Mileage Pay': Number(bveTotals.mileagePay.toFixed(2)),
        'Travel Differential Miles': '',
        'Travel Hours': '',
        'Travel Pay': Number(bveTotals.travelPay.toFixed(2)),
        'Reimbursement': Number(bveTotals.reimbursement.toFixed(2)),
        'Other': Number(bveTotals.other.toFixed(2)),
        'Total Gross Pay': Number(bveTotals.totalGrossPay.toFixed(2)),
      });
    }

    // Create workbook
    const workbook = XLSX.utils.book_new();

    const appendDetailSheet = (sheetName: string, dataRows: any[], excludedKeys: string[] = []) => {
      if (dataRows.length === 0) return;
      const excludedKeySet = new Set(excludedKeys);
      const sanitizedRows = dataRows.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !excludedKeySet.has(key))
        )
      );
      const visibleColumns = detailColumnConfig.filter(({ key }) =>
        !excludedKeySet.has(key) &&
        sanitizedRows.some((row) => Object.prototype.hasOwnProperty.call(row, key))
      );
      const worksheet = XLSX.utils.json_to_sheet(sanitizedRows, {
        header: visibleColumns.map((column) => column.key),
      });
      worksheet['!cols'] = visibleColumns.map(({ wch }) => ({ wch }));
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    };

    appendDetailSheet('Vendor Payments', vendorRows);
    appendDetailSheet('Hourly Users', hourlyRows, ['Commission Pay']);
    appendDetailSheet('Comm Travel Pay', commissionTravelRows);
    appendDetailSheet('Comm No Travel', commissionNoTravelRows);
    if (byVenueEventRows.length > 0) {
      const bveCols = [
        { key: 'Venue', wch: 25 }, { key: 'City', wch: 15 }, { key: 'State', wch: 8 },
        { key: 'Event Name', wch: 30 }, { key: 'Event Date', wch: 12 },
        { key: 'First Name', wch: 18 }, { key: 'Last Name', wch: 18 }, { key: 'Email', wch: 30 },
        { key: 'Reg Rate', wch: 10 }, { key: 'Rate in Effect', wch: 14 },
        { key: 'Hours', wch: 8 }, { key: 'Hours in Decimal', wch: 16 },
        { key: 'Commission Pay', wch: 16 }, { key: 'Variable Incentive', wch: 18 },
        { key: 'Tips', wch: 10 }, { key: 'Rest Break', wch: 12 },
        { key: 'Mileage Miles', wch: 14 }, { key: 'Mileage Pay', wch: 12 },
        { key: 'Travel Differential Miles', wch: 22 }, { key: 'Travel Hours', wch: 12 },
        { key: 'Travel Pay', wch: 12 }, { key: 'Reimbursement', wch: 15 }, { key: 'Other', wch: 10 }, { key: 'Total Gross Pay', wch: 15 },
      ];
      const bveSheet = XLSX.utils.json_to_sheet(byVenueEventRows, { header: bveCols.map(c => c.key) });
      bveSheet['!cols'] = bveCols.map(({ wch }) => ({ wch }));
      XLSX.utils.book_append_sheet(workbook, bveSheet, 'By Venue & Event');
    }

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

    // Generate filename with date range
    const startStr = paymentsStartDate || 'start';
    const endStr = paymentsEndDate || 'end';
    const filename = `payments_${startStr}_to_${endStr}.xlsx`;

    // Download file
    XLSX.writeFile(workbook, filename);
  }, [paymentsByVenue, paymentsByVendor, paymentsStartDate, paymentsEndDate, mileageByEvent, getDisplayedPaymentBreakdown, getDisplayedTips, getDisplayedVendorTotals, adjustmentTypes]);

  const exportNonEventPayroll = useCallback(() => {
    const nonEventVenues = paymentsByVenue
      .map(v => ({ ...v, events: v.events.filter((e: any) => e.event_type === 'special') }))
      .filter(v => v.events.length > 0);

    if (nonEventVenues.length === 0) {
      alert('No Non Event time sheet data found. Load a date range that includes Non Event time sheets.');
      return;
    }

    const rows: any[] = [];
    nonEventVenues.forEach(venue => {
      venue.events.forEach(event => {
        const eventPayments = Array.isArray(event.payments) ? event.payments : [];
        eventPayments.forEach((p: any) => {
          const breakdown = getDisplayedPaymentBreakdown(event, p);
          const hours = breakdown.hours;
          const hoursInDecimal = roundHoursToTwoDecimals(hours);
          const regRate = breakdown.regRate;
          const rateInEffect = breakdown.rateInEffect;
          const regularHours = Number(breakdown.regularHours.toFixed(2));
          const regularPay = Number(roundUpThousandsToNextHundred(breakdown.regularPay).toFixed(2));
          const overtimeHours = Number(breakdown.overtimeHours.toFixed(2));
          const overtimePay = Number(roundUpThousandsToNextHundred(breakdown.overtimePay).toFixed(2));
          const doubletimeHours = Number(breakdown.doubletimeHours.toFixed(2));
          const doubletimePay = Number(roundUpThousandsToNextHundred(breakdown.doubletimePay).toFixed(2));
          const reimbursementNe = Number(p.reimbursementAmount ?? 0);
          const other = Number(p.otherAmount ?? 0);
          const adjAmtNe = reimbursementNe + other;
          const mileageMiles = (mileageByEvent[event.id] || {})[p.userId]?.miles ?? null;
          const _mileagePayRaw = Number((mileageByEvent[event.id] || {})[p.userId]?.mileagePay || 0);
          const exportApproval = getMileageApproval(event.id, p.userId);
          const mileagePay = exportApproval.mileage ? _mileagePayRaw : 0;
          const diffMiles = (mileageByEvent[event.id] || {})[p.userId]?.differentialMiles ?? null;
          const travelHours = 0;
          const travelPay = exportApproval.travel && diffMiles !== null ? computeTravelPay(diffMiles, event?.state, breakdown.rateInEffect) : 0;
          const pTipsRaw = getDisplayedTips(event, p);
          const totalGrossPay = Number(roundUpThousandsToNextHundred(
            breakdown.commissionPaidTotal + pTipsRaw + adjAmtNe + mileagePay + travelPay
          ).toFixed(2));

          rows.push({
            'Venue': venue.venue,
            'City': venue.city || '',
            'State': venue.state || '',
            'Event Name': event.name,
            'Event Date': event.date || '',
            'First Name': p.firstName || '',
            'Last Name': p.lastName || '',
            'Email': p.email || '',
            'Reg Rate': formatPayrollMoney(regRate),
            'Rate in Effect': formatPayrollMoney(rateInEffect),
            'Hours': formatHoursHHMM(hours),
            'Hours in Decimal': hoursInDecimal,
            'Regular Time Hours': regularHours,
            'Regular Time Pay': regularPay,
            'Overtime Hours': overtimeHours,
            'Overtime Pay': overtimePay,
            'Double Time Hours': doubletimeHours,
            'Double Time Pay': doubletimePay,
            'Tips': Number(roundUpThousandsToNextHundred(pTipsRaw).toFixed(2)),
            'Mileage Miles': !exportApproval.mileage ? 0 : (mileageMiles !== null ? mileageMiles : 'N/A'),
            'Mileage Pay': Number(roundUpThousandsToNextHundred(mileagePay).toFixed(2)),
            'Travel Differential Miles': !exportApproval.travel ? 0 : (diffMiles !== null ? diffMiles : 'N/A'),
            'Travel Hours': !exportApproval.travel ? 0 : (diffMiles !== null ? Number(travelHours.toFixed(4)) : 'N/A'),
            'Travel Pay': Number(roundUpThousandsToNextHundred(travelPay).toFixed(2)),
            'Reimbursement': Number(roundUpThousandsToNextHundred(reimbursementNe).toFixed(2)),
            'Other': Number(roundUpThousandsToNextHundred(other).toFixed(2)),
            'Total Gross Pay': totalGrossPay,
          });
        });
      });
    });

    if (rows.length === 0) {
      alert('No Non Event employee payment records found.');
      return;
    }

    const sumNum = (key: string) => rows.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0);
    rows.push({
      'Venue': 'TOTAL', 'City': '', 'State': '', 'Event Name': '', 'Event Date': '',
      'First Name': '', 'Last Name': '', 'Email': '', 'Reg Rate': '', 'Rate in Effect': '',
      'Hours': '', 'Hours in Decimal': Number(sumNum('Hours in Decimal').toFixed(2)),
      'Regular Time Hours': Number(sumNum('Regular Time Hours').toFixed(2)),
      'Regular Time Pay': Number(sumNum('Regular Time Pay').toFixed(2)),
      'Overtime Hours': Number(sumNum('Overtime Hours').toFixed(2)),
      'Overtime Pay': Number(sumNum('Overtime Pay').toFixed(2)),
      'Double Time Hours': Number(sumNum('Double Time Hours').toFixed(2)),
      'Double Time Pay': Number(sumNum('Double Time Pay').toFixed(2)),
      'Tips': Number(sumNum('Tips').toFixed(2)),
      'Mileage Miles': '', 'Mileage Pay': Number(sumNum('Mileage Pay').toFixed(2)),
      'Travel Differential Miles': '', 'Travel Hours': '',
      'Travel Pay': Number(sumNum('Travel Pay').toFixed(2)),
      'Reimbursement': Number(sumNum('Reimbursement').toFixed(2)),
      'Other': Number(sumNum('Other').toFixed(2)),
      'Total Gross Pay': Number(sumNum('Total Gross Pay').toFixed(2)),
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 25 }, { wch: 15 }, { wch: 8 }, { wch: 30 }, { wch: 12 },
      { wch: 18 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 12 },
      { wch: 8 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 14 },
      { wch: 13 }, { wch: 16 }, { wch: 15 }, { wch: 10 }, { wch: 14 },
      { wch: 12 }, { wch: 22 }, { wch: 13 }, { wch: 12 }, { wch: 15 }, { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Non Event Payroll');
    const startStr = paymentsStartDate || 'start';
    const endStr = paymentsEndDate || 'end';
    XLSX.writeFile(wb, `non_event_payroll_${startStr}_to_${endStr}.xlsx`);
  }, [paymentsByVenue, paymentsStartDate, paymentsEndDate, mileageByEvent, getDisplayedPaymentBreakdown, getDisplayedTips, getMileageApproval, adjustmentTypes]);

  const exportSalariedPayroll = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

      const res = await fetch('/api/salaried-paysheet', { headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load salaried records');

      const records: any[] = Array.isArray(json.records) ? json.records : [];
      if (records.length === 0) {
        alert('No salaried pay records found in the paysheet.');
        return;
      }

      const rows = records.map(r => ({
        'Employee': r.employee_name,
        'Email': r.employee_email || '',
        'Pay Period Start': r.pay_period_start,
        'Pay Period End': r.pay_period_end,
        'Gross Pay': Number(r.gross_pay),
        'Bonus': Number(r.bonus_amount ?? 0),
        'Bonus Notes': r.bonus_notes || '',
        'Reimbursement': Number(r.reimbursement_amount ?? 0),
        'Reimbursement Notes': r.reimbursement_notes || '',
        'Net Pay': Number(r.net_pay),
        'Status': r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : '',
        'Notes': r.notes || '',
      }));

      const totalRow: any = {
        'Employee': 'TOTAL', 'Email': '', 'Pay Period Start': '', 'Pay Period End': '',
        'Gross Pay': Number(rows.reduce((s, r) => s + r['Gross Pay'], 0).toFixed(2)),
        'Bonus': Number(rows.reduce((s, r) => s + r['Bonus'], 0).toFixed(2)),
        'Bonus Notes': '',
        'Reimbursement': Number(rows.reduce((s, r) => s + r['Reimbursement'], 0).toFixed(2)),
        'Reimbursement Notes': '',
        'Net Pay': Number(rows.reduce((s, r) => s + r['Net Pay'], 0).toFixed(2)),
        'Status': '', 'Notes': '',
      };
      rows.push(totalRow);

      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 25 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 30 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Salaried Payroll');
      XLSX.writeFile(wb, `salaried_payroll.xlsx`);
    } catch (err: any) {
      alert(err.message || 'Failed to export salaried payroll');
    }
  }, []);

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

  const loadSickLeaves = useCallback(async (period: SickLeavePeriodFilter = emptySickLeavePeriod) => {
    setLoadingSickLeaves(true);
    setSickLeavesError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (period.start) params.set("accrual_start", period.start);
      if (period.end) params.set("accrual_end", period.end);
      const url = `/api/hr/sick-leaves${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, {
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
      loadSickLeaves(appliedSickLeavePeriod);
    }
  }, [hrView, appliedSickLeavePeriod, loadSickLeaves]);

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

      await loadSickLeaves(appliedSickLeavePeriod);
    } catch (err: any) {
      alert(err?.message || "Failed to update sick leave status");
    } finally {
      setUpdatingSickLeaveId(null);
    }
  }, [appliedSickLeavePeriod, loadSickLeaves]);

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

        await loadSickLeaves(appliedSickLeavePeriod);
      } catch (err: any) {
        alert(err?.message || "Failed to add used sick leave hours");
      } finally {
        setAddingUsedHoursUserId(null);
      }
    },
    [appliedSickLeavePeriod, loadSickLeaves]
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

        await loadSickLeaves(appliedSickLeavePeriod);
      } catch (err: any) {
        alert(err?.message || "Failed to remove used sick leave hours");
      } finally {
        setRemovingUsedHoursUserId(null);
      }
    },
    [appliedSickLeavePeriod, loadSickLeaves]
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

        await loadSickLeaves(appliedSickLeavePeriod);
      } catch (err: any) {
        alert(err?.message || `Failed to update ${fieldLabel} hours`);
      } finally {
        setEditingSickAccrualKey(null);
      }
    },
    [appliedSickLeavePeriod, loadSickLeaves]
  );

  const handleApplySickLeavePeriod = useCallback(() => {
    if (sickLeavePeriodStart && sickLeavePeriodEnd && sickLeavePeriodStart > sickLeavePeriodEnd) {
      setSickLeavesError("Accrual period start date must be on or before the end date.");
      return;
    }

    setAppliedSickLeavePeriod({
      start: sickLeavePeriodStart,
      end: sickLeavePeriodEnd,
    });
  }, [sickLeavePeriodEnd, sickLeavePeriodStart]);

  const handleClearSickLeavePeriod = useCallback(() => {
    setSickLeavePeriodStart("");
    setSickLeavePeriodEnd("");
    setAppliedSickLeavePeriod(emptySickLeavePeriod);
    setSickLeavesError("");
  }, []);

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

  const hasAppliedSickLeavePeriod = Boolean(
    appliedSickLeavePeriod.start || appliedSickLeavePeriod.end
  );

  // ---- Sick leave pay sheet (queued sick-leave payroll) ----
  const getSickPayBaseRate = useCallback(
    (employee?: Employee | null) => {
      if (!employee) return 0;
      if (normalizeState(employee.state) === "CA" && /san\s*diego/i.test(employee.city || "")) {
        return SAN_DIEGO_BASE_RATE;
      }
      const configured = Number(sickPayBaseRatesByState[normalizeState(employee.state)] || 0);
      return configured > 0 ? configured : 17.28;
    },
    [sickPayBaseRatesByState]
  );

  const loadSickPayBaseRates = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/rates", {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (!res.ok) return;
      const json = await res.json();
      const map: Record<string, number> = {};
      for (const row of json?.rates || []) {
        const st = normalizeState(row?.state_code);
        const baseRate = Number(row?.base_rate || 0);
        if (st && baseRate > 0) map[st] = baseRate;
      }
      setSickPayBaseRatesByState(map);
    } catch (e) {
      console.warn("[SICK PAYSHEET] Failed to load base rates", e);
    }
  }, []);

  const loadSickPaysheets = useCallback(async () => {
    setLoadingSickPaysheets(true);
    setSickPaysheetError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/hr/sick-leave-payments?ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load sick leave pay sheets");
      setSickPaysheets(Array.isArray(json.paysheets) ? json.paysheets : []);
    } catch (e: any) {
      setSickPaysheetError(e?.message || "Failed to load sick leave pay sheets");
    } finally {
      setLoadingSickPaysheets(false);
    }
  }, []);

  const sickPaysheetSelectedEmployee = useMemo(
    () => employees.find((e) => e.id === sickPaysheetForm.userId) || null,
    [employees, sickPaysheetForm.userId]
  );

  const sickPaysheetComputedAmount = useMemo(() => {
    const hours = Number(sickPaysheetForm.hours) || 0;
    const rate = Number(sickPaysheetForm.rate) || 0;
    return Number((hours * rate).toFixed(2));
  }, [sickPaysheetForm.hours, sickPaysheetForm.rate]);

  const handleSickPaysheetEmployeeChange = (userId: string) => {
    const employee = employees.find((e) => e.id === userId) || null;
    const rate = getSickPayBaseRate(employee);
    setSickPaysheetForm((prev) => ({
      ...prev,
      userId,
      rate: rate > 0 ? rate.toFixed(2) : prev.rate,
    }));
  };

  const handleCreateSickPaysheet = async () => {
    setSickPaysheetError("");
    setSickPaysheetSuccess("");
    const hours = Number(sickPaysheetForm.hours);
    const rate = Number(sickPaysheetForm.rate);
    if (!sickPaysheetForm.userId) {
      setSickPaysheetError("Select an employee.");
      return;
    }
    if (!sickPaysheetForm.paymentDate) {
      setSickPaysheetError("Select a payment date.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setSickPaysheetError("Enter sick leave hours greater than 0.");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setSickPaysheetError("Enter a valid hourly rate.");
      return;
    }
    setCreatingSickPaysheet(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/hr/sick-leave-payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          user_id: sickPaysheetForm.userId,
          payment_date: sickPaysheetForm.paymentDate,
          hours,
          rate,
          amount: sickPaysheetComputedAmount,
          notes: sickPaysheetForm.notes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to queue sick leave pay sheet");
      setSickPaysheetSuccess("Sick leave pay sheet queued for payroll.");
      setSickPaysheetForm((prev) => ({ ...prev, hours: "", notes: "" }));
      await loadSickPaysheets();
    } catch (e: any) {
      setSickPaysheetError(e?.message || "Failed to queue sick leave pay sheet");
    } finally {
      setCreatingSickPaysheet(false);
    }
  };

  const handleUpdateSickPaysheet = async (id: string, updates: { status?: "queued" | "paid"; payment_date?: string }) => {
    setUpdatingSickPaysheetId(id);
    setSickPaysheetError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/hr/sick-leave-payments", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id, ...updates }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to update sick leave pay sheet");
      await loadSickPaysheets();
    } catch (e: any) {
      setSickPaysheetError(e?.message || "Failed to update sick leave pay sheet");
    } finally {
      setUpdatingSickPaysheetId(null);
    }
  };

  const handleDeleteSickPaysheet = async (id: string) => {
    setUpdatingSickPaysheetId(id);
    setSickPaysheetError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/hr/sick-leave-payments?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to remove sick leave pay sheet");
      await loadSickPaysheets();
    } catch (e: any) {
      setSickPaysheetError(e?.message || "Failed to remove sick leave pay sheet");
    } finally {
      setUpdatingSickPaysheetId(null);
    }
  };

  // ---- Payment cycles ----
  const loadPaymentCycles = useCallback(async () => {
    setLoadingCycles(true);
    setCycleError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/hr/payment-cycles?ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load payment cycles");
      setPaymentCycles(Array.isArray(json.cycles) ? json.cycles : []);
      setCycleConfig(json.config || null);
      if (json.config) {
        setCadenceForm({
          frequency: json.config.frequency || "biweekly",
          anchorDate: json.config.anchor_date || "",
          payOffsetDays: String(json.config.pay_offset_days ?? 0),
        });
      }
    } catch (e: any) {
      setCycleError(e?.message || "Failed to load payment cycles");
    } finally {
      setLoadingCycles(false);
    }
  }, []);

  const handleSaveCadence = async () => {
    setCycleError("");
    setCycleSuccess("");
    if (!cadenceForm.anchorDate) {
      setCycleError("Pick an anchor date (the first period's start).");
      return;
    }
    setSavingCadence(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/hr/payment-cycles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          frequency: cadenceForm.frequency,
          anchorDate: cadenceForm.anchorDate,
          payOffsetDays: Number(cadenceForm.payOffsetDays) || 0,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save cadence");
      setCycleSuccess("Payment cadence saved and cycles generated.");
      await loadPaymentCycles();
    } catch (e: any) {
      setCycleError(e?.message || "Failed to save cadence");
    } finally {
      setSavingCadence(false);
    }
  };

  const handleRetrieveCycle = async (cycle: PaymentCycle) => {
    setCycleError("");
    setCycleSuccess("");
    setRetrieveCycle(cycle);
    setRetrieveRows([]);
    setRetrieveSelected(new Set());
    setRetrieving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/hr/payment-cycles/${cycle.id}/retrieve?ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to retrieve cycle time");
      const rows: CyclePreviewRow[] = Array.isArray(json.rows) ? json.rows : [];
      setRetrieveRows(rows);
      // Default-select everyone who doesn't already have a paysheet for this cycle.
      setRetrieveSelected(new Set(rows.filter((r) => !r.already_has_paysheet).map((r) => r.user_id)));
    } catch (e: any) {
      setCycleError(e?.message || "Failed to retrieve cycle time");
      setRetrieveCycle(null);
    } finally {
      setRetrieving(false);
    }
  };

  const toggleRetrieveUser = (userId: string) => {
    setRetrieveSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleProcessCycle = async () => {
    if (!retrieveCycle) return;
    const userIds = [...retrieveSelected];
    if (userIds.length === 0) {
      setCycleError("Select at least one employee to create paysheets for.");
      return;
    }
    setCycleError("");
    setProcessingCycle(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/hr/payment-cycles/${retrieveCycle.id}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userIds }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to create paysheets");
      setCycleSuccess(json.message || "Paysheets created.");
      setRetrieveCycle(null);
      setRetrieveRows([]);
      setRetrieveSelected(new Set());
      await Promise.all([loadPaymentCycles(), loadSickPaysheets()]);
    } catch (e: any) {
      setCycleError(e?.message || "Failed to create paysheets");
    } finally {
      setProcessingCycle(false);
    }
  };

  const handleDeleteCycle = async (cycle: PaymentCycle) => {
    setCycleError("");
    setCycleSuccess("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/hr/payment-cycles?id=${encodeURIComponent(cycle.id)}`, {
        method: "DELETE",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to remove cycle");
      await loadPaymentCycles();
    } catch (e: any) {
      setCycleError(e?.message || "Failed to remove cycle");
    }
  };

  useEffect(() => {
    if (hrView === "payments") {
      loadSickPayBaseRates();
      loadSickPaysheets();
      loadPaymentCycles();
    }
  }, [hrView, loadSickPayBaseRates, loadSickPaysheets, loadPaymentCycles]);

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
    await loadEmployees(newState, selectedEmployeeRegion, selectedEmployeeStatus);
  };

  const handleEmployeeRegionChange = async (newRegion: string) => {
    setSelectedEmployeeRegion(newRegion);
    await loadEmployees(selectedState, newRegion, selectedEmployeeStatus);
  };

  const handleEmployeeStatusChange = async (newStatus: EmployeeStatusFilter) => {
    setSelectedEmployeeStatus(newStatus);
    await loadEmployees(selectedState, selectedEmployeeRegion, newStatus);
  };

  const resetEmployeeFilters = async () => {
    setSelectedEmployeeStatus("active");
    setSelectedState("all");
    setSelectedEmployeeRegion("all");
    await loadEmployees("all", "all", "active");
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
    return sickLeaveAccruals.filter((record) => {
      if (
        hasAppliedSickLeavePeriod &&
        Number(record.period_worked_hours || 0) <= 0 &&
        Number(record.period_earned_hours || 0) <= 0
      ) {
        return false;
      }
      if (!q) return true;
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
  }, [hasAppliedSickLeavePeriod, sickLeaveAccruals, sickLeaveSearch]);

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

  const sickLeavePeriodTotals = useMemo(() => {
    if (!hasAppliedSickLeavePeriod) return null;
    return filteredSickLeaveAccruals.reduce(
      (acc, row) => {
        acc.employees += 1;
        acc.totalWorkedHours += Number(row.period_worked_hours || 0);
        acc.totalEarnedHours += Number(row.period_earned_hours || 0);
        return acc;
      },
      { employees: 0, totalWorkedHours: 0, totalEarnedHours: 0 }
    );
  }, [filteredSickLeaveAccruals, hasAppliedSickLeavePeriod]);

  const sickLeaveAccrualColumnCount = hasAppliedSickLeavePeriod ? 11 : 9;

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
              Actual Global Calendar
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
              <div className="mt-4 flex flex-wrap gap-3">
                <button onClick={loadPaymentsData} className={`apple-button ${loadingPayments ? 'apple-button-disabled' : 'apple-button-primary'}`} disabled={loadingPayments}>
                  {loadingPayments ? 'Loading…' : 'Load Payments'}
                </button>
                <button onClick={saveAllAdjustments} className={`apple-button ${savingAdjustment ? 'apple-button-disabled' : 'apple-button-secondary'}`} disabled={savingAdjustment}>
                  {savingAdjustment ? 'Saving…' : 'Save All Adjustments'}
                </button>
                <button onClick={exportPaymentsToExcel} className={`apple-button ${paymentsByVenue.length === 0 ? 'apple-button-disabled' : 'apple-button-secondary'}`} disabled={paymentsByVenue.length === 0}>
                  Export to Excel
                </button>
                <button onClick={exportNonEventPayroll} className={`apple-button ${paymentsByVenue.length === 0 ? 'apple-button-disabled' : 'apple-button-secondary'}`} disabled={paymentsByVenue.length === 0}>
                  Non Event
                </button>
                <button onClick={() => void exportSalariedPayroll()} className="apple-button apple-button-secondary">
                  Salaried Export
                </button>
                <Link href="/salaried-paysheet">
                  <button className="apple-button apple-button-secondary">Salaried Paysheet</button>
                </Link>
                <button
                  onClick={() => setPayrollGroupBy('venue')}
                  className={`apple-button ${paymentsByVenue.length === 0 ? 'apple-button-disabled' : payrollGroupBy === 'venue' ? 'apple-button-primary' : 'apple-button-secondary'}`}
                  disabled={paymentsByVenue.length === 0}
                >
                  View by Event
                </button>
                <button
                  onClick={() => setPayrollGroupBy('vendor')}
                  className={`apple-button ${paymentsByVenue.length === 0 ? 'apple-button-disabled' : payrollGroupBy === 'vendor' ? 'apple-button-primary' : 'apple-button-secondary'}`}
                  disabled={paymentsByVenue.length === 0}
                >
                  View by Vendor
                </button>
                <button onClick={() => { setApprovalError(''); setShowApprovalModal(true); }} className="apple-button apple-button-primary">
                  Send to Approval
                </button>
                <Link href="/payroll-approvals">
                  <button className="apple-button apple-button-secondary">View Approvals</button>
                </Link>
              </div>
            </div>

            {/* Payment Cycles */}
            <div className="apple-card mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Payment Cycles</h2>
                  <p className="text-sm text-gray-500">Set a recurring pay cadence, then retrieve each employee&apos;s sick-leave &amp; worked hours for a cycle to auto-fill paysheets.</p>
                </div>
                <button
                  onClick={loadPaymentCycles}
                  disabled={loadingCycles}
                  className="apple-button apple-button-secondary"
                >
                  {loadingCycles ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              {/* Cadence config */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="apple-label" htmlFor="cycle-frequency">Frequency</label>
                  <select
                    id="cycle-frequency"
                    value={cadenceForm.frequency}
                    onChange={(e) => setCadenceForm((prev) => ({ ...prev, frequency: e.target.value }))}
                    className="apple-select w-full"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="semimonthly">Semi-monthly (1–15 / 16–end)</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="apple-label" htmlFor="cycle-anchor">Anchor Date (first period start)</label>
                  <input
                    id="cycle-anchor"
                    type="date"
                    value={cadenceForm.anchorDate}
                    onChange={(e) => setCadenceForm((prev) => ({ ...prev, anchorDate: e.target.value }))}
                    className="apple-select w-full"
                  />
                </div>
                <div>
                  <label className="apple-label" htmlFor="cycle-offset">Pay Offset (days after period end)</label>
                  <input
                    id="cycle-offset"
                    type="number"
                    min="0"
                    step="1"
                    value={cadenceForm.payOffsetDays}
                    onChange={(e) => setCadenceForm((prev) => ({ ...prev, payOffsetDays: e.target.value }))}
                    className="apple-select w-full"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleSaveCadence}
                    disabled={savingCadence}
                    className={`apple-button w-full ${savingCadence ? "apple-button-disabled" : "apple-button-primary"}`}
                  >
                    {savingCadence ? "Saving…" : cycleConfig ? "Update & Regenerate" : "Save Cadence"}
                  </button>
                </div>
              </div>

              {cycleError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{cycleError}</div>
              )}
              {cycleSuccess && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{cycleSuccess}</div>
              )}

              {/* Cycle list */}
              <div className="mt-6 overflow-x-auto">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase keeping-wider">Generated Cycles</h3>
                  <span className="text-xs text-gray-500">{paymentCycles.length} total</span>
                </div>
                {paymentCycles.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-400">No cycles yet. Save a cadence above to generate them.</div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Cycle</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Pay Date</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Status</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Paysheets</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paymentCycles.map((cycle) => (
                        <tr key={cycle.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-900">
                            <div className="font-medium">{cycle.label}</div>
                            <div className="text-xs text-gray-400">
                              {formatSickLeaveDate(cycle.start_date)} – {formatSickLeaveDate(cycle.end_date)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-700">{formatSickLeaveDate(cycle.pay_date)}</td>
                          <td className="px-3 py-2 text-sm">
                            <span className={`px-2 py-0.5 text-xs font-semibold capitalize border rounded-full ${cycle.status === "processed" ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
                              {cycle.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm text-right text-gray-700">{cycle.paysheet_count ?? 0}</td>
                          <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
                            <button
                              onClick={() => handleRetrieveCycle(cycle)}
                              disabled={retrieving}
                              className="text-purple-600 hover:text-purple-800 font-medium mr-3 disabled:opacity-50"
                            >
                              Retrieve &amp; auto-fill
                            </button>
                            <button
                              onClick={() => handleDeleteCycle(cycle)}
                              disabled={(cycle.paysheet_count ?? 0) > 0}
                              title={(cycle.paysheet_count ?? 0) > 0 ? "Remove its paysheets first" : "Delete cycle"}
                              className="text-red-600 hover:text-red-800 font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Retrieve & auto-fill preview modal */}
            {retrieveCycle && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Retrieve time for cycle</h2>
                      <p className="text-sm text-gray-500 mt-0.5">{retrieveCycle.label} · pays {formatSickLeaveDate(retrieveCycle.pay_date)}</p>
                    </div>
                    <button
                      onClick={() => { setRetrieveCycle(null); setRetrieveRows([]); setRetrieveSelected(new Set()); }}
                      className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
                      aria-label="Close"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-4">
                    {retrieving ? (
                      <div className="text-center py-10 text-sm text-gray-400">Retrieving sick-leave &amp; worked hours…</div>
                    ) : retrieveRows.length === 0 ? (
                      <div className="text-center py-10 text-sm text-gray-400">No employees used sick leave in this cycle window.</div>
                    ) : (
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider w-8"></th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Employee</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Sick Hrs</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Worked Hrs</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Rate</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {retrieveRows.map((row) => (
                            <tr key={row.user_id} className={row.already_has_paysheet ? "bg-gray-50" : "hover:bg-gray-50"}>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={retrieveSelected.has(row.user_id)}
                                  disabled={row.already_has_paysheet}
                                  onChange={() => toggleRetrieveUser(row.user_id)}
                                />
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900">
                                <div className="font-medium">{row.name}{row.state ? ` (${row.state})` : ""}</div>
                                {row.already_has_paysheet && <div className="text-xs text-amber-600">Already has a paysheet for this cycle</div>}
                              </td>
                              <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">{formatSickLeaveHours(row.sick_hours)}</td>
                              <td className="px-3 py-2 text-sm text-right text-gray-500">{formatSickLeaveHours(row.worked_hours)}</td>
                              <td className="px-3 py-2 text-sm text-right text-gray-700">${formatPayrollMoney(row.rate)}</td>
                              <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">${formatPayrollMoney(row.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="px-6 py-4 border-t border-gray-200 flex items-center gap-3">
                    <button
                      onClick={() => { setRetrieveCycle(null); setRetrieveRows([]); setRetrieveSelected(new Set()); }}
                      className="flex-1 apple-button apple-button-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleProcessCycle}
                      disabled={processingCycle || retrieving || retrieveSelected.size === 0}
                      className={`flex-1 apple-button ${processingCycle || retrieveSelected.size === 0 ? "apple-button-disabled" : "apple-button-primary"}`}
                    >
                      {processingCycle ? "Creating…" : `Create ${retrieveSelected.size} Paysheet${retrieveSelected.size !== 1 ? "s" : ""}`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Sick Leave Pay Sheet */}
            <div className="apple-card mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Sick Leave Pay Sheet</h2>
                  <p className="text-sm text-gray-500">Create a sick-leave payroll sheet and queue it with a payment date.</p>
                </div>
                <button
                  onClick={loadSickPaysheets}
                  disabled={loadingSickPaysheets}
                  className="apple-button apple-button-secondary"
                >
                  {loadingSickPaysheets ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
                <div className="lg:col-span-2">
                  <label className="apple-label" htmlFor="sick-pay-employee">Employee</label>
                  <select
                    id="sick-pay-employee"
                    value={sickPaysheetForm.userId}
                    onChange={(e) => handleSickPaysheetEmployeeChange(e.target.value)}
                    className="apple-select w-full"
                  >
                    <option value="">Select employee…</option>
                    {[...employees]
                      .sort((a, b) =>
                        `${a.last_name} ${a.first_name}`.localeCompare(
                          `${b.last_name} ${b.first_name}`,
                          undefined,
                          { sensitivity: "base" }
                        )
                      )
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.last_name}, {emp.first_name}
                          {emp.state ? ` (${emp.state})` : ""}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="apple-label" htmlFor="sick-pay-date">Payment Date</label>
                  <input
                    id="sick-pay-date"
                    type="date"
                    value={sickPaysheetForm.paymentDate}
                    onChange={(e) => setSickPaysheetForm((prev) => ({ ...prev, paymentDate: e.target.value }))}
                    className="apple-select w-full"
                  />
                </div>
                <div>
                  <label className="apple-label" htmlFor="sick-pay-hours">Hours</label>
                  <input
                    id="sick-pay-hours"
                    type="number"
                    min="0"
                    step="0.01"
                    value={sickPaysheetForm.hours}
                    onChange={(e) => setSickPaysheetForm((prev) => ({ ...prev, hours: e.target.value }))}
                    placeholder="0.00"
                    className="apple-select w-full"
                  />
                </div>
                <div>
                  <label className="apple-label" htmlFor="sick-pay-rate">Rate ($/hr)</label>
                  <input
                    id="sick-pay-rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={sickPaysheetForm.rate}
                    onChange={(e) => setSickPaysheetForm((prev) => ({ ...prev, rate: e.target.value }))}
                    placeholder="0.00"
                    className="apple-select w-full"
                  />
                  {sickPaysheetSelectedEmployee && (
                    <p className="mt-1 text-xs text-gray-400">
                      Default for {sickPaysheetSelectedEmployee.state || "—"}: ${getSickPayBaseRate(sickPaysheetSelectedEmployee).toFixed(2)}/hr
                    </p>
                  )}
                </div>
                <div>
                  <label className="apple-label">Amount</label>
                  <div className="apple-select w-full bg-gray-50 font-semibold text-gray-900 flex items-center">
                    ${formatPayrollMoney(sickPaysheetComputedAmount)}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Hours × Rate</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className="md:col-span-2">
                  <label className="apple-label" htmlFor="sick-pay-notes">Notes (optional)</label>
                  <input
                    id="sick-pay-notes"
                    type="text"
                    value={sickPaysheetForm.notes}
                    onChange={(e) => setSickPaysheetForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="e.g. Sick leave for week of …"
                    className="apple-select w-full"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleCreateSickPaysheet}
                    disabled={creatingSickPaysheet}
                    className={`apple-button w-full ${creatingSickPaysheet ? "apple-button-disabled" : "apple-button-primary"}`}
                  >
                    {creatingSickPaysheet ? "Queuing…" : "Create & Queue Pay Sheet"}
                  </button>
                </div>
              </div>

              {sickPaysheetError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sickPaysheetError}</div>
              )}
              {sickPaysheetSuccess && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{sickPaysheetSuccess}</div>
              )}

              {/* Queue */}
              <div className="mt-6 overflow-x-auto">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase keeping-wider">Queued Sick Leave Pay Sheets</h3>
                  <span className="text-xs text-gray-500">{sickPaysheets.length} total</span>
                </div>
                {sickPaysheets.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-400">No sick leave pay sheets queued yet.</div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Employee</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Payment Date</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Hours</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Rate</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Amount</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Status</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sickPaysheets.map((ps) => (
                        <tr key={ps.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-900">
                            <div className="font-medium">{ps.employee_name}</div>
                            {ps.notes && <div className="text-xs text-gray-400">{ps.notes}</div>}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-700">{formatSickLeaveDate(ps.payment_date)}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-700">{formatSickLeaveHours(ps.hours)}</td>
                          <td className="px-3 py-2 text-sm text-right text-gray-700">${formatPayrollMoney(ps.rate)}</td>
                          <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900">${formatPayrollMoney(ps.amount)}</td>
                          <td className="px-3 py-2 text-sm">
                            <span className={`px-2 py-0.5 text-xs font-semibold capitalize border rounded-full ${ps.status === "paid" ? "bg-green-100 text-green-700 border-green-200" : "bg-blue-100 text-blue-700 border-blue-200"}`}>
                              {ps.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-sm text-right whitespace-nowrap">
                            {ps.status === "queued" ? (
                              <button
                                onClick={() => handleUpdateSickPaysheet(ps.id, { status: "paid" })}
                                disabled={updatingSickPaysheetId === ps.id}
                                className="text-green-600 hover:text-green-800 font-medium mr-3 disabled:opacity-50"
                              >
                                Mark Paid
                              </button>
                            ) : (
                              <button
                                onClick={() => handleUpdateSickPaysheet(ps.id, { status: "queued" })}
                                disabled={updatingSickPaysheetId === ps.id}
                                className="text-blue-600 hover:text-blue-800 font-medium mr-3 disabled:opacity-50"
                              >
                                Re-queue
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteSickPaysheet(ps.id)}
                              disabled={updatingSickPaysheetId === ps.id}
                              className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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
              ) : payrollGroupBy === 'vendor' ? (
                paymentsByVendor.map(vendor => {
                  const vendorTotals = getDisplayedVendorTotals(vendor);
                  const vendorDisplayedTotal = vendorTotals.totalGross;
                  const vendorHasSanDiegoEvents = vendor.events.some(({ event }) => event?.isSanDiegoHourly === true || isSanDiegoRegion(event));
                  const vendorHasNonSanDiegoEvents = vendor.events.some(({ event }) => !(event?.isSanDiegoHourly === true || isSanDiegoRegion(event)));
                  const showVendorHourlyColumns = vendorHasSanDiegoEvents;
                  const showVendorCommissionColumns = vendorHasNonSanDiegoEvents;
                  const showVendorRestBreakColumn = vendorHasNonSanDiegoEvents;
                  const formatVendorMoney = (amount: number) => formatExactMoney(amount);

                  return (
                    <div key={vendor.userId || vendor.email} className="apple-card">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{vendor.firstName} {vendor.lastName}</h3>
                          <p className="text-sm text-gray-500">{vendor.email}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-gray-900">${formatVendorMoney(vendorDisplayedTotal)}</div>
                          <div className="text-sm text-gray-500">{formatHoursDecimal(vendorTotals.totalHours)} hrs</div>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Venue</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                              {showVendorHourlyColumns && (
                                <>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Regular Time</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Overtime</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Double Time</th>
                                </>
                              )}
                              {showVendorCommissionColumns && (
                                <>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Commission Pay</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Variable Incentive</th>
                                </>
                              )}
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Tips</th>
                              {showVendorRestBreakColumn && (
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rest Break</th>
                              )}
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Mileage Pay</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Travel Pay</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Reimbursement</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Other</th>
                              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total Gross Pay</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {vendor.events.map(({ event, venue, city, state, payment }, idx) => {
                              const breakdown = getDisplayedPaymentBreakdown(event, payment);
                              const isEventSD = event?.isSanDiegoHourly === true || payment?.isSanDiegoHourly === true || isSanDiegoRegion(event);
                              const loadedRate = breakdown.rateInEffect;
                              const _mp = Number((mileageByEvent[event.id] || {})[payment.userId]?.mileagePay || 0);
                              const diffMiles = (mileageByEvent[event.id] || {})[payment.userId]?.differentialMiles ?? null;
                              const _tp = diffMiles !== null ? computeTravelPay(diffMiles, state ?? event?.state, loadedRate) : 0;
                              const approval = getMileageApproval(event.id, payment.userId);
                              const mileageOverrideS1 = (mileagePayOverrides[event.id] || {})[payment.userId];
                              const travelOverrideS1 = (travelPayOverrides[event.id] || {})[payment.userId];
                              const mileagePay = mileageOverrideS1 !== undefined ? mileageOverrideS1 : (approval.mileage ? _mp : 0);
                              const travelPay = travelOverrideS1 !== undefined ? travelOverrideS1 : (approval.travel ? _tp : 0);
                              const currentAdjustmentType = normalizeOtherAdjustmentType(
                                ((adjustmentTypes[event.id] ?? {})[payment.userId] ?? payment.adjustmentType ?? DEFAULT_OTHER_ADJUSTMENT_TYPE)
                              );
                              const currentAdjustmentTypeLabel = getOtherAdjustmentTypeLabel(currentAdjustmentType);
                              const rowTotal = breakdown.commissionPaidTotal + Number(payment.tips || 0) + (isEventSD ? 0 : Number(payment.restBreak || 0)) + Number(payment.adjustmentAmount || 0) + mileagePay + travelPay;
                              const eventHref = `/event-dashboard/${event.id}?tab=hr${paymentsStartDate ? `&periodStart=${encodeURIComponent(paymentsStartDate)}` : ''}${paymentsEndDate ? `&periodEnd=${encodeURIComponent(paymentsEndDate)}` : ''}`;
                              return (
                                <tr key={`${event.id}-${idx}`} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-sm">
                                    <Link href={eventHref} className="text-blue-600 hover:text-blue-800 hover:underline">{event.name}</Link>
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-700">{venue}<span className="text-gray-400 ml-1">{city ? `· ${city}` : ''}{state ? `, ${state}` : ''}</span></td>
                                  <td className="px-4 py-2 text-sm text-gray-500">{event.date || '—'}</td>
                                  <td className="px-4 py-2 text-sm text-right">{formatHoursDecimal(Number(payment.actualHours || 0))}</td>
                                  {showVendorHourlyColumns && (
                                    <>
                                      <td className="px-4 py-2 text-sm text-right text-gray-900">
                                        {isEventSD
                                          ? `${formatHoursDecimal(breakdown.regularHours)}h / $${formatVendorMoney(breakdown.regularPay)}`
                                          : '—'}
                                      </td>
                                      <td className="px-4 py-2 text-sm text-right text-orange-600">
                                        {isEventSD
                                          ? `${formatHoursDecimal(breakdown.overtimeHours)}h / $${formatVendorMoney(breakdown.overtimePay)}`
                                          : '—'}
                                      </td>
                                      <td className="px-4 py-2 text-sm text-right text-rose-600">
                                        {isEventSD
                                          ? `${formatHoursDecimal(breakdown.doubletimeHours)}h / $${formatVendorMoney(breakdown.doubletimePay)}`
                                          : '—'}
                                      </td>
                                    </>
                                  )}
                                  {showVendorCommissionColumns && (
                                    <>
                                      <td className="px-4 py-2 text-sm text-right text-blue-600">{isEventSD ? '—' : `$${formatVendorMoney(breakdown.commissionPay)}`}</td>
                                      <td className="px-4 py-2 text-sm text-right text-gray-400">—</td>
                                    </>
                                  )}
                                  <td className="px-4 py-2 text-sm text-right text-orange-600">${formatVendorMoney(Number(payment.tips || 0))}</td>
                                  {showVendorRestBreakColumn && (
                                    <td className="px-4 py-2 text-sm text-right text-green-600">{isEventSD ? '—' : `$${formatVendorMoney(Number(payment.restBreak || 0))}`}</td>
                                  )}
                                  <td className="px-4 py-2 text-sm text-right text-blue-600">
                                    {_mp > 0 ? (
                                      editingMileageCell?.eventId === event.id && editingMileageCell?.userId === payment.userId && editingMileageCell?.field === 'mileage' ? (
                                        <div className="flex flex-col items-end gap-1">
                                          <div className="flex items-center gap-1">
                                            <span className="text-gray-500 text-xs">$</span>
                                            <input type="number" className="w-20 px-1 py-0.5 border rounded text-xs text-right" value={editingMileageValue} onChange={(e) => setEditingMileageValue(e.target.value)} step="0.01" min="0" autoFocus />
                                          </div>
                                          <div className="flex gap-1">
                                            <button type="button" onClick={async () => { const val = parseFloat(editingMileageValue); if (!isNaN(val)) await saveMileageAmountOverride(event.id, payment.userId, 'mileage', val); setEditingMileageCell(null); }} className="text-[10px] text-green-600 hover:text-green-700 font-medium">Save</button>
                                            <button type="button" onClick={() => setEditingMileageCell(null)} className="text-[10px] text-gray-500">Cancel</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button type="button" onClick={() => { setEditingMileageCell({ eventId: event.id, userId: payment.userId, field: 'mileage' }); setEditingMileageValue(String(mileagePay.toFixed(2))); }} className="flex flex-col items-end gap-0.5 hover:text-blue-800" title="Click to edit">
                                          <span>{mileageOverrideS1 !== undefined ? <span className="text-orange-500">${formatVendorMoney(mileagePay)}<span className="text-[9px] ml-1">edited</span></span> : `$${formatVendorMoney(mileagePay)}`}</span>
                                          {diffMiles !== null && diffMiles > 0 && (
                                            <div className="text-[10px] text-gray-400">{diffMiles} mi diff x 2 x $0.71</div>
                                          )}
                                        </button>
                                      )
                                    ) : '\u2014'}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-right text-indigo-600">
                                    {(_mp > 0 || _tp > 0) ? (
                                      editingMileageCell?.eventId === event.id && editingMileageCell?.userId === payment.userId && editingMileageCell?.field === 'travel' ? (
                                        <div className="flex flex-col items-end gap-1">
                                          <div className="flex items-center gap-1">
                                            <span className="text-gray-500 text-xs">$</span>
                                            <input type="number" className="w-20 px-1 py-0.5 border rounded text-xs text-right" value={editingMileageValue} onChange={(e) => setEditingMileageValue(e.target.value)} step="0.01" min="0" autoFocus />
                                          </div>
                                          <div className="flex gap-1">
                                            <button type="button" onClick={async () => { const val = parseFloat(editingMileageValue); if (!isNaN(val)) await saveMileageAmountOverride(event.id, payment.userId, 'travel', val); setEditingMileageCell(null); }} className="text-[10px] text-green-600 hover:text-green-700 font-medium">Save</button>
                                            <button type="button" onClick={() => setEditingMileageCell(null)} className="text-[10px] text-gray-500">Cancel</button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex flex-col gap-0.5 items-end">
                                          {_tp > 0 ? (
                                            <button type="button" onClick={() => { setEditingMileageCell({ eventId: event.id, userId: payment.userId, field: 'travel' }); setEditingMileageValue(String(travelPay.toFixed(2))); }} className="flex flex-col items-end gap-0.5 hover:text-indigo-800" title="Click to edit">
                                              <span>{travelOverrideS1 !== undefined ? <span className="text-orange-500">${formatVendorMoney(travelPay)}<span className="text-[9px] ml-1">edited</span></span> : `$${formatVendorMoney(travelPay)}`}</span>
                                              {diffMiles !== null && diffMiles > 0 && (
                                                <div className="text-[10px] text-gray-400">{diffMiles} mi ÷ 30 × ${formatVendorMoney(Math.max(normalizeState(state ?? event?.state) === 'CA' ? 28.50 : 25.94, loadedRate))}/hr</div>
                                              )}
                                            </button>
                                          ) : <span className="text-gray-400">&mdash;</span>}
                                          <div className="flex gap-1 mt-0.5 justify-end">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setMileageApproval(event.id, payment.userId, 'mileage', true);
                                                setMileageApproval(event.id, payment.userId, 'travel', true);
                                                setMileagePayOverrides(prev => { const n = { ...prev }; if (n[event.id]) { const m = { ...n[event.id] }; delete m[payment.userId]; n[event.id] = m; } return n; });
                                                setTravelPayOverrides(prev => { const n = { ...prev }; if (n[event.id]) { const m = { ...n[event.id] }; delete m[payment.userId]; n[event.id] = m; } return n; });
                                              }}
                                              className={`text-[10px] px-1.5 py-0.5 rounded border ${(approval.mileage && approval.travel && mileageOverrideS1 === undefined && travelOverrideS1 === undefined) ? 'bg-green-100 border-green-400 text-green-700 font-semibold' : 'border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600'}`}
                                            >Approve</button>
                                          </div>
                                        </div>
                                      )
                                    ) : '\u2014'}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-right">
                                    {editingCell?.eventId === event.id && editingCell?.userId === payment.userId && editingCell?.column === 'reimbursement' ? (
                                      <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center justify-end gap-2">
                                          <span className="text-gray-500">$</span>
                                          <input type="number" className="w-24 px-2 py-1 border rounded text-sm" value={Number((reimbursementAmounts[event.id] ?? {})[payment.userId] ?? payment.reimbursementAmount ?? 0)} onChange={(e) => { const val = Number(e.target.value) || 0; setReimbursementAmounts(prev => ({ ...prev, [event.id]: { ...(prev[event.id] || {}), [payment.userId]: val } })); }} step="1" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button type="button" onClick={async () => { const saved = await saveAdjustment(event.id, payment.userId); if (saved) setEditingCell(null); }} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                          <button type="button" onClick={() => setEditingCell(null)} className="text-gray-500 hover:text-gray-600 text-xs">Cancel</button>
                                        </div>
                                      </div>
                                    ) : (() => { const v = reimbursementAmounts[event.id]?.[payment.userId] ?? Number(payment.reimbursementAmount || 0); return v !== 0 ? (
                                      <button type="button" className={`text-right ${v >= 0 ? 'text-green-600' : 'text-red-600'}`} onClick={() => setEditingCell({ eventId: event.id, userId: payment.userId, column: 'reimbursement' })} title="Click to edit">
                                        <div>{`$${formatVendorMoney(v)}`}</div>
                                      </button>
                                    ) : (
                                      <button type="button" className="text-gray-300 hover:text-gray-500 text-xs px-1" title="Add reimbursement" onClick={() => setEditingCell({ eventId: event.id, userId: payment.userId, column: 'reimbursement' })}>+</button>
                                    ); })()}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-right">
                                    {editingCell?.eventId === event.id && editingCell?.userId === payment.userId && editingCell?.column === 'other' ? (
                                      <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center justify-end gap-2">
                                          <span className="text-gray-500">$</span>
                                          <input type="number" className="w-24 px-2 py-1 border rounded text-sm" value={Number((adjustments[event.id] ?? {})[payment.userId] ?? payment.otherAmount ?? 0)} onChange={(e) => { const val = Number(e.target.value) || 0; setAdjustments(prev => ({ ...prev, [event.id]: { ...(prev[event.id] || {}), [payment.userId]: val } })); }} step="1" />
                                        </div>
                                        <select className="w-32 px-2 py-1 border rounded text-xs text-right" value={currentAdjustmentType} onChange={(e) => { const nextType = normalizeOtherAdjustmentType(e.target.value); setAdjustmentTypes(prev => ({ ...prev, [event.id]: { ...(prev[event.id] || {}), [payment.userId]: nextType } })); }}>
                                          <option value="meal_break">Meal Break Premium</option>
                                          <option value="bonus">Bonus</option>
                                        </select>
                                        <div className="flex items-center gap-2">
                                          <button type="button" onClick={async () => { const saved = await saveAdjustment(event.id, payment.userId); if (saved) setEditingCell(null); }} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                          <button type="button" onClick={() => setEditingCell(null)} className="text-gray-500 hover:text-gray-600 text-xs">Cancel</button>
                                        </div>
                                      </div>
                                    ) : (() => { const v = adjustments[event.id]?.[payment.userId] ?? Number(payment.otherAmount || 0); return v !== 0 ? (
                                      <button type="button" className={`text-right ${v >= 0 ? 'text-green-600' : 'text-red-600'}`} onClick={() => setEditingCell({ eventId: event.id, userId: payment.userId, column: 'other' })} title="Click to edit">
                                        <div>{`$${formatVendorMoney(v)}`}</div>
                                        <div className="text-[10px] text-gray-400">{currentAdjustmentTypeLabel}</div>
                                      </button>
                                    ) : (
                                      <button type="button" className="text-gray-300 hover:text-gray-500 text-xs px-1" title="Add other" onClick={() => setEditingCell({ eventId: event.id, userId: payment.userId, column: 'other' })}>+</button>
                                    ); })()}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-right font-semibold">${formatVendorMoney(rowTotal)}</td>
                                </tr>
                              );
                            })}
                            {showVendorCommissionColumns && (
                              <tr style={{ backgroundColor: '#f3e8ff' }} className="font-medium text-sm border-t border-purple-200">
                                <td className="px-4 py-2 uppercase tracking-wide text-purple-700" colSpan={3}>Variable Incentive</td>
                                <td className="px-4 py-2 text-right"></td>
                                {showVendorHourlyColumns && (
                                  <>
                                    <td className="px-4 py-2 text-right"></td>
                                    <td className="px-4 py-2 text-right"></td>
                                    <td className="px-4 py-2 text-right"></td>
                                  </>
                                )}
                                <td className="px-4 py-2 text-right"></td>
                                <td className="px-4 py-2 text-right text-purple-700">${formatVendorMoney(vendorTotals.totalVariableIncentive)}</td>
                                <td className="px-4 py-2 text-right"></td>
                                {showVendorRestBreakColumn && (
                                  <td className="px-4 py-2 text-right"></td>
                                )}
                                <td className="px-4 py-2 text-right"></td>
                                <td className="px-4 py-2 text-right"></td>
                                <td className="px-4 py-2 text-right"></td>
                                <td className="px-4 py-2 text-right"></td>
                                <td className="px-4 py-2 text-right"></td>
                              </tr>
                            )}
                            <tr style={{ backgroundColor: '#e5e7eb' }} className="font-semibold text-sm border-t-2 border-gray-400">
                              <td className="px-4 py-2 uppercase tracking-wide" colSpan={3}>Total</td>
                              <td className="px-4 py-2 text-right">{formatHoursDecimal(vendorTotals.totalHours)}</td>
                              {showVendorHourlyColumns && (
                                <>
                                  <td className="px-4 py-2 text-right text-gray-900">
                                    {vendorTotals.totalRegularHours > 0 || vendorTotals.totalRegularPay > 0
                                      ? `${formatHoursDecimal(vendorTotals.totalRegularHours)}h / $${formatVendorMoney(vendorTotals.totalRegularPay)}`
                                      : '\u2014'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-orange-600">
                                    {vendorTotals.totalOvertimeHours > 0 || vendorTotals.totalOvertimePay > 0
                                      ? `${formatHoursDecimal(vendorTotals.totalOvertimeHours)}h / $${formatVendorMoney(vendorTotals.totalOvertimePay)}`
                                      : '\u2014'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-rose-600">
                                    {vendorTotals.totalDoubletimeHours > 0 || vendorTotals.totalDoubletimePay > 0
                                      ? `${formatHoursDecimal(vendorTotals.totalDoubletimeHours)}h / $${formatVendorMoney(vendorTotals.totalDoubletimePay)}`
                                      : '\u2014'}
                                  </td>
                                </>
                              )}
                              {showVendorCommissionColumns && (
                                <>
                                  <td className="px-4 py-2 text-right text-blue-600">${formatVendorMoney(vendorTotals.totalCommissionPay)}</td>
                                  <td className="px-4 py-2 text-right text-gray-400">—</td>
                                </>
                              )}
                              <td className="px-4 py-2 text-right text-orange-600">${formatVendorMoney(vendorTotals.totalTips)}</td>
                              {showVendorRestBreakColumn && (
                                <td className="px-4 py-2 text-right text-green-600">${formatVendorMoney(vendorTotals.totalRestBreak)}</td>
                              )}
                              <td className="px-4 py-2 text-right text-blue-600">${formatVendorMoney(vendorTotals.totalMileagePay)}</td>
                              <td className="px-4 py-2 text-right text-indigo-600">${formatVendorMoney(vendorTotals.totalTravelPay)}</td>
                              <td className="px-4 py-2 text-right">${formatVendorMoney(vendorTotals.totalReimbursement)}</td>
                              <td className="px-4 py-2 text-right">${formatVendorMoney(vendorTotals.totalOther)}</td>
                              <td className="px-4 py-2 text-right">${formatVendorMoney(vendorDisplayedTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              ) : (
                paymentsByVenue.map(v => {
                  const venueDisplayedTotal = (v.events || []).reduce((sum: number, ev: any) => {
                    return sum + getDisplayedEventTotals(ev).totalGross;
                  }, 0);

                  return (
                  <div key={v.venue} className="apple-card">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{v.venue}</h3>
                        <p className="text-sm text-gray-500">{v.city || '—'}, {v.state || ''}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-gray-900">${formatPayrollMoney(venueDisplayedTotal)}</div>
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
                          {v.events.map(ev => {
                            const eventTotals = getDisplayedEventTotals(ev);
                            const eventHref = `/event-dashboard/${ev.id}?tab=hr${paymentsStartDate ? `&periodStart=${encodeURIComponent(paymentsStartDate)}` : ''}${paymentsEndDate ? `&periodEnd=${encodeURIComponent(paymentsEndDate)}` : ''}`;
                            return (
                            <>
                              <tr key={ev.id} className="bg-white">
                                <td className="px-4 py-2 text-sm text-gray-900">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Event</div>
                                  <div>
                                    <Link href={eventHref} className="text-blue-600 hover:text-blue-800 hover:underline">
                                      {ev.name}
                                    </Link>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-500">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Date</div>
                                  <div>{ev.date || '—'}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Hours</div>
                                  <div>{formatHoursDecimal(eventTotals.eventHours || 0)}</div>
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
                                  {Number(ev.totalTips || 0) > 0 && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const newEqual = !tipsEqualMode[ev.id];
                                        setTipsEqualMode(prev => ({ ...prev, [ev.id]: newEqual }));
                                        try {
                                          const { data: { session: s } } = await supabase.auth.getSession();
                                          await fetch(`/api/events/${ev.id}`, {
                                            method: 'PATCH',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              ...(s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : {}),
                                            },
                                            body: JSON.stringify({ tips_distribution_mode: newEqual ? 'equal' : 'prorated' }),
                                          });
                                        } catch { /* non-critical */ }
                                      }}
                                      className={`mt-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${tipsEqualMode[ev.id] ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600'}`}
                                    >
                                      {tipsEqualMode[ev.id] ? 'Equal' : 'Prorated'}
                                    </button>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total Rest Break</div>
                                  <div>${formatExactMoney(Number(eventTotals.totalRestBreak || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total Other</div>
                                  <div>${formatExactMoney(Number(eventTotals.totalOther || 0))}</div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-900 text-right">
                                  <div className="text-[10px] text-gray-400 uppercase keeping-wider">Total</div>
                                  <div>${formatExactMoney(Number(eventTotals.totalGross || 0))}</div>
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
                                            const isEventSD = ev?.isSanDiegoHourly === true || isSanDiegoRegion(ev);
                                            const hideRest = isEventSD;
                                            const showOT = st === "AZ" || st === "NY";
                                            return (
                                              <tr>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Reg Rate</th>
                                                {isEventSD ? (
                                                  <>
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Regular Time</th>
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Overtime</th>
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Double Time</th>
                                                  </>
                                                ) : (
                                                  <>
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Rate in Effect</th>
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                                                    {showOT && (
                                                      <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">OT Rate</th>
                                                    )}
                                                    <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Commission Pay</th>
                                                  </>
                                                )}
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Tips</th>
                                                {!hideRest && (
                                                  <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Rest Break</th>
                                                )}
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Mileage Pay</th>
                                                <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Travel Pay</th>
                                                <th className="p-2 text-right text-xs font-medium text-gray-500 uppercase">Reimbursement</th>
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
                                                const isEventSD = ev?.isSanDiegoHourly === true || isSanDiegoRegion(ev);
                                                const hideRest = isEventSD;
                                                const showOT = st === "AZ" || st === "NY";

                                                const breakdown = getDisplayedPaymentBreakdown(ev, p);
                                                const regRate = breakdown.regRate;
                                                const loadedRate = breakdown.rateInEffect;
                                                const hours = breakdown.hours;
                                                const otRate = Number(p.otRate || 0);
                                                const displayedCommissionPay = breakdown.commissionPaidTotal;
                                                const tips = getDisplayedTips(ev, p);
                                                const restBreak = hideRest ? 0 : Number(p.restBreak || 0);
                                                const _mileagePay = Number((mileageByEvent[ev.id] || {})[p.userId]?.mileagePay || 0);
                                                const differentialMiles = (mileageByEvent[ev.id] || {})[p.userId]?.differentialMiles ?? null;
                                                const _travelPay = differentialMiles !== null ? computeTravelPay(differentialMiles, ev?.state ?? v?.state, loadedRate) : 0;
                                                const approval = getMileageApproval(ev.id, p.userId);
                                                const mileageOverrideS2 = (mileagePayOverrides[ev.id] || {})[p.userId];
                                                const travelOverrideS2 = (travelPayOverrides[ev.id] || {})[p.userId];
                                                const mileagePay = mileageOverrideS2 !== undefined ? mileageOverrideS2 : (approval.mileage ? _mileagePay : 0);
                                                const travelPay = travelOverrideS2 !== undefined ? travelOverrideS2 : (approval.travel ? _travelPay : 0);
                                                const reimbursementForRow = reimbursementAmounts[ev.id]?.[p.userId] !== undefined ? Number(reimbursementAmounts[ev.id]?.[p.userId] || 0) : Number(p.reimbursementAmount || 0);
                                                const otherForRow = adjustments[ev.id]?.[p.userId] !== undefined ? Number(adjustments[ev.id]?.[p.userId] || 0) : Number(p.otherAmount || 0);
                                                const totalGrossPay =
                                                  breakdown.commissionPaidTotal +
                                                  tips +
                                                  restBreak +
                                                  reimbursementForRow +
                                                  otherForRow +
                                                  mileagePay +
                                                  travelPay;
                                                const currentAdjustmentType = normalizeOtherAdjustmentType(
                                                  ((adjustmentTypes[ev.id] ?? {})[p.userId] ?? p.adjustmentType ?? DEFAULT_OTHER_ADJUSTMENT_TYPE)
                                                );
                                                const currentAdjustmentTypeLabel = getOtherAdjustmentTypeLabel(currentAdjustmentType);

                                                return (
                                                  <>
                                                    <td className="p-2 text-sm">${formatPayrollMoney(regRate)}/hr</td>
                                                    {isEventSD ? (
                                                      <>
                                                        <td className="p-2 text-sm">{formatHoursDecimal(hours)}</td>
                                                        <td className="p-2 text-sm text-gray-900">{`${formatHoursDecimal(breakdown.regularHours)}h / $${formatPayrollMoney(breakdown.regularPay)}`}</td>
                                                        <td className="p-2 text-sm text-orange-600">{`${formatHoursDecimal(breakdown.overtimeHours)}h / $${formatPayrollMoney(breakdown.overtimePay)}`}</td>
                                                        <td className="p-2 text-sm text-rose-600">{`${formatHoursDecimal(breakdown.doubletimeHours)}h / $${formatPayrollMoney(breakdown.doubletimePay)}`}</td>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <td className="p-2 text-sm">${formatPayrollMoney(loadedRate)}/hr</td>
                                                        <td className="p-2 text-sm">{formatHoursDecimal(hours)}</td>
                                                        {showOT && (
                                                          <td className="p-2 text-sm">{otRate > 0 ? `$${formatPayrollMoney(otRate)}/hr` : '\u2014'}</td>
                                                        )}
                                                        <td className="p-2 text-sm text-blue-600">${formatPayrollMoney(displayedCommissionPay)}</td>
                                                      </>
                                                    )}
                                                    <td className="p-2 text-sm text-orange-600">${formatPayrollMoney(tips)}</td>
                                                    {!hideRest && (
                                                      <td className="p-2 text-sm text-green-600">${formatPayrollMoney(restBreak)}</td>
                                                    )}
                                                    <td className="p-2 text-sm text-blue-600">
                                                      {_mileagePay > 0 ? (
                                                        editingMileageCell?.eventId === ev.id && editingMileageCell?.userId === p.userId && editingMileageCell?.field === 'mileage' ? (
                                                          <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-1">
                                                              <span className="text-gray-500 text-xs">$</span>
                                                              <input type="number" className="w-20 px-1 py-0.5 border rounded text-xs" value={editingMileageValue} onChange={(e) => setEditingMileageValue(e.target.value)} step="0.01" min="0" autoFocus />
                                                            </div>
                                                            <div className="flex gap-1">
                                                              <button type="button" onClick={async () => { const val = parseFloat(editingMileageValue); if (!isNaN(val)) await saveMileageAmountOverride(ev.id, p.userId, 'mileage', val); setEditingMileageCell(null); }} className="text-[10px] text-green-600 hover:text-green-700 font-medium">Save</button>
                                                              <button type="button" onClick={() => setEditingMileageCell(null)} className="text-[10px] text-gray-500">Cancel</button>
                                                            </div>
                                                          </div>
                                                        ) : (
                                                          <button type="button" onClick={() => { setEditingMileageCell({ eventId: ev.id, userId: p.userId, field: 'mileage' }); setEditingMileageValue(String(mileagePay.toFixed(2))); }} className="flex flex-col gap-0.5 hover:text-blue-800 text-left" title="Click to edit">
                                                            {mileageOverrideS2 !== undefined ? <span className="text-orange-500">${formatPayrollMoney(mileagePay)}<span className="text-[9px] ml-1">edited</span></span> : <span>${formatPayrollMoney(mileagePay)}</span>}
                                                            {(() => { const md = (mileageByEvent[ev.id] || {})[p.userId]; return md?.differentialMiles != null && md.differentialMiles > 0 ? <div className="text-[10px] text-gray-400">{md.differentialMiles} mi diff ? 2 ? $0.71</div> : null; })()}
                                                          </button>
                                                        )
                                                      ) : '\u2014'}
                                                    </td>
                                                    <td className="p-2 text-sm text-indigo-600">
                                                      {(_mileagePay > 0 || _travelPay > 0) ? (
                                                        editingMileageCell?.eventId === ev.id && editingMileageCell?.userId === p.userId && editingMileageCell?.field === 'travel' ? (
                                                          <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-1">
                                                              <span className="text-gray-500 text-xs">$</span>
                                                              <input type="number" className="w-20 px-1 py-0.5 border rounded text-xs" value={editingMileageValue} onChange={(e) => setEditingMileageValue(e.target.value)} step="0.01" min="0" autoFocus />
                                                            </div>
                                                            <div className="flex gap-1">
                                                              <button type="button" onClick={async () => { const val = parseFloat(editingMileageValue); if (!isNaN(val)) await saveMileageAmountOverride(ev.id, p.userId, 'travel', val); setEditingMileageCell(null); }} className="text-[10px] text-green-600 hover:text-green-700 font-medium">Save</button>
                                                              <button type="button" onClick={() => setEditingMileageCell(null)} className="text-[10px] text-gray-500">Cancel</button>
                                                            </div>
                                                          </div>
                                                        ) : (
                                                          <div className="flex flex-col gap-0.5">
                                                            {_travelPay > 0 ? (
                                                              <button type="button" onClick={() => { setEditingMileageCell({ eventId: ev.id, userId: p.userId, field: 'travel' }); setEditingMileageValue(String(travelPay.toFixed(2))); }} className="flex flex-col gap-0.5 hover:text-indigo-800 text-left" title="Click to edit">
                                                                {travelOverrideS2 !== undefined ? <span className="text-orange-500">${formatPayrollMoney(travelPay)}<span className="text-[9px] ml-1">edited</span></span> : <span>${formatPayrollMoney(travelPay)}</span>}
                                                                {differentialMiles !== null && differentialMiles > 0 && <div className="text-[10px] text-gray-400">{differentialMiles} mi ÷ 30 × ${formatPayrollMoney(Math.max(normalizeState(ev?.state ?? v?.state) === 'CA' ? 28.50 : 25.94, loadedRate))}/hr</div>}
                                                              </button>
                                                            ) : <span className="text-gray-400">&mdash;</span>}
                                                            <div className="flex gap-1 mt-0.5">
                                                              <button type="button" onClick={() => { setMileageApproval(ev.id, p.userId, 'mileage', true); setMileageApproval(ev.id, p.userId, 'travel', true); setMileagePayOverrides(prev => { const n = { ...prev }; if (n[ev.id]) { const m = { ...n[ev.id] }; delete m[p.userId]; n[ev.id] = m; } return n; }); setTravelPayOverrides(prev => { const n = { ...prev }; if (n[ev.id]) { const m = { ...n[ev.id] }; delete m[p.userId]; n[ev.id] = m; } return n; }); }} className={`text-[10px] px-1.5 py-0.5 rounded border ${(approval.mileage && approval.travel && mileageOverrideS2 === undefined && travelOverrideS2 === undefined) ? 'bg-green-100 border-green-400 text-green-700 font-semibold' : 'border-gray-300 text-gray-400 hover:border-green-400 hover:text-green-600'}`}>? Approve</button>
                                                            </div>
                                                          </div>
                                                        )
                                                      ) : '\u2014'}
                                                    </td>
                                                    <td className="p-2 text-sm text-right">
                                                      {editingCell?.eventId === ev.id && editingCell?.userId === p.userId && editingCell?.column === 'reimbursement' ? (
                                                        <div className="flex flex-col items-end gap-1">
                                                          <div className="flex items-center justify-end gap-2">
                                                            <span className="text-gray-500">$</span>
                                                            <input type="number" className="w-24 px-2 py-1 border rounded text-sm" value={Number((reimbursementAmounts[ev.id] ?? {})[p.userId] ?? p.reimbursementAmount ?? 0)} onChange={(e) => { const val = Number(e.target.value) || 0; setReimbursementAmounts(prev => ({ ...prev, [ev.id]: { ...(prev[ev.id] || {}), [p.userId]: val } })); }} step="1" />
                                                          </div>
                                                          <div className="flex items-center gap-2">
                                                            <button type="button" onClick={async () => { const saved = await saveAdjustment(ev.id, p.userId); if (saved) setEditingCell(null); }} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                                            <button type="button" onClick={() => setEditingCell(null)} className="text-gray-500 hover:text-gray-600 text-xs">Cancel</button>
                                                          </div>
                                                        </div>
                                                      ) : (() => { const v = reimbursementAmounts[ev.id]?.[p.userId] ?? Number(p.reimbursementAmount || 0); return v !== 0 ? (
                                                        <button type="button" className={`text-right ${v >= 0 ? 'text-green-600' : 'text-red-600'}`} onClick={() => setEditingCell({ eventId: ev.id, userId: p.userId, column: 'reimbursement' })} title="Click to edit">
                                                          <div>{`$${formatPayrollMoney(v)}`}</div>
                                                        </button>
                                                      ) : (
                                                        <button type="button" className="text-gray-300 hover:text-gray-500 text-xs px-1" title="Add reimbursement" onClick={() => setEditingCell({ eventId: ev.id, userId: p.userId, column: 'reimbursement' })}>+</button>
                                                      ); })()}
                                                    </td>
                                                    <td className="p-2 text-sm text-right">
                                                      {editingCell?.eventId === ev.id && editingCell?.userId === p.userId && editingCell?.column === 'other' ? (
                                                        <div className="flex flex-col items-end gap-1">
                                                          <div className="flex items-center justify-end gap-2">
                                                            <span className="text-gray-500">$</span>
                                                            <input type="number" className="w-24 px-2 py-1 border rounded text-sm" value={Number((adjustments[ev.id] ?? {})[p.userId] ?? p.otherAmount ?? 0)} onChange={(e) => { const val = Number(e.target.value) || 0; setAdjustments(prev => ({ ...prev, [ev.id]: { ...(prev[ev.id] || {}), [p.userId]: val } })); }} step="1" />
                                                          </div>
                                                          <select className="w-32 px-2 py-1 border rounded text-xs text-right" value={currentAdjustmentType} onChange={(e) => { const nextType = normalizeOtherAdjustmentType(e.target.value); setAdjustmentTypes(prev => ({ ...prev, [ev.id]: { ...(prev[ev.id] || {}), [p.userId]: nextType } })); }}>
                                                            <option value="meal_break">Meal Break Premium</option>
                                                            <option value="bonus">Bonus</option>
                                                          </select>
                                                          <div className="flex items-center gap-2">
                                                            <button type="button" onClick={async () => { const saved = await saveAdjustment(ev.id, p.userId); if (saved) setEditingCell(null); }} className="text-green-600 hover:text-green-700 text-xs font-medium">Save</button>
                                                            <button type="button" onClick={() => setEditingCell(null)} className="text-gray-500 hover:text-gray-600 text-xs">Cancel</button>
                                                          </div>
                                                        </div>
                                                      ) : (() => { const v = adjustments[ev.id]?.[p.userId] ?? Number(p.otherAmount || 0); return v !== 0 ? (
                                                        <button type="button" className={`text-right ${v >= 0 ? 'text-green-600' : 'text-red-600'}`} onClick={() => setEditingCell({ eventId: ev.id, userId: p.userId, column: 'other' })} title="Click to edit">
                                                          <div>{`$${formatPayrollMoney(v)}`}</div>
                                                          <div className="text-[10px] text-gray-400">{currentAdjustmentTypeLabel}</div>
                                                        </button>
                                                      ) : (
                                                        <button type="button" className="text-gray-300 hover:text-gray-500 text-xs px-1" title="Add other" onClick={() => setEditingCell({ eventId: ev.id, userId: p.userId, column: 'other' })}>+</button>
                                                      ); })()}
                                                    </td>
                                                    <td className="p-2 text-sm font-semibold text-right">${formatExactMoney(totalGrossPay)}</td>
                                                  </>
                                                );
                                              })()}
                                            </tr>
                                          ))}
                                          {(() => {
                                            const st = normalizeState(ev.state || v.state);
                                            const isEventSD = ev?.isSanDiegoHourly === true || isSanDiegoRegion(ev);
                                            const hideRest = isEventSD;
                                            const showOT = st === "AZ" || st === "NY";
                                            const eventTotals = getDisplayedEventTotals(ev);
                                            return (
                                              <tr style={{ backgroundColor: '#e5e7eb' }} className="font-semibold text-sm border-t-2 border-gray-400">
                                                <td className="p-2 uppercase tracking-wide">Total</td>
                                                <td className="p-2"></td>
                                                {isEventSD ? (
                                                  <>
                                                    <td className="p-2">{formatHoursDecimal(eventTotals.eventHours)}</td>
                                                    <td className="p-2 text-gray-900">{`${formatHoursDecimal(eventTotals.totalRegularHours)}h / $${formatPayrollMoney(eventTotals.totalRegularPay)}`}</td>
                                                    <td className="p-2 text-orange-600">{`${formatHoursDecimal(eventTotals.totalOvertimeHours)}h / $${formatPayrollMoney(eventTotals.totalOvertimePay)}`}</td>
                                                    <td className="p-2 text-rose-600">{`${formatHoursDecimal(eventTotals.totalDoubletimeHours)}h / $${formatPayrollMoney(eventTotals.totalDoubletimePay)}`}</td>
                                                  </>
                                                ) : (
                                                  <>
                                                    <td className="p-2"></td>
                                                    <td className="p-2">{formatHoursDecimal(eventTotals.eventHours)}</td>
                                                    {showOT && <td className="p-2"></td>}
                                                    <td className="p-2 text-green-600">${formatExactMoney(eventTotals.totalCommissionPaid)}</td>
                                                  </>
                                                )}
                                                <td className="p-2 text-orange-600">${formatPayrollMoney(eventTotals.totalTips)}</td>
                                                {!hideRest && <td className="p-2 text-green-600">${formatPayrollMoney(eventTotals.totalRestBreak)}</td>}
                                                <td className="p-2 text-blue-600">${formatPayrollMoney(eventTotals.totalMileagePay)}</td>
                                                <td className="p-2 text-indigo-600">${formatPayrollMoney(eventTotals.totalTravelPay)}</td>
                                                <td className="p-2 text-right">${formatPayrollMoney(eventTotals.totalReimbursement)}</td>
                                                <td className="p-2 text-right">${formatPayrollMoney(eventTotals.totalOther)}</td>
                                                <td className="p-2 text-right">${formatExactMoney(eventTotals.totalGross)}</td>
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
                          )})}
                          <tr key="venue-totals" style={{ backgroundColor: '#e5e7eb' }} className="font-semibold text-sm border-t-2 border-gray-400">
                            <td className="px-4 py-2 text-gray-900 uppercase tracking-wide">Total</td>
                            <td className="px-4 py-2"></td>
                            <td className="px-4 py-2 text-gray-900 text-right">{v.events.reduce((s: number, ev: any) => s + getDisplayedEventTotals(ev).eventHours, 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.adjustedGrossAmount || 0), 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + Number(ev.commissionDollars || 0), 0))}</td>
                            <td className="px-4 py-2"></td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + getDisplayedEventTotals(ev).totalTips, 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + getDisplayedEventTotals(ev).totalRestBreak, 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + getDisplayedEventTotals(ev).totalReimbursement, 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + getDisplayedEventTotals(ev).totalOther, 0))}</td>
                            <td className="px-4 py-2 text-gray-900 text-right">${formatExactMoney(v.events.reduce((s: number, ev: any) => s + getDisplayedEventTotals(ev).totalGross, 0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )})
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
                <button
                  onClick={() => { setConvertSalariedError(''); setConvertSalariedSuccess(''); setShowConvertSalariedModal(true); }}
                  className="apple-button apple-button-secondary"
                >
                  Convert Existing to Salaried
                </button>
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

                <label className="apple-label" htmlFor="employee-status-filter">Status</label>
                <select
                  id="employee-status-filter"
                  value={selectedEmployeeStatus}
                  onChange={(e) => handleEmployeeStatusChange(e.target.value as EmployeeStatusFilter)}
                  disabled={loadingEmployees}
                  className="apple-select min-w-[12rem]"
                  title="Filter employees by activation status"
                >
                  <option value="active">Active Only</option>
                  <option value="inactive">Deactivated Only</option>
                  <option value="all">Active + Deactivated</option>
                </select>

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

                {(selectedEmployeeStatus !== 'active' || selectedState !== 'all' || selectedEmployeeRegion !== 'all') && (
                  <button
                    onClick={resetEmployeeFilters}
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
                <div key={e.id} className="relative group">
                  <Link href={`/hr/employees/${e.id}`} className="block">
                    <div className="apple-card p-6 hover:shadow-lg transition-shadow group-hover:translate-y-[-1px]">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold shrink-0">
                          {firstName?.[0] || 'E'}{lastName?.[0] || ''}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-lg font-semibold text-gray-900 truncate">
                              {firstName} {lastName}
                            </h3>
                            <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
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
                  {/* Edit salary button — sits outside the Link so it doesn't navigate */}
                  <button
                    type="button"
                    onClick={() => {
                      setConvertSalariedForm({
                        userId: e.id,
                        annualSalary: Number(e.salary) > 0 ? String(e.salary) : '',
                        department: e.department || '',
                        position: e.position || '',
                        effectiveDate: new Date().toISOString().slice(0, 10),
                      });
                      setConvertSalariedSearch(`${firstName} ${lastName}`.trim());
                      setConvertSalariedError('');
                      setConvertSalariedSuccess('');
                      setShowConvertSalariedModal(true);
                    }}
                    className="absolute bottom-4 right-4 text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors shadow-sm"
                    title={Number(e.salary) > 0 ? 'Edit salary' : 'Set as salaried'}
                  >
                    {Number(e.salary) > 0 ? 'Edit Salary' : '+ Salary'}
                  </button>
                </div>
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

            {/* Create Salaried User Modal — moved to /signup page */}
            {false && showCreateSalariedModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-gray-900">Create Salaried User</h2>
                    <button
                      onClick={() => { setShowCreateSalariedModal(false); setCreateSalariedError(''); setCreateSalariedSuccess(''); }}
                      className="text-gray-400 hover:text-gray-600 transition-colors text-2xl leading-none"
                      aria-label="Close"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="apple-label" htmlFor="cs-first-name">First Name <span className="text-red-500">*</span></label>
                      <input
                        id="cs-first-name"
                        type="text"
                        value={createSalariedForm.firstName}
                        onChange={e => setCreateSalariedForm(f => ({ ...f, firstName: e.target.value }))}
                        className="apple-select w-full"
                        placeholder="First name"
                      />
                    </div>
                    <div>
                      <label className="apple-label" htmlFor="cs-last-name">Last Name <span className="text-red-500">*</span></label>
                      <input
                        id="cs-last-name"
                        type="text"
                        value={createSalariedForm.lastName}
                        onChange={e => setCreateSalariedForm(f => ({ ...f, lastName: e.target.value }))}
                        className="apple-select w-full"
                        placeholder="Last name"
                      />
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="apple-label" htmlFor="cs-email">Email <span className="text-red-500">*</span></label>
                    <input
                      id="cs-email"
                      type="email"
                      value={createSalariedForm.email}
                      onChange={e => setCreateSalariedForm(f => ({ ...f, email: e.target.value }))}
                      className="apple-select w-full"
                      placeholder="user@example.com"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="apple-label" htmlFor="cs-role">Role <span className="text-red-500">*</span></label>
                      <select
                        id="cs-role"
                        value={createSalariedForm.role}
                        onChange={e => setCreateSalariedForm(f => ({ ...f, role: e.target.value as any }))}
                        className="apple-select w-full"
                      >
                        <option value="worker">Worker</option>
                        <option value="manager">Manager</option>
                        <option value="finance">Finance</option>
                        <option value="exec">Executive</option>
                        <option value="hr">HR</option>
                      </select>
                    </div>
                    <div>
                      <label className="apple-label" htmlFor="cs-division">Division <span className="text-red-500">*</span></label>
                      <select
                        id="cs-division"
                        value={createSalariedForm.division}
                        onChange={e => setCreateSalariedForm(f => ({ ...f, division: e.target.value as any }))}
                        className="apple-select w-full"
                      >
                        <option value="vendor">Vendor</option>
                        <option value="trailers">Trailers</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="apple-label" htmlFor="cs-salary">Annual Salary ($) <span className="text-red-500">*</span></label>
                    <input
                      id="cs-salary"
                      type="number"
                      min="0"
                      step="1000"
                      value={createSalariedForm.annualSalary}
                      onChange={e => setCreateSalariedForm(f => ({ ...f, annualSalary: e.target.value }))}
                      className="apple-select w-full"
                      placeholder="e.g. 55000"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="apple-label" htmlFor="cs-department">Department</label>
                      <input
                        id="cs-department"
                        type="text"
                        value={createSalariedForm.department}
                        onChange={e => setCreateSalariedForm(f => ({ ...f, department: e.target.value }))}
                        className="apple-select w-full"
                        placeholder="e.g. Operations"
                      />
                    </div>
                    <div>
                      <label className="apple-label" htmlFor="cs-position">Position</label>
                      <input
                        id="cs-position"
                        type="text"
                        value={createSalariedForm.position}
                        onChange={e => setCreateSalariedForm(f => ({ ...f, position: e.target.value }))}
                        className="apple-select w-full"
                        placeholder="e.g. Coordinator"
                      />
                    </div>
                  </div>

                  {createSalariedError && (
                    <div className="apple-alert apple-alert-error mb-4">{createSalariedError}</div>
                  )}
                  {createSalariedSuccess && (
                    <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm mb-4">{createSalariedSuccess}</div>
                  )}

                  <div className="flex gap-3 justify-end">
                    <button
                      onClick={() => { setShowCreateSalariedModal(false); setCreateSalariedError(''); setCreateSalariedSuccess(''); }}
                      className="apple-button apple-button-secondary"
                      disabled={createSalariedLoading}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitCreateSalariedUser}
                      className={`apple-button ${createSalariedLoading ? 'apple-button-disabled' : 'apple-button-primary'}`}
                      disabled={createSalariedLoading}
                    >
                      {createSalariedLoading ? 'Creating…' : 'Create & Send Invite'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Convert Existing User to Salaried Modal */}
            {showConvertSalariedModal && (() => {
              const search = convertSalariedSearch.trim().toLowerCase();
              const filteredEmployees = (employees || [])
                .filter((e: any) => {
                  if (!search) return true;
                  const fullName = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
                  return fullName.includes(search) || (e.email || '').toLowerCase().includes(search);
                })
                .slice(0, 50);
              const selectedEmployee = (employees || []).find((e: any) => e.id === convertSalariedForm.userId);
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                  <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">Convert Existing User to Salaried</h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Sets annual salary on an existing employee. Upserts on user — re-running updates the salary.
                        </p>
                      </div>
                      <button
                        onClick={() => { setShowConvertSalariedModal(false); setConvertSalariedError(''); setConvertSalariedSuccess(''); }}
                        className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    <div className="mb-4">
                      <label className="apple-label" htmlFor="conv-search">Employee <span className="text-red-500">*</span></label>
                      <input
                        id="conv-search"
                        type="text"
                        value={convertSalariedSearch}
                        onChange={e => setConvertSalariedSearch(e.target.value)}
                        className="apple-select w-full"
                        placeholder="Search by name or email…"
                      />
                      <div className="mt-2 border border-gray-200 rounded-xl max-h-48 overflow-y-auto">
                        {filteredEmployees.length === 0 ? (
                          <p className="text-sm text-gray-500 px-3 py-2">No matching employees.</p>
                        ) : filteredEmployees.map((e: any) => {
                          const isSelected = e.id === convertSalariedForm.userId;
                          const name = `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email || e.id;
                          const currentSalary = Number(e.salary || 0);
                          return (
                            <button
                              key={e.id}
                              type="button"
                              onClick={() => setConvertSalariedForm(f => ({ ...f, userId: e.id }))}
                              className={`block w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
                            >
                              <span className="font-medium">{name}</span>
                              {e.email && <span className="text-gray-500 ml-2">{e.email}</span>}
                              {currentSalary > 0 && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                                  Salaried · ${currentSalary.toLocaleString()}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {selectedEmployee && (
                        <p className="mt-2 text-xs text-gray-500">
                          Selected: <span className="font-medium text-gray-700">{`${selectedEmployee.first_name || ''} ${selectedEmployee.last_name || ''}`.trim() || selectedEmployee.email}</span>
                        </p>
                      )}
                    </div>

                    <div className="mb-4">
                      <label className="apple-label" htmlFor="conv-salary">Annual Salary ($) <span className="text-red-500">*</span></label>
                      <input
                        id="conv-salary"
                        type="number"
                        min="0"
                        step="1000"
                        value={convertSalariedForm.annualSalary}
                        onChange={e => setConvertSalariedForm(f => ({ ...f, annualSalary: e.target.value }))}
                        className="apple-select w-full"
                        placeholder="e.g. 55000"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="apple-label" htmlFor="conv-department">Department</label>
                        <input
                          id="conv-department"
                          type="text"
                          value={convertSalariedForm.department}
                          onChange={e => setConvertSalariedForm(f => ({ ...f, department: e.target.value }))}
                          className="apple-select w-full"
                          placeholder="e.g. Operations"
                        />
                      </div>
                      <div>
                        <label className="apple-label" htmlFor="conv-position">Position</label>
                        <input
                          id="conv-position"
                          type="text"
                          value={convertSalariedForm.position}
                          onChange={e => setConvertSalariedForm(f => ({ ...f, position: e.target.value }))}
                          className="apple-select w-full"
                          placeholder="e.g. Coordinator"
                        />
                      </div>
                    </div>

                    <div className="mb-6">
                      <label className="apple-label" htmlFor="conv-effective">Effective Date</label>
                      <input
                        id="conv-effective"
                        type="date"
                        value={convertSalariedForm.effectiveDate}
                        onChange={e => setConvertSalariedForm(f => ({ ...f, effectiveDate: e.target.value }))}
                        className="apple-select w-full"
                      />
                    </div>

                    {convertSalariedError && (
                      <div className="apple-alert apple-alert-error mb-4">{convertSalariedError}</div>
                    )}
                    {convertSalariedSuccess && (
                      <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm mb-4">{convertSalariedSuccess}</div>
                    )}

                    <div className="flex gap-3 justify-end">
                      <button
                        onClick={() => { setShowConvertSalariedModal(false); setConvertSalariedError(''); setConvertSalariedSuccess(''); }}
                        className="apple-button apple-button-secondary"
                        disabled={convertSalariedLoading}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={submitConvertExistingToSalaried}
                        className={`apple-button ${convertSalariedLoading ? 'apple-button-disabled' : 'apple-button-primary'}`}
                        disabled={convertSalariedLoading}
                      >
                        {convertSalariedLoading ? 'Saving…' : 'Save Salary'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {hrView === "sickleave" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Sick Leave Management</h2>
              <button
                onClick={() => loadSickLeaves(appliedSickLeavePeriod)}
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

                <div className="flex flex-wrap items-end gap-3 ml-auto">
                  <div>
                    <label className="apple-label" htmlFor="sick-leave-period-start">Earned Hours From</label>
                    <input
                      id="sick-leave-period-start"
                      type="date"
                      value={sickLeavePeriodStart}
                      onChange={(e) => setSickLeavePeriodStart(e.target.value)}
                      className="apple-input min-w-[10rem]"
                    />
                  </div>
                  <div>
                    <label className="apple-label" htmlFor="sick-leave-period-end">Earned Hours To</label>
                    <input
                      id="sick-leave-period-end"
                      type="date"
                      value={sickLeavePeriodEnd}
                      onChange={(e) => setSickLeavePeriodEnd(e.target.value)}
                      className="apple-input min-w-[10rem]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplySickLeavePeriod}
                    disabled={loadingSickLeaves}
                    className="apple-button apple-button-primary"
                  >
                    Apply Period
                  </button>
                  <button
                    type="button"
                    onClick={handleClearSickLeavePeriod}
                    disabled={loadingSickLeaves || !hasAppliedSickLeavePeriod}
                    className="apple-button apple-button-secondary"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {hasAppliedSickLeavePeriod && (
                <p className="mt-3 text-sm text-gray-500">
                  Showing employees with earned sick leave activity from{" "}
                  <span className="font-medium text-gray-700">
                    {appliedSickLeavePeriod.start
                      ? formatSickLeaveDate(appliedSickLeavePeriod.start)
                      : "the beginning"}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium text-gray-700">
                    {appliedSickLeavePeriod.end
                      ? formatSickLeaveDate(appliedSickLeavePeriod.end)
                      : "today"}
                  </span>
                  .
                </p>
              )}
            </div>

            {sickLeavesError && (
              <div className="apple-error-banner">{sickLeavesError}</div>
            )}

            {hasAppliedSickLeavePeriod && sickLeavePeriodTotals && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="apple-card p-5">
                  <p className="text-sm text-sky-700">Employees In Period</p>
                  <p className="text-3xl font-semibold text-sky-700">{sickLeavePeriodTotals.employees}</p>
                </div>
                <div className="apple-card p-5">
                  <p className="text-sm text-cyan-700">Worked Hours In Period</p>
                  <p className="text-3xl font-semibold text-cyan-700">
                    {formatSickLeaveHours(sickLeavePeriodTotals.totalWorkedHours)}
                  </p>
                </div>
                <div className="apple-card p-5">
                  <p className="text-sm text-blue-700">Earned Hours In Period</p>
                  <p className="text-3xl font-semibold text-blue-700">
                    {formatSickLeaveHours(sickLeavePeriodTotals.totalEarnedHours)}
                  </p>
                </div>
              </div>
            )}

            <div className="apple-card overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 uppercase keeping-wider">Employee Sick Leave Balances</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Users with earned hours, calculated as 1 hour per 30 worked.
                  {hasAppliedSickLeavePeriod ? " Period columns reflect the selected date range." : ""}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Employee</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Carry Over</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Year to Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Worked</th>
                      {hasAppliedSickLeavePeriod && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Worked In Period</th>
                      )}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Earned</th>
                      {hasAppliedSickLeavePeriod && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Earned In Period</th>
                      )}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Requested</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Balance</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Requests</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {loadingSickLeaves && (
                      <tr>
                        <td colSpan={sickLeaveAccrualColumnCount} className="px-4 py-8 text-center text-sm text-gray-500">
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
                        {hasAppliedSickLeavePeriod && (
                          <td className="px-4 py-3 align-top text-sm text-sky-700">
                            {formatSickLeaveHours(Number(record.period_worked_hours || 0))}
                          </td>
                        )}
                        <td className="px-4 py-3 align-top text-sm text-indigo-700 font-semibold">
                          {formatSickLeaveHours(record.accrued_hours)}
                        </td>
                        {hasAppliedSickLeavePeriod && (
                          <td className="px-4 py-3 align-top text-sm text-blue-700 font-semibold">
                            {formatSickLeaveHours(Number(record.period_earned_hours || 0))}
                          </td>
                        )}
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
                              {addingUsedHoursUserId === record.user_id ? "Adding..." : "Add Requested Hours"}
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
                              {removingUsedHoursUserId === record.user_id ? "Removing..." : "Take Away Requested Hours"}
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
                        <td colSpan={sickLeaveAccrualColumnCount} className="px-4 py-12 text-center text-sm text-gray-500">
                          No employees with earned sick leave hours match the current filters.
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
