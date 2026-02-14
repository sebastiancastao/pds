"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type EventItem = {
  id: string;
  created_by: string;
  event_name: string;
  artist: string | null;
  venue: string;
  city: string | null;
  state: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  ticket_sales: number | null;
  ticket_count: number | null;
  artist_share_percent: number;
  venue_share_percent: number;
  pds_share_percent: number;
  commission_pool: number | null; // expects fraction like 0.04 for 4%
  required_staff: number | null;
  confirmed_staff: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tax_rate_percent?: number | null;
  merchandise_units?: number | null;
  merchandise_value?: number | null;
};

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
};

type TabType = "edit" | "sales" | "merchandise" | "team" | "timesheet" | "hr";

type StateRateData = {
  state_code: string;
  state_name: string;
  base_rate: number;
  overtime_enabled: boolean;
  overtime_rate: number;
  doubletime_enabled: boolean;
  doubletime_rate: number;
};

type TimesheetEditDraft = {
  firstIn: string;
  lastOut: string;
  firstMealStart: string;
  lastMealEnd: string;
  secondMealStart: string;
  secondMealEnd: string;
};

export default function EventDashboardPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.id as string;
  const initialTab = (searchParams.get("tab") as TabType) || "edit";

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [event, setEvent] = useState<EventItem | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [loadingTimesheetTab, setLoadingTimesheetTab] = useState(false);
  const [loadingPaymentTab, setLoadingPaymentTab] = useState(false);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const canEditTimesheets = userRole === "exec";

  const [ticketSales, setTicketSales] = useState<string>("");
  const [ticketCount, setTicketCount] = useState<string>("");
  const [commissionPool, setCommissionPool] = useState<string>(""); // fraction like 0.04
  const [taxRate, setTaxRate] = useState<string>("0");
  const [stateTaxRate, setStateTaxRate] = useState<number>(0); // Tax rate from database based on venue state
  const [stateRatesData, setStateRatesData] = useState<StateRateData[]>([]); // Fetched rates from API
  const [tips, setTips] = useState<string>("");
  // Manual tax amount for Sales tab (no auto rate calc)
  const [manualTaxAmount, setManualTaxAmount] = useState<string>("");

  const [merchandiseUnits, setMerchandiseUnits] = useState<string>("");
  const [merchandiseValue, setMerchandiseValue] = useState<string>("");

  // Detailed merchandise breakdown
  const [apparelGross, setApparelGross] = useState<string>("");
  const [apparelTaxRate, setApparelTaxRate] = useState<string>("0");
  const [apparelCCFeeRate, setApparelCCFeeRate] = useState<string>("0");
  const [otherGross, setOtherGross] = useState<string>("");
  const [otherTaxRate, setOtherTaxRate] = useState<string>("0");
  const [otherCCFeeRate, setOtherCCFeeRate] = useState<string>("0");
  const [musicGross, setMusicGross] = useState<string>("");
  const [musicTaxRate, setMusicTaxRate] = useState<string>("0");
  const [musicCCFeeRate, setMusicCCFeeRate] = useState<string>("0");

  // Split percentages for merchandise
  const [apparelArtistPercent, setApparelArtistPercent] = useState<string>("80");
  const [otherArtistPercent, setOtherArtistPercent] = useState<string>("80");
  const [musicArtistPercent, setMusicArtistPercent] = useState<string>("90");

  // Team & Timesheet
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamSearch, setTeamSearch] = useState<string>("");
  // Cache flags to avoid re-fetching data when switching tabs
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [timesheetLoaded, setTimesheetLoaded] = useState(false);
  const [adjustmentsLoaded, setAdjustmentsLoaded] = useState(false);
  const [timesheetTotals, setTimesheetTotals] = useState<Record<string, number>>({});
  const [timesheetSpans, setTimesheetSpans] = useState<
    Record<
      string,
      {
        firstIn: string | null;
        lastOut: string | null;
        firstMealStart: string | null;
        lastMealEnd: string | null;
        secondMealStart: string | null;
        secondMealEnd: string | null;
      }
    >
  >({});

  // HR/Payroll adjustments (user_id -> adjustment amount)
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  // HR/Payroll reimbursements (user_id -> reimbursement amount)
  const [reimbursements, setReimbursements] = useState<Record<string, number>>({});
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingTimesheetUserId, setEditingTimesheetUserId] = useState<string | null>(null);
  const [timesheetDrafts, setTimesheetDrafts] = useState<Record<string, TimesheetEditDraft>>({});
  const [savingTimesheetUserId, setSavingTimesheetUserId] = useState<string | null>(null);

  // HR/Payments filters
  const [staffSearch, setStaffSearch] = useState<string>("");
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>(""); // '', 'vendor', 'cwt'

  // Derived: filtered team members based on search and role filter
  const filteredTeamListMembers = (teamMembers || []).filter((member: any) => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return true;

    const profile = member?.users?.profiles;
    const firstName = (profile?.first_name || "").toString().toLowerCase();
    const lastName = (profile?.last_name || "").toString().toLowerCase();
    const fullName = `${firstName} ${lastName}`.trim();
    const email = (member?.users?.email || "").toString().toLowerCase();
    const phone = (profile?.phone || "").toString().toLowerCase();
    const division = (member?.users?.division || "").toString().toLowerCase();
    const status = (member?.status || "").toString().replace(/_/g, " ").toLowerCase();

    return (
      fullName.includes(q) ||
      email.includes(q) ||
      phone.includes(q) ||
      division.includes(q) ||
      status.includes(q)
    );
  });

  const filteredTeamMembers = (teamMembers || []).filter((member: any) => {
    try {
      const division = (member?.users?.division || '').toString().toLowerCase();
      const email = (member?.users?.email || '').toString().toLowerCase();
      const fn = (member?.users?.profiles?.first_name || '').toString().toLowerCase();
      const ln = (member?.users?.profiles?.last_name || '').toString().toLowerCase();
      const fullName = `${fn} ${ln}`.trim();

      // Role filter mapping: 'vendor' => division in ['vendor','both']; 'cwt' => division === 'trailers'
      let matchesRole = true;
      const f = staffRoleFilter.toLowerCase();
      if (f === 'vendor') {
        matchesRole = division === 'vendor' || division === 'both';
      } else if (f === 'cwt') {
        matchesRole = division === 'trailers';
      }

      // Search filter against name or email
      const q = staffSearch.trim().toLowerCase();
      const matchesQuery = q === '' || fullName.includes(q) || email.includes(q);

      return matchesRole && matchesQuery;
    } catch {
      return true;
    }
  });
  const isVendorDivision = (division?: string | null) => {
    const normalized = (division || '').toString().toLowerCase();
    return normalized === 'vendor' || normalized === 'both';
  };

  const vendorCount = teamMembers.reduce((count: number, member: any) => {
    return isVendorDivision(member.users?.division) ? count + 1 : count;
  }, 0);

  // Form state for editing
  const [form, setForm] = useState<Partial<EventItem>>({
    event_name: "",
    artist: "",
    venue: "",
    city: "",
    state: "",
    event_date: "",
    start_time: "",
    end_time: "",
    ticket_sales: null,
    artist_share_percent: 0,
    venue_share_percent: 0,
    pds_share_percent: 0,
    commission_pool: null,
    required_staff: null,
    confirmed_staff: null,
    is_active: true,
  });

  // Auth / bootstrap
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        router.replace("/login");
      } else {
        setIsAuthed(true);
        // Load current user's role for back navigation routing
        (async () => {
          try {
            const { data, error } = await (supabase
              .from('users')
              .select('role')
              .eq('id', user.id)
              .single() as any);
            if (!error) {
              const role = (data?.role ?? '').toString().trim().toLowerCase();
              setUserRole(role || null);
            }
          } catch {}
        })();
        loadVenues();
        loadStateRates(); // Load rates from API for payroll calculations
        loadEvent();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, eventId]);

  // Load team & timesheet when needed (with caching to avoid re-fetching on tab switch)
  useEffect(() => {
    if (!eventId) return;

    if (activeTab === "team") {
      if (!teamLoaded) loadTeam();
      return;
    }

    if (activeTab === "timesheet") {
      const needsTeam = !teamLoaded;
      const needsTimesheet = !timesheetLoaded;
      if (!needsTeam && !needsTimesheet) return;
      (async () => {
        setLoadingTimesheetTab(true);
        try {
          const promises: Promise<void>[] = [];
          if (needsTeam) promises.push(loadTeam());
          if (needsTimesheet) promises.push(loadTimesheetTotals());
          await Promise.all(promises);
        } finally {
          setLoadingTimesheetTab(false);
        }
      })();
      return;
    }

    if (activeTab === "hr") {
      const needsTeam = !teamLoaded;
      const needsTimesheet = !timesheetLoaded;
      const needsAdjustments = !adjustmentsLoaded;
      if (!needsTeam && !needsTimesheet && !needsAdjustments) return;
      (async () => {
        setLoadingPaymentTab(true);
        try {
          const promises: Promise<void>[] = [];
          if (needsTeam) promises.push(loadTeam());
          if (needsTimesheet) promises.push(loadTimesheetTotals());
          if (needsAdjustments) promises.push(loadAdjustmentsFromPayments());
          await Promise.all(promises);
        } finally {
          setLoadingPaymentTab(false);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, eventId]);

  // Auto-save adjustments/reimbursements when they change on HR tab
  useEffect(() => {
    if (!eventId || activeTab !== 'hr' || !canEditTimesheets) return;
    const handler = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        };
        // Union of user_ids present in adjustments or reimbursements
        const userIds = Array.from(new Set([
          ...Object.keys(adjustments || {}),
          ...Object.keys(reimbursements || {}),
        ]));
        await Promise.all(userIds.map((uid) => {
          const adj = Number(adjustments?.[uid] || 0);
          const reimb = Number(reimbursements?.[uid] || 0);
          const total = adj + reimb; // Persist as a single net adjustment
          return fetch('/api/payment-adjustments', {
            method: 'POST',
            headers,
            body: JSON.stringify({ event_id: eventId, user_id: uid, adjustment_amount: total }),
          });
        }));
      } catch (_) {
        // ignore transient errors; user can retry
      }
    }, 600);
    return () => clearTimeout(handler);
  }, [adjustments, reimbursements, activeTab, eventId, canEditTimesheets]);

  const loadVenues = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/venues-list", {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setVenues(data.venues || []);
      }
    } catch (err: any) {
      console.log("[DEBUG] Error loading venues:", err);
    }
  };

  // Load state rates from API
  const loadStateRates = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/rates", {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        console.log('[RATES] Loaded state rates:', data.rates?.length || 0);
        setStateRatesData(data.rates || []);
      }
    } catch (err: any) {
      console.log("[DEBUG] Error loading state rates:", err);
    }
  };

  // Helper to get base rate for a state from fetched data, with fallback defaults
  const getBaseRateForState = (stateCode: string): number => {
    const normalizedState = (stateCode || '').toUpperCase().trim();
    const rate = stateRatesData.find(r => r.state_code?.toUpperCase() === normalizedState);
    if (rate) {
      return rate.base_rate;
    }
    // Fallback defaults if API data not loaded yet
    const fallbackRates: Record<string, number> = {
      'CA': 17.28, 'NY': 17.00, 'AZ': 14.70, 'WI': 15.00,
    };
    return fallbackRates[normalizedState] || 17.28;
  };

  const loadEvent = async () => {
    if (!eventId) return;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        const eventData: EventItem = data.event;
        setEvent(eventData);
        setForm({
          event_name: eventData.event_name || "",
          artist: eventData.artist || "",
          venue: eventData.venue || "",
          city: eventData.city || "",
          state: eventData.state || "",
          event_date: eventData.event_date || "",
          start_time: eventData.start_time || "",
          end_time: eventData.end_time || "",
          ticket_sales: eventData.ticket_sales || null,
          artist_share_percent: (eventData.artist_share_percent || 0) * 100,
          venue_share_percent: (eventData.venue_share_percent || 0) * 100,
          pds_share_percent: (eventData.pds_share_percent || 0) * 100,
          commission_pool: eventData.commission_pool || null,
          required_staff: eventData.required_staff || null,
          confirmed_staff: eventData.confirmed_staff || null,
          is_active: eventData.is_active !== undefined ? eventData.is_active : true,
        });
        setTicketSales(eventData.ticket_sales?.toString() || "");
        setTicketCount(eventData.ticket_count?.toString() || "");
        setCommissionPool(eventData.commission_pool?.toString() || "");
        setTaxRate((eventData.tax_rate_percent ?? 0).toString());
        setTips((eventData as any).tips?.toString() || "");
        setMerchandiseUnits(eventData.merchandise_units?.toString() || "");
        setMerchandiseValue(eventData.merchandise_value?.toString() || "");

        // Tax rate is stored per-event (state_rates table only has base_rate for hourly wages, not tax rates)
        console.debug('[SALES-DEBUG] Event state detected:', eventData.state);
        console.debug('[SALES-DEBUG] Using event tax_rate_percent:', eventData.tax_rate_percent);
        setStateTaxRate(Number(eventData.tax_rate_percent ?? 0));

        // Load merchandise breakdown if provided
        const m = data.merchandise || null;
        if (m) {
          setApparelGross((m.apparel_gross ?? '').toString());
          setApparelTaxRate((m.apparel_tax_rate ?? '0').toString());
          setApparelCCFeeRate((m.apparel_cc_fee_rate ?? '0').toString());
          setApparelArtistPercent((m.apparel_artist_percent ?? '80').toString());

          setOtherGross((m.other_gross ?? '').toString());
          setOtherTaxRate((m.other_tax_rate ?? '0').toString());
          setOtherCCFeeRate((m.other_cc_fee_rate ?? '0').toString());
          setOtherArtistPercent((m.other_artist_percent ?? '80').toString());

          setMusicGross((m.music_gross ?? '').toString());
          setMusicTaxRate((m.music_tax_rate ?? '0').toString());
          setMusicCCFeeRate((m.music_cc_fee_rate ?? '0').toString());
          setMusicArtistPercent((m.music_artist_percent ?? '90').toString());
        }
      } else {
        setMessage("Failed to load event details");
      }
    } catch (err: any) {
      setMessage("Network error loading event");
    }
    setLoading(false);
  };

  const loadTeam = async () => {
    if (!eventId) return;
    setLoadingTeam(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `/api/events/${eventId}/team`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data.team || []);
        setTeamLoaded(true);
      } else {
        const errorText = await res.text();
        console.error("Failed to load team members:", { errorText });
      }
    } catch (err: any) {
      console.error("Error loading team:", err);
    }
    setLoadingTeam(false);
  };

  const loadAdjustmentsFromPayments = async () => {
    try {
      if (!eventId) return;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/vendor-payments?event_ids=${encodeURIComponent(eventId)}`, {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!res.ok) return;
      const json = await res.json();
      const payments = json?.paymentsByEvent?.[eventId]?.vendorPayments || [];
      const map: Record<string, number> = {};
      for (const vp of payments) {
        const uid = (vp.user_id || vp.vendor_id || vp.users?.id || '').toString();
        if (uid) map[uid] = Number(vp.adjustment_amount || 0);
      }
      setAdjustments(map);
      setAdjustmentsLoaded(true);
    } catch (e) {
      // ignore
    }
  };

  const saveAdjustmentForUser = async (uid: string) => {
    try {
      if (!eventId || !uid) return;
      const amount = Number(adjustments[uid] || 0);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/payment-adjustments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ event_id: eventId, user_id: uid, adjustment_amount: amount }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMessage(j.error || 'Failed to save adjustment');
      } else {
        setMessage('Adjustment saved');
        // refresh merged view so numbers/notes remain consistent
        await loadAdjustmentsFromPayments();
      }
    } catch (e: any) {
      setMessage(e.message || 'Network error saving adjustment');
    }
  };

  const loadTimesheetTotals = async () => {
    if (!eventId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `/api/events/${eventId}/timesheet`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setTimesheetTotals(data.totals || {});
        setTimesheetSpans(data.spans || {});
        setTimesheetLoaded(true);
      } else {
        const errorText = await res.text();
        console.error("Failed to load timesheet:", { errorText });
      }
    } catch (err) {
      console.error("Exception in loadTimesheetTotals:", err);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : type === "number"
          ? value === ""
            ? null
            : Number(value)
          : value,
    }));
  };

  const handleVenueChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedVenue = venues.find((v) => v.venue_name === e.target.value);
    if (selectedVenue) {
      setForm((prev) => ({
        ...prev,
        venue: selectedVenue.venue_name,
        city: selectedVenue.city,
        state: selectedVenue.state,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        venue: "",
        city: "",
        state: "",
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    if (
      !form.event_name ||
      !form.venue ||
      !form.city ||
      !form.state ||
      !form.event_date ||
      !form.start_time ||
      !form.end_time
    ) {
      setMessage("Please fill all required fields");
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        ...form,
        artist_share_percent: (form.artist_share_percent || 0) / 100,
        venue_share_percent: (form.venue_share_percent || 0) / 100,
        pds_share_percent: (form.pds_share_percent || 0) / 100,
      };

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage("Event updated successfully");
        setEvent(data.event);
      } else {
        setMessage(data.error || "Failed to update event");
      }
    } catch (err: any) {
      setMessage("Network error");
    }
    setSubmitting(false);
  };

  const handleSaveSales = async () => {
    setSubmitting(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        ...event,
        ticket_sales: ticketSales !== "" ? Number(ticketSales) : null,
        ticket_count: ticketCount !== "" ? Number(ticketCount) : null,
        commission_pool: commissionPool !== "" ? Number(commissionPool) : null, // fraction (0.04)
        tax_rate_percent: stateTaxRate || 0,
        tips: tips !== "" ? Number(tips) : null,
      };
      try { console.debug('[SALES-DEBUG] handleSaveSales payload:', payload); } catch {}
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage("Sales data updated successfully");
        setEvent(data.event);
      } else {
        try { console.warn('[SALES-DEBUG] handleSaveSales server error:', data); } catch {}
        setMessage(data.error || "Failed to update sales data");
      }
    } catch (err: any) {
      try { console.error('[SALES-DEBUG] handleSaveSales network error:', err); } catch {}
      setMessage("Network error updating sales data");
    }
    setSubmitting(false);
  };

  const handleSaveMerchandise = async () => {
    setSubmitting(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          ...event,
          merchandise_units: merchandiseUnits !== "" ? Number(merchandiseUnits) : null,
          merchandise_value: merchandiseValue !== "" ? Number(merchandiseValue) : null,
          merchandise: {
            apparel_gross: apparelGross || null,
            apparel_tax_rate: apparelTaxRate || null,
            apparel_cc_fee_rate: apparelCCFeeRate || null,
            apparel_artist_percent: apparelArtistPercent || null,

            other_gross: otherGross || null,
            other_tax_rate: otherTaxRate || null,
            other_cc_fee_rate: otherCCFeeRate || null,
            other_artist_percent: otherArtistPercent || null,

            music_gross: musicGross || null,
            music_tax_rate: musicTaxRate || null,
            music_cc_fee_rate: musicCCFeeRate || null,
            music_artist_percent: musicArtistPercent || null,
          },
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage("Merchandise data updated successfully");
        setEvent(data.event);
      } else {
        setMessage(data.error || "Failed to update merchandise data");
      }
    } catch (err: any) {
      setMessage("Network error updating merchandise data");
    }
    setSubmitting(false);
  };

  const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

  // Sales calc (vertical)
  const calculateShares = () => {
    if (!event) return null;

    const grossCollected = Number(ticketSales) || 0; // total collected
    const tipsNum = Number(tips) || 0;
    const taxPct = stateTaxRate; // kept for reference/debug; not used for tax amount

    const totalSales = Math.max(grossCollected - tipsNum, 0); // Total collected - Tips
    const tax = Math.max(Number(manualTaxAmount) || 0, 0);
    const netSales = Math.max(totalSales - tax, 0);

    const artistShare = netSales * (event.artist_share_percent / 100);
    const venueShare = netSales * (event.venue_share_percent / 100);
    const pdsShare = netSales * (event.pds_share_percent / 100);

    const result = { grossCollected, tipsNum, totalSales, taxPct, tax, netSales, artistShare, venueShare, pdsShare };
    try {
      console.debug('[SALES-DEBUG] calculateShares:', result);
    } catch {}
    return result;
  };

  // Debug changes in inputs affecting sales computation
  useEffect(() => {
    try {
      const gross = Number(ticketSales) || 0;
      const t = Number(tips) || 0;
      const totalSales = Math.max(gross - t, 0);
      const taxAmt = Math.max(Number(manualTaxAmount) || 0, 0);
      console.debug('[SALES-DEBUG] Inputs changed', {
        ticketSales: gross,
        tips: t,
        manualTaxAmount: taxAmt,
      });
    } catch {}
  }, [ticketSales, tips, manualTaxAmount]);

  // Calculate commission amount - updates reactively when inputs change
  const calculatedCommission = (() => {
    const s = calculateShares();
    if (!s) return 0;
    // Use commissionPool state if set, otherwise fallback to event.commission_pool
    const pool = commissionPool !== "" 
      ? Number(commissionPool) 
      : (event?.commission_pool || 0);
    return s.netSales * pool;
  })();

  // Helper to format ISO -> "HH:mm" for inputs
  const isoToHHMM = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const startTimesheetEdit = (uid: string, span: {
    firstIn: string | null;
    lastOut: string | null;
    firstMealStart: string | null;
    lastMealEnd: string | null;
    secondMealStart: string | null;
    secondMealEnd: string | null;
  }) => {
    if (!canEditTimesheets) return;
    setTimesheetDrafts((prev) => ({
      ...prev,
      [uid]: {
        firstIn: isoToHHMM(span.firstIn),
        lastOut: isoToHHMM(span.lastOut),
        firstMealStart: isoToHHMM(span.firstMealStart),
        lastMealEnd: isoToHHMM(span.lastMealEnd),
        secondMealStart: isoToHHMM(span.secondMealStart),
        secondMealEnd: isoToHHMM(span.secondMealEnd),
      },
    }));
    setEditingTimesheetUserId(uid);
    setMessage("");
  };

  const updateTimesheetDraft = (uid: string, field: keyof TimesheetEditDraft, value: string) => {
    setTimesheetDrafts((prev) => ({
      ...prev,
      [uid]: {
        ...(prev[uid] || {
          firstIn: "",
          lastOut: "",
          firstMealStart: "",
          lastMealEnd: "",
          secondMealStart: "",
          secondMealEnd: "",
        }),
        [field]: value,
      },
    }));
  };

  const cancelTimesheetEdit = () => {
    setEditingTimesheetUserId(null);
    setMessage("");
  };

  const saveTimesheetEdit = async (uid: string) => {
    if (!eventId || !canEditTimesheets) return;
    const draft = timesheetDrafts[uid];
    if (!draft) return;

    setSavingTimesheetUserId(uid);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}/timesheet`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: uid, spans: draft }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to save timesheet edits.");
        return;
      }

      await loadTimesheetTotals();
      setEditingTimesheetUserId(null);
      setMessage("Timesheet updated.");
      setTimeout(() => setMessage(""), 3000);
    } catch (err: any) {
      setMessage(err?.message || "Network error while saving timesheet.");
    } finally {
      setSavingTimesheetUserId(null);
    }
  };

  /**
   * Calculate regular/overtime/doubletime hours based on state labor laws
   * Note: Overtime logic is intentionally disabled in the Payment tab.
   * All hours are treated as regular hours for all states.
   */
  const calculateHoursByState = (actualHours: number, _state: string): { regularHours: number; overtimeHours: number; doubletimeHours: number } => {
    return {
      regularHours: actualHours,
      overtimeHours: 0,
      doubletimeHours: 0,
    };
  };

  const getRestBreakAmount = (actualHours: number, state: string): number => {
    const normalizedState = (state || "").toUpperCase().trim();
    // Nevada & Wisconsin: no rest break amount/column in Payment tab
    if (normalizedState === "NV" || normalizedState === "WI") return 0;
    return actualHours > 10 ? 12 : actualHours > 0 ? 9 : 0;
  };

  const payrollState = event?.state?.toUpperCase()?.trim() || "CA";
  const hideRestBreakColumn = payrollState === "NV" || payrollState === "WI";

  // Save Payment Data - Store payment calculations to database
  const handleSavePaymentData = async () => {
    if (!event || !eventId) return;
    if (!canEditTimesheets) {
      setMessage("Only exec can edit timesheets and payroll adjustments.");
      return;
    }

    setSavingPayment(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Calculate all payment data using rates from database
      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
      const baseRate = getBaseRateForState(eventState);

      const sharesData = calculateShares();
      const netSales = sharesData?.netSales || 0;
      const poolPercent = Number(commissionPool || event?.commission_pool || 0) || 0;
      const totalCommissionPool = netSales * poolPercent;
      const totalTips = Number(tips) || 0;

      // Only include non-trailers in the hours pool for commissions/tips prorating
      const totalEligibleHours = teamMembers.reduce((sum: number, member: any) => {
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const memberDivision = member.users?.division;
        if (memberDivision === 'trailers') return sum;
        const ms = timesheetTotals[uid] || 0;
        return sum + (ms / (1000 * 60 * 60));
      }, 0);

      const perVendorCommissionShare =
        vendorCount > 0 ? totalCommissionPool / vendorCount : 0;

      // Build vendor payments array
      const vendorPayments = teamMembers.map((member: any) => {
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const totalMs = timesheetTotals[uid] || 0;
        const actualHours = totalMs / (1000 * 60 * 60);
        const memberDivision = member.users?.division;

        // No OT/DT logic in Payment tab
        const { regularHours, overtimeHours, doubletimeHours } = calculateHoursByState(actualHours, eventState);
        const overtimePay = 0;
        const doubletimePay = 0;

        // Users with division "trailers" should NOT receive commissions or tips
        const isTrailersDivision = memberDivision === 'trailers';

        // Ext Amt on Reg Rate = total hours × base rate × 1.5
        const extAmtOnRegRate = actualHours * baseRate * 1.5;
        const restBreak = getRestBreakAmount(actualHours, eventState);

        // Payment rule: if per-vendor commission share is lower than Ext Amt on Reg Rate,
        // pay Ext Amt on Reg Rate (otherwise pay the commission share).
        const totalFinalCommission = Math.max(extAmtOnRegRate, perVendorCommissionShare);
        const commissionAmount =
          !isTrailersDivision && vendorCount > 0
            ? Math.max(0, totalFinalCommission - extAmtOnRegRate)
            : 0;
        const proratedTips = !isTrailersDivision && totalEligibleHours > 0 ? (totalTips * actualHours) / totalEligibleHours : 0;

        const totalPay = extAmtOnRegRate + commissionAmount + proratedTips + restBreak;

        return {
          userId: uid,
          actualHours,
          regularHours,
          overtimeHours,
          doubletimeHours,
          regularPay: extAmtOnRegRate,
          overtimePay,
          doubletimePay,
          commissions: commissionAmount,
          tips: proratedTips,
          restBreak,
          totalPay,
        };
      });

      // Call save-payment API
      const response = await fetch(`/api/events/${eventId}/save-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          commissionPoolPercent: poolPercent,
          commissionPoolDollars: totalCommissionPool,
          totalTips,
          baseRate,
          netSales,
          vendorPayments,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save payment data');
      }

      console.log('✅ Payment data saved:', result);
      setMessage('Payment data saved successfully!');

      // Auto-clear message after 5 seconds
      setTimeout(() => setMessage(""), 5000);
    } catch (err: any) {
      console.error('❌ Error saving payment data:', err);
      setMessage(`Error: ${err.message || 'Failed to save payment data'}`);
    } finally {
      setSavingPayment(false);
    }
  };

  // Process Payroll - Send emails to all team members
  const handleProcessPayroll = async () => {
    if (!event || !eventId) return;

    if (!window.confirm(`Send payroll details to all ${teamMembers.length} team members via email?`)) {
      return;
    }

    setSubmitting(true);
    try {
      // Calculate payroll data for each team member using rates from database
      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
      const baseRate = getBaseRateForState(eventState);

      const sharesData = calculateShares();
      const netSales = sharesData?.netSales || 0;
      const poolPercent = Number(commissionPool || event?.commission_pool || 0) || 0;
      const totalCommissionPool = netSales * poolPercent;
      const totalTips = Number(tips) || 0;

      // Only include non-trailers in the hours pool for email/payroll preview prorating
      const totalEligibleHoursEmail = teamMembers.reduce((sum: number, member: any) => {
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const memberDivision = member.users?.division;
        if (memberDivision === 'trailers') return sum;
        const ms = timesheetTotals[uid] || 0;
        return sum + (ms / (1000 * 60 * 60));
      }, 0);

      const perVendorCommissionShare =
        vendorCount > 0 ? totalCommissionPool / vendorCount : 0;

      const payrollData = teamMembers.map((member: any) => {
        const profile = member.users?.profiles;
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const totalMs = timesheetTotals[uid] || 0;
        const actualHours = totalMs / (1000 * 60 * 60);
        const memberDivision = member.users?.division;

        // Calculate pay
        const { regularHours, overtimeHours, doubletimeHours } = calculateHoursByState(actualHours, eventState);
        const overtimePay = 0;
        const doubletimePay = 0;

        // Users with division "trailers" should NOT receive commissions or tips
        const isTrailersDivision = memberDivision === 'trailers';

        // Ext Amt on Reg Rate = total hours × base rate × 1.5
        const extAmtOnRegRate = actualHours * baseRate * 1.5;
        const restBreak = getRestBreakAmount(actualHours, eventState);

        // Payment rule: if per-vendor commission share is lower than Ext Amt on Reg Rate,
        // pay Ext Amt on Reg Rate (otherwise pay the commission share).
        const totalFinalCommission = Math.max(extAmtOnRegRate, perVendorCommissionShare);
        const commissionAmount =
          !isTrailersDivision && vendorCount > 0
            ? Math.max(0, totalFinalCommission - extAmtOnRegRate)
            : 0;
        const proratedTips = !isTrailersDivision && totalEligibleHoursEmail > 0 ? (totalTips * actualHours) / totalEligibleHoursEmail : 0;
        const adjustment = adjustments[uid] || 0;

        const totalPay = extAmtOnRegRate + commissionAmount + proratedTips + restBreak + adjustment;

        return {
          email: member.users?.email,
          firstName: profile?.first_name || "Team Member",
          lastName: profile?.last_name || "",
          regularHours: regularHours.toFixed(2),
          regularPay: extAmtOnRegRate.toFixed(2),
          overtimeHours: overtimeHours.toFixed(2),
          overtimePay: overtimePay.toFixed(2),
          doubletimeHours: doubletimeHours.toFixed(2),
          doubletimePay: doubletimePay.toFixed(2),
          commission: commissionAmount.toFixed(2),
          tips: proratedTips.toFixed(2),
          restBreak: restBreak.toFixed(2),
          adjustment: adjustment.toFixed(2),
          totalPay: totalPay.toFixed(2),
          baseRate: baseRate.toFixed(2),
        };
      });

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}/process-payroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          eventName: event.event_name,
          eventDate: event.event_date,
          venue: event.venue,
          city: event.city,
          state: event.state,
          payrollData,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessage(`Success! Payroll emails sent to ${data.sentCount || payrollData.length} team members.`);
      } else {
        const error = await res.text();
        setMessage(`Failed to process payroll: ${error}`);
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setSubmitting(false);
  };

  if (!isAuthed || loading) {
    return (
      <div className="container mx-auto max-w-6xl py-10 px-4">
        <div className="text-center">Loading event details...</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto max-w-6xl py-10 px-4">
        <div className="bg-red-100 border-red-400 text-red-700 px-6 py-3 rounded">Event not found</div>
        <div className="mt-4">
          <Link href={userRole === 'exec' ? '/global-calendar' : '/dashboard'}>
            <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
              &larr; Back to Dashboard
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const shares = calculateShares();
  const percentTotal =
    ((event.artist_share_percent || 0) +
    (event.venue_share_percent || 0) +
    (event.pds_share_percent || 0)) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="container mx-auto max-w-7xl py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <Link href={userRole === 'exec' ? '/global-calendar' : '/dashboard'}>
            <button className="group flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 font-semibold py-2.5 px-5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 border border-gray-200">
              <svg className="w-5 h-5 transform group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </button>
          </Link>
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-200">
            <div className={`w-2.5 h-2.5 rounded-full ${event.is_active ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className="text-sm font-medium text-gray-700">{event.is_active ? 'Active' : 'Inactive'}</span>
          </div>
        </div>

        {message && (
          <div
            className={`mb-6 px-6 py-4 rounded-xl relative shadow-lg backdrop-blur-sm ${
              message.toLowerCase().includes("success")
                ? "bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 text-green-800"
                : "bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-200 text-red-800"
            }`}
          >
            <div className="flex items-center gap-3">
              {message.toLowerCase().includes("success") ? (
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span className="font-medium">{message}</span>
            </div>
            <button onClick={() => setMessage("")} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {Math.abs(percentTotal - 100) > 0.01 && (
          <div className="mb-6 px-6 py-4 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 text-amber-900 shadow-sm">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-medium">Heads up: your split percentages add up to {percentTotal.toFixed(2)}% (not 100%).</span>
            </div>
          </div>
        )}

        <div className="bg-white shadow-2xl rounded-2xl overflow-hidden border border-gray-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-white opacity-5 rounded-full -mr-48 -mt-48"></div>
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-white opacity-5 rounded-full -ml-48 -mb-48"></div>
            <div className="relative z-10">
              <h1 className="text-4xl font-bold mb-4 keeping-tight">{event.event_name}</h1>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-blue-100">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span><strong className="text-white">Venue:</strong> {event.venue} ({event.city}, {event.state})</span>
                </div>
                {event.artist && (
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    <span><strong className="text-white">Artist:</strong> {event.artist}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span><strong className="text-white">Date:</strong> {event.event_date} | {event.start_time?.slice(0, 5)} - {event.end_time?.slice(0, 5)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200 bg-gradient-to-r from-gray-50 to-slate-50">
            <nav className="flex overflow-x-auto">
              {[
                ["edit", "Edit Event", "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"],
                ["sales", "Sales", "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"],
                ["merchandise", "Merchandise", "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"],
                ["team", "Team", "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"],
                ["timesheet", "TimeSheet", "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"],
                ["hr", "Payment", "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"],
              ].map(([key, label, icon]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as TabType)}
                  className={`group relative px-6 py-4 font-semibold transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${
                    activeTab === (key as TabType)
                      ? "text-blue-600"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                  </svg>
                  {label}
                  {activeTab === (key as TabType) && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-t-full"></div>
                  )}
                </button>
              ))}
            </nav>
          </div>

        {/* Content */}
        <div className="p-8 bg-gradient-to-br from-gray-50 to-slate-50">
          {/* EDIT TAB */}
          {activeTab === "edit" && (
            <form onSubmit={handleSubmit} className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Basic Information
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Event Name *</label>
                    <input
                      name="event_name"
                      value={form.event_name}
                      onChange={handleChange}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                      placeholder="Enter event name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Artist</label>
                    <input
                      name="artist"
                      value={form.artist || ""}
                      onChange={handleChange}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                      placeholder="Artist name (optional)"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Venue *</label>
                    <select
                      name="venue"
                      value={form.venue}
                      onChange={handleVenueChange}
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                    >
                      <option value="">Select a venue...</option>
                      {venues.map((venue) => (
                        <option key={venue.id} value={venue.venue_name}>
                          {venue.venue_name} - {venue.city}, {venue.state}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">City (Auto-filled)</label>
                    <input
                      name="city"
                      value={form.city || ""}
                      readOnly
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 cursor-not-allowed text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">State (Auto-filled)</label>
                    <input
                      name="state"
                      value={form.state || ""}
                      readOnly
                      className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 cursor-not-allowed text-gray-600 uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Event Date *</label>
                    <input
                      name="event_date"
                      value={form.event_date}
                      onChange={handleChange}
                      required
                      type="date"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Event Timing
                </h3>
                {form.start_time && form.end_time && form.end_time < form.start_time && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                    <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-amber-800">
                      This event continues into the next day (ends at {form.end_time} on the following day)
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Start Time *</label>
                    <input
                      name="start_time"
                      value={form.start_time}
                      onChange={handleChange}
                      required
                      type="time"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">End Time *</label>
                    <input
                      name="end_time"
                      value={form.end_time}
                      onChange={handleChange}
                      required
                      type="time"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Total Collected</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                      <input
                        name="ticket_sales"
                        value={form.ticket_sales || ""}
                        onChange={handleChange}
                        type="number"
                        min="0"
                        step="1"
                        className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Revenue Split
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Artist Share %</label>
                    <input
                      name="artist_share_percent"
                      value={(form.artist_share_percent || 0) + '%'}
                      onChange={(e) => {
                        const val = e.target.value.replace('%', '').trim();
                        handleChange({ target: { name: 'artist_share_percent', value: val } } as any);
                      }}
                      type="text"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                      placeholder="50%"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Venue Share %</label>
                    <input
                      name="venue_share_percent"
                      value={(form.venue_share_percent || 0) + '%'}
                      onChange={(e) => {
                        const val = e.target.value.replace('%', '').trim();
                        handleChange({ target: { name: 'venue_share_percent', value: val } } as any);
                      }}
                      type="text"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                      placeholder="30%"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">PDS Share %</label>
                    <input
                      name="pds_share_percent"
                      value={(form.pds_share_percent || 0) + '%'}
                      onChange={(e) => {
                        const val = e.target.value.replace('%', '').trim();
                        handleChange({ target: { name: 'pds_share_percent', value: val } } as any);
                      }}
                      type="text"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                      placeholder="20%"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Commission Pool (%)</label>
                    <input
                      name="commission_pool"
                      value={((form.commission_pool || 0) * 100) + '%'}
                      onChange={(e) => {
                        const val = e.target.value.replace('%', '').trim();
                        const fraction = Number(val) / 100;
                        handleChange({ target: { name: 'commission_pool', value: fraction.toString() } } as any);
                      }}
                      type="text"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white hover:border-gray-400"
                      placeholder="4%"
                    />
                    <p className="text-xs text-gray-500 mt-2">Displayed as percentage (e.g., 4%)</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-3">
                  <input
                    id="is_active"
                    type="checkbox"
                    name="is_active"
                    checked={form.is_active}
                    onChange={handleChange}
                    className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                  />
                  <label htmlFor="is_active" className="text-sm font-semibold text-gray-700 cursor-pointer">
                    Event is Active
                  </label>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                disabled={submitting}
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Updating...
                  </span>
                ) : (
                  "Update Event"
                )}
              </button>
            </form>
          )}

          {/* SALES TAB */}
          {activeTab === "sales" && (
            <div className="space-y-8">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Sales Information
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Total Collected ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">$</span>
                      <input
                        type="number"
                        value={ticketSales}
                        onChange={(e) => setTicketSales(e.target.value)}
                        placeholder="0"
                        step="1"
                        min="0"
                        className="w-full pl-10 pr-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white hover:border-gray-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Number of Tickets/People</label>
                    <input
                      type="number"
                      value={ticketCount}
                      onChange={(e) => setTicketCount(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white hover:border-gray-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Tax Amount ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">$</span>
                      <input
                        type="number"
                        value={manualTaxAmount}
                        onChange={(e) => setManualTaxAmount(e.target.value)}
                        placeholder="0"
                        step="1"
                        min="0"
                        className="w-full pl-10 pr-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white hover:border-gray-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Tips ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">$</span>
                      <input
                        type="number"
                        value={tips}
                        onChange={(e) => setTips(e.target.value)}
                        placeholder="0"
                        step="1"
                        min="0"
                        className="w-full pl-10 pr-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white hover:border-gray-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Commission Pool (%)</label>
                    <input
                      type="text"
                      value={(() => {
                        // Convert fraction to percentage for display
                        const poolValue = Number(commissionPool || event?.commission_pool || 0);
                        return (poolValue * 100).toFixed(2) + '%';
                      })()}
                      onChange={(e) => {
                        const val = e.target.value.replace('%', '').trim();
                        if (val === '' || val === '0') {
                          setCommissionPool('');
                          return;
                        }
                        const numVal = Number(val);
                        if (isNaN(numVal)) return;
                        // Convert percentage to fraction (4% -> 0.04)
                        const fraction = numVal / 100;
                        setCommissionPool(fraction.toString());
                      }}
                      placeholder="4%"
                      className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white hover:border-gray-400"
                    />
                    <p className="text-xs text-gray-500 mt-2">Displayed as percentage (e.g., 4% = 0.04 fraction)</p>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Commission ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg">$</span>
                      <input
                        type="text"
                        value={calculatedCommission.toFixed(2)}
                        readOnly
                        className="w-full pl-10 pr-4 py-3 text-lg border border-gray-200 rounded-lg bg-gray-50 cursor-not-allowed text-gray-600"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Auto: Net Sales × Commission Pool (fraction)</p>
                  </div>
                </div>

                <button
                  onClick={handleSaveSales}
                  disabled={submitting}
                  className="w-full mt-6 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </span>
                  ) : "Save Sales Data"}
                </button>
              </div>

              {shares && (
                <>
                  {/* Sales Summary */}
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl shadow-sm border-2 border-blue-200 p-6">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900">
                      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Sales Summary
                    </h3>
                    <div className="bg-white rounded-lg p-6 space-y-4 shadow-sm">
                      <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                        <span className="font-semibold text-gray-700">Total collected</span>
                        <span className="text-2xl font-bold text-gray-900">
                          ${shares.grossCollected.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                        <span className="font-semibold text-gray-700">− Tips</span>
                        <span className="text-xl font-bold text-orange-600">−${shares.tipsNum.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                        <span className="font-semibold text-gray-700">= Total sales</span>
                        <span className="text-2xl font-bold text-gray-900">
                          ${shares.totalSales.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center pb-3 border-b border-gray-200">
                        <span className="font-semibold text-red-600">− Tax Amount</span>
                        <span className="text-xl font-bold text-red-600">−${shares.tax.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center pt-2">
                        <span className="text-lg font-bold text-gray-900">= Net Sales</span>
                        <span className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">${shares.netSales.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Per Person */}
                  {ticketCount && Number(ticketCount) > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                      <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900">
                        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        Per Person Metrics
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 text-center border border-blue-200">
                          <div className="text-sm font-semibold text-blue-700 mb-3">$ / Head (Total)</div>
                          <div className="text-4xl font-bold text-blue-600 mb-2">
                            ${(shares.grossCollected / Number(ticketCount)).toFixed(2)}
                          </div>
                          <div className="text-xs text-blue-600">Based on Total collected</div>
                        </div>

                        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 text-center border border-purple-200">
                          <div className="text-sm font-semibold text-purple-700 mb-3">Avg $ (Total Sales)</div>
                          <div className="text-4xl font-bold text-purple-600 mb-2">
                            ${(shares.totalSales / Number(ticketCount)).toFixed(2)}
                          </div>
                          <div className="text-xs text-purple-600">After tips removed</div>
                        </div>

                        <div className="bg-gradient-to-br from-teal-50 to-teal-100 rounded-xl p-6 text-center border border-teal-200">
                          <div className="text-sm font-semibold text-teal-700 mb-3">Avg $ (Net)</div>
                          <div className="text-4xl font-bold text-teal-600 mb-2">
                            ${(shares.netSales / Number(ticketCount)).toFixed(2)}
                          </div>
                          <div className="text-xs text-teal-600">After tax removed</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Split removed per request */}
                </>
              )}
            </div>
          )}

          {/* MERCH TAB */}
          {activeTab === "merchandise" && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                  Merchandise Settlement
                </h2>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-bold mb-6 text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                  </svg>
                  Enter Sales Data
                </h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                  {/* Apparel */}
                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-5 border-2 border-purple-200 shadow-sm">
                    <h4 className="font-bold text-purple-700 mb-4 flex items-center gap-2 text-lg">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                      </svg>
                      Apparel
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Gross Sales ($)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                          <input
                            type="number"
                            value={apparelGross}
                            onChange={(e) => setApparelGross(e.target.value)}
                            placeholder="0"
                            step="1"
                            min="0"
                            className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Sales Tax (%)</label>
                          <input
                            type="text"
                            value={apparelTaxRate + '%'}
                            onChange={(e) => {
                              const val = e.target.value.replace('%', '').trim();
                              setApparelTaxRate(val);
                            }}
                            placeholder="0%"
                            className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">CC Fee (%)</label>
                          <input
                            type="text"
                            value={apparelCCFeeRate + '%'}
                            onChange={(e) => {
                              const val = e.target.value.replace('%', '').trim();
                              setApparelCCFeeRate(val);
                            }}
                            placeholder="0%"
                            className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Artist Share (%)</label>
                        <input
                          type="text"
                          value={apparelArtistPercent + '%'}
                          onChange={(e) => {
                            const val = e.target.value.replace('%', '').trim();
                            setApparelArtistPercent(val);
                          }}
                          placeholder="80%"
                          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Other */}
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-5 border-2 border-blue-200 shadow-sm">
                    <h4 className="font-bold text-blue-700 mb-4 flex items-center gap-2 text-lg">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      Other Merchandise
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Gross Sales ($)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                          <input
                            type="number"
                            value={otherGross}
                            onChange={(e) => setOtherGross(e.target.value)}
                            placeholder="0"
                            step="1"
                            min="0"
                            className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">Sales Tax (%)</label>
                          <input
                            type="text"
                            value={otherTaxRate + '%'}
                            onChange={(e) => {
                              const val = e.target.value.replace('%', '').trim();
                              setOtherTaxRate(val);
                            }}
                            placeholder="0%"
                            className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-2">CC Fee (%)</label>
                          <input
                            type="text"
                            value={otherCCFeeRate + '%'}
                            onChange={(e) => {
                              const val = e.target.value.replace('%', '').trim();
                              setOtherCCFeeRate(val);
                            }}
                            placeholder="0%"
                            className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Artist Share (%)</label>
                        <input
                          type="text"
                          value={otherArtistPercent + '%'}
                          onChange={(e) => {
                            const val = e.target.value.replace('%', '').trim();
                            setOtherArtistPercent(val);
                          }}
                          placeholder="80%"
                          className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Music */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-5 border-2 border-green-200 shadow-sm max-w-2xl">
                  <h4 className="font-bold text-green-700 mb-4 flex items-center gap-2 text-lg">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                    Music Sales
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Gross Sales ($)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                          type="number"
                          value={musicGross}
                          onChange={(e) => setMusicGross(e.target.value)}
                          placeholder="0"
                          step="1"
                          min="0"
                          className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Sales Tax (%)</label>
                      <input
                        type="text"
                        value={musicTaxRate + '%'}
                        onChange={(e) => {
                          const val = e.target.value.replace('%', '').trim();
                          setMusicTaxRate(val);
                        }}
                        placeholder="0%"
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">CC Fee (%)</label>
                      <input
                        type="text"
                        value={musicCCFeeRate + '%'}
                        onChange={(e) => {
                          const val = e.target.value.replace('%', '').trim();
                          setMusicCCFeeRate(val);
                        }}
                        placeholder="0%"
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Artist Share (%)</label>
                      <input
                        type="text"
                        value={musicArtistPercent + '%'}
                        onChange={(e) => {
                          const val = e.target.value.replace('%', '').trim();
                          setMusicArtistPercent(val);
                        }}
                        placeholder="90%"
                        className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveMerchandise}
                    disabled={submitting}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </span>
                    ) : "Calculate Settlement"}
                  </button>
                </div>
              </div>

              {/* Settlement Summary */}
              {(() => {
                const appGross = Number(apparelGross) || 0;
                const appTax = (appGross * (Number(apparelTaxRate) || 0)) / 100;
                const appCC = (appGross * (Number(apparelCCFeeRate) || 0)) / 100;
                const appAdjusted = appGross - appTax - appCC;

                const othGross = Number(otherGross) || 0;
                const othTax = (othGross * (Number(otherTaxRate) || 0)) / 100;
                const othCC = (othGross * (Number(otherCCFeeRate) || 0)) / 100;
                const othAdjusted = othGross - othTax - othCC;

                const merchGross = appGross + othGross;
                const merchTax = appTax + othTax;
                const merchCC = appCC + othCC;
                const merchAdjusted = appAdjusted + othAdjusted;

                const musGross = Number(musicGross) || 0;
                const musTax = (musGross * (Number(musicTaxRate) || 0)) / 100;
                const musCC = (musGross * (Number(musicCCFeeRate) || 0)) / 100;
                const musAdjusted = musGross - musTax - musCC;

                const totalGross = merchGross + musGross;
                const totalTax = merchTax + musTax;
                const totalCC = merchCC + musCC;
                const totalAdjusted = merchAdjusted + musAdjusted;

                const appArtistPct = Number(apparelArtistPercent) || 0;
                const othArtistPct = Number(otherArtistPercent) || 0;
                const musArtistPct = Number(musicArtistPercent) || 0;

                const appArtistCut = (appAdjusted * appArtistPct) / 100;
                const appVenueCut = (appAdjusted * (100 - appArtistPct)) / 100;

                const othArtistCut = (othAdjusted * othArtistPct) / 100;
                const othVenueCut = (othAdjusted * (100 - othArtistPct)) / 100;

                const musArtistCut = (musAdjusted * musArtistPct) / 100;
                const musVenueCut = (musAdjusted * (100 - musArtistPct)) / 100;

                const totalArtist = appArtistCut + othArtistCut + musArtistCut;
                const totalVenue = appVenueCut + othVenueCut + musVenueCut;

                const hasData = appGross > 0 || othGross > 0 || musGross > 0;

                return hasData ? (
                  <>
                    <hr className="my-6" />

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Merchandise Sales */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Merchandise Sales</h3>
                        <div className="bg-white border border-gray-200 rounded-b p-4 space-y-3">
                          <div className="grid grid-cols-3 gap-2 text-sm font-semibold border-b pb-2">
                            <div>Category</div>
                            <div className="text-right">Apparel</div>
                            <div className="text-right">Other</div>
                            <div className="col-span-3 border-b pt-2"></div>
                            <div>Total</div>
                            <div className="text-right">${appGross.toFixed(2)}</div>
                            <div className="text-right">${othGross.toFixed(2)}</div>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Gross Sales</span>
                              <span className="font-bold">${merchGross.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Sales Tax</span>
                              <span>- ${merchTax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Fee: credit card</span>
                              <span>- ${merchCC.toFixed(2)}</span>
                            </div>
                            <hr />
                            <div className="flex justify-between font-bold text-base">
                              <span>Adjusted Gross</span>
                              <span className="text-green-600">${merchAdjusted.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Music Sales */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Music Sales</h3>
                        <div className="bg-white border border-gray-200 rounded-b p-4 space-y-3">
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Total</span>
                              <span className="font-bold">${musGross.toFixed(2)}</span>
                            </div>
                          </div>

                          <div className="space-y-2 text-sm pt-6">
                            <div className="flex justify-between">
                              <span className="font-medium">Gross Sales</span>
                              <span className="font-bold">${musGross.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Sales Tax</span>
                              <span>- ${musTax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Fee: credit card</span>
                              <span>- ${musCC.toFixed(2)}</span>
                            </div>
                            <hr />
                            <div className="flex justify-between font-bold text-base">
                              <span>Adjusted Gross</span>
                              <span className="text-green-600">${musAdjusted.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Total Sales */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Total Collected</h3>
                        <div className="bg-white border border-gray-200 rounded-b p-4 space-y-3">
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Total</span>
                              <span className="font-bold">${totalGross.toFixed(2)}</span>
                            </div>
                          </div>

                          <div className="space-y-2 text-sm pt-6">
                            <div className="flex justify-between">
                              <span className="font-medium">Gross Sales</span>
                              <span className="font-bold">${totalGross.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Sales Tax</span>
                              <span>- ${totalTax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Fee: credit card</span>
                              <span>- ${totalCC.toFixed(2)}</span>
                            </div>
                            <hr />
                            <div className="flex justify-between font-bold text-base">
                              <span>Adjusted Gross</span>
                              <span className="text-green-600">${totalAdjusted.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Settlement Bar */}
                    <div className="bg-gray-700 text-white p-4 rounded flex justify-between items-center mt-4">
                      <span className="text-xl font-bold">Settlement</span>
                      <div className="flex gap-8">
                        <div>
                          <span className="text-sm opacity-80">Total Due Artist: </span>
                          <span className="text-2xl font-bold">${totalArtist.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-sm opacity-80">Total Due Venue: </span>
                          <span className="text-2xl font-bold">${totalVenue.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                      {/* Artist */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Artist</h3>
                        <div className="bg-white border border-gray-200 rounded-b overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left p-3 font-medium">Category</th>
                                <th className="text-right p-3 font-medium">Cuts</th>
                                <th className="text-right p-3 font-medium">Fees</th>
                                <th className="text-right p-3 font-medium">Taxes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              <tr>
                                <td className="p-3">Apparel ({appArtistPct}%)</td>
                                <td className="text-right p-3">${appArtistCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                              <tr>
                                <td className="p-3">Other ({othArtistPct}%)</td>
                                <td className="text-right p-3">${othArtistCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                              <tr className="font-semibold bg-gray-50">
                                <td className="p-3">Merch Subtotal</td>
                                <td className="text-right p-3">
                                  ${(appArtistCut + othArtistCut).toFixed(2)}
                                </td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                              <tr>
                                <td className="p-3">Music ({musArtistPct}%)</td>
                                <td className="text-right p-3">${musArtistCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Venue */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Venue</h3>
                        <div className="bg-white border border-gray-200 rounded-b overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left p-3 font-medium">Category</th>
                                <th className="text-right p-3 font-medium">Cuts</th>
                                <th className="text-right p-3 font-medium">Fees</th>
                                <th className="text-right p-3 font-medium">Taxes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              <tr>
                                <td className="p-3">Apparel ({100 - appArtistPct}%)</td>
                                <td className="text-right p-3">${appVenueCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${appTax.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td className="p-3">Other ({100 - othArtistPct}%)</td>
                                <td className="text-right p-3">${othVenueCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${othTax.toFixed(2)}</td>
                              </tr>
                              <tr className="font-semibold bg-gray-50">
                                <td className="p-3">Merch Subtotal</td>
                                <td className="text-right p-3">
                                  ${(appVenueCut + othVenueCut).toFixed(2)}
                                </td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${(appTax + othTax).toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td className="p-3">Music ({100 - musArtistPct}%)</td>
                                <td className="text-right p-3">${musVenueCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${musTax.toFixed(2)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null;
              })()}
            </div>
          )}

          {/* TEAM TAB */}
          {activeTab === "team" && (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Event Team</h2>
                <button
                  onClick={loadTeam}
                  disabled={loadingTeam}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                >
                  {loadingTeam ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {loadingTeam ? (
                <div className="text-center py-12">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-4 text-gray-600">Loading team members...</p>
                </div>
              ) : teamMembers.length === 0 ? (
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600 text-lg font-medium">No team members assigned yet</p>
                  <p className="text-gray-500 text-sm mt-2">Create a team from the dashboard to invite vendors</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-blue-600 mb-1">Total Invited</div>
                      <div className="text-2xl font-bold text-blue-900">{teamMembers.length}</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-green-600 mb-1">Confirmed</div>
                      <div className="text-2xl font-bold text-green-900">
                        {teamMembers.filter((m) => m.status === "confirmed").length}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-amber-600 mb-1">Pending</div>
                      <div className="text-2xl font-bold text-amber-900">
                        {teamMembers.filter((m) => m.status === "pending_confirmation").length}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border rounded-lg p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Search Team</label>
                    <input
                      type="text"
                      placeholder="Search by name, email, phone, role, or status"
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      Showing {filteredTeamListMembers.length} of {teamMembers.length}{" "}
                      {teamMembers.length === 1 ? "member" : "members"}
                    </p>
                  </div>

                  {/* List */}
                  <div className="bg-white border rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                            Vendor
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                            Email
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                            Phone
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                            Invited On
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredTeamListMembers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                              No team members match your search
                            </td>
                          </tr>
                        ) : (
                        filteredTeamListMembers.map((member: any) => {
                          const profile = member.users?.profiles;
                          const firstName = profile?.first_name || "N/A";
                          const lastName = profile?.last_name || "";
                          const email = member.users?.email || "N/A";
                          const phone = profile?.phone || "N/A";

                          let statusBadge = "";
                          let statusColor = "";
                          switch (member.status) {
                            case "confirmed":
                              statusBadge = "Confirmed";
                              statusColor = "bg-green-100 text-green-800";
                              break;
                            case "declined":
                              statusBadge = "Declined";
                              statusColor = "bg-red-100 text-red-800";
                              break;
                            case "pending_confirmation":
                              statusBadge = "Pending";
                              statusColor = "bg-amber-100 text-amber-800";
                              break;
                            case "assigned":
                              statusBadge = "Assigned";
                              statusColor = "bg-blue-100 text-blue-800";
                              break;
                            default:
                              statusBadge = member.status || "Unknown";
                              statusColor = "bg-gray-100 text-gray-800";
                          }

                          return (
                            <tr key={member.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">
                                  {firstName} {lastName}
                                </div>
                              </td>

                              
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{email}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{phone}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span
                                  className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}`}
                                >
                                  {statusBadge}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {new Date(member.created_at).toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </td>
                            </tr>
                          );
                        })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TIMESHEET TAB */}
          {activeTab === "timesheet" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">TimeSheet</h2>
                <div className="text-sm text-gray-500">
                  Event window: {event?.start_time?.slice(0, 5)} – {event?.end_time?.slice(0, 5)}
                </div>
              </div>

              {!canEditTimesheets && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Read-only access. Only exec can edit timesheets.
                </div>
              )}

              {loadingTimesheetTab && (
                <div className="text-center py-6 bg-white border rounded-lg">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-3 text-sm text-gray-600">Loading timesheet data...</p>
                </div>
              )}

              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-blue-700 font-medium">Members</div>
                  <div className="text-2xl font-bold text-blue-900">{teamMembers.length}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-sm text-green-700 font-medium">Total Hours (decimal)</div>
                  <div className="text-2xl font-bold text-green-900">
                    {(() => {
                      const totalMs = teamMembers.reduce((acc: number, m: any) => {
                        const uid = (m.user_id || m.users?.id || "").toString();
                        return acc + (timesheetTotals[uid] || 0);
                      }, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);
                      return totalHours.toFixed(2);
                    })()}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white border rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Staff
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Clock In
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Clock Out
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 1 Start
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 1 End
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 2 Start
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 2 End
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Hours
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {teamMembers.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500 text-sm">
                          No time entries yet
                        </td>
                      </tr>
                    ) : (
                      teamMembers.map((m: any) => {
                        const profile = m.users?.profiles;
                        const firstName = profile?.first_name || "N/A";
                        const lastName = profile?.last_name || "";
                        const uid = (m.user_id || m.vendor_id || m.users?.id || "").toString();

                        const span = timesheetSpans[uid] || {
                          firstIn: null,
                          lastOut: null,
                          firstMealStart: null,
                          lastMealEnd: null,
                          secondMealStart: null,
                          secondMealEnd: null,
                        };
                        const firstClockIn = isoToHHMM(span.firstIn);
                        const lastClockOut = isoToHHMM(span.lastOut);
                        const firstMealStart = isoToHHMM(span.firstMealStart);
                        const lastMealEnd = isoToHHMM(span.lastMealEnd);
                        const secondMealStart = isoToHHMM(span.secondMealStart);
                        const secondMealEnd = isoToHHMM(span.secondMealEnd);
                        const isEditing = canEditTimesheets && editingTimesheetUserId === uid;
                        const draft = timesheetDrafts[uid] || {
                          firstIn: firstClockIn,
                          lastOut: lastClockOut,
                          firstMealStart,
                          lastMealEnd,
                          secondMealStart,
                          secondMealEnd,
                        };

                        const totalMs = timesheetTotals[uid] || 0;
                        const hours = (totalMs / (1000 * 60 * 60)).toFixed(2);

                        return (
                          <tr key={m.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="font-medium text-sm text-gray-900">
                                {firstName} {lastName}
                              </div>
                              <div className="text-xs text-gray-500">{m.users?.email || "N/A"}</div>
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={isEditing ? draft.firstIn : firstClockIn}
                                onChange={(e) => updateTimesheetDraft(uid, "firstIn", e.target.value)}
                                readOnly={!isEditing}
                                className={`border rounded px-2 py-1 text-sm w-28 ${isEditing ? "bg-white" : "bg-gray-100 cursor-not-allowed"}`}
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={isEditing ? draft.lastOut : lastClockOut}
                                onChange={(e) => updateTimesheetDraft(uid, "lastOut", e.target.value)}
                                readOnly={!isEditing}
                                className={`border rounded px-2 py-1 text-sm w-28 ${isEditing ? "bg-white" : "bg-gray-100 cursor-not-allowed"}`}
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={isEditing ? draft.firstMealStart : firstMealStart}
                                onChange={(e) => updateTimesheetDraft(uid, "firstMealStart", e.target.value)}
                                placeholder="--:--"
                                readOnly={!isEditing}
                                className={`border rounded px-2 py-1 text-sm w-28 ${isEditing ? "bg-white" : "bg-gray-100 cursor-not-allowed"}`}
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={isEditing ? draft.lastMealEnd : lastMealEnd}
                                onChange={(e) => updateTimesheetDraft(uid, "lastMealEnd", e.target.value)}
                                placeholder="--:--"
                                readOnly={!isEditing}
                                className={`border rounded px-2 py-1 text-sm w-28 ${isEditing ? "bg-white" : "bg-gray-100 cursor-not-allowed"}`}
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={isEditing ? draft.secondMealStart : secondMealStart}
                                onChange={(e) => updateTimesheetDraft(uid, "secondMealStart", e.target.value)}
                                placeholder="--:--"
                                readOnly={!isEditing}
                                className={`border rounded px-2 py-1 text-sm w-28 ${isEditing ? "bg-white" : "bg-gray-100 cursor-not-allowed"}`}
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={isEditing ? draft.secondMealEnd : secondMealEnd}
                                onChange={(e) => updateTimesheetDraft(uid, "secondMealEnd", e.target.value)}
                                placeholder="--:--"
                                readOnly={!isEditing}
                                className={`border rounded px-2 py-1 text-sm w-28 ${isEditing ? "bg-white" : "bg-gray-100 cursor-not-allowed"}`}
                              />
                            </td>
                            <td className="px-3 py-3 text-sm font-medium whitespace-nowrap">{hours}</td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {canEditTimesheets ? (
                                isEditing ? (
                                  <>
                                    <button
                                      onClick={() => saveTimesheetEdit(uid)}
                                      disabled={savingTimesheetUserId === uid}
                                      className="text-blue-600 hover:text-blue-700 font-medium text-xs mr-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {savingTimesheetUserId === uid ? "Saving..." : "Save"}
                                    </button>
                                    <button
                                      onClick={cancelTimesheetEdit}
                                      disabled={savingTimesheetUserId === uid}
                                      className="text-gray-600 hover:text-gray-700 font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => startTimesheetEdit(uid, span)}
                                    className="text-blue-600 hover:text-blue-700 font-medium text-xs"
                                  >
                                    Edit
                                  </button>
                                )
                              ) : (
                                <span className="text-xs text-gray-400">View only</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* HR TAB */}
          {activeTab === "hr" && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold mb-6">HR Management</h2>

              {loadingPaymentTab && (
                <div className="text-center py-6 bg-white border rounded-lg">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-3 text-sm text-gray-600">Loading payment data...</p>
                </div>
              )}

              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-blue-600">Staff Assigned</div>
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-blue-900">{event?.confirmed_staff || 0}</div>
                  <div className="text-xs text-blue-600 mt-1">of {event?.required_staff || 0} required</div>
                </div>

                <div className="bg-green-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-green-600">Hours Worked</div>
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-green-900">
                    {(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(1);
                      return totalHours;
                    })()}
                  </div>
                  <div className="text-xs text-green-600 mt-1">total hours</div>
                </div>

                <div className="bg-purple-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-purple-600">Team Total Payment</div>
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-purple-900">
                    ${(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);

                      // Use rates from database based on venue state
                      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                      const baseRate = getBaseRateForState(eventState);

                      const totalPayment = totalHours * baseRate;
                      return totalPayment.toFixed(2);
                    })()}
                  </div>
                  <div className="text-xs text-purple-600 mt-1">based on actual hours</div>
                </div>

                <div className="bg-orange-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-orange-600">Attendance</div>
                    <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-orange-900">0%</div>
                  <div className="text-xs text-orange-600 mt-1">checked in</div>
                </div>
              </div>

              {/* State Rate Indicator */}
              <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-blue-700">Payroll Rate Based On</div>
                    <div className="text-lg font-bold text-blue-900">
                      {event?.state?.toUpperCase() || 'CA'} - {event?.venue || 'Venue'}, {event?.city || 'City'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-blue-700">Base Rate</div>
                    <div className="text-2xl font-bold text-blue-900">
                      ${getBaseRateForState(event?.state || 'CA').toFixed(2)}/hr
                    </div>
                  </div>
                </div>
              </div>

              {/* Staff Schedule with Commission & Tips columns */}
              <div className="bg-white border rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Staff Schedule</h3>

                <div className="mb-4 flex gap-4">
                  <input
                    type="text"
                    placeholder="Search staff..."
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={staffRoleFilter}
                    onChange={(e) => setStaffRoleFilter(e.target.value)}
                    className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Roles</option>
                    <option value="vendor">Vendor</option>
                    <option value="cwt">CWT</option>
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-4 font-semibold text-gray-700">Employee</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Reg Rate</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Loaded Rate</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Hours</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Ext Amt on Reg Rate</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Commission Amt</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Total Final Commission</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Tips</th>
                        {!hideRestBreakColumn && (
                          <th className="text-left p-4 font-semibold text-gray-700">Rest Break</th>
                        )}
                        <th className="text-left p-4 font-semibold text-gray-700">Other</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Total Gross Pay</th>
                        <th className="text-right p-4 font-semibold text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredTeamMembers.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="p-8 text-center text-gray-500">
                            No staff found matching filters
                          </td>
                        </tr>
                      ) : (
                        filteredTeamMembers.map((member: any) => {
                          const profile = member.users?.profiles;
                          const firstName = profile?.first_name || "N/A";
                          const lastName = profile?.last_name || "";
                          const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();

                          // Worked hours for member & all
                          // Prefer server-computed totals; fall back to span-based calc if missing
                          let totalMs = timesheetTotals[uid] || 0;
                          if (!totalMs || totalMs <= 0) {
                            const span = timesheetSpans[uid] || {} as any;
                            if (span.firstIn && span.lastOut) {
                              try {
                                let ms = new Date(span.lastOut).getTime() - new Date(span.firstIn).getTime();
                                let mealMs = 0;
                                if (span.firstMealStart && span.lastMealEnd) {
                                  mealMs += new Date(span.lastMealEnd).getTime() - new Date(span.firstMealStart).getTime();
                                }
                                if (span.secondMealStart && span.secondMealEnd) {
                                  mealMs += new Date(span.secondMealEnd).getTime() - new Date(span.secondMealStart).getTime();
                                }
                                if (ms > 0) totalMs = Math.max(ms - mealMs, 0);
                              } catch {}
                            }
                          }
                          const actualHours = totalMs / (1000 * 60 * 60);
                          // Hours pool for prorating excludes 'trailers' division
                          const totalHoursAll =
                            Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0) /
                            (1000 * 60 * 60);
                          const totalEligibleHours = teamMembers.reduce((sum: number, m: any) => {
                            const mDivision = m.users?.division;
                            if (mDivision === 'trailers') return sum;
                            const mUid = (m.user_id || m.vendor_id || m.users?.id || '').toString();
                            const mMs = timesheetTotals[mUid] || 0;
                            return sum + (mMs / (1000 * 60 * 60));
                          }, 0);

                          // Use rates from database based on venue state
                          const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                          const baseRate = getBaseRateForState(eventState);
                          console.log('[PAYROLL DEBUG] Event:', event?.event_name, 'State:', event?.state, 'Normalized:', eventState, 'Rate:', baseRate);

                          // Loaded rate is always the base rate (no OT/DT logic)
                          const loadedRate = baseRate;

                          // Ext Amt on Reg Rate = total hours × base rate × 1.5
                          const extAmtOnRegRate = actualHours * baseRate * 1.5;

                          // Commission pool (Net Sales × pool fraction)
                          const sharesData = calculateShares();
                          const netSales = sharesData?.netSales || 0;

                          // Prefer current input value; fallback to event.commission_pool
                          const poolPercent =
                            Number(commissionPool || event?.commission_pool || 0) || 0; // fraction 0.04

                          const totalCommissionPool = netSales * poolPercent;

                          const perVendorCommissionShare =
                            vendorCount > 0 ? totalCommissionPool / vendorCount : 0;

                          const isTrailersDivision = member.users?.division === 'trailers';
                          const totalFinalCommission = isTrailersDivision
                            ? extAmtOnRegRate
                            : Math.max(extAmtOnRegRate, perVendorCommissionShare);
                          const commissionAmount =
                            !isTrailersDivision && vendorCount > 0
                              ? Math.max(0, totalFinalCommission - extAmtOnRegRate)
                              : 0;
                          const rawFinalCommissionRate = actualHours > 0 ? totalFinalCommission / actualHours : loadedRate;
                          const finalCommissionRate = Math.max(28.5, rawFinalCommissionRate);

                          // Tips prorated by hours (same method)
                          const totalTips = Number(tips) || 0;
                          const proratedTips = !isTrailersDivision && totalEligibleHours > 0
                            ? (totalTips * actualHours) / totalEligibleHours
                            : 0;

                          // Payment for the event is the Total Final Commission value (Ext Amt + any commission uplift)
                          const totalBasePay = totalFinalCommission;

                          // Calculate total gross pay
                          const restBreak = getRestBreakAmount(actualHours, eventState);
                          const otherAmount = (adjustments[uid] || 0) + (reimbursements[uid] || 0);
                          const totalGrossPay = totalBasePay + proratedTips + restBreak + otherAmount;

                          return (
                            <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                              {/* Employee */}
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                                    {firstName.charAt(0)}
                                    {lastName.charAt(0)}
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-900">
                                      {firstName} {lastName}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {member.users?.email || "N/A"}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Reg Rate */}
                              <td className="p-4">
                                <div className="font-medium text-gray-900">
                                  ${baseRate.toFixed(2)}/hr
                                </div>
                              </td>

                              {/* Loaded Rate */}
                              <td className="p-4">
                                <div className={`font-medium ${finalCommissionRate > baseRate ? 'text-orange-600' : 'text-gray-900'}`}>
                                  ${finalCommissionRate.toFixed(2)}/hr
                                </div>
                              </td>

                              {/* Hours */}
                              <td className="p-4">
                                <div className="font-medium text-gray-900">
                                  {actualHours > 0 ? `${actualHours.toFixed(2)}h` : "0h"}
                                </div>
                              </td>

                              {/* Ext Amt on Reg Rate */}
                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600">
                                  ${extAmtOnRegRate.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-gray-500 mt-1">
                                  {actualHours.toFixed(2)}h × ${baseRate.toFixed(2)} × 1.5
                                </div>
                              </td>

                              {/* Commission Amt */}
                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600">
                                  ${commissionAmount.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  Pool {(poolPercent * 100).toFixed(2)}%
                                </div>
                              </td>

                              {/* Total Final Commission */}
                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600">
                                  ${totalFinalCommission.toFixed(2)}
                                </div>
                              </td>

                              {/* Tips */}
                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600">
                                  ${proratedTips.toFixed(2)}
                                </div>
                              </td>

                              {!hideRestBreakColumn && (
                                <td className="p-4">
                                  <div className="text-sm font-medium text-green-600">
                                    ${restBreak.toFixed(2)}
                                  </div>
                                  <div className="text-[10px] text-gray-500 mt-1">
                                    {actualHours.toFixed(2)}h {actualHours > 10 ? '>' : '≤'} 10h
                                  </div>
                                </td>
                              )}

                              {/* Other (Adjustments + Reimbursements) - Editable */}
                              <td className="p-4">
                                {canEditTimesheets && editingMemberId === member.id ? (
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-gray-500">Adj:</span>
                                      <input
                                        type="number"
                                        value={adjustments[uid] || 0}
                                        onChange={(e) => {
                                          const value = Number(e.target.value) || 0;
                                          setAdjustments(prev => ({ ...prev, [uid]: value }));
                                        }}
                                        className="w-16 px-1 py-0.5 border border-blue-500 rounded text-xs"
                                        placeholder="0"
                                        step="1"
                                        autoFocus
                                      />
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-gray-500">Reimb:</span>
                                      <input
                                        type="number"
                                        value={reimbursements[uid] || 0}
                                        onChange={(e) => {
                                          const value = Number(e.target.value) || 0;
                                          setReimbursements(prev => ({ ...prev, [uid]: value }));
                                        }}
                                        className="w-16 px-1 py-0.5 border border-blue-500 rounded text-xs"
                                        placeholder="0"
                                        step="1"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => {
                                      if (!canEditTimesheets) return;
                                      setEditingMemberId(member.id);
                                    }}
                                    className={`${canEditTimesheets ? "cursor-pointer hover:bg-gray-100" : "cursor-not-allowed opacity-70"} rounded px-2 py-1 text-sm font-medium`}
                                  >
                                    {otherAmount !== 0 ? (
                                      <span className={otherAmount >= 0 ? "text-green-600" : "text-red-600"}>
                                        ${otherAmount >= 0 ? '+' : ''}{otherAmount.toFixed(2)}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">$0.00</span>
                                    )}
                                  </div>
                                )}
                                <div className="text-[10px] text-gray-500 mt-1">
                                  {canEditTimesheets ? "Click to edit" : "Exec only"}
                                </div>
                              </td>

                              {/* Total Gross Pay */}
                              <td className="p-4">
                                <div className="text-sm font-bold text-green-700">
                                  ${totalGrossPay.toFixed(2)}
                                </div>
                              </td>

                              {/* Actions */}
                              <td className="p-4 text-right">
                                <button
                                  onClick={() => {
                                    if (!canEditTimesheets) return;
                                    if (editingMemberId === member.id) {
                                      setEditingMemberId(null);
                                    } else {
                                      setEditingMemberId(member.id);
                                    }
                                  }}
                                  disabled={!canEditTimesheets}
                                  className="text-blue-600 hover:text-blue-700 font-medium text-sm mr-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {editingMemberId === member.id ? 'Done' : 'Edit'}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (window.confirm(`Remove ${firstName} ${lastName} from this event?`)) {
                                      try {
                                        const { data: { session } } = await supabase.auth.getSession();
                                        const res = await fetch(`/api/events/${eventId}/team/${member.id}`, {
                                          method: 'DELETE',
                                          headers: {
                                            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                                          },
                                        });
                                        if (res.ok) {
                                          setMessage(`${firstName} ${lastName} removed successfully`);
                                          loadTeam(); // Reload team list
                                        } else {
                                          const error = await res.text();
                                          setMessage(`Failed to remove team member: ${error}`);
                                        }
                                      } catch (err: any) {
                                        setMessage(`Error: ${err.message}`);
                                      }
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-700 font-medium text-sm transition-colors"
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payroll Summary */
              
              }
              <div className="bg-white border rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Payroll Summary</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Base Pay</span>
                    <span className="font-semibold text-gray-900"> ${(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);

                      // Use rates from database based on venue state
                      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                      const baseRate = getBaseRateForState(eventState);

                      const totalPayment = totalHours * baseRate;
                      return totalPayment.toFixed(2);
                    })()}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Overtime</span>
                    <span className="font-semibold text-gray-900">$0.00</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Tips</span>
                    <span className="font-semibold text-gray-900">${tips || "0.00"}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Adjustments</span>
                    <span className={`font-semibold ${(() => {
                      const total = Object.values(adjustments).reduce((sum, val) => sum + val, 0);
                      return total >= 0 ? 'text-green-600' : 'text-red-600';
                    })()}`}>
                      ${(() => {
                        const total = Object.values(adjustments).reduce((sum, val) => sum + val, 0);
                        return (total >= 0 ? '+' : '') + total.toFixed(2);
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Reimbursements</span>
                    <span className={`font-semibold ${(() => {
                      const total = Object.values(reimbursements).reduce((sum, val) => sum + val, 0);
                      return total >= 0 ? 'text-green-600' : 'text-red-600';
                    })()}`}>
                      ${(() => {
                        const total = Object.values(reimbursements).reduce((sum, val) => sum + val, 0);
                        return (total >= 0 ? '+' : '') + total.toFixed(2);
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-lg font-bold text-gray-900">Total Payroll</span>
                    <span className="text-2xl font-bold text-green-600">${(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);

                      // Use rates from database based on venue state
                      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                      const baseRate = getBaseRateForState(eventState);

                      const basePay = totalHours * baseRate;
                      const tipsAmount = Number(tips) || 0;
                      const adjustmentsTotal = Object.values(adjustments).reduce((sum, val) => sum + val, 0);
                      const reimbursementsTotal = Object.values(reimbursements).reduce((sum, val) => sum + val, 0);
                      const totalPayroll = basePay + tipsAmount + adjustmentsTotal + reimbursementsTotal;

                      return totalPayroll.toFixed(2);
                    })()}</span>
                  </div>

                  {/* Save Payment Data Button */}
                  <button
                    onClick={handleSavePaymentData}
                    disabled={savingPayment || teamMembers.length === 0 || !canEditTimesheets}
                    title={!canEditTimesheets ? "Only exec can save timesheet payment data" : undefined}
                    className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
                  >
                    {savingPayment ? (
                      <>
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                        </svg>
                        Save Payment Data
                      </>
                    )}
                  </button>

                  {/* Process Payroll & Send Emails button removed per request */}
                </div>
              </div>

              {/* Performance Metrics */}
              
            </div>
          )}
          {/* END tabs */}
        </div>
        </div>
      </div>
    </div>
  );
}
