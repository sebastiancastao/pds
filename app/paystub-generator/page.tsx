'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

interface PaymentData {
  actual_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  doubletime_hours: number | null;
  regular_pay: number | null;
  overtime_pay: number | null;
  doubletime_pay: number | null;
  commissions: number | null;
  tips: number | null;
  total_pay: number | null;
}

interface Worker {
  user_id: string;
  user_name: string;
  user_email: string;
  phone?: string;
  address?: string;
  status: string;
  payment_data: PaymentData | null;
}

interface Event {
  id: string;
  name: string;
  artist: string | null;
  venue: string;
  event_type: string;
  event_date: string;
  city: string | null;
  state: string | null;
  workers?: Worker[];
}

interface SickLeaveBalance {
  total_hours: number;
  total_days: number;
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  balance_hours: number;
  balance_days: number;
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
  const [sickLeave, setSickLeave] = useState<SickLeaveBalance | null>(null);
  const [sickLeaveLoading, setSickLeaveLoading] = useState(false);
  const [sickLeaveError, setSickLeaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
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
        const response = await fetch(
          `/api/events-by-date?startDate=${formData.payPeriodStart}&endDate=${formData.payPeriodEnd}`
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/employees/${matchedUserId}/summary`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load sick leave data');
        }
        const data = await response.json();
        if (isMounted) {
          setSickLeave(data.summary?.sick_leave ?? null);
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

  const getFilteredEvents = () => {
    // Filter events to only include the matched employee's data
    return matchedUserId
      ? events
          .map(event => ({
            ...event,
            workers: event.workers?.filter(w => w.user_id === matchedUserId)
          }))
          .filter(event => event.workers && event.workers.length > 0)
      : events;
  };

  const sanitizeFilePart = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const filteredEvents = getFilteredEvents();

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
        state: formData.state,

        // Other
        miscDeduction: formData.miscDeduction,
        miscReimbursement: formData.miscReimbursement,

        // Events data
        events: filteredEvents,
        sickLeave
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

  const handleCreateReport = async () => {
    setCreatingReport(true);

    try {
      const filteredEvents = getFilteredEvents();
      const generatedAt = new Date().toISOString();

      const summaryRows: Array<[string, string | number]> = [
        ['Generated At', generatedAt],
        ['Employee Name', formData.employeeName],
        ['Employee ID', formData.employeeId],
        ['SSN', formData.ssn],
        ['Address', formData.address],
        ['Matched User ID', matchedUserId ?? ''],
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
            actual_hours: worker?.payment_data?.actual_hours ?? '',
            regular_hours: worker?.payment_data?.regular_hours ?? '',
            overtime_hours: worker?.payment_data?.overtime_hours ?? '',
            doubletime_hours: worker?.payment_data?.doubletime_hours ?? '',
            regular_pay: worker?.payment_data?.regular_pay ?? '',
            overtime_pay: worker?.payment_data?.overtime_pay ?? '',
            doubletime_pay: worker?.payment_data?.doubletime_pay ?? '',
            commissions: worker?.payment_data?.commissions ?? '',
            tips: worker?.payment_data?.tips ?? '',
            total_pay: worker?.payment_data?.total_pay ?? '',
          }));
        }) ?? [];

      const sickLeaveRows = sickLeave
        ? [
            {
              total_hours: sickLeave.total_hours,
              total_days: sickLeave.total_days,
              accrued_months: sickLeave.accrued_months,
              accrued_hours: sickLeave.accrued_hours,
              accrued_days: sickLeave.accrued_days,
              balance_hours: sickLeave.balance_hours,
              balance_days: sickLeave.balance_days,
            },
          ]
        : [];

      const wb = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...summaryRows.map(([k, v]) => [k, v])]);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(earningsRows), 'Earnings');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deductionsRows), 'Deductions');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventsRows), 'Events');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sickLeaveRows), 'SickLeave');

      const safeName = formData.employeeName ? sanitizeFilePart(formData.employeeName) : 'employee';
      const safePayDate = formData.payDate ? sanitizeFilePart(formData.payDate) : sanitizeFilePart(generatedAt);
      XLSX.writeFile(wb, `paystub-report-${safeName}-${safePayDate}.xlsx`);
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

      // Expected format: First row is headers, second row is data
      if (jsonData.length < 2) {
        setUploadError('Excel file must have at least 2 rows (headers and data)');
        return;
      }

      const headers = jsonData[0].map((h: any) => String(h).toLowerCase().trim());
      const values = jsonData[1];

      const getValueByHeader = (possibleNames: string[]) => {
        for (const name of possibleNames) {
          const index = headers.findIndex((h: string) => h.includes(name));
          if (index !== -1 && values[index] != null && values[index] !== '') {
            const val = values[index];
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
      const getAbsoluteValue = (possibleNames: string[]) => {
        const value = getValueByHeader(possibleNames);
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
      let detectedState = formData.state;
      const caStateIncome = getValueByHeader(['ca state income']);
      const wiStateIncome = getValueByHeader(['wi state income']);
      const azStateIncome = getValueByHeader(['az state income']);

      if (caStateIncome) detectedState = 'CA';
      else if (wiStateIncome) detectedState = 'WI';
      else if (azStateIncome) detectedState = 'AZ';

      // Get state-specific deductions
      let stateIncome = '';
      let stateDI = '';

      if (detectedState === 'CA') {
        stateIncome = getAbsoluteValue(['ca state income']);
        stateDI = getAbsoluteValue(['ca state di']);
      } else if (detectedState === 'WI') {
        stateIncome = getAbsoluteValue(['wi state income']);
      } else if (detectedState === 'AZ') {
        stateIncome = getAbsoluteValue(['az state income']);
      }

      // Get gross pay and net pay
      const grossPay = getValueByHeader(['gross pay']);
      const netPay = getValueByHeader(['net pay']);

      // Calculate hours and rates from gross pay if available
      let regularHours = '';
      let regularRate = '';

      if (grossPay && parseFloat(grossPay) > 0) {
        // Assume 80 hours for biweekly pay period
        regularHours = '80';
        const rate = parseFloat(grossPay) / 80;
        regularRate = rate.toFixed(2);
      }

      // Map Excel data to form fields
      const updatedFormData = {
        employeeName: getValueByHeader(['employee name', 'name', 'employee']),
        ssn: getValueByHeader(['ssn', 'social security']),
        address: getValueByHeader(['address']),
        employeeId: getValueByHeader(['employee id', 'emp id', 'id', 'page']),

        payPeriodStart: formatDate(getValueByHeader(['pay period start', 'period start', 'start date'])),
        payPeriodEnd: formatDate(getValueByHeader(['pay period end', 'period end', 'end date'])),
        payDate: formatDate(getValueByHeader(['pay date', 'payment date'])),

        regularHours: regularHours || getValueByHeader(['regular hours', 'hours']),
        regularRate: regularRate || getValueByHeader(['regular rate', 'hourly rate', 'rate']),
        overtimeHours: getValueByHeader(['overtime hours', 'ot hours']),
        overtimeRate: getValueByHeader(['overtime rate', 'ot rate']),
        doubleTimeHours: getValueByHeader(['double time hours', 'dt hours']),
        doubleTimeRate: getValueByHeader(['double time rate', 'dt rate']),

        federalIncome: getAbsoluteValue(['federal income', 'federal tax', 'fed income']),
        socialSecurity: getAbsoluteValue(['social security', 'ss', 'fica']),
        medicare: getAbsoluteValue(['medicare', 'med']),
        stateIncome: stateIncome,
        stateDI: stateDI,
        state: detectedState,

        miscDeduction: getAbsoluteValue(['misc non taxable', 'misc deduction', 'other deduction']),
        miscReimbursement: getValueByHeader(['misc reimbursement', 'reimbursement']),
      };

      setFormData(updatedFormData);

      // Match employee name with official_name in profiles
      if (updatedFormData.employeeName) {
        try {
          const response = await fetch(`/api/match-employee?name=${encodeURIComponent(updatedFormData.employeeName)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.user_id) {
              setMatchedUserId(data.user_id);
              setUploadSuccess(`Excel data imported and matched to ${updatedFormData.employeeName}!`);
            } else {
              setMatchedUserId(null);
              setUploadSuccess('Excel data imported successfully! (No matching employee found)');
            }
          } else {
            setMatchedUserId(null);
            setUploadSuccess('Excel data imported successfully! (Could not match employee)');
          }
        } catch (error) {
          console.error('Error matching employee:', error);
          setMatchedUserId(null);
          setUploadSuccess('Excel data imported successfully! (Error matching employee)');
        }
      } else {
        setUploadSuccess('Excel data imported successfully!');
      }

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
          </div>
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
                    The file should have headers in the first row and data in the second row.
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
                </div>
              </div>
            </div>

            {/* Employee Information */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Employee Information</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Employee Name
                  </label>
                  <input
                    type="text"
                    name="employeeName"
                    value={formData.employeeName}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    SSN
                  </label>
                  <input
                    type="text"
                    name="ssn"
                    value={formData.ssn}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="XXX-XX-1234"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="123 Main St, City, State 12345"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    name="employeeId"
                    value={formData.employeeId}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="EMP-001"
                  />
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
                            <h3 className="font-semibold text-slate-900">{event.name}</h3>
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
                              {new Date(event.event_date).toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'short'
                              })}
                            </p>
                          </div>
                          <div className="flex-shrink-0">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {event.event_type}
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
                                              <span className="text-slate-500">Days Used:</span>{' '}
                                              <span className="font-medium text-slate-900">{sickLeave.total_days.toFixed(2)}</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500">Accrued:</span>{' '}
                                              <span className="font-medium text-slate-900">{sickLeave.accrued_days.toFixed(2)} days</span>
                                            </div>
                                            <div>
                                              <span className="text-slate-500">Balance:</span>{' '}
                                              <span className="font-medium text-slate-900">{sickLeave.balance_days.toFixed(2)} days</span>
                                            </div>
                                          </div>
                                        ) : sickLeaveError ? (
                                          <p className="text-xs text-red-600">{sickLeaveError}</p>
                                        ) : (
                                          <p className="text-xs text-slate-500">No sick leave records yet.</p>
                                        )}
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
                                          {worker.payment_data.doubletime_hours !== null && worker.payment_data.doubletime_hours > 0 && (
                                            <div>
                                              <span className="text-slate-500">DT Hours:</span>{' '}
                                              <span className="font-medium text-slate-900">{worker.payment_data.doubletime_hours}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.doubletime_pay !== null && worker.payment_data.doubletime_pay > 0 && (
                                            <div>
                                              <span className="text-slate-500">DT Pay:</span>{' '}
                                              <span className="font-medium text-slate-900">${worker.payment_data.doubletime_pay.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.tips !== null && worker.payment_data.tips > 0 && (
                                            <div>
                                              <span className="text-slate-500">Tips:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.tips.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {worker.payment_data.commissions !== null && worker.payment_data.commissions > 0 && (
                                            <div>
                                              <span className="text-slate-500">Commissions:</span>{' '}
                                              <span className="font-medium text-blue-700">${worker.payment_data.commissions.toFixed(2)}</span>
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
              {/* Summary Card */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Summary</h2>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Gross Pay</span>
                    <span className="text-lg font-semibold text-slate-900">
                      ${grossPay.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-600">Total Deductions</span>
                    <span className="text-lg font-semibold text-red-600">
                      -${totalDeductions.toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-slate-200 pt-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-slate-900">Net Pay</span>
                      <span className="text-2xl font-bold text-green-700">
                        ${netPay.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

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
                    Generate Paystub PDF
                  </>
                )}
              </button>

              {/* Create Report Button */}
              <button
                onClick={handleCreateReport}
                disabled={creatingReport || !formData.employeeName}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-800 rounded-lg text-sm font-semibold shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {creatingReport ? (
                  <>
                    <div className="inline-block h-4 w-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                    Creating report...
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
                    Create report
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
