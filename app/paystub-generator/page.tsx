'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { PDFDocument } from 'pdf-lib';

interface PaymentData {
  effective_hours?: number | null;
  actual_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  doubletime_hours: number | null;
  regular_pay: number | null;
  overtime_pay: number | null;
  doubletime_pay: number | null;
  commissions: number | null;
  variable_incentive: number | null;
  rest_break_pay: number | null;
  travel_pay: number | null;
  tips: number | null;
  total_pay: number | null;
}

interface Worker {
  user_id: string;
  user_name: string;
  user_email: string;
  division?: string | null;
  phone?: string;
  address?: string;
  status: string;
  payment_data: PaymentData | null;
  worked_hours?: number;
  adjustment_amount?: number;
}

interface EventPaymentSummary {
  net_sales?: number | null;
  commission_pool_dollars?: number | null;
  commission_pool_percent?: number | null;
  total_tips?: number | null;
  base_rate?: number | null;
}

interface Event {
  id: string;
  name: string;
  event_name?: string | null;
  artist: string | null;
  venue: string;
  event_type: string;
  event_date: string;
  city: string | null;
  state: string | null;
  commission_pool?: number | null;
  tips?: number | null;
  ticket_sales?: number | null;
  tax_rate_percent?: number | null;
  event_payment?: EventPaymentSummary | null;
  workers?: Worker[];
}

type ImportedEmployeeRow = {
  rowIndex: number;
  employeeName: string;
  ssn: string;
  address: string;
  employeeId: string;

  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;

  // Deductions
  federalIncome: string;
  socialSecurity: string;
  medicare: string;
  stateIncome: string;
  stateDI: string;
  state: string;

  // Other
  miscDeduction: string;
  miscReimbursement: string;

  matchedUserId: string | null;
  matchError?: string;
};

interface SickLeaveBalance {
  total_hours: number;
  total_days: number;
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  balance_hours: number;
  balance_days: number;
}

interface FinalPayEvent {
  eventId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  city: string | null;
  state: string | null;
  actualHours: number;
  regularPay: number;
  overtimePay: number;
  doubletimePay: number;
  commissions: number;
  tips: number;
  totalPay: number;
  adjustmentAmount: number;
  adjustmentType: string | null;
  finalPay: number;
}

interface FinalPayTotals {
  commissions: number;
  tips: number;
  totalPay: number;
  finalPay: number;
}

export default function PaystubGenerator() {
  const [formData, setFormData] = useState({
    // Employee Information
    employeeName: '',
    ssn: '',
    address: '',
    employeeId: '',

    // Pay Period Information
    payPeriodStart: '',
    payPeriodEnd: '',
    payDate: '',

    // Earnings
    regularHours: '',
    regularRate: '',
    overtimeHours: '',
    overtimeRate: '',
    doubleTimeHours: '',
    doubleTimeRate: '',

    // Deductions
    federalIncome: '',
    socialSecurity: '',
    medicare: '',
    stateIncome: '',
    stateDI: '',
    state: 'CA',

    // Other
    miscDeduction: '',
    miscReimbursement: '',
  });

  const [generating, setGenerating] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [matchedUserId, setMatchedUserId] = useState<string | null>(null);
  const [importedEmployees, setImportedEmployees] = useState<ImportedEmployeeRow[]>([]);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [sickLeave, setSickLeave] = useState<SickLeaveBalance | null>(null);
  const [sickLeaveLoading, setSickLeaveLoading] = useState(false);
  const [sickLeaveError, setSickLeaveError] = useState<string | null>(null);

  // Per-employee meal premium & sick overrides (keyed by matchedUserId)
  const [employeeOverrides, setEmployeeOverrides] = useState<Record<string, { mealPremium: string; sick: string }>>({});

  const getOverride = (userId: string) => employeeOverrides[userId] ?? { mealPremium: '', sick: '' };
  const setOverride = (userId: string, field: 'mealPremium' | 'sick', value: string) =>
    setEmployeeOverrides(prev => ({
      ...prev,
      [userId]: { ...getOverride(userId), [field]: value },
    }));

  // Final Pay from HR Dashboard
  const [finalPayEvents, setFinalPayEvents] = useState<FinalPayEvent[]>([]);
  const [finalPayTotals, setFinalPayTotals] = useState<FinalPayTotals | null>(null);
  const [finalPayLoading, setFinalPayLoading] = useState(false);
  const [finalPayError, setFinalPayError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const normalizeState = (s: any) => (s || '').toString().toUpperCase().trim();
  const normalizeStateCode = (s: any) => {
    const st = normalizeState(s);
    const map: Record<string, string> = {
      CALIFORNIA: 'CA',
      NEVADA: 'NV',
      WISCONSIN: 'WI',
      'NEW YORK': 'NY',
      ARIZONA: 'AZ',
    };
    return map[st] || st;
  };
  const normalizeDivision = (value?: string | null) => (value || '').toString().toLowerCase().trim();
  const isTrailersDivision = (value?: string | null) => normalizeDivision(value) === 'trailers';
  const isVendorDivision = (value?: string | null) => {
    const division = normalizeDivision(value);
    return division === 'vendor' || division === 'both';
  };
  const roundMoney = (value: number) =>
    Number((Number.isFinite(value) ? value : 0).toFixed(2));
  const roundHours = (value: number) =>
    Number((Number.isFinite(value) ? value : 0).toFixed(2));
  const addLongShiftBonus = (hours: number): number => hours >= 14 ? hours + 4.5 : hours;
  const formatCommissionReportDate = (rawValue: string) => {
    const raw = (rawValue || '').toString();
    const dateOnly = raw.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      const [yy, mm, dd] = dateOnly.split('-').map((n) => Number(n));
      return `${mm}/${dd}`;
    }
    const asDate = new Date(raw);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    }
    return raw || '';
  };
  const getCommissionReportHours = (worker?: Worker | null): number => {
    if (!worker) return 0;
    const effective = Number(worker.payment_data?.effective_hours ?? 0);
    if (Number.isFinite(effective) && effective > 0) {
      return roundHours(addLongShiftBonus(effective + 0.5));
    }
    const actual = Number(worker.payment_data?.actual_hours ?? 0);
    if (Number.isFinite(actual) && actual > 0) {
      return roundHours(addLongShiftBonus(actual));
    }
    const workedHours = Number(worker.worked_hours ?? 0);
    if (Number.isFinite(workedHours) && workedHours > 0) {
      return roundHours(addLongShiftBonus(workedHours));
    }
    const regularHours = Number(worker.payment_data?.regular_hours ?? 0);
    const overtimeHours = Number(worker.payment_data?.overtime_hours ?? 0);
    const doubletimeHours = Number(worker.payment_data?.doubletime_hours ?? 0);
    const summed = regularHours + overtimeHours + doubletimeHours;
    return summed > 0 ? roundHours(addLongShiftBonus(summed)) : 0;
  };
  const getAdjustedGrossForEvent = (event: Event): number => {
    const eventPaymentSummary = event.event_payment || null;
    const hasSalesInputs =
      event.ticket_sales !== null &&
      event.ticket_sales !== undefined;
    const eventTips = Number(event.tips || 0);
    const ticketSales = Number(event.ticket_sales || 0);
    const totalSales = Math.max(ticketSales - eventTips, 0);
    const taxRate = Number(event.tax_rate_percent || 0);
    const tax = totalSales * (taxRate / 100);
    const adjustedGrossFromSales = Math.max(totalSales - tax, 0);

    if (hasSalesInputs) {
      return roundMoney(adjustedGrossFromSales);
    }

    const persistedAdjustedGrossRaw = Number(eventPaymentSummary?.net_sales);
    const hasPersistedAdjustedGross =
      eventPaymentSummary?.net_sales !== null &&
      eventPaymentSummary?.net_sales !== undefined &&
      Number.isFinite(persistedAdjustedGrossRaw);

    if (hasPersistedAdjustedGross) {
      return roundMoney(Math.max(persistedAdjustedGrossRaw, 0));
    }

    return roundMoney(adjustedGrossFromSales);
  };
  const getCommissionPoolPercentForEvent = (
    event: Event,
    adjustedGross: number,
    grossCommission: number
  ) => {
    const persistedPercent = Number(event.event_payment?.commission_pool_percent);
    if (Number.isFinite(persistedPercent) && persistedPercent > 0) {
      return persistedPercent;
    }

    const eventPercent = Number(event.commission_pool);
    if (Number.isFinite(eventPercent) && eventPercent > 0) {
      return eventPercent;
    }

    return adjustedGross > 0 && grossCommission > 0
      ? grossCommission / adjustedGross
      : 0;
  };
  const getCommissionVendorCountForEvent = (event: Event) => {
    const workers = Array.isArray(event.workers) ? event.workers : [];
    const workersWithHours = workers.filter((worker) => getCommissionReportHours(worker) > 0);
    const memberCount = workersWithHours.length > 0 ? workersWithHours.length : workers.length;
    const eligibleVendorCount = workersWithHours.reduce((count, worker) => {
      return isVendorDivision(worker.division) ? count + 1 : count;
    }, 0);

    return eligibleVendorCount > 0 ? eligibleVendorCount : memberCount;
  };
  const getRestPayForReport = (actualHours: number, stateCode: string | null | undefined) => {
    const normalizedState = normalizeStateCode(stateCode);
    if (normalizedState === 'NV' || normalizedState === 'WI' || normalizedState === 'AZ' || normalizedState === 'NY') {
      return 0;
    }
    if (!Number.isFinite(actualHours) || actualHours <= 0) {
      return 0;
    }
    return actualHours >= 10 ? 12 : 9;
  };

  const fetchEmployeeSummary = async (userId: string): Promise<{
    sickLeave: SickLeaveBalance | null;
    profileStateCode: string | null;
  }> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`/api/employees/${userId}/summary`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to load sick leave data');
    }

    const data = await response.json();
    return {
      sickLeave: data.summary?.sick_leave ?? null,
      profileStateCode: normalizeStateCode(data?.employee?.state) || null,
    };
  };

  // Fetch events when pay period dates change
  useEffect(() => {
    const fetchEvents = async () => {
      if (!formData.payPeriodStart || !formData.payPeriodEnd) {
        setEvents([]);
        return;
      }

      setEventsLoading(true);
      setEventsError(null);

      try {
        const debugMode =
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('debug') === '1';

        const response = await fetch(
          `/api/events-by-date?startDate=${formData.payPeriodStart}&endDate=${formData.payPeriodEnd}&includeHours=true${debugMode ? '&debug=true' : ''}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch events');
        }

        const data = await response.json();
        setEvents(data.events || []);
      } catch (error: any) {
        console.error('Error fetching events:', error);
        setEventsError(error.message || 'Failed to load events');
        setEvents([]);
      } finally {
        setEventsLoading(false);
      }
    };

    fetchEvents();
  }, [formData.payPeriodStart, formData.payPeriodEnd]);

  useEffect(() => {
    let isMounted = true;

    if (!matchedUserId) {
      setSickLeave(null);
      setSickLeaveError(null);
      setSickLeaveLoading(false);
      return;
    }

    const fetchSickLeave = async () => {
      setSickLeaveLoading(true);
      setSickLeaveError(null);

      try {
        const summaryData = await fetchEmployeeSummary(matchedUserId);
        if (isMounted) {
          setSickLeave(summaryData.sickLeave);
          const profileStateCode = summaryData.profileStateCode;
          if (profileStateCode) {
            setFormData(prev => (
              prev.state === profileStateCode ? prev : { ...prev, state: profileStateCode }
            ));
          }
        }
      } catch (error: any) {
        if (!isMounted) return;
        console.error('Error fetching sick leave summary:', error);
        setSickLeave(null);
        setSickLeaveError(error.message || 'Failed to load sick leave data');
      } finally {
        if (isMounted) setSickLeaveLoading(false);
      }
    };

    fetchSickLeave();

    return () => {
      isMounted = false;
    };
  }, [matchedUserId]);

  // Fetch Final Pay from HR Dashboard data when employee + dates are ready
  useEffect(() => {
    let isMounted = true;

    if (!matchedUserId || !formData.payPeriodStart || !formData.payPeriodEnd) {
      setFinalPayEvents([]);
      setFinalPayTotals(null);
      setFinalPayError(null);
      return;
    }

    const fetchFinalPay = async () => {
      setFinalPayLoading(true);
      setFinalPayError(null);
      try {
        const debugMode =
          typeof window !== 'undefined' &&
          new URLSearchParams(window.location.search).get('debug') === '1';
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `/api/employee-final-pay?userId=${encodeURIComponent(matchedUserId)}&startDate=${formData.payPeriodStart}&endDate=${formData.payPeriodEnd}${debugMode ? '&debug=1' : ''}`,
          {
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load final pay data');
        }
        const data = await res.json();
        if (isMounted) {
          if (debugMode) {
            console.log('[PAYSTUB-GEN][debug] employee-final-pay hours breakdown', (data.events || []).map((ev: any) => ({
              eventId: ev.eventId,
              eventName: ev.eventName,
              eventDate: ev.eventDate,
              actualHours: ev.actualHours,
              hoursDebug: ev.hours_debug || null,
            })));
          }
          setFinalPayEvents(data.events || []);
          setFinalPayTotals(data.totals || null);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setFinalPayError(err.message || 'Failed to load final pay data');
        setFinalPayEvents([]);
        setFinalPayTotals(null);
      } finally {
        if (isMounted) setFinalPayLoading(false);
      }
    };

    fetchFinalPay();

    return () => {
      isMounted = false;
    };
  }, [matchedUserId, formData.payPeriodStart, formData.payPeriodEnd]);

  const calculateEarnings = () => {
    const regularPay = (parseFloat(formData.regularHours) || 0) * (parseFloat(formData.regularRate) || 0);
    const overtimePay = (parseFloat(formData.overtimeHours) || 0) * (parseFloat(formData.overtimeRate) || 0);
    const doubleTimePay = (parseFloat(formData.doubleTimeHours) || 0) * (parseFloat(formData.doubleTimeRate) || 0);
    return regularPay + overtimePay + doubleTimePay;
  };

  const calculateDeductions = () => {
    return (
      (parseFloat(formData.federalIncome) || 0) +
      (parseFloat(formData.socialSecurity) || 0) +
      (parseFloat(formData.medicare) || 0) +
      (parseFloat(formData.stateIncome) || 0) +
      (parseFloat(formData.stateDI) || 0) +
      (parseFloat(formData.miscDeduction) || 0)
    );
  };

  const grossPay = calculateEarnings();
  const totalDeductions = calculateDeductions();
  const netPay = grossPay - totalDeductions + (parseFloat(formData.miscReimbursement) || 0);

  const getWorkerHoursForEligibility = (worker?: Worker | null): number => {
    if (!worker) return 0;
    const pd: any = worker.payment_data;
    const workedHours = worker.worked_hours != null ? Number(worker.worked_hours) || 0 : 0;
    if (workedHours > 0) return workedHours;
    const actualHours = pd?.actual_hours != null ? Number(pd.actual_hours) || 0 : 0;
    if (actualHours > 0) return actualHours;
    const regH = pd?.regular_hours != null ? Number(pd.regular_hours) || 0 : 0;
    const otH = pd?.overtime_hours != null ? Number(pd.overtime_hours) || 0 : 0;
    const dtH = pd?.doubletime_hours != null ? Number(pd.doubletime_hours) || 0 : 0;
    const sum = regH + otH + dtH;
    return sum > 0 ? sum : 0;
  };

  const hasWorkerCompensationData = (worker?: Worker | null): boolean => {
    const pd = worker?.payment_data;
    if (!pd) return false;
    const values = [
      pd.actual_hours,
      pd.regular_hours,
      pd.overtime_hours,
      pd.doubletime_hours,
      pd.regular_pay,
      pd.overtime_pay,
      pd.doubletime_pay,
      pd.commissions,
      pd.tips,
      pd.total_pay,
    ];
    return values.some((v) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) && Math.abs(n) > 0;
    });
  };

  const periodStatsByUserId = useMemo(() => {
    const stats: Record<string, { hours: number; events: number }> = {};
    for (const event of events || []) {
      const workers = event.workers || [];
      for (const w of workers) {
        const uid = (w?.user_id || '').toString();
        if (!uid) continue;
        const h = getWorkerHoursForEligibility(w);
        if (h <= 0) continue;
        if (!stats[uid]) stats[uid] = { hours: 0, events: 0 };
        stats[uid].hours += h;
        stats[uid].events += 1;
      }
    }
    return stats;
  }, [events]);

  const assignedEventsByUserId = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const event of events || []) {
      const eventId = (event?.id || '').toString();
      if (!eventId) continue;
      for (const w of event.workers || []) {
        const uid = (w?.user_id || '').toString();
        if (!uid) continue;
        if (!m[uid]) m[uid] = new Set<string>();
        m[uid].add(eventId);
      }
    }
    const out: Record<string, number> = {};
    for (const [uid, set] of Object.entries(m)) out[uid] = set.size;
    return out;
  }, [events]);

  const getFilteredEvents = () => {
    // Only include events the employee worked, but keep ALL workers for those events.
    // AZ/NY commission logic needs other workers' hours to compute the per-vendor commission.
    return matchedUserId
      ? events.filter((event) => (event.workers || []).some((w) => w.user_id === matchedUserId))
      : events;
  };

  const formatEventDateForCard = (rawValue: string) => {
    const raw = (rawValue || '').toString();
    const dateOnly = raw.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      const [yy, mm, dd] = dateOnly.split('-').map((n) => Number(n));
      return new Date(Date.UTC(yy, mm - 1, dd)).toLocaleDateString('en-US', { dateStyle: 'medium' });
    }
    const asDate = new Date(raw);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    }
    return raw || 'N/A';
  };

  const filterEventsForUserId = (userId: string | null) => {
    if (!userId) return events;
    return events.filter((event) => (event.workers || []).some((w) => w.user_id === userId));
  };

  const filterEventsForUserIdWithHours = (userId: string | null) => {
    if (!userId) return [];
    return events.filter((event) => (event.workers || []).some((w) => w.user_id === userId));
  };

  const resolveEmployeeUserIdByOfficialName = async (
    officialNameRaw: string,
    options?: { debug?: boolean }
  ): Promise<string | null> => {
    const officialName = (officialNameRaw || '').trim();
    if (!officialName) return null;

    try {
      const response = await fetch(
        `/api/match-employee?name=${encodeURIComponent(officialName)}${options?.debug ? '&debug=true' : ''}`
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data?.user_id || null;
    } catch (error) {
      console.error('Error matching employee:', error);
      return null;
    }
  };

  const sanitizeFilePart = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const debugMode =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('debug') === '1';

      const resolvedUserId =
        matchedUserId ||
        (formData.employeeName ? await resolveEmployeeUserIdByOfficialName(formData.employeeName, { debug: debugMode }) : null);

      let sickLeaveForPayload = sickLeave;
      let stateForPayload = formData.state;

      if (resolvedUserId) {
        const summaryData = await fetchEmployeeSummary(resolvedUserId);
        sickLeaveForPayload = summaryData.sickLeave;
        setSickLeave(summaryData.sickLeave);
        setSickLeaveError(null);
        const profileStateCode = summaryData.profileStateCode;
        if (profileStateCode) {
          stateForPayload = profileStateCode;
          setFormData(prev => (
            prev.state === profileStateCode ? prev : { ...prev, state: profileStateCode }
          ));
        }
      }

      if (resolvedUserId && resolvedUserId !== matchedUserId) {
        setMatchedUserId(resolvedUserId);
      }

      const filteredEvents = filterEventsForUserIdWithHours(resolvedUserId);
      if (debugMode) {
        console.log('[PAYSTUB-GEN][debug] generate clicked', {
          resolvedUserId,
          matchedUserId,
          eventsTotal: events.length,
          eventsFiltered: filteredEvents.length,
        });
        console.log(
          '[PAYSTUB-GEN][debug] filtered event ids',
          filteredEvents.map((e) => ({
            id: e.id,
            date: e.event_date,
            workers: (e.workers || []).map((w) => ({
              user_id: w.user_id,
              worked_hours: w.worked_hours,
              has_payment_data: !!w.payment_data,
            })),
          }))
        );
      }

      // Prepare payload for PDF generation
      const payload = {
        // Employee info
        employeeName: formData.employeeName,
        ssn: formData.ssn,
        address: formData.address,
        employeeId: formData.employeeId,

        // Pay period
        payPeriodStart: formData.payPeriodStart,
        payPeriodEnd: formData.payPeriodEnd,
        payDate: formData.payDate,

        // Deductions
        federalIncome: formData.federalIncome,
        socialSecurity: formData.socialSecurity,
        medicare: formData.medicare,
        stateIncome: formData.stateIncome,
        stateDI: formData.stateDI,
        state: stateForPayload,

        // Other
        miscDeduction: formData.miscDeduction,
        miscReimbursement: formData.miscReimbursement,
        mealPremium: resolvedUserId ? (parseFloat(getOverride(resolvedUserId).mealPremium) || 0) : 0,
        sick: resolvedUserId ? (parseFloat(getOverride(resolvedUserId).sick) || 0) : 0,

        // Events data
        events: filteredEvents,
        sickLeave: sickLeaveForPayload,

        // Used server-side to pick correct worker row per event (hours worked)
        matchedUserId: resolvedUserId,

        // Debug logging (opt-in via /paystub-generator?debug=1)
        debug: debugMode,
      };

      const response = await fetch('/api/generate-paystub', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate paystub');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paystub-${formData.employeeName?.replace(/\s/g, '_')}-${formData.payDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      console.error('Error generating paystub:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // Some browsers can fail to download if we revoke immediately.
    setTimeout(() => window.URL.revokeObjectURL(url), 250);
    document.body.removeChild(a);
  };

  const handleGenerateBatch = async (mode: 'merge' | 'separate') => {
    setBatchMessage(null);
    setBatchErrors([]);

    const rows = importedEmployees || [];
    if (rows.length === 0) {
      alert('No employees imported from Excel yet.');
      return;
    }
    if (!formData.payPeriodStart || !formData.payPeriodEnd) {
      alert('Missing pay period start/end.');
      return;
    }
    if (eventsLoading) {
      alert('Events are still loading. Try again in a moment.');
      return;
    }
    if (!events || events.length === 0) {
      alert('No events loaded for the selected pay period.');
      return;
    }

    setBatchGenerating(true);
    try {
      const debugMode =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('debug') === '1';

      const outPdf = mode === 'merge' ? await PDFDocument.create() : null;
      let generated = 0;
      let skipped = 0;
      const errors: string[] = [];
      const generatedNames: string[] = [];
      let mergedPagesAdded = 0;
      const sickLeaveByUserId: Record<string, SickLeaveBalance | null> = {};
      const profileStateByUserId: Record<string, string | null> = {};

      for (const emp of rows) {
        try {
          const employeeName = (emp.employeeName || '').trim();
          if (!employeeName) {
            skipped++;
            errors.push(`Row ${emp.rowIndex}: missing employee name`);
            continue;
          }
          if (!emp.matchedUserId) {
            skipped++;
            errors.push(`Row ${emp.rowIndex} (${employeeName}): not found in database`);
            continue;
          }

          const assignedCount = assignedEventsByUserId[emp.matchedUserId] || 0;
          const filteredEvents = filterEventsForUserIdWithHours(emp.matchedUserId);
          if (assignedCount <= 0) {
            skipped++;
            errors.push(`Row ${emp.rowIndex} (${employeeName}): not in any event teams during selected period`);
            continue;
          }
          if (filteredEvents.length === 0) {
            skipped++;
            errors.push(`Row ${emp.rowIndex} (${employeeName}): no payable data found in selected period`);
            continue;
          }

          if (!Object.prototype.hasOwnProperty.call(sickLeaveByUserId, emp.matchedUserId)) {
            const summaryData = await fetchEmployeeSummary(emp.matchedUserId);
            sickLeaveByUserId[emp.matchedUserId] = summaryData.sickLeave;
            profileStateByUserId[emp.matchedUserId] = summaryData.profileStateCode;
          }
          const sickLeaveForRow = sickLeaveByUserId[emp.matchedUserId] ?? null;
          const stateForRow =
            profileStateByUserId[emp.matchedUserId] ||
            emp.state ||
            formData.state;

          const payload = {
            // Employee info
            employeeName: employeeName,
            ssn: emp.ssn,
            address: emp.address,
            employeeId: emp.employeeId,

            // Pay period: always use form dates (same as single-generate)
            payPeriodStart: formData.payPeriodStart,
            payPeriodEnd: formData.payPeriodEnd,
            payDate: formData.payDate,

            // Deductions
            federalIncome: emp.federalIncome,
            socialSecurity: emp.socialSecurity,
            medicare: emp.medicare,
            stateIncome: emp.stateIncome,
            stateDI: emp.stateDI,
            state: stateForRow,

            // Other
            miscDeduction: emp.miscDeduction,
            miscReimbursement: emp.miscReimbursement,
            mealPremium: parseFloat(getOverride(emp.matchedUserId).mealPremium) || 0,
            sick: parseFloat(getOverride(emp.matchedUserId).sick) || 0,

            // Events data
            events: filteredEvents,
            sickLeave: sickLeaveForRow,

            matchedUserId: emp.matchedUserId,
            debug: debugMode,
          };

          const response = await fetch('/api/generate-paystub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            skipped++;
            errors.push(`Row ${emp.rowIndex} (${employeeName}): ${body?.error || 'Failed to generate paystub'}`);
            continue;
          }

          const bytes = await response.arrayBuffer();

          if (mode === 'separate') {
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const safeName = employeeName ? sanitizeFilePart(employeeName) : `row_${emp.rowIndex}`;
            const safePayDate = (emp.payDate || formData.payDate) ? sanitizeFilePart(emp.payDate || formData.payDate) : new Date().toISOString().split('T')[0];
            downloadBlob(blob, `paystub-${safeName}-${safePayDate}.pdf`);
            // Reduce the chance the browser blocks multiple downloads triggered too quickly.
            await new Promise((r) => setTimeout(r, 200));
          } else if (outPdf) {
            const doc = await PDFDocument.load(bytes);
            const pageIndices = doc.getPageIndices();
            const copied = await outPdf.copyPages(doc, pageIndices);
            for (const p of copied) outPdf.addPage(p);
            mergedPagesAdded += copied.length;
          }

          generated++;
          generatedNames.push(employeeName);
        } catch (err: any) {
          skipped++;
          errors.push(`Row ${emp.rowIndex} (${(emp.employeeName || '').trim() || 'Unknown'}): ${err?.message || 'Unexpected error'}`);
          continue;
        }
      }

      if (generated === 0) {
        throw new Error('No paystubs were generated. Check that employees are matched and have events in the selected period.');
      }

      const safePayDate = formData.payDate ? sanitizeFilePart(formData.payDate) : new Date().toISOString().split('T')[0];
      if (mode === 'merge' && outPdf) {
        const outBytes = await outPdf.save();
        // pdf-lib returns Uint8Array<ArrayBufferLike>; normalize to a Uint8Array for Blob compatibility in TS.
        const blob = new Blob([Uint8Array.from(outBytes)], { type: 'application/pdf' });
        downloadBlob(blob, `paystubs-${safePayDate}.pdf`);
      }

      const msg = mode === 'merge'
        ? `Generated ${generated} paystub(s) into 1 PDF (${mergedPagesAdded} page(s)). Skipped ${skipped}.`
        : `Generated ${generated} paystub(s) as separate PDF downloads. Skipped ${skipped}.`;
      setBatchMessage(msg);
      setBatchErrors(errors);
      if (debugMode && errors.length) {
        console.log('[PAYSTUB-GEN][debug] batch errors', errors);
      }
      if (debugMode) {
        console.log('[PAYSTUB-GEN][debug] batch generated', { generated, skipped, generatedNames });
      }
    } catch (error: any) {
      console.error('Error generating batch paystubs:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setBatchGenerating(false);
    }
  };

  const handleCreateReport = async () => {
    setCreatingReport(true);

    try {
      const reportUserId =
        matchedUserId ||
        (formData.employeeName
          ? await resolveEmployeeUserIdByOfficialName(formData.employeeName)
          : null);

      if (!reportUserId) {
        throw new Error('Could not match this employee to a user profile.');
      }

      if (reportUserId !== matchedUserId) {
        setMatchedUserId(reportUserId);
      }

      const filteredEvents = filterEventsForUserId(reportUserId);
      const generatedAt = new Date().toISOString();
      const finalPayByEventId = new Map(finalPayEvents.map((event) => [event.eventId, event]));

      type CommissionReportRow = {
        showDate: string;
        eventName: string;
        venueStadium: string;
        adjustedGross: number;
        adjustedGrossPercent: number;
        grossCommission: number;
        employeeCount: number | string;
        commission: number;
        hoursWorked: number;
        rateInEffect: number;
        variableIncentive: number | '';
        tips: number | '';
        restPay: number | '';
        finalPay: number;
      };

      const summaryRows: Array<[string, string | number]> = [
        ['Generated At', generatedAt],
        ['Employee Name', formData.employeeName],
        ['Employee ID', formData.employeeId],
        ['SSN', formData.ssn],
        ['Address', formData.address],
        ['Matched User ID', reportUserId],
        ['Pay Period Start', formData.payPeriodStart],
        ['Pay Period End', formData.payPeriodEnd],
        ['Pay Date', formData.payDate],
        ['State', formData.state],
        ['Gross Pay', Number(grossPay.toFixed(2))],
        ['Total Deductions', Number(totalDeductions.toFixed(2))],
        ['Misc Reimbursement', Number((parseFloat(formData.miscReimbursement) || 0).toFixed(2))],
        ['Net Pay', Number(netPay.toFixed(2))],
      ];

      const earningsRows = [
        {
          regular_hours: parseFloat(formData.regularHours) || 0,
          regular_rate: parseFloat(formData.regularRate) || 0,
          overtime_hours: parseFloat(formData.overtimeHours) || 0,
          overtime_rate: parseFloat(formData.overtimeRate) || 0,
          doubletime_hours: parseFloat(formData.doubleTimeHours) || 0,
          doubletime_rate: parseFloat(formData.doubleTimeRate) || 0,
        },
      ];

      const deductionsRows = [
        {
          federal_income: parseFloat(formData.federalIncome) || 0,
          social_security: parseFloat(formData.socialSecurity) || 0,
          medicare: parseFloat(formData.medicare) || 0,
          state_income: parseFloat(formData.stateIncome) || 0,
          state_di: parseFloat(formData.stateDI) || 0,
          misc_deduction: parseFloat(formData.miscDeduction) || 0,
        },
      ];

      const commissionReportRows: CommissionReportRow[] =
        filteredEvents?.flatMap((event) => {
          const worker =
            (event.workers || []).find((candidate) => candidate.user_id === reportUserId) || null;

          if (!worker) {
            return [];
          }

          const finalPayData = finalPayByEventId.get(event.id);
          const hoursWorked = roundHours(
            Number(finalPayData?.actualHours ?? getCommissionReportHours(worker))
          );
          const adjustedGross = roundMoney(getAdjustedGrossForEvent(event));

          const persistedGrossCommission = Number(event.event_payment?.commission_pool_dollars || 0);
          const adjustedGrossPercent = getCommissionPoolPercentForEvent(
            event,
            adjustedGross,
            persistedGrossCommission
          );
          const grossCommission = roundMoney(
            persistedGrossCommission || adjustedGross * adjustedGrossPercent
          );
          const employeeCount = getCommissionVendorCountForEvent(event);
          const commission = employeeCount > 0
            ? roundMoney(grossCommission / Number(employeeCount))
            : 0;

          const restPayRaw =
            Number(worker.payment_data?.rest_break_pay ?? 0) ||
            getRestPayForReport(
              hoursWorked,
              formData.state || event.state
            );
          const restPay = roundMoney(restPayRaw);
          const tips = roundMoney(Number(finalPayData?.tips ?? worker.payment_data?.tips ?? 0));
          const totalPayRaw =
            Number(finalPayData?.totalPay ?? worker.payment_data?.total_pay ?? 0);
          const persistedCommissionPay =
            Number(worker.payment_data?.regular_pay || 0) +
            Number(worker.payment_data?.commissions || 0);
          const commissionPaid = roundMoney(
            totalPayRaw > 0
              ? totalPayRaw - tips - restPay
              : persistedCommissionPay
          );
          const variableIncentiveRaw = roundMoney(commissionPaid - commission);
          const totalPay = roundMoney(
            totalPayRaw > 0
              ? totalPayRaw
              : commissionPaid + tips + restPay
          );
          const rateInEffect = hoursWorked > 0
            ? roundMoney(commissionPaid / hoursWorked)
            : 0;

          return [{
            showDate: formatCommissionReportDate(event.event_date),
            eventName: (event.event_name ?? event.name ?? '').toString(),
            venueStadium: (event.venue ?? '').toString(),
            adjustedGross,
            adjustedGrossPercent,
            grossCommission,
            employeeCount,
            commission,
            hoursWorked,
            rateInEffect,
            variableIncentive: Math.abs(variableIncentiveRaw) < 0.005 ? '' : variableIncentiveRaw,
            tips: Math.abs(tips) < 0.005 ? '' : tips,
            restPay: Math.abs(restPay) < 0.005 ? '' : restPay,
            finalPay: totalPay,
          }];
        }) ?? [];

      if (commissionReportRows.length === 0) {
        throw new Error('No commission-report rows were found for this employee in the selected pay period.');
      }

      const eventsRows =
        filteredEvents?.flatMap(event => {
          const workers = event.workers && event.workers.length > 0 ? event.workers : [undefined];
          return workers.map(worker => ({
            event_id: event.id,
            event_name: event.name,
            artist: event.artist ?? '',
            venue: event.venue,
            event_type: event.event_type,
            event_date: event.event_date,
            city: event.city ?? '',
            state: event.state ?? '',
            worker_user_id: worker?.user_id ?? '',
            worker_name: worker?.user_name ?? '',
            worker_email: worker?.user_email ?? '',
            worker_status: worker?.status ?? '',
            worker_division: worker?.division ?? '',
            actual_hours: worker?.payment_data?.actual_hours ?? '',
            effective_hours: worker?.payment_data?.effective_hours ?? '',
            regular_hours: worker?.payment_data?.regular_hours ?? '',
            overtime_hours: worker?.payment_data?.overtime_hours ?? '',
            doubletime_hours: worker?.payment_data?.doubletime_hours ?? '',
            regular_pay: worker?.payment_data?.regular_pay ?? '',
            overtime_pay: worker?.payment_data?.overtime_pay ?? '',
            doubletime_pay: worker?.payment_data?.doubletime_pay ?? '',
            variable_incentive: worker?.payment_data?.variable_incentive ?? '',
            commissions: worker?.payment_data?.commissions ?? '',
            rest_break_pay: worker?.payment_data?.rest_break_pay ?? '',
            travel_pay: worker?.payment_data?.travel_pay ?? '',
            tips: worker?.payment_data?.tips ?? '',
            total_pay: worker?.payment_data?.total_pay ?? '',
            adjustment_amount: worker?.adjustment_amount ?? '',
            event_net_sales: event?.event_payment?.net_sales ?? '',
            event_commission_pool_percent: event?.event_payment?.commission_pool_percent ?? event?.commission_pool ?? '',
            event_commission_pool_dollars: event?.event_payment?.commission_pool_dollars ?? '',
          }));
        }) ?? [];

      const sickLeaveRows = sickLeave
        ? [
            {
              total_hours: sickLeave.total_hours,
              accrued_hours: sickLeave.accrued_hours,
              balance_hours: sickLeave.balance_hours,
            },
          ]
        : [];

      const finalCommissionRows = commissionReportRows.map((row) => ({
        show_date: row.showDate,
        event_name: row.eventName,
        venue_stadium: row.venueStadium,
        adjusted_gross: row.adjustedGross,
        adjusted_gross_percent: row.adjustedGrossPercent,
        gross_commission: row.grossCommission,
        employee_count: row.employeeCount,
        commission: row.commission,
        hours_worked: row.hoursWorked,
        rate_in_effect: row.rateInEffect,
        variable_incentive: row.variableIncentive === '' ? 0 : row.variableIncentive,
        tips: row.tips === '' ? 0 : row.tips,
        rest_pay: row.restPay === '' ? 0 : row.restPay,
        final_pay: row.finalPay,
      }));

      const wb = XLSX.utils.book_new();
      const commissionReportSheetData: Array<Array<string | number>> = [
        [
          'Show Date/Event Date',
          'Event Name',
          'Venue/Stadium',
          'Adjusted Gross',
          '% of Adjusted Gross',
          'Gross Commission',
          '# of Employees',
          'Commission',
          'Hours Worked',
          'Rate in Effect',
          'Variable Incentive',
          'Tips',
          'Rest Pay',
          'Final Pay (incl. tips/rest)',
        ],
        ...commissionReportRows.map((row) => [
          row.showDate,
          row.eventName,
          row.venueStadium,
          row.adjustedGross,
          row.adjustedGrossPercent,
          row.grossCommission,
          row.employeeCount,
          row.commission,
          row.hoursWorked,
          row.rateInEffect,
          row.variableIncentive,
          row.tips,
          row.restPay,
          row.finalPay,
        ]),
      ];

      const totals = commissionReportRows.reduce((acc, row) => {
        const variableIncentive =
          typeof row.variableIncentive === 'number' ? row.variableIncentive : 0;
        const tips = typeof row.tips === 'number' ? row.tips : 0;
        const restPay = typeof row.restPay === 'number' ? row.restPay : 0;
        const commissionPaid = row.commission + variableIncentive;

        return {
          commission: acc.commission + row.commission,
          hoursWorked: acc.hoursWorked + row.hoursWorked,
          commissionPaid: acc.commissionPaid + commissionPaid,
          variableIncentive: acc.variableIncentive + variableIncentive,
          tips: acc.tips + tips,
          restPay: acc.restPay + restPay,
          finalPay: acc.finalPay + row.finalPay,
        };
      }, {
        commission: 0,
        hoursWorked: 0,
        commissionPaid: 0,
        variableIncentive: 0,
        tips: 0,
        restPay: 0,
        finalPay: 0,
      });

      commissionReportSheetData.push([
        '',
        '',
        '',
        '',
        '',
        '',
        'TOTALS',
        roundMoney(totals.commission),
        roundHours(totals.hoursWorked),
        totals.hoursWorked > 0 ? roundMoney(totals.commissionPaid / totals.hoursWorked) : 0,
        roundMoney(totals.variableIncentive),
        roundMoney(totals.tips),
        roundMoney(totals.restPay),
        roundMoney(totals.finalPay),
      ]);

      const commissionReportSheet = XLSX.utils.aoa_to_sheet(commissionReportSheetData);
      commissionReportSheet['!cols'] = [
        { wch: 18 },
        { wch: 28 },
        { wch: 22 },
        { wch: 16 },
        { wch: 18 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 18 },
        { wch: 12 },
        { wch: 12 },
        { wch: 24 },
      ];
      commissionReportSheet['!autofilter'] = {
        ref: `A1:N${commissionReportSheetData.length}`,
      };

      const currencyColumns = ['D', 'F', 'H', 'J', 'K', 'L', 'M', 'N'];
      const numericColumns = ['I'];
      for (let rowIndex = 2; rowIndex <= commissionReportSheetData.length; rowIndex += 1) {
        for (const column of currencyColumns) {
          const cell = commissionReportSheet[`${column}${rowIndex}`] as XLSX.CellObject | undefined;
          if (cell && typeof cell.v === 'number') {
            cell.z = '$#,##0.00';
          }
        }
        const percentCell = commissionReportSheet[`E${rowIndex}`] as XLSX.CellObject | undefined;
        if (percentCell && typeof percentCell.v === 'number') {
          percentCell.z = '0.00%';
        }
        for (const column of numericColumns) {
          const cell = commissionReportSheet[`${column}${rowIndex}`] as XLSX.CellObject | undefined;
          if (cell && typeof cell.v === 'number') {
            cell.z = '0.00';
          }
        }
      }

      XLSX.utils.book_append_sheet(wb, commissionReportSheet, 'Commission Report');

      const summarySheet = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...summaryRows.map(([k, v]) => [k, v])]);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(earningsRows), 'Earnings');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deductionsRows), 'Deductions');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventsRows), 'Events');
      if (finalCommissionRows.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(finalCommissionRows), 'FinalCommission');
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sickLeaveRows), 'SickLeave');

      const safeName = formData.employeeName ? sanitizeFilePart(formData.employeeName) : 'employee';
      const safePayDate = formData.payDate ? sanitizeFilePart(formData.payDate) : sanitizeFilePart(generatedAt);
      XLSX.writeFile(wb, `commission-report-${safeName}-${safePayDate}.xlsx`);
    } catch (error: any) {
      console.error('Error creating report:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setCreatingReport(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploadSuccess(null);

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setUploadError('Please upload an Excel file (.xlsx or .xls)');
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      // Expected format: first row is headers, following rows are one employee per row.
      if (jsonData.length < 2) {
        setUploadError('Excel file must have at least 2 rows (headers and at least 1 employee row)');
        return;
      }

      const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());

      const getValueByHeader = (valuesRow: any[], possibleNames: string[]) => {
        for (const name of possibleNames) {
          const index = headers.findIndex((h: string) => h.includes(name));
          if (index !== -1 && valuesRow[index] != null && valuesRow[index] !== '') {
            const val = valuesRow[index];
            // Skip if value is 0 for deductions (means not applicable)
            if (typeof val === 'number' && val === 0 &&
                (possibleNames.some(n => n.includes('deduction') || n.includes('tax') || n.includes('income') || n.includes('medicare') || n.includes('security')))) {
              return '';
            }
            return String(val).trim();
          }
        }
        return '';
      };

      // Helper to get absolute value for deductions (handle negative values)
      const getAbsoluteValue = (valuesRow: any[], possibleNames: string[]) => {
        const value = getValueByHeader(valuesRow, possibleNames);
        if (!value) return '';
        const num = parseFloat(value);
        return isNaN(num) ? value : String(Math.abs(num));
      };

      // Helper to format dates
      const formatDate = (value: any) => {
        if (!value) return '';
        try {
          // Handle Excel serial dates
          if (typeof value === 'number') {
            const date = XLSX.SSF.parse_date_code(value);
            return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
          }
          // Handle string dates
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
          return String(value);
        } catch {
          return String(value);
        }
      };

      // Determine state from available state income columns
      const dataRows = jsonData
        .slice(1)
        .map((row, idx) => ({ row, rowIndex: idx + 2 })) // +2 because Excel is 1-based and headers are row 1
        .filter(({ row }) => Array.isArray(row) && row.some((c: any) => c != null && String(c).trim() !== ''));

      if (dataRows.length === 0) {
        setUploadError('No employee rows found in Excel file');
        return;
      }

      const parsedEmployees: ImportedEmployeeRow[] = dataRows.map(({ row: valuesRow, rowIndex }) => {
        // Determine state from available state income columns
        let detectedState = formData.state;
        const caStateIncome = getValueByHeader(valuesRow, ['ca state income']);
        const wiStateIncome = getValueByHeader(valuesRow, ['wi state income']);
        const azStateIncome = getValueByHeader(valuesRow, ['az state income']);
        const nyStateIncome = getValueByHeader(valuesRow, ['ny state income']);

        if (caStateIncome) detectedState = 'CA';
        else if (wiStateIncome) detectedState = 'WI';
        else if (azStateIncome) detectedState = 'AZ';
        else if (nyStateIncome) detectedState = 'NY';

        // Get state-specific deductions
        let stateIncome = '';
        let stateDI = '';

        if (detectedState === 'CA') {
          stateIncome = getAbsoluteValue(valuesRow, ['ca state income']);
          stateDI = getAbsoluteValue(valuesRow, ['ca state di']);
        } else if (detectedState === 'WI') {
          stateIncome = getAbsoluteValue(valuesRow, ['wi state income']);
        } else if (detectedState === 'AZ') {
          stateIncome = getAbsoluteValue(valuesRow, ['az state income']);
        } else if (detectedState === 'NY') {
          stateIncome = getAbsoluteValue(valuesRow, ['ny state income']);
        }

        // Calculate hours and rates from gross pay if available
        const grossPay = getValueByHeader(valuesRow, ['gross pay']);
        let regularHours = '';
        let regularRate = '';

        if (grossPay && parseFloat(grossPay) > 0) {
          // Assume 80 hours for biweekly pay period
          regularHours = '80';
          const rate = parseFloat(grossPay) / 80;
          regularRate = rate.toFixed(2);
        }

        return {
          rowIndex,
          employeeName: getValueByHeader(valuesRow, ['employee name', 'name', 'employee']),
          ssn: getValueByHeader(valuesRow, ['ssn', 'social security']),
          address: getValueByHeader(valuesRow, ['address']),
          employeeId: getValueByHeader(valuesRow, ['employee id', 'emp id', 'id', 'page']),

          payPeriodStart: formatDate(getValueByHeader(valuesRow, ['pay period start', 'period start', 'start date'])),
          payPeriodEnd: formatDate(getValueByHeader(valuesRow, ['pay period end', 'period end', 'end date'])),
          payDate: formatDate(getValueByHeader(valuesRow, ['pay date', 'payment date'])),

          federalIncome: getAbsoluteValue(valuesRow, ['federal income', 'federal tax', 'fed income']),
          socialSecurity: getAbsoluteValue(valuesRow, ['social security', 'ss', 'fica']),
          medicare: getAbsoluteValue(valuesRow, ['medicare', 'med']),
          stateIncome,
          stateDI,
          state: detectedState,

          miscDeduction: getAbsoluteValue(valuesRow, ['misc non taxable', 'misc deduction', 'other deduction']),
          miscReimbursement: getValueByHeader(valuesRow, ['misc reimbursement', 'reimbursement']),

          // Keep for backward compat: these fields still exist on the single form, but batch uses the per-row data.
          // (We don't store earnings fields in ImportedEmployeeRow because the PDF derives earnings from DB events.)
          matchedUserId: null,
        };
      });

      // Set the single-form view from the first row (for manual/single generation)
      const first = parsedEmployees[0];
      if (first) {
        setFormData(prev => ({
          ...prev,
          employeeName: first.employeeName || prev.employeeName,
          ssn: first.ssn || prev.ssn,
          address: first.address || prev.address,
          employeeId: first.employeeId || prev.employeeId,
          payPeriodStart: first.payPeriodStart || prev.payPeriodStart,
          payPeriodEnd: first.payPeriodEnd || prev.payPeriodEnd,
          payDate: first.payDate || prev.payDate,
          federalIncome: first.federalIncome || prev.federalIncome,
          socialSecurity: first.socialSecurity || prev.socialSecurity,
          medicare: first.medicare || prev.medicare,
          stateIncome: first.stateIncome || prev.stateIncome,
          stateDI: first.stateDI || prev.stateDI,
          state: first.state || prev.state,
          miscDeduction: first.miscDeduction || prev.miscDeduction,
          miscReimbursement: first.miscReimbursement || prev.miscReimbursement,
        }));
      }

      // Match all employees (sequential to avoid spamming the server)
      const matched: ImportedEmployeeRow[] = [];
      for (const emp of parsedEmployees) {
        if (!emp.employeeName) {
          matched.push({ ...emp, matchError: 'Missing employee name' });
          continue;
        }
        try {
          const uid = await resolveEmployeeUserIdByOfficialName(emp.employeeName);
          matched.push({ ...emp, matchedUserId: uid, matchError: uid ? undefined : 'No match found in database' });
        } catch (err: any) {
          matched.push({ ...emp, matchedUserId: null, matchError: err?.message || 'Match error' });
        }
      }

      setImportedEmployees(matched);

      const firstMatched = matched.find((e) => !!e.matchedUserId);
      if (firstMatched?.matchedUserId) setMatchedUserId(firstMatched.matchedUserId);

      const matchedCount = matched.filter((e) => !!e.matchedUserId).length;
      setUploadSuccess(`Excel imported: ${matched.length} row(s), matched ${matchedCount}.`);

      // Clear success message after 5 seconds
      setTimeout(() => setUploadSuccess(null), 5000);
    } catch (error: any) {
      console.error('Error reading Excel file:', error);
      setUploadError(`Failed to read Excel file: ${error.message}`);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-semibold text-blue-700 uppercase keeping-wide">Utilities</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1">Paystub Generator</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Generate professional paystubs with customizable payroll information.
            </p>
            <div className="flex items-center gap-2 mt-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-md">
                <span className="font-semibold text-blue-600">Step 1:</span> PDF Reader
              </span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 rounded-md">
                <span className="font-semibold text-blue-600">Step 2:</span> Paystub Generator
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/pdf-reader"
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 border border-blue-600 rounded-lg shadow-sm text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              PDF Reader (Step 1)
            </Link>
            <Link
              href="/hr-dashboard"
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to dashboard
            </Link>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Form Section */}
          <div className="lg:col-span-2 space-y-6">
            {/* Excel Upload Section */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl shadow-sm p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-slate-900 mb-2">Import from Excel</h2>
                    <p className="text-sm text-slate-600 mb-4">
                      Upload an Excel file (.xlsx or .xls) to automatically populate the form fields.
                      The file should have headers in the first row and one employee per row starting on row 2.
                    </p>

                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="excel-upload"
                    />
                    <label
                      htmlFor="excel-upload"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-blue-300 rounded-lg text-sm font-medium text-blue-700 hover:bg-blue-50 cursor-pointer transition-colors shadow-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Choose Excel File
                    </label>
                    <a
                      href="/templates/paystub-template.xlsx"
                      download
                      className="text-sm text-blue-600 hover:text-blue-800 underline"
                    >
                      Download Template
                    </a>
                  </div>

                  {uploadError && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {uploadError}
                    </div>
                  )}

                  {uploadSuccess && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {uploadSuccess}
                    </div>
                  )}

                  {importedEmployees.length > 0 && (
                    <div className="mt-4 bg-white/60 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">Imported Employees</div>
                        <div className="text-xs text-slate-600">
                          {importedEmployees.filter((e) => !!e.matchedUserId).length} matched / {importedEmployees.length} total
                        </div>
                      </div>
                      <div className="mt-2 max-h-64 overflow-auto divide-y divide-slate-200 text-sm">
                        {importedEmployees.slice(0, 50).map((e) => (
                          <div key={`${e.rowIndex}-${e.employeeName}`} className="py-2 space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate">
                                <span className="text-slate-500">Row {e.rowIndex}:</span>{' '}
                                <span className="font-medium text-slate-900">{e.employeeName || '(missing name)'}</span>
                              </div>
                              <div className="flex-shrink-0">
                                {e.matchedUserId ? (() => {
                                  const assignedCount = assignedEventsByUserId[e.matchedUserId] || 0;
                                  const st = periodStatsByUserId[e.matchedUserId];
                                  const hours = st ? st.hours : 0;
                                  const eligible = filterEventsForUserIdWithHours(e.matchedUserId).length > 0;
                                  return eligible ? (
                                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 text-xs font-semibold">
                                      Eligible ({hours.toFixed(2)}h)
                                    </span>
                                  ) : assignedCount > 0 ? (
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">
                                      Matched (0h, {assignedCount} event{assignedCount !== 1 ? 's' : ''})
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">
                                      Matched (no events)
                                    </span>
                                  );
                                })() : (
                                  <span className="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-semibold">
                                    {e.matchError ? 'Unmatched' : 'Pending'}
                                  </span>
                                )}
                              </div>
                            </div>
                            {e.matchedUserId && (
                              <div className="flex items-center gap-3 pl-1">
                                <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                                  <span>Meal Premium $</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={getOverride(e.matchedUserId).mealPremium}
                                    onChange={(ev) => setOverride(e.matchedUserId!, 'mealPremium', ev.target.value)}
                                    className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  />
                                </label>
                                <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                                  <span>Sick $</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={getOverride(e.matchedUserId).sick}
                                    onChange={(ev) => setOverride(e.matchedUserId!, 'sick', ev.target.value)}
                                    className="w-20 px-1.5 py-0.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        ))}
                        {importedEmployees.length > 50 && (
                          <div className="pt-2 text-xs text-slate-600">
                            Showing first 50 rows.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Pay Period Information */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Pay Period</h2>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Period Start
                  </label>
                  <input
                    type="date"
                    name="payPeriodStart"
                    value={formData.payPeriodStart}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Period End
                  </label>
                  <input
                    type="date"
                    name="payPeriodEnd"
                    value={formData.payPeriodEnd}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Pay Date
                  </label>
                  <input
                    type="date"
                    name="payDate"
                    value={formData.payDate}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Events During Pay Period */}
            {(formData.payPeriodStart && formData.payPeriodEnd) && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Events During Pay Period</h2>
                  {eventsLoading && (
                    <div className="inline-block h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>

                {eventsError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {eventsError}
                  </div>
                )}

                {!eventsLoading && !eventsError && events.length === 0 && (
                  <div className="text-center py-8 text-slate-500">
                    <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">No events scheduled during this pay period</p>
                  </div>
                )}

                {!eventsLoading && !eventsError && events.length > 0 && (
                  <div className="space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex-1">
                            <h3 className="font-semibold text-slate-900">{event.name || event.event_name || 'Unnamed Event'}</h3>
                            {event.artist && (
                              <p className="text-sm text-slate-600 mt-1">Artist: {event.artist}</p>
                            )}
                            <p className="text-sm text-slate-600 mt-1">Venue: {event.venue}</p>
                            {(event.city || event.state) && (
                              <p className="text-sm text-slate-600">
                                Location: {[event.city, event.state].filter(Boolean).join(', ')}
                              </p>
                            )}
                            <p className="text-xs text-slate-500 mt-2">
                              {formatEventDateForCard(event.event_date)}
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {event.event_type || 'Event'}
                            </span>
                          </div>
                        </div>

                        {/* Workers and Payment Data */}
                        {event.workers && event.workers.length > 0 && (() => {
                          // Filter workers based on matchedUserId if available
                          const filteredWorkers = matchedUserId
                            ? event.workers?.filter(w => w.user_id === matchedUserId) || []
                            : event.workers || [];

                          return filteredWorkers.length > 0 && (
                            <div className="border-t border-slate-200 pt-3 mt-3">
                              <h4 className="text-sm font-semibold text-slate-700 mb-2">
                                Workers ({filteredWorkers.length})
                                {matchedUserId && <span className="ml-2 text-xs text-blue-600">(Filtered by Excel employee name)</span>}
                              </h4>
                              <div className="space-y-2">
                                {filteredWorkers.map((worker) => (
                                  <div key={worker.user_id} className="bg-slate-50 rounded-lg p-3">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-slate-900">{worker.user_name}</p>
                                        <p className="text-xs text-slate-500">{worker.user_email}</p>
                                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                                          worker.status === 'completed' ? 'bg-green-100 text-green-800' :
                                          worker.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                                          worker.status === 'assigned' ? 'bg-yellow-100 text-yellow-800' :
                                          'bg-red-100 text-red-800'
                                        }`}>
                                          {worker.status}
                                        </span>
                                      </div>
                                    </div>

                                    {/* Excel Upload Data - Only show for matched employee */}
                                    {matchedUserId && worker.user_id === matchedUserId && formData.employeeName && (
                                      <div className="mt-3 pt-3 border-t border-blue-200 bg-blue-50 rounded p-2">
                                        <p className="text-xs font-semibold text-blue-900 mb-2">📊 Excel Upload Data:</p>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          {/* Earnings */}
                                          {formData.regularHours && (
                                            <div>
                                              <span className="text-blue-600">Regular Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{formData.regularHours}</span>
                                            </div>
                                          )}
                                          {formData.regularRate && (
                                            <div>
                                              <span className="text-blue-600">Regular Rate:</span>{' '}
                                              <span className="font-medium text-slate-900">${parseFloat(formData.regularRate).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.overtimeHours && (
                                            <div>
                                              <span className="text-blue-600">OT Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{formData.overtimeHours}</span>
                                            </div>
                                          )}
                                          {formData.overtimeRate && (
                                            <div>
                                              <span className="text-blue-600">OT Rate:</span>{' '}
                                              <span className="font-medium text-slate-900">${parseFloat(formData.overtimeRate).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.doubleTimeHours && (
                                            <div>
                                              <span className="text-blue-600">DT Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{formData.doubleTimeHours}</span>
                                            </div>
                                          )}
                                          {formData.doubleTimeRate && (
                                            <div>
                                              <span className="text-blue-600">DT Rate:</span>{' '}
                                              <span className="font-medium text-slate-900">${parseFloat(formData.doubleTimeRate).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {/* Deductions */}
                                          {formData.federalIncome && (
                                            <div>
                                              <span className="text-blue-600">Federal Tax:</span>{' '}
                                              <span className="font-medium text-red-700">${parseFloat(formData.federalIncome).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.socialSecurity && (
                                            <div>
                                              <span className="text-blue-600">Social Security:</span>{' '}
                                              <span className="font-medium text-red-700">${parseFloat(formData.socialSecurity).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.medicare && (
                                            <div>
                                              <span className="text-blue-600">Medicare:</span>{' '}
                                              <span className="font-medium text-red-700">${parseFloat(formData.medicare).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.stateIncome && (
                                            <div>
                                              <span className="text-blue-600">State Tax:</span>{' '}
                                              <span className="font-medium text-red-700">${parseFloat(formData.stateIncome).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.stateDI && (
                                            <div>
                                              <span className="text-blue-600">State DI:</span>{' '}
                                              <span className="font-medium text-red-700">${parseFloat(formData.stateDI).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.miscDeduction && (
                                            <div>
                                              <span className="text-blue-600">Misc Deduction:</span>{' '}
                                              <span className="font-medium text-red-700">${parseFloat(formData.miscDeduction).toFixed(2)}</span>
                                            </div>
                                          )}
                                          {formData.miscReimbursement && (
                                            <div>
                                              <span className="text-blue-600">Reimbursement:</span>{' '}
                                              <span className="font-medium text-green-700">${parseFloat(formData.miscReimbursement).toFixed(2)}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {matchedUserId && worker.user_id === matchedUserId && (
                                      <div className="mt-3 pt-3 border-y border-dashed border-slate-200 py-3">
                                        <p className="text-xs font-semibold text-slate-600 mb-2">Sick Leave Summary</p>
                                        {sickLeaveLoading ? (
                                          <p className="text-xs text-slate-500">Loading sick leave data…</p>
                                        ) : sickLeave ? (
                                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                                            <div>
                                              <span className="text-slate-500">Hours Used:</span>{' '}
                                              <span className="font-medium text-slate-900">{sickLeave.total_hours.toFixed(2)}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500">Hours Accrued:</span>{' '}
                                              <span className="font-medium text-slate-900">{sickLeave.accrued_hours.toFixed(2)}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500">Balance:</span>{' '}
                                              <span className="font-medium text-slate-900">{sickLeave.balance_hours.toFixed(2)}</span>
                                            </div>
                                          </div>
                                        ) : sickLeaveError ? (
                                          <p className="text-xs text-red-600">{sickLeaveError}</p>
                                        ) : (
                                          <p className="text-xs text-slate-500">No sick leave records yet.</p>
                                        )}
                                      </div>
                                    )}

                                    {matchedUserId && worker.user_id === matchedUserId && (
                                      <div className="mt-3 pt-3 border-t border-slate-200">
                                        <p className="text-xs font-semibold text-slate-700 mb-2">Pay Adjustments</p>
                                        <div className="flex items-center gap-4">
                                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                            <span className="whitespace-nowrap">Meal Premium $</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder="0.00"
                                              value={getOverride(matchedUserId).mealPremium}
                                              onChange={(ev) => setOverride(matchedUserId, 'mealPremium', ev.target.value)}
                                              className="w-24 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            />
                                          </label>
                                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                            <span className="whitespace-nowrap">Sick $</span>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              placeholder="0.00"
                                              value={getOverride(matchedUserId).sick}
                                              onChange={(ev) => setOverride(matchedUserId, 'sick', ev.target.value)}
                                              className="w-24 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                                            />
                                          </label>
                                        </div>
                                      </div>
                                    )}

                                    {worker.payment_data && (
                                      <div className="mt-2 pt-2 border-t border-slate-200">
                                        <p className="text-xs font-semibold text-slate-600 mb-1">💳 Database Payment Data:</p>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                          {worker.payment_data.total_pay !== null && worker.payment_data.total_pay > 0 && (
                                            <div>
                                              <span className="text-slate-500">Total Pay:</span>{' '}
                                              <span className="font-medium text-green-700">${worker.payment_data.total_pay.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.actual_hours !== null && worker.payment_data.actual_hours > 0 && (
                                            <div>
                                              <span className="text-slate-500">Actual Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{worker.payment_data.actual_hours}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.regular_hours !== null && worker.payment_data.regular_hours > 0 && (
                                            <div>
                                              <span className="text-slate-500">Regular Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{worker.payment_data.regular_hours}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.regular_pay !== null && worker.payment_data.regular_pay > 0 && (
                                            <div>
                                              <span className="text-slate-500">Regular Pay:</span>{' '}
                                              <span className="font-medium text-slate-900">${worker.payment_data.regular_pay.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.overtime_hours !== null && worker.payment_data.overtime_hours > 0 && (
                                            <div>
                                              <span className="text-slate-500">OT Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{worker.payment_data.overtime_hours}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.overtime_pay !== null && worker.payment_data.overtime_pay > 0 && (
                                            <div>
                                              <span className="text-slate-500">OT Pay:</span>{' '}
                                              <span className="font-medium text-slate-900">${worker.payment_data.overtime_pay.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.tips !== null && worker.payment_data.tips > 0 && (
                                            <div>
                                              <span className="text-slate-500">Tips:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.tips.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.variable_incentive !== null && worker.payment_data.variable_incentive > 0 && (
                                            <div>
                                              <span className="text-slate-500">Variable Incentive:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.variable_incentive.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.commissions !== null && worker.payment_data.commissions > 0 && (
                                            <div>
                                              <span className="text-slate-500">Commissions:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.commissions.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.rest_break_pay !== null && worker.payment_data.rest_break_pay > 0 && (
                                            <div>
                                              <span className="text-slate-500">Rest Break Pay:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.rest_break_pay.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.travel_pay !== null && worker.payment_data.travel_pay > 0 && (
                                            <div>
                                              <span className="text-slate-500">Travel Pay:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.travel_pay.toFixed(2)}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm text-blue-900">
                        <strong>{events.length}</strong> event{events.length !== 1 ? 's' : ''} found during this pay period
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary Section */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 space-y-6">
              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={generating || !formData.employeeName}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? (
                  <>
                    <div className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Generate Paystub PDF (Single)
                  </>
                )}
              </button>

              {/* Batch Generate Button (Excel import) */}
              {importedEmployees.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-slate-600">
                    Excel rows: <span className="font-semibold">{importedEmployees.length}</span>, matched:{' '}
                    <span className="font-semibold">{importedEmployees.filter((e) => !!e.matchedUserId).length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => handleGenerateBatch('merge')}
                      disabled={batchGenerating}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      title="Downloads one combined PDF containing all generated paystubs"
                    >
                      {batchGenerating ? (
                        <>
                          <div className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Batch PDF (Merged)
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleGenerateBatch('separate')}
                      disabled={batchGenerating}
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      title="Downloads one PDF per employee (your browser may prompt or block multiple downloads)"
                    >
                      {batchGenerating ? (
                        <>
                          <div className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Batch PDFs (Separate)
                        </>
                      )}
                    </button>
                  </div>
                  {batchMessage && (
                    <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-2">
                      {batchMessage}
                    </div>
                  )}
                  {batchErrors.length > 0 && (
                    <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded-md p-2 max-h-40 overflow-auto">
                      <div className="font-semibold text-slate-900 mb-1">Skipped / Errors</div>
                      <ul className="list-disc pl-5 space-y-1">
                        {batchErrors.slice(0, 50).map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                      {batchErrors.length > 50 && (
                        <div className="mt-2 text-slate-600">Showing first 50.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Create Report Button */}
              <button
                onClick={handleCreateReport}
                disabled={creatingReport || !formData.employeeName}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-800 rounded-lg text-sm font-semibold shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {creatingReport ? (
                  <>
                    <div className="inline-block h-4 w-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                    Downloading commission report...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 17v-6a2 2 0 012-2h2a2 2 0 012 2v6m-8 0h8m-8 0a2 2 0 01-2-2V7a2 2 0 012-2h5.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V15a2 2 0 01-2 2"
                      />
                    </svg>
                    Download commission report
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
