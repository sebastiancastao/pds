"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption";
import "@/app/global-calendar/dashboard-styles.css";

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

export default function HRDashboardPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [hrView, setHrView] = useState<"overview" | "employees" | "payments">("overview");

  const [employees, setEmployees] = useState<Employee[]>([]);
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

  // Editable adjustments: eventId -> (userId -> amount)
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, number>>>({});
  const [editingCell, setEditingCell] = useState<{ eventId: string; userId: string } | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);

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

  // Gate access: only 'admin' and 'hr'
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
        if (!error && (role === 'admin' || role === 'hr')) {
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
      const eventIds = filtered.map((e: any) => e.id).join(',');
      if (!eventIds) { setPaymentsByVenue([]); setLoadingPayments(false); return; }
      // Fetch vendor payments for filtered events (same data model as Global Calendar)
      const payRes = await fetch(`/api/vendor-payments`, {
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
      const byVenue: Record<string, { venue: string; city?: string | null; state?: string | null; totalPayment: number; totalHours: number; events: any[] }> = {};

      // Show ALL filtered events, not just those with payment data
      const eventsMap: Record<string, any> = Object.fromEntries(allEvents.map((e: any) => [e.id, e]));

      console.log('[HR PAYMENTS] Processing filtered events:', { filteredCount: filtered.length, withPaymentData: Object.keys(paymentsByEventId).length });

      for (const eventInfo of filtered) {
        const eventId = eventInfo.id;
        const eventPaymentData = paymentsByEventId[eventId];

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
                  baseRate: 17.28,
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
            baseRate: 17.28,
            eventTotal: 0,
            eventHours: 0,
            payments: []
          });
          continue;
        }

        // Process events with payment data
        const vendorPayments = eventPaymentData.vendorPayments;
        const eventPaymentSummary = eventPaymentData.eventPayment || {};
        const baseRate = Number(eventPaymentSummary.base_rate || 17.28);
        console.log('[HR PAYMENTS] Event with payment data:', eventId, eventInfo.event_name, { vendorCount: vendorPayments.length });

        // Map vendor payments to the normalized shape used in Global Calendar
        const eventPayments = vendorPayments.map((payment: any) => {
          const user = payment.users;
          const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
          const rawFirstName = profile?.first_name || 'N/A';
          const rawLastName = profile?.last_name || '';
          const firstName = rawFirstName !== 'N/A' ? safeDecrypt(rawFirstName) : 'N/A';
          const lastName = rawLastName ? safeDecrypt(rawLastName) : '';
          const adjustmentAmount = Number(payment.adjustment_amount || 0);
          const totalPay = Number(payment.total_pay || 0);
          return {
            userId: payment.user_id,
            firstName,
            lastName,
            email: user?.email || 'N/A',
            actualHours: Number(payment.actual_hours || 0),
            regularHours: Number(payment.regular_hours || 0),
            regularPay: Number(payment.regular_pay || 0),
            overtimeHours: Number(payment.overtime_hours || 0),
            overtimePay: Number(payment.overtime_pay || 0),
            doubletimeHours: Number(payment.doubletime_hours || 0),
            doubletimePay: Number(payment.doubletime_pay || 0),
            commissions: Number(payment.commissions || 0),
            tips: Number(payment.tips || 0),
            totalPay,
            adjustmentAmount,
            finalPay: totalPay + adjustmentAmount,
          };
        });
        console.log('[HR PAYMENTS] event payments mapped', { eventId, count: eventPayments.length, sample: eventPayments.slice(0,2).map((p: any) => ({ userId: p.userId, hours: p.actualHours, total: p.totalPay })) });

        const eventTotal = eventPayments.reduce((sum: number, p: any) => sum + p.totalPay, 0);
        const eventHours = eventPayments.reduce((sum: number, p: any) => sum + p.actualHours, 0);

        byVenue[eventInfo.venue].totalPayment += eventTotal;
        byVenue[eventInfo.venue].totalHours += eventHours;
        byVenue[eventInfo.venue].events.push({
          id: eventId,
          name: eventInfo.event_name,
          date: eventInfo.event_date,
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
      setPaymentsByVenue(prev => prev.map(v => ({
        ...v,
        events: v.events.map((ev: any) => {
          if (ev.id !== eventId) return ev;
          const payments = (ev.payments || []).map((p: any) => {
            if (p.userId !== userId) return p;
            const newAdj = amount;
            return { ...p, adjustmentAmount: newAdj, finalPay: Number(p.totalPay || 0) + newAdj };
          });
          const eventTotal = payments.reduce((sum: number, p: any) => sum + p.totalPay, 0);
          const eventHours = payments.reduce((sum: number, p: any) => sum + p.actualHours, 0);
          return { ...ev, payments, eventTotal, eventHours };
        })
      })));
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
              <h1 className="text-5xl font-semibold text-gray-900 mb-3 tracking-tight">HR Dashboard</h1>
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
          </div>
        </div>

        {hrView === "overview" && (
          <div className="space-y-8">
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Key Metrics</h2>
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
                    <div className="text-4xl font-bold text-gray-900 mb-2 tracking-tight">{hrStats.totalEmployees}</div>
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
                    <div className="text-4xl font-bold text-gray-900 mb-2 tracking-tight">{totalDepartments}</div>
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
                    <div className="text-4xl font-bold text-gray-900 mb-2 tracking-tight">{hrStats.approvedBackgroundChecks}</div>
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
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Departments Overview</h2>
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
                <button onClick={sendPaymentEmails} className={`apple-button ${sendingEmails ? 'apple-button-disabled' : 'apple-button-secondary'}`} disabled={sendingEmails}>
                  {sendingEmails ? 'Emailing…' : 'Email Final Payments'}
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
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Hours</th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
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
                                          <tr>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Reg Hrs</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Reg Pay</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">OT Hrs</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">OT Pay</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">DT Hrs</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">DT Pay</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Commissions</th>
                                            <th className="p-2 text-left text-xs font-medium text-gray-500 uppercase">Tips</th>
                                            <th className="p-2 text-right text-xs font-medium text-gray-500 uppercase">Adj</th>
                                            <th className="p-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                                          </tr>
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
                                                    }`} title="Team member assigned, awaiting time tracking">
                                                      {p.status === 'confirmed' ? 'Confirmed' : p.status === 'pending_confirmation' ? 'Pending' : p.status}
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="p-2 text-sm">{Number(p.regularHours || 0).toFixed(2)}h</td>
                                              <td className="p-2 text-sm text-green-600">${Number(p.regularPay || 0).toFixed(2)}</td>
                                              <td className="p-2 text-sm">{Number(p.overtimeHours || 0).toFixed(2)}h</td>
                                              <td className="p-2 text-sm text-green-600">${Number(p.overtimePay || 0).toFixed(2)}</td>
                                              <td className="p-2 text-sm">{Number(p.doubletimeHours || 0).toFixed(2)}h</td>
                                              <td className="p-2 text-sm text-green-600">${Number(p.doubletimePay || 0).toFixed(2)}</td>
                                              <td className="p-2 text-sm text-purple-600">${Number(p.commissions || 0).toFixed(2)}</td>
                                              <td className="p-2 text-sm text-orange-600">${Number(p.tips || 0).toFixed(2)}</td>
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
                                              <td className="p-2 text-sm font-semibold text-right">${Number(p.finalPay || 0).toFixed(2)}</td>
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
        {hrView === "employees" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Employees</h2>
              <div className="flex items-center gap-3">
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
              {employees.map((e) => {
                const firstName = e.first_name ? safeDecrypt(e.first_name) : '';
                const lastName = e.last_name ? safeDecrypt(e.last_name) : '';
                return (
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
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
