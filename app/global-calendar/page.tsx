// app/global-calendar/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import "./dashboard-styles.css";



type EventItem = {
  id: string;
  created_by: string;
  event_name: string;
  artist: string | null;
  venue: string;
  city: string | null;
  state: string | null;
  event_date: string;  // YYYY-MM-DD
  start_time: string;  // HH:MM:SS
  end_time: string;    // HH:MM:SS
  ticket_sales: number | null;
  ticket_count?: number | null;
  artist_share_percent: number;
  venue_share_percent: number;
  pds_share_percent: number;
  commission_pool: number | null;
  required_staff: number | null;
  confirmed_staff: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tax_rate_percent?: number | null;
  tips_total?: number | null;
};

type Vendor = {
  id: string;
  email: string;
  role: string;
  division: string;
  is_active: boolean;
  distance: number | null;
  hasCoordinates?: boolean;
  recently_responded?: boolean;
  profiles: {
    first_name: string;
    last_name: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
    profile_photo_url?: string | null;
  };
};

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

type LeaveRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: "vacation" | "sick" | "personal" | "unpaid";
  start_date: string;
  end_date: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  days: number;
};

type Department = {
  name: string;
  employee_count: number;
  color: string;
};

type BackgroundCheck = {
  id: string;
  vendor_id: string;
  status: "pending" | "approved" | "rejected" | "in_progress";
  check_date: string;
  verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"events" | "payments">("events");
  const [hrView, setHrView] = useState<"overview" | "employees" | "leaves">("overview");

  // Auth & Access Control
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Events
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedVenue, setSelectedVenue] = useState<string>("all");

  // Vendors / Regions (Calendar Availability Request)
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);

  // Team creation for a given event
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [availableVendors, setAvailableVendors] = useState<Vendor[]>([]);
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<Set<string>>(new Set());
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");

  // HR tab state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [backgroundChecks, setBackgroundChecks] = useState<BackgroundCheck[]>([]);
  const [selectedState, setSelectedState] = useState<string>("all");
  const [selectedEmployeeRegion, setSelectedEmployeeRegion] = useState<string>("all");
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeesError, setEmployeesError] = useState<string>("");

  // Payments tab state
  const [paymentsStartDate, setPaymentsStartDate] = useState<string>("");
  const [paymentsEndDate, setPaymentsEndDate] = useState<string>("");
  const [paymentsData, setPaymentsData] = useState<any>(null);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string>("");
  const [adjustments, setAdjustments] = useState<Record<string, Record<string, number>>>({});  // {eventId: {userId: adjustmentAmount}}
  const [savingAdjustments, setSavingAdjustments] = useState(false);
  const [sendingPayments, setSendingPayments] = useState(false);

  // Staff predictions for events
  const [predictions, setPredictions] = useState<Record<string, { predictedStaff: number; confidence: number; loading: boolean }>>({});

  // Helpers
  const toIsoDateTime = (dateStr: string, timeStr?: string | null) => {
    if (!dateStr) return undefined;
    if (!timeStr) return new Date(`${dateStr}T00:00:00`).toISOString();
    const local = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(local.getTime())) return undefined;
    return local.toISOString();
  };
  const addHours = (iso: string | undefined, hours: number) => {
    if (!iso) return undefined;
    const d = new Date(iso);
    d.setHours(d.getHours() + hours);
    return d.toISOString();
  };

  // Load staff prediction for an event
  const loadPrediction = useCallback(async (eventId: string) => {
    setPredictions(prev => {
      if (prev[eventId]?.loading) return prev; // Already loading
      return { ...prev, [eventId]: { predictedStaff: 0, confidence: 0, loading: true } };
    });
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}/predict-staff`, {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        setPredictions(prev => ({
          ...prev,
          [eventId]: {
            predictedStaff: data.predictedStaff || 0,
            confidence: data.confidence || 0,
            loading: false,
          },
        }));
      } else {
        setPredictions(prev => ({ ...prev, [eventId]: { predictedStaff: 0, confidence: 0, loading: false } }));
      }
    } catch (err) {
      console.error("[GLOBAL-CALENDAR] Error loading prediction:", err);
      setPredictions(prev => ({ ...prev, [eventId]: { predictedStaff: 0, confidence: 0, loading: false } }));
    }
  }, []);

  // Load employees function - needs to be outside useEffect to be called by handlers
  const loadEmployees = useCallback(async (stateFilter: string = "all", regionFilter: string = "all") => {
    setLoadingEmployees(true);
    setEmployeesError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (stateFilter !== "all") params.append("state", stateFilter);
      if (regionFilter !== "all") {
        params.append("region_id", regionFilter);
        params.append("geo_filter", "true");
      }
      console.log('[GLOBAL-CALENDAR-HR] 🔍 Loading employees with filters:', { stateFilter, regionFilter });
      const res = await fetch(`/api/employees${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load employees");
      console.log('[GLOBAL-CALENDAR-HR] 📦 Employees loaded:', {
        count: data.employees?.length || 0,
        region: data.region?.name || 'all',
        geo_filtered: data.geo_filtered
      });
      setEmployees(data.employees || []);
      if (data.stats?.states) setAvailableStates(data.stats.states);
    } catch (err: any) {
      console.error('[GLOBAL-CALENDAR-HR] ❌ Error loading employees:', err);
      setEmployeesError(err.message || "Failed to load employees");
    }
    setLoadingEmployees(false);
  }, []);

  // Load background checks
  const loadBackgroundChecks = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[GLOBAL-CALENDAR-HR] 🔍 Loading background checks...');

      const { data, error } = await supabase
        .from('vendor_background_checks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log('[GLOBAL-CALENDAR-HR] 📦 Background checks loaded:', {
        count: data?.length || 0,
        approved: data?.filter((bc: any) => bc.status === 'approved').length || 0
      });

      setBackgroundChecks(data || []);
    } catch (err: any) {
      console.error('[GLOBAL-CALENDAR-HR] ❌ Error loading background checks:', err);
    }
  }, []);

  // Load payments data for date range
  const loadPaymentsData = useCallback(async (startDate: string, endDate: string) => {
    setLoadingPayments(true);
    setPaymentsError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[PAYMENTS] 🔍 Loading payments from database for', startDate, 'to', endDate);

      // Fetch ALL events using the API endpoint (bypasses RLS issues)
      const eventsRes = await fetch("/api/all-events", {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      if (!eventsRes.ok) {
        const errorData = await eventsRes.json();
        throw new Error(errorData.error || "Failed to load events");
      }

      const eventsJson = await eventsRes.json();
      const allEvents = eventsJson.events || [];

      console.log('[PAYMENTS] 📅 All events loaded:', {
        count: allEvents.length,
        events: allEvents.slice(0, 5).map((e: any) => ({ name: e.event_name, date: e.event_date }))
      });

      if (allEvents.length === 0) {
        console.warn('[PAYMENTS] ⚠️ No events found in database');
        setPaymentsError('No events found in the database.');
        setLoadingPayments(false);
        return;
      }

      // Use ALL events (no date filtering)
      const eventsData = allEvents;

      console.log('[PAYMENTS] 📦 Processing ALL', eventsData.length, 'events (date filter ignored)');
      console.log('[PAYMENTS] Events:', eventsData.map((e: any) => ({ name: e.event_name, date: e.event_date })));

      // Fetch all vendor payments for ALL events using API (bypasses RLS)
      const eventIds = eventsData.map((e: any) => e.id).join(',');
      console.log('[PAYMENTS] 🔍 Fetching vendor payments for ALL', eventsData.length, 'events via API');

      const paymentsApiRes = await fetch(`/api/vendor-payments?event_ids=${encodeURIComponent(eventIds)}`, {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      if (!paymentsApiRes.ok) {
        const errorData = await paymentsApiRes.json();
        throw new Error(errorData.error || "Failed to load vendor payments");
      }

      const paymentsApiData = await paymentsApiRes.json();
      const paymentsByEventId = paymentsApiData.paymentsByEvent || {};

      console.log('[PAYMENTS] ✅ Fetched payment data for', Object.keys(paymentsByEventId).length, 'events');
      console.log('[PAYMENTS] Total vendor payment records:', paymentsApiData.totalVendorPayments);

      const paymentsByVenue: Record<string, any> = {};

      for (const event of eventsData || []) {
        const eventPaymentData = paymentsByEventId[event.id];

        if (!eventPaymentData || !eventPaymentData.vendorPayments || eventPaymentData.vendorPayments.length === 0) {
          console.log('[PAYMENTS] ⚠️ No saved payment data for event', event.event_name, '(ID:', event.id, ')');
          continue;
        }

        const vendorPayments = eventPaymentData.vendorPayments;
        const eventPaymentSummary = eventPaymentData.eventPayment;

        console.log('[PAYMENTS] ✅ Found', vendorPayments.length, 'vendor payments for event', event.event_name);

        const baseRate = eventPaymentSummary?.base_rate || 17.28;

        // Initialize venue if not exists
        if (!paymentsByVenue[event.venue]) {
          paymentsByVenue[event.venue] = {
            venue: event.venue,
            city: event.city,
            state: event.state,
            events: [],
            totalPayment: 0,
            totalHours: 0,
          };
        }

        // Transform vendor payments data
        const eventPayments = vendorPayments.map((payment: any) => {
          const user = payment.users;
          const profile = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;

          // Debug: Log encrypted vs decrypted names
          const rawFirstName = profile?.first_name || "N/A";
          const rawLastName = profile?.last_name || "";

          console.log('[PAYMENTS] 🔍 Raw name data:', {
            rawFirst: rawFirstName,
            rawFirstLength: rawFirstName.length,
            rawLast: rawLastName,
            rawLastLength: rawLastName.length
          });

          const firstName = rawFirstName !== "N/A" ? safeDecrypt(rawFirstName) : "N/A";
          const lastName = rawLastName ? safeDecrypt(rawLastName) : "";

          console.log('[PAYMENTS] ✅ After decryption:', {
            firstName,
            lastName,
            firstChanged: firstName !== rawFirstName,
            lastChanged: lastName !== rawLastName
          });

          const adjustmentAmount = Number(payment.adjustment_amount || 0);

          return {
            userId: payment.user_id,
            firstName,
            lastName,
            email: user?.email || "N/A",
            actualHours: Number(payment.actual_hours || 0),
            regularHours: Number(payment.regular_hours || 0),
            regularPay: Number(payment.regular_pay || 0),
            overtimeHours: Number(payment.overtime_hours || 0),
            overtimePay: Number(payment.overtime_pay || 0),
            doubletimeHours: Number(payment.doubletime_hours || 0),
            doubletimePay: Number(payment.doubletime_pay || 0),
            commissions: Number(payment.commissions || 0),
            tips: Number(payment.tips || 0),
            totalPay: Number(payment.total_pay || 0),
            adjustmentAmount,
            finalPay: Number(payment.total_pay || 0) + adjustmentAmount,
          };
        });

        paymentsByVenue[event.venue].events.push({
          eventId: event.id,
          eventName: event.event_name,
          eventDate: event.event_date,
          baseRate,
          payments: eventPayments,
        });

        const eventTotal = eventPayments.reduce((sum: number, p: any) => sum + p.totalPay, 0);
        const eventHours = eventPayments.reduce((sum: number, p: any) => sum + p.actualHours, 0);
        paymentsByVenue[event.venue].totalPayment += eventTotal;
        paymentsByVenue[event.venue].totalHours += eventHours;
      }

      const venueCount = Object.keys(paymentsByVenue).length;
      console.log('[PAYMENTS] ✅ Payment data loaded from database:', venueCount, 'venues with payment data');

      if (venueCount === 0 && eventsData && eventsData.length > 0) {
        console.warn('[PAYMENTS] ⚠️ Found', eventsData.length, 'events in date range but NONE have saved payment data. Go to each event dashboard HR/Payments tab and click "Save Payment Data"');
        setPaymentsError(`Found ${eventsData.length} event(s) in the selected date range, but none have saved payment data yet. Please go to the event dashboard and click "Save Payment Data" in the HR/Payments tab.`);
      } else if (venueCount === 0) {
        console.warn('[PAYMENTS] ⚠️ No events found in the selected date range:', startDate, 'to', endDate);
        setPaymentsError('No events found in the selected date range. Try adjusting the dates.');
      }

      // Initialize adjustments state from loaded data
      const initialAdjustments: Record<string, Record<string, number>> = {};
      Object.values(paymentsByVenue).forEach((venue: any) => {
        venue.events.forEach((eventData: any) => {
          if (!initialAdjustments[eventData.eventId]) {
            initialAdjustments[eventData.eventId] = {};
          }
          eventData.payments.forEach((payment: any) => {
            initialAdjustments[eventData.eventId][payment.userId] = payment.adjustmentAmount || 0;
          });
        });
      });
      setAdjustments(initialAdjustments);

      setPaymentsData(paymentsByVenue);
    } catch (err: any) {
      console.error('[PAYMENTS] ❌ Error loading payment data:', err);
      setPaymentsError(err.message || "Failed to load payment data");
    } finally {
      setLoadingPayments(false);
    }
  }, []);

  // Handle adjustment change
  const handleAdjustmentChange = (eventId: string, userId: string, value: number) => {
    setAdjustments(prev => ({
      ...prev,
      [eventId]: {
        ...(prev[eventId] || {}),
        [userId]: value,
      },
    }));
  };

  // Save adjustments to database
  const saveAdjustments = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      alert('Not authenticated');
      return;
    }

    setSavingAdjustments(true);
    try {
      // Flatten adjustments into array format
      const adjustmentsArray: any[] = [];
      Object.entries(adjustments).forEach(([eventId, userAdjustments]) => {
        Object.entries(userAdjustments).forEach(([userId, adjustmentAmount]) => {
          if (adjustmentAmount !== 0) {  // Only save non-zero adjustments
            adjustmentsArray.push({
              event_id: eventId,
              user_id: userId,
              adjustment_amount: adjustmentAmount,
            });
          }
        });
      });

      if (adjustmentsArray.length === 0) {
        alert('No adjustments to save');
        return;
      }

      const res = await fetch('/api/payment-adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ adjustments: adjustmentsArray }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save adjustments');
      }

      alert('Adjustments saved successfully!');
      // Reload payment data to get updated values
      if (paymentsStartDate && paymentsEndDate) {
        await loadPaymentsData(paymentsStartDate, paymentsEndDate);
      }
    } catch (err: any) {
      console.error('[PAYMENTS] Error saving adjustments:', err);
      alert(`Error saving adjustments: ${err.message}`);
    } finally {
      setSavingAdjustments(false);
    }
  };

  // Send payment summaries to vendors
  const sendPaymentsToVendors = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      alert('Not authenticated');
      return;
    }

    if (!paymentsData || Object.keys(paymentsData).length === 0) {
      alert('No payment data to send');
      return;
    }

    const confirmed = confirm(
      'This will send payment summaries to all vendors for the selected period. Continue?'
    );

    if (!confirmed) return;

    setSendingPayments(true);
    try {
      const res = await fetch('/api/send-vendor-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          startDate: paymentsStartDate,
          endDate: paymentsEndDate,
          paymentsData,
          adjustments,
        }),
      });

      // Read response safely even if it's not JSON
      const rawText = await res.text();
      let data: any = null;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch (e) {
        throw new Error(`Server returned non-JSON (status ${res.status}). Body: ${rawText?.slice(0, 300)}`);
      }

      if (!res.ok || !data?.success) {
        const serverError = data?.error || rawText || 'Failed to send payments';
        throw new Error(typeof serverError === 'string' ? serverError : 'Failed to send payments');
      }

      alert(`Successfully sent payment summaries to ${data.sentCount || 0} vendor(s)!`);
    } catch (err: any) {
      console.error('[PAYMENTS] Error sending payments:', err);
      alert(`Error sending payments: ${err.message}`);
    } finally {
      setSendingPayments(false);
    }
  };

  // Auth check - MUST run first
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !session) {
          console.error('[GLOBAL-CALENDAR] No session found, redirecting to login');
          router.replace('/login');
          return;
        }

        // Check user role
        const { data: userData, error: userError } = await (supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single() as any);

        if (userError || !userData) {
          console.error('[GLOBAL-CALENDAR] Failed to fetch user data:', userError);
          router.replace('/dashboard');
          return;
        }

        // Only allow admin, exec, and manager users
        const role = userData.role as string;
        if (role !== 'admin' && role !== 'exec' && role !== 'manager') {
          console.error('[GLOBAL-CALENDAR] Access denied - user role:', role);
          router.replace('/dashboard');
          return;
        }

        console.log('[GLOBAL-CALENDAR] Access granted - user role:', role);
        setUserRole(role);
        setIsAuthorized(true);
      } catch (err) {
        console.error('[GLOBAL-CALENDAR] Auth check error:', err);
        router.replace('/login');
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  // Initial load - only runs after auth check passes
  useEffect(() => {
    if (!isAuthorized) return;

    const loadEvents = async () => {
      setError("");
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        // Global calendar uses /api/all-events to see ALL events across the organization
        const res = await fetch("/api/all-events", {
          method: "GET",
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load events");
        setEvents(data.events || []);
      } catch (e: any) {
        setError(e.message || "Failed to load events");
      }
      setLoading(false);
    };

    const loadHRMockData = async () => {
      // Leave requests mock data
      await new Promise((r) => setTimeout(r, 200));
      const mockLeaves: LeaveRequest[] = [
        { id: "1", employee_id: "4", employee_name: "Emily Davis", leave_type: "vacation", start_date: "2025-11-01", end_date: "2025-11-10", status: "pending", reason: "Family vacation", days: 10 },
        { id: "2", employee_id: "2", employee_name: "Sarah Johnson", leave_type: "sick", start_date: "2025-10-28", end_date: "2025-10-29", status: "approved", reason: "Medical appointment", days: 2 },
        { id: "3", employee_id: "1", employee_name: "John Smith", leave_type: "personal", start_date: "2025-11-15", end_date: "2025-11-15", status: "pending", reason: "Personal matter", days: 1 },
      ];
      setLeaveRequests(mockLeaves);
    };

    loadEvents();
    loadEmployees();
    loadBackgroundChecks();
    loadHRMockData();
    loadRegions();
  }, [isAuthorized, loadEmployees, loadBackgroundChecks]);

  // Load predictions when events are loaded
  useEffect(() => {
    if (events.length > 0) {
      events.forEach(ev => {
        loadPrediction(ev.id);
      });
    }
  }, [events, loadPrediction]);

  const venueOptions = Array.from(new Set(events.map((e) => e.venue))).sort();
  const filteredEvents =
    selectedVenue === "all" ? events : events.filter((e) => e.venue === selectedVenue);

  useEffect(() => {
    if (selectedVenue === "all") return;
    if (!events.some((e) => e.venue === selectedVenue)) {
      setSelectedVenue("all");
    }
  }, [events, selectedVenue]);

  // Derived stats
  const eventStats = {
    totalEvents: filteredEvents.length,
    activeEvents: filteredEvents.filter((e) => e.is_active).length,
    upcomingEvents: filteredEvents.filter((e) => new Date(e.event_date) >= new Date()).length,
    totalTicketSales: filteredEvents.reduce((sum, e) => sum + (e.ticket_sales || 0), 0),
    totalCommissionPool: filteredEvents.reduce((sum, e) => sum + (e.commission_pool || 0), 0),
    totalRequiredStaff: filteredEvents.reduce((sum, e) => sum + (e.required_staff || 0), 0),
    totalConfirmedStaff: filteredEvents.reduce((sum, e) => sum + (e.confirmed_staff || 0), 0),
  };

  // Calculate role distribution from actual employee data
  const roleCounts = employees.reduce((acc, emp) => {
    // Map employee positions to roles (vendor or manager)
    // Assume positions containing 'manager' or 'supervisor' are managers, rest are vendors
    const role = emp.position.toLowerCase().includes('manager') || emp.position.toLowerCase().includes('supervisor')
      ? 'manager'
      : 'vendor';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const calculatedDepartments: Department[] = [
    { name: "vendor", employee_count: roleCounts['vendor'] || 0, color: "blue" },
    { name: "manager", employee_count: roleCounts['manager'] || 0, color: "purple" },
  ];

  const hrStats = {
    totalEmployees: employees.length,
    activeEmployees: employees.filter((e) => e.status === "active").length,
    onLeaveEmployees: employees.filter((e) => e.status === "on_leave").length,
    newHiresThisMonth: employees.filter((e) => {
      const d = new Date(e.hire_date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    approvedBackgroundChecks: backgroundChecks.filter((bc) => bc.status === "approved").length,
    totalDepartments: calculatedDepartments.length,
  };

  // Region + vendors helpers
  const loadRegions = async () => {
    console.log('[GLOBAL-CALENDAR] 📍 Loading regions...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/regions", {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[GLOBAL-CALENDAR] ✅ Regions loaded:', data.regions?.length || 0, data.regions);
        setRegions(data.regions || []);
      } else {
        console.error('[GLOBAL-CALENDAR] ❌ Failed to load regions, status:', res.status);
      }
    } catch (err) {
      console.error("[GLOBAL-CALENDAR] ❌ Failed to load regions:", err);
    }
  };

  const buildVendorUrl = (venue: string, regionId: string) => {
    const params = new URLSearchParams({ venue });
    if (regionId && regionId !== "all") params.append("region_id", regionId);
    return `/api/vendors?${params.toString()}`;
  };

  const loadAllVendors = async (regionId: string = selectedRegion) => {
    console.log('[GLOBAL-CALENDAR] 🔍 loadAllVendors called with regionId:', regionId);
    setLoadingVendors(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Use geographic filtering when a region is selected
      const useGeoFilter = regionId !== "all";
      const url = `/api/all-vendors${regionId !== "all" ? `?region_id=${regionId}&geo_filter=true` : ""}`;
      console.log('[GLOBAL-CALENDAR] 📡 Fetching vendors from:', url, { useGeoFilter });

      // Fetch ALL vendors from the database directly, not filtered by venue
      const res = await fetch(url, {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });

      console.log('[GLOBAL-CALENDAR] 📥 Response status:', res.status, res.ok ? '✅' : '❌');

      if (!res.ok) {
        const errorData = await res.json();
        console.error('[GLOBAL-CALENDAR] ❌ API error:', errorData);
        throw new Error(errorData.error || "Failed to load vendors");
      }

      const data = await res.json();
      console.log('[GLOBAL-CALENDAR] 📦 Received data:', {
        vendors_count: data.vendors?.length || 0,
        region: data.region?.name || 'all',
        geo_filtered: data.geo_filtered,
        first_vendor: data.vendors?.[0]?.email || 'none'
      });

      // When using geo_filter, vendors are already sorted by distance
      // Otherwise, sort alphabetically
      const allVendors = data.geo_filtered
        ? data.vendors
        : (data.vendors || []).sort((a: Vendor, b: Vendor) => {
            const A = `${a.profiles.first_name} ${a.profiles.last_name}`.toLowerCase();
            const B = `${b.profiles.first_name} ${b.profiles.last_name}`.toLowerCase();
            return A.localeCompare(B);
          });

      console.log('[GLOBAL-CALENDAR] ✅ Setting vendors state:', allVendors.length);
      setVendors(allVendors);
    } catch (err: any) {
      console.error("[GLOBAL-CALENDAR] ❌ Error loading vendors:", err);
      setMessage(err.message || "Network error loading vendors");
    }
    setLoadingVendors(false);
  };

  // UI handlers
  const openVendorModal = () => {
    setShowVendorModal(true);
    setSelectedVendors(new Set());
    setSelectedRegion("all");
    setMessage("");
    loadRegions();
    loadAllVendors("all");
  };
  const closeVendorModal = () => {
    setShowVendorModal(false);
    setVendors([]);
    setSelectedVendors(new Set());
    setMessage("");
  };
  const handleRegionChange = async (newRegion: string) => {
    console.log('[GLOBAL-CALENDAR] 🌍 Region changed:', { from: selectedRegion, to: newRegion });
    setSelectedRegion(newRegion);
    setSelectedVendors(new Set());
    loadAllVendors(newRegion);
  };
  const toggleVendorSelection = (id: string) => {
    const s = new Set(selectedVendors);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedVendors(s);
  };
  const handleSelectAll = () => {
    if (selectedVendors.size === vendors.length) setSelectedVendors(new Set());
    else setSelectedVendors(new Set(vendors.map((v) => v.id)));
  };
  const handleInvite = async () => {
    if (selectedVendors.size === 0) return;
    setSubmitting(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/invitations/bulk-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vendorIds: Array.from(selectedVendors), durationWeeks: 3 }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(`Successfully sent ${data.stats.sent} invitation(s)!`);
        setSelectedVendors(new Set());
        if (data.stats.failed > 0) setMessage(`Sent ${data.stats.sent} invitations. ${data.stats.failed} failed.`);
      } else {
        setMessage(data.error || "Failed to send invitations");
      }
    } catch {
      setMessage("Network error sending invitations");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMessage(""), 5000);
    }
  };

  const openTeamModal = async (event: EventItem) => {
    setSelectedEvent(event);
    setShowTeamModal(true);
    setTeamMessage("");
    setLoadingAvailable(true);

    // Load available vendors first
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${event.id}/available-vendors`, {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const data = await res.json();
      if (res.ok) setAvailableVendors(data.vendors || []);
      else setTeamMessage("Failed to load available vendors");
    } catch {
      setTeamMessage("Network error loading available vendors");
    }
    setLoadingAvailable(false);

    // Load existing team members and merge with available vendors
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${event.id}/team`, {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const data = await res.json();
      if (res.ok && data.team && data.team.length > 0) {
        console.log('[GLOBAL-CALENDAR-TEAM] 📋 Loading', data.team.length, 'existing team members');

        // Convert team members to vendor format (names are already decrypted by API)
        const existingVendors = data.team.map((member: any) => ({
          id: member.vendor_id,
          email: member.users?.email || '',
          division: member.users?.division || '',
          profiles: {
            first_name: member.users?.profiles?.first_name || '',
            last_name: member.users?.profiles?.last_name || '',
            phone: member.users?.profiles?.phone || '',
            profile_photo_url: member.users?.profiles?.profile_photo_url || null,
          },
          distance: null,
          status: member.status, // Include status to show confirmation state
          isExistingMember: true // Flag to show they're already on the team
        }));

        // Merge existing team members with available vendors:
        // - Flag vendors already on the team (disable checkbox + show status chip)
        // - Add any team members that are not in the available list
        const existingById = new Map<string, any>(existingVendors.map((v: any) => [v.id, v]));
        setAvailableVendors((prevVendors) => {
          const updatedVendors = prevVendors.map((v: any) => {
            const existing = existingById.get(v.id);
            if (!existing) return v;
            return {
              ...v,
              status: existing.status,
              isExistingMember: true,
              profiles: {
                ...v.profiles,
                profile_photo_url:
                  existing.profiles?.profile_photo_url ??
                  (v.profiles as any)?.profile_photo_url ??
                  null,
              },
            };
          });

          const vendorIds = new Set(updatedVendors.map((v: any) => v.id));
          const newVendors = existingVendors.filter((v: any) => !vendorIds.has(v.id));
          return [...updatedVendors, ...newVendors];
        });

        // Pre-select existing team members AFTER merging
        const existingMemberIds = new Set<string>(
          (data.team as any[])
            .map((member: any) => String(member?.vendor_id ?? ""))
            .filter((id) => id.length > 0)
        );
        console.log('[GLOBAL-CALENDAR-TEAM] ✅ Pre-selecting', existingMemberIds.size, 'existing team members');
        setSelectedTeamMembers(existingMemberIds);
      } else {
        // No existing team - start with empty selection
        setSelectedTeamMembers(new Set());
      }
    } catch (err) {
      console.error('[GLOBAL-CALENDAR-TEAM] ❌ Error loading existing team members:', err);
      // Continue anyway - user can still create a team
      setSelectedTeamMembers(new Set());
    }
  };
  const closeTeamModal = () => {
    setShowTeamModal(false);
    setSelectedEvent(null);
    setAvailableVendors([]);
    setSelectedTeamMembers(new Set());
    setTeamMessage("");
  };
  const toggleTeamMember = (id: string) => {
    const s = new Set(selectedTeamMembers);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedTeamMembers(s);
  };
  const handleSelectAllTeam = () => {
    // Get vendors who are NOT already invited (new vendors only)
    const newVendors = availableVendors.filter((v) => !(v as any).isExistingMember);
    const existingVendors = availableVendors.filter((v) => (v as any).isExistingMember);

    // Get IDs of new vendors and existing vendors
    const newVendorIds = newVendors.map((v) => v.id);
    const existingVendorIds = existingVendors.map((v) => v.id);

    // Check if all NEW vendors are selected
    const allNewSelected = newVendorIds.every(id => selectedTeamMembers.has(id));

    if (allNewSelected) {
      // Deselect all NEW vendors, but keep existing members selected
      setSelectedTeamMembers(new Set(existingVendorIds));
    } else {
      // Select all NEW vendors + keep existing members selected
      setSelectedTeamMembers(new Set([...newVendorIds, ...existingVendorIds]));
    }
  };
  const handleSaveTeam = async () => {
    if (!selectedEvent || selectedTeamMembers.size === 0) return;
    setSavingTeam(true);
    setTeamMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${selectedEvent.id}/team`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vendorIds: Array.from(selectedTeamMembers) }),
      });
      const data = await res.json();
      if (res.ok) {
        // Use the message from the API which includes details about new/existing members
        setTeamMessage(data.message || `Team updated successfully!`);
        setTimeout(() => closeTeamModal(), 1500);
      } else {
        setTeamMessage(data.error || "Failed to create team");
      }
    } catch {
      setTeamMessage("Network error creating team");
    } finally {
      setSavingTeam(false);
    }
  };

  // Leaves
  const handleApproveLeave = (id: string) =>
    setLeaveRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "approved" } : r)));
  const handleRejectLeave = (id: string) =>
    setLeaveRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "rejected" } : r)));

  // Logout
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      sessionStorage.clear();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // HR filters
  const handleStateFilterChange = async (newState: string) => {
    setSelectedState(newState);
    loadEmployees(newState, selectedEmployeeRegion);
  };

  const handleEmployeeRegionChange = async (newRegion: string) => {
    console.log('[GLOBAL-CALENDAR-HR] 🌍 Region changed:', { from: selectedEmployeeRegion, to: newRegion });
    setSelectedEmployeeRegion(newRegion);
    loadEmployees(selectedState, newRegion);
  };

  const getLeaveTypeColor = (t: string) => {
    switch (t) {
      case "vacation":
        return "text-blue-600 bg-blue-100";
      case "sick":
        return "text-red-600 bg-red-100";
      case "personal":
        return "text-purple-600 bg-purple-100";
      case "unpaid":
        return "text-gray-600 bg-gray-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  // Show loading screen while checking authorization
  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="apple-spinner mb-4" />
          <p className="text-gray-600 text-lg">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authorized (already redirecting)
  if (!isAuthorized) {
    return null;
  }

  const allAvailableVendorsInvited =
    availableVendors.length > 0 &&
    availableVendors.every((v) => (v as any).isExistingMember);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-12 px-6">
        {/* Header */}
        <div className="mb-6">
          <div className={`flex ${userRole === "exec" || userRole === "hr" ? "flex-col gap-6" : "items-start justify-between"}`}>
            <div className={`${userRole === "exec" || userRole === "hr" ? "order-2 w-full max-w-none mt-6" : "flex-1"}`}>
              <h1 className="text-5xl font-semibold text-gray-900 mb-3 keeping-tight">Global Calendar</h1>
              <p className="text-lg text-gray-600 font-normal">
                {activeTab === "events"
                  ? "Manage all events and vendors across the organization."
                  : "View payment data for all vendors across events and venues."}
              </p>
              <div className="mt-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Admin, Executive & Manager Access
                </span>
              </div>
            </div>
            <div className={`flex items-center gap-3 ${userRole === "exec" || userRole === "hr" ? "order-1 self-end" : ""}`}>
              {userRole === 'exec' && (
                <>
                  <Link
                    href="/venue-management"
                    className="apple-button apple-button-secondary flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Venues
                  </Link>
                  <Link
                    href="/rates"
                    className="apple-button apple-button-secondary flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Rates
                  </Link>
                </>
              )}
              {(userRole === 'hr' || userRole === 'exec' || userRole === 'finance') && (
                <Link
                  href="/hr-dashboard"
                  className="apple-button apple-button-secondary flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  HR Dashboard
                </Link>
              )}
              {(userRole === 'exec' || userRole === 'admin') && (
                <Link
                  href="/user-management"
                  className="apple-button apple-button-secondary flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  User Management
                </Link>
              )}
              <Link
                href="/dashboard"
                className="apple-button apple-button-secondary flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M4.5 10.5V20a1 1 0 001 1H9v-6h6v6h3.5a1 1 0 001-1v-9.5" />
                </svg>
                Dashboard
              </Link>
              <button
                onClick={handleLogout}
                className="apple-button apple-button-secondary flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Main Tabs */}
        <div className="mb-8 border-b border-gray-200">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("events")}
              className={`pb-4 px-2 font-semibold text-lg transition-colors relative ${
                activeTab === "events" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Events
              {activeTab === "events" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
            </button>
          </div>
        </div>

        {/* EVENTS TAB */}
        {activeTab === "events" && (
          <>
            {/* Actions */}
            {userRole !== "manager" && (
              <div className="flex flex-wrap gap-3 mb-10">
                <Link href="/create-event?returnTo=global-calendar">
                  <button className="apple-button apple-button-primary">
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Event
                  </button>
                </Link>
                <button
                  onClick={openVendorModal}
                  disabled={loading || events.length === 0}
                  className={`apple-button ${
                    loading || events.length === 0 ? "apple-button-disabled" : "apple-button-secondary"
                  }`}
                >
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Calendar Availability Request
                </button>
              </div>
            )}

            {/* Overview */}
            {!loading && !error && events.length > 0 && (
              <section className="mb-10">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Overview</h2>
                  <span className="text-sm text-gray-500 font-medium">Last updated: {new Date().toLocaleDateString()}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="group relative bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                    <div className="relative flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-110 transition-transform duration-300">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">Events</span>
                        </div>
                        <h3 className="text-sm font-medium text-gray-600 mb-2">Total Events</h3>
                        <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{eventStats.totalEvents}</div>
                        <p className="text-sm text-blue-600 font-medium flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {eventStats.activeEvents} active
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="group relative bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                    <div className="relative flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:scale-110 transition-transform duration-300">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">Schedule</span>
                        </div>
                        <h3 className="text-sm font-medium text-gray-600 mb-2">Upcoming Events</h3>
                        <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{eventStats.upcomingEvents}</div>
                        <p className="text-sm text-purple-600 font-medium flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                          scheduled ahead
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="group relative bg-gradient-to-br from-green-50 to-white border border-green-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-green-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                    <div className="relative flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/30 group-hover:scale-110 transition-transform duration-300">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                            </svg>
                          </div>
                          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Revenue</span>
                        </div>
                        <h3 className="text-sm font-medium text-gray-600 mb-2">Total Collected</h3>
                        <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">${(eventStats.totalTicketSales / 1000).toFixed(1)}k</div>
                        <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          total revenue
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {!loading && !error && events.length > 0 && (
              <div className="mb-10">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Filter by Venue
                  {venueOptions.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-500">({venueOptions.length} venues)</span>
                  )}
                </label>
                <select
                  value={selectedVenue}
                  onChange={(e) => setSelectedVenue(e.target.value)}
                  className="w-full max-w-md px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                >
                  <option value="all">All Venues</option>
                  {venueOptions.map((venue) => (
                    <option key={venue} value={venue}>
                      {venue}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-gray-500">
                    {selectedVenue === "all"
                      ? `Showing ${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"} across all venues`
                      : `Showing ${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"} at ${selectedVenue}`}
                  </p>
                  {selectedVenue !== "all" && (
                    <button
                      onClick={() => setSelectedVenue("all")}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Clear filter
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Calendar */}
            <section className="mb-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 keeping-tight">Calendar</h2>
              {loading && (
                <div className="apple-card">
                  <div className="flex items-center justify-center py-16">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading calendar...</span>
                  </div>
                </div>
              )}
              {error && <div className="apple-alert apple-alert-error">{error}</div>}
              {!loading && !error && (
                <div className="apple-card apple-calendar-wrapper">
                  <FullCalendar
                    plugins={[dayGridPlugin]}
                    initialView="dayGridMonth"
                    height="auto"
                    events={filteredEvents.map((ev) => {
                      const startIso = toIsoDateTime(ev.event_date, ev.start_time);
                      let endIso = toIsoDateTime(ev.event_date, ev.end_time);
                      if (!endIso && startIso) endIso = addHours(startIso, 1);
                      return { id: ev.id, title: ev.event_name, start: startIso, end: endIso, allDay: false };
                    })}
                  />
                </div>
              )}
            </section>

            {/* All Events */}
            <section>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 keeping-tight">All Events</h2>
              {loading && (
                <div className="apple-card">
                  <div className="flex items-center justify-center py-16">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading events...</span>
                  </div>
                </div>
              )}
              {error && <div className="apple-alert apple-alert-error">{error}</div>}
              {!loading && !error && events.length === 0 && (
                <div className="apple-card text-center py-16">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-lg">No events created yet</p>
                  <p className="text-gray-400 text-sm mt-2">Get started by creating your first event</p>
                </div>
              )}
              {!loading && !error && events.length > 0 && filteredEvents.length === 0 && (
                <div className="apple-card text-center py-16">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-lg">No events match this venue</p>
                  <p className="text-gray-400 text-sm mt-2">Try another venue or clear the filter</p>
                </div>
              )}
              {!loading && !error && filteredEvents.length > 0 && (
                <div className="space-y-4">
                  {filteredEvents.map((ev) => (
                    <div key={ev.id} className="apple-event-card group">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-semibold text-gray-900">{ev.event_name}</h3>
                            <span className={`apple-badge ${ev.is_active ? "apple-badge-success" : "apple-badge-neutral"}`}>
                              {ev.is_active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="flex items-center text-gray-600 mb-2">
                            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="font-medium">{ev.venue}</span>
                            {ev.city && ev.state && <span className="ml-2 text-gray-500">• {ev.city}, {ev.state}</span>}
                          </div>
                          {ev.artist && (
                            <div className="flex items-center text-gray-600 mb-2">
                              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                              </svg>
                              <span>{ev.artist}</span>
                            </div>
                          )}
                          <div className="flex items-center text-gray-500 text-sm">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>{ev.event_date}</span>
                            <span className="mx-2">•</span>
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>
                              {ev.start_time?.slice(0, 5)} - {ev.end_time?.slice(0, 5)}
                            </span>
                          </div>
                          {/* Staff Prediction */}
                          {predictions[ev.id] && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 border border-purple-200 rounded-lg">
                                <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                <span className="text-xs font-semibold text-purple-700">
                                  AI Prediction: {predictions[ev.id].loading ? (
                                    <span className="text-purple-500">Loading...</span>
                                  ) : (
                                    <>
                                      <span className="font-bold">{predictions[ev.id].predictedStaff}</span> staff
                                      {predictions[ev.id].confidence > 0 && (
                                        <span className="ml-1 text-purple-500">
                                          ({Math.round(predictions[ev.id].confidence * 100)}% confidence)
                                        </span>
                                      )}
                                    </>
                                  )}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        {userRole !== "manager" && (
                          <div className="flex items-center gap-2">
                            <Link href={`/check-in?eventId=${ev.id}`}>
                              <button className="apple-button apple-button-secondary text-sm py-2 px-4">
                                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Check In
                              </button>
                            </Link>
                            <button onClick={() => openTeamModal(ev)} className="apple-button apple-button-secondary text-sm py-2 px-4">
                              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                              </svg>
                              Create Team
                            </button>
                            <Link href={`/event-dashboard/${ev.id}`}>
                              <button className="apple-icon-button">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* HR TAB */}
        {false && (
          <>
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-3 mb-10">
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
            </div>

            {/* HR Subtabs */}
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
              </div>
            </div>

            {/* HR Overview */}
            {hrView === "overview" && (
              <div className="space-y-8">
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Key Metrics</h2>
                    <span className="text-sm text-gray-500 font-medium">HR Dashboard</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="group relative bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                      <div className="relative">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-110 transition-transform duration-300">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                          </div>
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">Total</span>
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
                          <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">Roles</span>
                        </div>
                        <h3 className="text-sm font-medium text-gray-600 mb-2">Departments</h3>
                        <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{hrStats.totalDepartments}</div>
                        <p className="text-sm text-purple-600 font-medium flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          active divisions
                        </p>
                      </div>
                    </div>

                    <div className="group relative bg-gradient-to-br from-green-50 to-white border border-green-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-green-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                      <div className="relative">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/30 group-hover:scale-110 transition-transform duration-300">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                            </svg>
                          </div>
                          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">New</span>
                        </div>
                        <h3 className="text-sm font-medium text-gray-600 mb-2">New Hires</h3>
                        <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{hrStats.newHiresThisMonth}</div>
                        <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          this month
                        </p>
                      </div>
                    </div>

                    <div className="group relative bg-gradient-to-br from-orange-50 to-white border border-orange-100 rounded-2xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500 opacity-5 rounded-full -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-500" />
                      <div className="relative">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/30 group-hover:scale-110 transition-transform duration-300">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                          </div>
                          <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-semibold">Security</span>
                        </div>
                        <h3 className="text-sm font-medium text-gray-600 mb-2">Background Checks</h3>
                        <div className="text-4xl font-bold text-gray-900 mb-2 keeping-tight">{hrStats.approvedBackgroundChecks}</div>
                        <p className="text-sm text-orange-600 font-medium flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          approved checks
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Roles */}
                <section>
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Role Overview</h2>
                    <span className="text-sm text-gray-500 font-medium">Workforce Distribution</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {calculatedDepartments.map((dept) => (
                      <div
                        key={dept.name}
                        className={`group relative bg-gradient-to-br ${
                          dept.color === 'blue' ? 'from-blue-50 to-white border-blue-200' : 'from-purple-50 to-white border-purple-200'
                        } border-2 rounded-2xl p-8 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 overflow-hidden`}
                      >
                        <div className={`absolute top-0 right-0 w-40 h-40 ${
                          dept.color === 'blue' ? 'bg-blue-500' : 'bg-purple-500'
                        } opacity-5 rounded-full -mr-20 -mt-20 group-hover:scale-150 transition-transform duration-500`} />
                        <div className="relative">
                          <div className="flex items-start justify-between mb-6">
                            <div className="flex items-center gap-4">
                              <div className={`w-14 h-14 ${
                                dept.color === 'blue' ? 'bg-blue-500 shadow-blue-500/30' : 'bg-purple-500 shadow-purple-500/30'
                              } rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div>
                                <h3 className="text-xl font-bold text-gray-900 capitalize mb-1">{dept.name}</h3>
                                <span className={`px-3 py-1 ${
                                  dept.color === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                                } rounded-full text-xs font-semibold`}>
                                  {dept.color === 'blue' ? 'Vendor Role' : 'Manager Role'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-end justify-between">
                            <div>
                              <div className="text-5xl font-bold text-gray-900 mb-2 keeping-tight">{dept.employee_count}</div>
                              <div className={`text-sm font-medium flex items-center gap-2 ${
                                dept.color === 'blue' ? 'text-blue-600' : 'text-purple-600'
                              }`}>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                                {dept.employee_count === 1 ? "employee" : "employees"}
                              </div>
                            </div>
                            <div className={`px-4 py-2 ${
                              dept.color === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                            } rounded-xl font-semibold text-sm`}>
                              {((dept.employee_count / hrStats.totalEmployees) * 100).toFixed(0)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* HR Employees */}
            {hrView === "employees" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">
                    All Employees
                    {employees.length > 0 && <span className="ml-3 text-lg font-normal text-gray-500">({employees.length})</span>}
                  </h2>
                  <div className="flex items-center gap-3">
                    <input
                      type="search"
                      placeholder="Search employees..."
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      // (Optional) hook up local filter later
                    />
                    <select
                      value={selectedEmployeeRegion}
                      onChange={(e) => handleEmployeeRegionChange(e.target.value)}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All Regions</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selectedState}
                      onChange={(e) => handleStateFilterChange(e.target.value)}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All States</option>
                      {availableStates.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                    <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                      <option value="">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept.name} value={dept.name}>
                          {dept.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(selectedState !== "all" || selectedEmployeeRegion !== "all") && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center text-sm text-blue-800">
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                      <span className="font-medium">Filters Active:</span>
                      {selectedEmployeeRegion !== "all" && (
                        <span className="ml-1">{regions.find(r => r.id === selectedEmployeeRegion)?.name || selectedEmployeeRegion}</span>
                      )}
                      {selectedEmployeeRegion !== "all" && selectedState !== "all" && <span className="mx-1">•</span>}
                      {selectedState !== "all" && <span>{selectedState}</span>}
                      <span className="ml-2 text-blue-600">• {employees.length} {employees.length === 1 ? "employee" : "employees"} found</span>
                    </div>
                    <button onClick={() => { handleStateFilterChange("all"); handleEmployeeRegionChange("all"); }} className="text-xs text-blue-700 hover:text-blue-900 font-medium flex items-center">
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Clear All Filters
                    </button>
                  </div>
                )}

                {loadingEmployees && (
                  <div className="apple-card">
                    <div className="flex items-center justify-center py-16">
                      <div className="apple-spinner" />
                      <span className="ml-3 text-gray-600">Loading employees...</span>
                    </div>
                  </div>
                )}
                {employeesError && <div className="apple-alert apple-alert-error">{employeesError}</div>}
                {!loadingEmployees && !employeesError && employees.length === 0 && (
                  <div className="apple-card text-center py-16">
                    <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <p className="text-gray-500 text-lg">No employees found</p>
                    <p className="text-gray-400 text-sm mt-2">
                      {selectedState !== "all" ? "Try selecting a different state" : "No employees in the system yet"}
                    </p>
                  </div>
                )}

                {!loadingEmployees && !employeesError && employees.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {employees.map((e) => (
                      <Link key={e.id} href={`/hr/employees/${e.id}`} className="block group">
                        <div className="apple-card p-6 hover:shadow-lg transition-shadow group-hover:translate-y-[-1px]">
                          <div className="flex items-start gap-4">
                            {e.profile_photo_url ? (
                              <img
                                src={e.profile_photo_url}
                                alt={`${e.first_name} ${e.last_name}`}
                                className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-xl flex-shrink-0">
                                {e.first_name.charAt(0)}
                                {e.last_name.charAt(0)}
                              </div>
                            )}
                            <div className="flex-1">
                              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                {e.first_name} {e.last_name}
                              </h3>
                              <p className="text-sm text-gray-600 mb-2">{e.position}</p>
                              <div className="space-y-1">
                                <div className="flex items-center text-xs text-gray-500">
                                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                  </svg>
                                  {e.department}
                                </div>
                                <div className="flex items-center text-xs text-gray-500">
                                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  {e.email}
                                </div>
                                {e.phone && (
                                  <div className="flex items-center text-xs text-gray-500">
                                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                    </svg>
                                    {e.phone}
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 flex items-center justify-between">
                                <span
                                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    e.status === "active"
                                      ? "bg-green-100 text-green-700"
                                      : e.status === "on_leave"
                                      ? "bg-yellow-100 text-yellow-700"
                                      : "bg-gray-100 text-gray-700"
                                  }`}
                                >
                                  {e.status === "active" ? "Active" : e.status === "on_leave" ? "On Leave" : "Inactive"}
                                </span>
                                <span className="text-xs text-gray-500">Since {new Date(e.hire_date).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

          </>
        )}
      </div>

      {/* Calendar Availability Modal */}
      {showVendorModal && (
        <div className="apple-modal-overlay">
          <div className="apple-modal">
            <div className="apple-modal-header">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Calendar Availability Request</h2>
                <p className="text-gray-600 text-sm mt-1">Ask vendors for their availability over the next 3 weeks</p>
              </div>
              <button onClick={closeVendorModal} className="apple-close-button">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="apple-modal-body">
              {message && (
                <div
                  className={`apple-alert ${
                    message.toLowerCase().includes("success") ? "apple-alert-success" : "apple-alert-error"
                  }`}
                >
                  {message}
                  <button onClick={() => setMessage("")} className="apple-close-button-small">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {loadingVendors ? (
                <div className="apple-empty-state">
                  <div className="apple-spinner mb-4" />
                  <p className="text-gray-600">Loading vendors...</p>
                </div>
              ) : vendors.length === 0 ? (
                <div className="apple-empty-state">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-medium text-gray-600">No vendors available</p>
                  <p className="text-sm text-gray-500 mt-2">No active vendors found for your events</p>
                </div>
              ) : (
                <>
                  <div className="apple-info-banner">
                    <svg className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-gray-700">
                      <div className="font-semibold mb-1">3-Week Work Period</div>
                      <div className="text-xs text-gray-600">We'll invite selected vendors to share availability</div>
                    </div>
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Filter by Region
                      {regions.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-gray-500">({regions.length} regions)</span>
                      )}
                    </label>
                    <select
                      value={selectedRegion}
                      onChange={(e) => handleRegionChange(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    >
                      <option value="all">🌎 All Regions</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          📍 {r.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-xs text-gray-500">
                        {selectedRegion === "all" ? "Showing vendors from all regions" : "Filtered by region"}
                      </p>
                      {selectedRegion !== "all" && (
                        <button onClick={() => handleRegionChange("all")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                          Clear filter
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
                    <label className="flex items-center cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedVendors.size === vendors.length && vendors.length > 0}
                        onChange={handleSelectAll}
                        className="apple-checkbox"
                      />
                      <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                        Select All ({vendors.length})
                      </span>
                    </label>
                    <button
                      onClick={handleInvite}
                      disabled={selectedVendors.size === 0 || submitting}
                      className={`apple-button ${
                        selectedVendors.size === 0 || submitting ? "apple-button-disabled" : "apple-button-primary"
                      }`}
                    >
                      {submitting ? "Sending..." : `Send ${selectedVendors.size} Invitation${selectedVendors.size !== 1 ? "s" : ""}`}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {vendors.map((v) => (
                      <div key={v.id} className="apple-vendor-card" onClick={() => toggleVendorSelection(v.id)}>
                        <input
                          type="checkbox"
                          checked={selectedVendors.has(v.id)}
                          onChange={() => toggleVendorSelection(v.id)}
                          className="apple-checkbox"
                        />
                        {v.profiles.profile_photo_url ? (
                          <img
                            src={v.profiles.profile_photo_url}
                            alt={`${v.profiles.first_name} ${v.profiles.last_name}`}
                            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                            onError={(e) => {
                              const t = e.target as HTMLImageElement;
                              t.style.display = "none";
                              if (t.nextSibling) (t.nextSibling as HTMLElement).style.display = "flex";
                            }}
                          />
                        ) : null}
                        <div
                          className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0"
                          style={{ display: v.profiles.profile_photo_url ? "none" : "flex" }}
                        >
                          {v.profiles.first_name?.charAt(0)}
                          {v.profiles.last_name?.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-900">
                              {v.profiles.first_name} {v.profiles.last_name}
                            </div>
                            <div className="flex items-center gap-2">
                              {v.recently_responded && (
                                <div className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-md">Replied this week</div>
                              )}
                              {v.distance !== null ? (
                                <div className="apple-distance-badge">{v.distance} mi</div>
                              ) : (
                                <div className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md">No location</div>
                              )}
                            </div>
                          </div>
                          <div className="text-gray-600 text-sm mb-1">
                            {v.email}
                            {v.profiles.phone && (
                              <>
                                <span className="mx-2 text-gray-400">•</span>
                                {v.profiles.phone}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {v.profiles.city && v.profiles.state && (
                              <>
                                <span className="flex items-center">
                                  <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  </svg>
                                  {v.profiles.city}, {v.profiles.state}
                                </span>
                                <span className="text-gray-400">•</span>
                              </>
                            )}
                            <span>{v.division}</span>
                            <span className="text-gray-400">•</span>
                            <span>{v.role}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PAYMENTS TAB */}
      {activeTab === "payments" && (
        <>
          {/* Date Range Filter */}
          <div className="mb-8 bg-white border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Filter by Date Range</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={paymentsStartDate}
                  onChange={(e) => setPaymentsStartDate(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={paymentsEndDate}
                  onChange={(e) => setPaymentsEndDate(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => loadPaymentsData(paymentsStartDate, paymentsEndDate)}
                className="apple-button apple-button-primary"
                disabled={!paymentsStartDate || !paymentsEndDate || loadingPayments}
              >
                {loadingPayments ? "Loading..." : "Load Payment Data"}
              </button>
              <button
                onClick={sendPaymentsToVendors}
                className="apple-button apple-button-secondary"
                disabled={!paymentsData || Object.keys(paymentsData).length === 0 || sendingPayments || !paymentsStartDate || !paymentsEndDate}
              >
                {sendingPayments ? (
                  <>
                    <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Send Payment Summaries to Vendors
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Payment Data Display */}
          {loadingPayments ? (
            <div className="apple-card">
              <div className="flex items-center justify-center py-16">
                <div className="apple-spinner" />
                <span className="ml-3 text-gray-600">Loading payment data...</span>
              </div>
            </div>
          ) : paymentsError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="text-lg font-semibold text-red-900">Error Loading Payments</h3>
                  <p className="text-red-700 mt-1">{paymentsError}</p>
                </div>
              </div>
            </div>
          ) : paymentsData ? (
            <div className="space-y-8">
              {/* Overall Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-600 mb-2">Total Venues</h3>
                  <div className="text-4xl font-bold text-gray-900 keeping-tight">{Object.keys(paymentsData).length}</div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-white border border-green-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/30">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-600 mb-2">Total Hours</h3>
                  <div className="text-4xl font-bold text-gray-900 keeping-tight">
                    {Object.values(paymentsData).reduce((sum: number, venue: any) => sum + venue.totalHours, 0).toFixed(1)}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-white border border-purple-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-sm font-medium text-gray-600 mb-2">Total Payments</h3>
                  <div className="text-4xl font-bold text-gray-900 keeping-tight">
                    ${Object.values(paymentsData).reduce((sum: number, venue: any) => sum + venue.totalPayment, 0).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Payment Data by Venue */}
              {Object.values(paymentsData).map((venueData: any, index: number) => (
                <div key={index} className="bg-white border rounded-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
                    <h2 className="text-2xl font-semibold">{venueData.venue}</h2>
                    <p className="text-blue-100 mt-1">{venueData.city}, {venueData.state}</p>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-blue-100">Total Hours</div>
                        <div className="text-2xl font-bold">{venueData.totalHours.toFixed(1)}h</div>
                      </div>
                      <div>
                        <div className="text-sm text-blue-100">Total Payment</div>
                        <div className="text-2xl font-bold">${venueData.totalPayment.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-6">
                    {venueData.events.map((eventData: any, eventIndex: number) => (
                      <div key={eventIndex} className="mb-8 last:mb-0">
                        <div className="flex items-center justify-between mb-4 pb-3 border-b">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">{eventData.eventName}</h3>
                            <p className="text-sm text-gray-600">{eventData.eventDate} • Base Rate: ${eventData.baseRate}/hr</p>
                          </div>
                        </div>

                        {eventData.payments.length === 0 ? (
                          <p className="text-gray-500 text-center py-4">No staff scheduled for this event</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead className="bg-gray-50 border-b">
                                <tr>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">Employee</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">Reg Hours</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">Reg Pay</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">OT Hours</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">OT Pay</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">DT Hours</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">DT Pay</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">Commissions</th>
                                  <th className="text-left p-3 font-semibold text-gray-700 text-sm">Tips</th>
                                  <th className="text-right p-3 font-semibold text-gray-700 text-sm">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {eventData.payments.map((payment: any, paymentIndex: number) => (
                                  <tr key={paymentIndex} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-3">
                                      <div className="font-medium text-gray-900">{payment.firstName} {payment.lastName}</div>
                                      <div className="text-xs text-gray-500">{payment.email}</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm">{payment.regularHours.toFixed(2)}h</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm font-medium text-green-600">${payment.regularPay.toFixed(2)}</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm">{payment.overtimeHours.toFixed(2)}h</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm font-medium text-green-600">${payment.overtimePay.toFixed(2)}</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm">{payment.doubletimeHours.toFixed(2)}h</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm font-medium text-green-600">${payment.doubletimePay.toFixed(2)}</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm font-medium text-purple-600">${payment.commissions.toFixed(2)}</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-sm font-medium text-orange-600">${payment.tips.toFixed(2)}</div>
                                    </td>
                                    <td className="p-3 text-right">
                                      <div className="text-sm font-bold text-gray-900">${payment.totalPay.toFixed(2)}</div>
                                      <div className="text-xs text-gray-500">{payment.actualHours.toFixed(2)}h total</div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Payment Data</h3>
              <p className="text-gray-600">Select a date range and click "Load Payment Data" to view payment information.</p>
            </div>
          )}
        </>
      )}

      {/* Team Creation Modal */}
      {showTeamModal && selectedEvent && (
        <div className="apple-modal-overlay">
          <div className="apple-modal">
            <div className="apple-modal-header">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Create Team</h2>
                <p className="text-gray-600 text-sm mt-1">
                  {selectedEvent.event_name} - {selectedEvent.event_date}
                </p>
              </div>
              <button onClick={closeTeamModal} className="apple-close-button">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="apple-modal-body">
              {teamMessage && (
                <div
                  className={`apple-alert mb-6 ${
                    teamMessage.toLowerCase().includes("success") ? "apple-alert-success" : "apple-alert-error"
                  }`}
                >
                  {teamMessage}
                  <button onClick={() => setTeamMessage("")} className="apple-close-button-small">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {loadingAvailable ? (
                <div className="apple-empty-state">
                  <div className="apple-spinner mb-4" />
                  <p className="text-gray-600">Loading available vendors...</p>
                </div>
              ) : availableVendors.length === 0 ? (
                <div className="apple-empty-state">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-medium text-gray-600">No Vendors Available</p>
                  <p className="text-sm text-gray-500 mt-2">No vendors have confirmed availability for this date</p>
                </div>
              ) : (
                <>
                  <div className="apple-info-banner">
                    <svg className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-gray-700">
                      <div className="font-semibold mb-1">Available Vendors</div>
                      <div className="text-xs text-gray-600">
                        {availableVendors.length} vendor{availableVendors.length !== 1 ? "s have" : " has"} confirmed availability
                      </div>
                    </div>
                  </div>

                  <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
                    <label className="flex items-center cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={(() => {
                          const newVendors = availableVendors.filter((v) => !(v as any).isExistingMember);
                          return newVendors.length > 0 && newVendors.every(v => selectedTeamMembers.has(v.id));
                        })()}
                        onChange={handleSelectAllTeam}
                        className="apple-checkbox"
                      />
                      <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                        Select All ({availableVendors.filter((v) => !(v as any).isExistingMember).length} new)
                      </span>
                    </label>
                    <button
                      onClick={handleSaveTeam}
                      disabled={selectedTeamMembers.size === 0 || savingTeam || allAvailableVendorsInvited}
                      className={`apple-button ${selectedTeamMembers.size === 0 || savingTeam || allAvailableVendorsInvited ? "apple-button-disabled" : "apple-button-primary"}`}
                    >
                      {savingTeam ? "Creating..." : allAvailableVendorsInvited ? "All Invited" : `Create Team (${selectedTeamMembers.size})`}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {availableVendors.map((v) => (
                      <div key={v.id} className="apple-vendor-card" onClick={() => !(v as any).isExistingMember && toggleTeamMember(v.id)}>
                        {!(v as any).isExistingMember ? (
                          <input
                            type="checkbox"
                            checked={selectedTeamMembers.has(v.id)}
                            onChange={() => toggleTeamMember(v.id)}
                            className="apple-checkbox"
                          />
                        ) : (
                          <div className="w-5 h-5 flex-shrink-0"></div>
                        )}
                        {v.profiles.profile_photo_url ? (
                          <img
                            src={v.profiles.profile_photo_url}
                            alt={`${v.profiles.first_name} ${v.profiles.last_name}`}
                            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                            onError={(e) => {
                              const t = e.target as HTMLImageElement;
                              t.style.display = "none";
                              if (t.nextSibling) (t.nextSibling as HTMLElement).style.display = "flex";
                            }}
                          />
                        ) : null}
                        <div
                          className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0"
                          style={{ display: v.profiles.profile_photo_url ? "none" : "flex" }}
                        >
                          {v.profiles.first_name?.charAt(0)}
                          {v.profiles.last_name?.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-900">
                              {v.profiles.first_name} {v.profiles.last_name}
                            </div>
                            <div className="flex items-center gap-2">
                              {(v as any).isExistingMember && (
                                <div className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md font-medium">
                                  {(v as any).status === 'confirmed' ? 'Confirmed' :
                                   (v as any).status === 'declined' ? 'Declined' :
                                   'Invited'}
                                </div>
                              )}
                              {v.distance !== null ? (
                                <div className="apple-distance-badge">{v.distance} mi</div>
                              ) : (
                                <div className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md">No location</div>
                              )}
                            </div>
                          </div>
                          <div className="text-gray-600 text-sm mb-1">
                            {v.email}
                            {v.profiles.phone && (
                              <>
                                <span className="mx-2 text-gray-400">•</span>
                                {v.profiles.phone}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {v.profiles.city && v.profiles.state && (
                              <>
                                <span className="flex items-center">
                                  <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  </svg>
                                  {v.profiles.city}, {v.profiles.state}
                                </span>
                                <span className="text-gray-400">•</span>
                              </>
                            )}
                            <span>{v.division}</span>
                            <span className="text-gray-400">•</span>
                            <span>{v.role}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
