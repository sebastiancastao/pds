"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
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

type TabType = "edit" | "sales" | "merchandise" | "team" | "locations" | "timesheet" | "hr";

type EventLocation = {
  id: string;
  event_id: string;
  name: string;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
};

type EventLocationAssignment = {
  id: string;
  event_id: string;
  location_id: string;
  vendor_id: string;
  created_at: string;
  updated_at: string;
};

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

type TeamVendorOption = {
  id: string;
  email: string;
  role?: string | null;
  division?: string | null;
  distance?: number | null;
  status?: string | null;
  isExistingMember?: boolean;
  profiles?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  };
};

type UninvitedTeamMemberRecord = {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  vendor_email: string;
  previous_status: string | null;
  uninvited_by_user_id: string | null;
  uninvited_by_name: string;
  uninvited_by_email: string;
  uninvited_at: string | null;
  team_member_id: string | null;
};

const getTeamMemberSortFields = (member: any): {
  lastKey: string;
  firstKey: string;
  emailKey: string;
  idKey: string;
} => {
  const profile = member?.users?.profiles;
  const firstName = (profile?.first_name || "").toString().trim();
  const lastName = (profile?.last_name || "").toString().trim();
  const email = (member?.users?.email || "").toString().trim();
  const id = (
    member?.users?.id ||
    member?.user_id ||
    member?.vendor_id ||
    member?.id ||
    ""
  ).toString();

  return {
    lastKey: (lastName || firstName || email || id).toLowerCase(),
    firstKey: (firstName || email || id).toLowerCase(),
    emailKey: email.toLowerCase(),
    idKey: id.toLowerCase(),
  };
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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const canEditTimesheets = userRole === "exec" || userRole === "manager" || userRole === "supervisor";
  const canManageLocations =
    userRole === "exec" ||
    userRole === "admin" ||
    userRole === "manager" ||
    userRole === "supervisor" ||
    userRole === "supervisor2";
  const canManageTeam =
    userRole === "exec" ||
    userRole === "manager" ||
    userRole === "supervisor";
  const isEventCreator = Boolean(
    currentUserId &&
    event?.created_by &&
    currentUserId === event.created_by
  );
  const canSendTeamInvites =
    isEventCreator ||
    userRole === "exec" ||
    userRole === "manager" ||
    userRole === "supervisor" ||
    userRole === "supervisor2";
  const canUninviteTeamMember =
    canManageTeam ||
    userRole === "admin" ||
    userRole === "supervisor2" ||
    isEventCreator;

  const [ticketSales, setTicketSales] = useState<string>("");
  const [ticketCount, setTicketCount] = useState<string>("");
  const [commissionPool, setCommissionPool] = useState<string>(""); // fraction like 0.04
  const [taxRate, setTaxRate] = useState<string>("0");
  const [stateTaxRate, setStateTaxRate] = useState<number>(0); // Tax rate from database based on venue state
  const [stateRatesData, setStateRatesData] = useState<StateRateData[]>([]); // Fetched rates from API
  const [tips, setTips] = useState<string>("");
  // Manual tax amount shown in Sales tab; persisted as an equivalent tax_rate_percent.
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
  const [uninvitedTeamMembers, setUninvitedTeamMembers] = useState<UninvitedTeamMemberRecord[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [teamSearch, setTeamSearch] = useState<string>("");
  const [showAddVendorModal, setShowAddVendorModal] = useState(false);
  const [showLocationCreateTeamModal, setShowLocationCreateTeamModal] = useState(false);
  const [loadingLocationTeamVendors, setLoadingLocationTeamVendors] = useState(false);
  const [locationTeamMessage, setLocationTeamMessage] = useState("");
  const [locationTeamSearchQuery, setLocationTeamSearchQuery] = useState("");
  const [locationTeamVendors, setLocationTeamVendors] = useState<TeamVendorOption[]>([]);
  const [selectedLocationTeamMembers, setSelectedLocationTeamMembers] = useState<Set<string>>(new Set());
  const [savingLocationTeam, setSavingLocationTeam] = useState(false);
  const [resendingLocationTeamConfirmations, setResendingLocationTeamConfirmations] = useState(false);
  const [showUninvitedHistoryModal, setShowUninvitedHistoryModal] = useState(false);
  const [loadingAddVendors, setLoadingAddVendors] = useState(false);
  const [addingVendorToTeam, setAddingVendorToTeam] = useState(false);
  const [uninvitingMemberId, setUninvitingMemberId] = useState<string | null>(null);
  const [addVendorSearch, setAddVendorSearch] = useState<string>("");
  const [addVendorOptions, setAddVendorOptions] = useState<TeamVendorOption[]>([]);
  const [selectedVendorToAdd, setSelectedVendorToAdd] = useState<string>("");
  // Cache flags to avoid re-fetching data when switching tabs
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [timesheetLoaded, setTimesheetLoaded] = useState(false);
  const [adjustmentsLoaded, setAdjustmentsLoaded] = useState(false);
  const [eventLocations, setEventLocations] = useState<EventLocation[]>([]);
  const [locationAssignments, setLocationAssignments] = useState<Record<string, string[]>>({});
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationNotes, setNewLocationNotes] = useState("");
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const [deletingLocationId, setDeletingLocationId] = useState<string | null>(null);
  const [sendingLocationEmails, setSendingLocationEmails] = useState(false);
  const [editingLocationIds, setEditingLocationIds] = useState<Record<string, boolean>>({});
  const [locationAssignmentDrafts, setLocationAssignmentDrafts] = useState<Record<string, string[]>>({});
  const [invitingLocationVendorIds, setInvitingLocationVendorIds] = useState<Set<string>>(new Set());
  const [invitingAllLocationVendors, setInvitingAllLocationVendors] = useState(false);
  const [sendingLocationInviteRequests, setSendingLocationInviteRequests] = useState(false);
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

  const sortedTeamMembers = useMemo(() => {
    return [...(teamMembers || [])].sort((a: any, b: any) => {
      const aSort = getTeamMemberSortFields(a);
      const bSort = getTeamMemberSortFields(b);

      const byLast = aSort.lastKey.localeCompare(bSort.lastKey, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byLast !== 0) return byLast;

      const byFirst = aSort.firstKey.localeCompare(bSort.firstKey, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byFirst !== 0) return byFirst;

      const byEmail = aSort.emailKey.localeCompare(bSort.emailKey, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      if (byEmail !== 0) return byEmail;

      return aSort.idKey.localeCompare(bSort.idKey, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
  }, [teamMembers]);

  // Derived: filtered team members based on search and role filter
  const filteredTeamListMembers = useMemo(() => sortedTeamMembers.filter((member: any) => {
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
  }), [sortedTeamMembers, teamSearch]);

  const filteredAddVendorOptions = useMemo(() => {
    const query = addVendorSearch.trim().toLowerCase();
    if (!query) return addVendorOptions;

    return addVendorOptions.filter((vendor) => {
      const firstName = (vendor.profiles?.first_name || "").toString().toLowerCase();
      const lastName = (vendor.profiles?.last_name || "").toString().toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = (vendor.email || "").toString().toLowerCase();
      const phone = (vendor.profiles?.phone || "").toString().toLowerCase();
      const division = (vendor.division || "").toString().toLowerCase();

      return (
        fullName.includes(query) ||
        email.includes(query) ||
        phone.includes(query) ||
        division.includes(query)
      );
    });
  }, [addVendorOptions, addVendorSearch]);

  const filteredLocationTeamVendors = useMemo(() => {
    const query = locationTeamSearchQuery.trim().toLowerCase();
    const sorted = [...locationTeamVendors].sort((a, b) => {
      const aName = `${a.profiles?.first_name || ""} ${a.profiles?.last_name || ""}`.trim().toLowerCase();
      const bName = `${b.profiles?.first_name || ""} ${b.profiles?.last_name || ""}`.trim().toLowerCase();
      return aName.localeCompare(bName);
    });

    if (!query) return sorted;

    return sorted.filter((vendor) => {
      const firstName = (vendor.profiles?.first_name || "").toString().toLowerCase();
      const lastName = (vendor.profiles?.last_name || "").toString().toLowerCase();
      const fullName = `${firstName} ${lastName}`.trim();
      const email = (vendor.email || "").toString().toLowerCase();
      const phone = (vendor.profiles?.phone || "").toString().toLowerCase();
      const division = (vendor.division || "").toString().toLowerCase();
      const status = (vendor.status || "").toString().replace(/_/g, " ").toLowerCase();

      return (
        fullName.includes(query) ||
        email.includes(query) ||
        phone.includes(query) ||
        division.includes(query) ||
        status.includes(query)
      );
    });
  }, [locationTeamVendors, locationTeamSearchQuery]);

  const allLocationAvailableVendorsInvited = useMemo(
    () =>
      locationTeamVendors.length > 0 &&
      locationTeamVendors.every((vendor) => Boolean(vendor.isExistingMember)),
    [locationTeamVendors]
  );

  const pendingLocationTeamInvitesCount = useMemo(
    () =>
      locationTeamVendors.filter((vendor) => {
        const status = String(vendor.status || "").toLowerCase();
        return Boolean(vendor.isExistingMember) && status !== "confirmed" && status !== "declined";
      }).length,
    [locationTeamVendors]
  );

  const locationAssignableMembers = useMemo(() => {
    const byId = new Map<string, TeamVendorOption>();

    for (const vendor of locationTeamVendors) {
      const id = String(vendor?.id || "").trim();
      if (!id) continue;
      byId.set(id, vendor);
    }

    for (const member of sortedTeamMembers) {
      const id = String(member?.vendor_id || member?.user_id || member?.users?.id || "").trim();
      if (!id || byId.has(id)) continue;

      byId.set(id, {
        id,
        email: String(member?.users?.email || ""),
        division: String(member?.users?.division || ""),
        distance: null,
        status: String(member?.status || ""),
        isExistingMember: true,
        profiles: {
          first_name: String(member?.users?.profiles?.first_name || ""),
          last_name: String(member?.users?.profiles?.last_name || ""),
          phone: String(member?.users?.profiles?.phone || ""),
        },
      });
    }

    Object.values(locationAssignments).forEach((ids) => {
      (ids || []).forEach((idValue) => {
        const id = String(idValue || "").trim();
        if (!id || byId.has(id)) return;
        byId.set(id, {
          id,
          email: "",
          division: "",
          distance: null,
          status: null,
          isExistingMember: false,
          profiles: {
            first_name: "Unknown",
            last_name: "",
            phone: "",
          },
        });
      });
    });

    return Array.from(byId.values()).sort((a, b) => {
      const aName = `${a.profiles?.first_name || ""} ${a.profiles?.last_name || ""}`.trim().toLowerCase();
      const bName = `${b.profiles?.first_name || ""} ${b.profiles?.last_name || ""}`.trim().toLowerCase();
      return aName.localeCompare(bName);
    });
  }, [locationTeamVendors, sortedTeamMembers, locationAssignments]);

  const locationAssignableMemberById = useMemo(
    () => new Map(locationAssignableMembers.map((member) => [member.id, member])),
    [locationAssignableMembers]
  );

  const savedAssignedUninvitedLocationVendorIds = useMemo(() => {
    const assignedUninvitedIds = new Set<string>();

    Object.values(locationAssignments).forEach((assignedIds) => {
      (assignedIds || []).forEach((idValue) => {
        const id = String(idValue || "").trim();
        if (!id) return;
        const member = locationAssignableMemberById.get(id);
        if (member && !member.isExistingMember) {
          assignedUninvitedIds.add(id);
        }
      });
    });

    return Array.from(assignedUninvitedIds);
  }, [locationAssignments, locationAssignableMemberById]);

  const filteredTeamMembers = useMemo(() => sortedTeamMembers.filter((member: any) => {
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
  }), [sortedTeamMembers, staffRoleFilter, staffSearch]);

  const isVendorDivision = (division?: string | null) => {
    const normalized = (division || '').toString().toLowerCase();
    return normalized === 'vendor' || normalized === 'both';
  };

  const hasTimesheetForMember = (member: any) => {
    const uid = (member?.user_id || member?.vendor_id || member?.users?.id || '').toString();
    if (!uid) return false;
    const totalMs = Number(timesheetTotals[uid] || 0);
    if (totalMs > 0) return true;
    const span = timesheetSpans[uid];
    return Boolean(span?.firstIn && span?.lastOut);
  };

  const vendorCount = useMemo(() => teamMembers.reduce((count: number, member: any) => {
    if (!isVendorDivision(member.users?.division)) return count;
    return hasTimesheetForMember(member) ? count + 1 : count;
  }, 0), [teamMembers, timesheetTotals, timesheetSpans]);

  const assignedVendorCount = useMemo(() => teamMembers.reduce((count: number, member: any) => {
    if (!isVendorDivision(member.users?.division)) return count;
    return count + 1;
  }, 0), [teamMembers]);

  const assignedLocationRecipientCount = useMemo(() => {
    const uniqueUserIds = new Set<string>();
    Object.values(locationAssignments).forEach((ids) => {
      (ids || []).forEach((id) => {
        const normalizedId = String(id || "").trim();
        if (normalizedId) uniqueUserIds.add(normalizedId);
      });
    });
    return uniqueUserIds.size;
  }, [locationAssignments]);

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
        setCurrentUserId(user.id);
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

  // Load team, locations, and payroll data when needed (with caching to avoid re-fetching on tab switch)
  useEffect(() => {
    if (!eventId) return;

    if (activeTab === "team") {
      if (!teamLoaded) loadTeam(false); // Include photos for team tab
      // Prefetch timesheet data in background while user is on team tab
      if (!timesheetLoaded) {
        loadTimesheetTotals();
      }
      return;
    }

    if (activeTab === "locations") {
      const needsTeam = !teamLoaded;
      const needsLocations = !locationsLoaded;
      const needsAssignableUsers = locationTeamVendors.length === 0;
      if (!needsTeam && !needsLocations && !needsAssignableUsers) return;
      (async () => {
        const promises: Promise<void>[] = [];
        if (needsAssignableUsers) {
          // Includes team + available vendors merge used by assignment UI.
          promises.push(loadLocationCreateTeamModalData());
        } else if (needsTeam) {
          promises.push(loadTeam(true)); // Skip photos for locations tab
        }
        if (needsLocations) promises.push(loadLocations());
        await Promise.all(promises);
      })();
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
          if (needsTeam) promises.push(loadTeam(true)); // Skip photos for timesheet tab
          if (needsTimesheet) promises.push(loadTimesheetTotals());
          await Promise.all(promises);
        } finally {
          setLoadingTimesheetTab(false);
        }
      })();
      // Prefetch adjustments in background for HR tab
      if (!adjustmentsLoaded) {
        loadAdjustmentsFromPayments();
      }
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
          if (needsTeam) promises.push(loadTeam(true)); // Skip photos for HR tab
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

        // Keep Tax Amount input aligned with persisted event tax rate so Sales and HR payroll match.
        const initialTicketSales = Number(eventData.ticket_sales || 0);
        const initialTips = Number((eventData as any).tips || 0);
        const initialTotalSales = Math.max(initialTicketSales - initialTips, 0);
        const initialTaxRate = Number(eventData.tax_rate_percent ?? 0);
        const initialTaxAmount = Math.max(initialTotalSales * (initialTaxRate / 100), 0);
        setManualTaxAmount(initialTaxAmount > 0 ? initialTaxAmount.toFixed(2) : "");

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

  // Cache session token to avoid redundant getSession() calls within the same tab load
  const sessionTokenRef = useRef<string | null>(null);
  const getSessionToken = async (): Promise<string | null> => {
    if (sessionTokenRef.current) return sessionTokenRef.current;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || null;
    sessionTokenRef.current = token;
    // Invalidate cache after 50 seconds (tokens are short-lived)
    setTimeout(() => { sessionTokenRef.current = null; }, 50000);
    return token;
  };

  const loadTeam = async (skipPhotos = false) => {
    if (!eventId) return;
    setLoadingTeam(true);
    try {
      const token = await getSessionToken();
      const url = `/api/events/${eventId}/team${skipPhotos ? '?skip_photos=true' : ''}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data.team || []);
        setUninvitedTeamMembers(Array.isArray(data.uninvited_history) ? data.uninvited_history : []);
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

  const closeAddVendorModal = () => {
    if (addingVendorToTeam) return;
    setShowAddVendorModal(false);
    setAddVendorSearch("");
    setSelectedVendorToAdd("");
  };

  const closeUninvitedHistoryModal = () => {
    setShowUninvitedHistoryModal(false);
  };

  const closeLocationCreateTeamModal = () => {
    if (savingLocationTeam || resendingLocationTeamConfirmations) return;
    setShowLocationCreateTeamModal(false);
    setLocationTeamMessage("");
    setLocationTeamSearchQuery("");
    setLocationTeamVendors([]);
    setSelectedLocationTeamMembers(new Set());
  };

  const loadLocationCreateTeamModalData = async () => {
    if (!eventId) return;

    setLoadingLocationTeamVendors(true);
    try {
      const token = await getSessionToken();
      const [availableRes, teamRes] = await Promise.all([
        fetch(`/api/events/${eventId}/available-vendors`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }),
        fetch(`/api/events/${eventId}/team`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }),
      ]);

      let available: TeamVendorOption[] = [];
      if (availableRes.ok) {
        const availableData = await availableRes.json().catch(() => ({}));
        available = Array.isArray(availableData?.vendors) ? availableData.vendors : [];
      } else {
        const availableError = await availableRes.json().catch(() => ({}));
        setLocationTeamMessage(availableError?.error || "Failed to load available vendors");
      }

      let existingTeam: any[] = [];
      if (teamRes.ok) {
        const teamData = await teamRes.json().catch(() => ({}));
        existingTeam = Array.isArray(teamData?.team) ? teamData.team : [];
        setTeamMembers(existingTeam);
        setUninvitedTeamMembers(Array.isArray(teamData?.uninvited_history) ? teamData.uninvited_history : []);
        setTeamLoaded(true);
      } else {
        const teamError = await teamRes.json().catch(() => ({}));
        setLocationTeamMessage((prev) =>
          prev
            ? prev
            : (teamError?.error || "Failed to load current team")
        );
      }

      const existingVendors: TeamVendorOption[] = existingTeam.map((member: any) => ({
        id: String(member?.vendor_id || ""),
        email: String(member?.users?.email || ""),
        division: String(member?.users?.division || ""),
        distance: null,
        status: String(member?.status || ""),
        isExistingMember: true,
        profiles: {
          first_name: String(member?.users?.profiles?.first_name || ""),
          last_name: String(member?.users?.profiles?.last_name || ""),
          phone: String(member?.users?.profiles?.phone || ""),
        },
      }));

      const existingById = new Map<string, TeamVendorOption>(
        existingVendors
          .filter((vendor) => vendor.id.length > 0)
          .map((vendor) => [vendor.id, vendor])
      );

      const merged = available.map((vendor) => {
        const vendorId = String(vendor?.id || "");
        const existing = existingById.get(vendorId);
        if (!existing) {
          return {
            ...vendor,
            isExistingMember: false,
          };
        }
        return {
          ...vendor,
          status: existing.status,
          isExistingMember: true,
        };
      });

      const mergedIds = new Set(merged.map((vendor) => String(vendor.id || "")));
      const missingExisting = existingVendors.filter(
        (vendor) => vendor.id.length > 0 && !mergedIds.has(vendor.id)
      );

      setLocationTeamVendors([...merged, ...missingExisting]);

      // Start with no new selections; existing invited members are displayed as read-only rows.
      setSelectedLocationTeamMembers(new Set());
    } catch (err: any) {
      setLocationTeamMessage(err?.message || "Network error loading vendors");
    } finally {
      setLoadingLocationTeamVendors(false);
    }
  };

  const openLocationCreateTeamModal = async () => {
    if (!canSendTeamInvites) {
      setMessage("You do not have permission to send team invitations.");
      return;
    }
    setShowLocationCreateTeamModal(true);
    setLocationTeamMessage("");
    setLocationTeamSearchQuery("");
    await loadLocationCreateTeamModalData();
  };

  const toggleLocationTeamMember = (id: string) => {
    const next = new Set(selectedLocationTeamMembers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLocationTeamMembers(next);
  };

  const handleSelectAllLocationTeam = () => {
    const visibleNewVendorIds = filteredLocationTeamVendors
      .filter((vendor) => !vendor.isExistingMember)
      .map((vendor) => vendor.id);

    if (visibleNewVendorIds.length === 0) return;

    const allVisibleNewSelected = visibleNewVendorIds.every((id) =>
      selectedLocationTeamMembers.has(id)
    );
    const nextSelected = new Set(selectedLocationTeamMembers);

    if (allVisibleNewSelected) {
      visibleNewVendorIds.forEach((id) => nextSelected.delete(id));
    } else {
      visibleNewVendorIds.forEach((id) => nextSelected.add(id));
    }

    setSelectedLocationTeamMembers(nextSelected);
  };

  const handleCreateTeamFromLocations = async () => {
    if (!eventId || selectedLocationTeamMembers.size === 0) return;

    setSavingLocationTeam(true);
    setLocationTeamMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/team`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vendorIds: Array.from(selectedLocationTeamMembers) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create team");
      }

      setLocationTeamMessage(data?.message || "Team invitations sent.");
      await loadLocationCreateTeamModalData();
      await loadTeam(true);
    } catch (err: any) {
      setLocationTeamMessage(err?.message || "Failed to create team");
    } finally {
      setSavingLocationTeam(false);
    }
  };

  const handleResendLocationTeamConfirmations = async () => {
    if (!eventId) return;

    const invitedVendorIds = locationTeamVendors
      .filter((vendor) => {
        const status = String(vendor.status || "").toLowerCase();
        return Boolean(vendor.isExistingMember) && status !== "confirmed" && status !== "declined";
      })
      .map((vendor) => vendor.id);

    if (invitedVendorIds.length === 0) {
      setLocationTeamMessage("No invited vendors are pending confirmation.");
      return;
    }

    setResendingLocationTeamConfirmations(true);
    setLocationTeamMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/team/resend-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ vendorIds: invitedVendorIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to resend confirmations");
      }

      setLocationTeamMessage(
        data?.message ||
        `Successfully resent confirmation to ${invitedVendorIds.length} invited vendor${invitedVendorIds.length !== 1 ? "s" : ""}.`
      );
      await loadLocationCreateTeamModalData();
      await loadTeam(true);
    } catch (err: any) {
      setLocationTeamMessage(err?.message || "Failed to resend confirmations");
    } finally {
      setResendingLocationTeamConfirmations(false);
    }
  };

  const loadVendorsForImmediateTeamAdd = async () => {
    if (!event?.venue) {
      setAddVendorOptions([]);
      setSelectedVendorToAdd("");
      return;
    }

    setLoadingAddVendors(true);
    try {
      const token = await getSessionToken();
      const query = new URLSearchParams({ venue: event.venue });
      const vendorsRes = await fetch(`/api/vendors?${query.toString()}`, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      let vendors: TeamVendorOption[] = [];
      if (vendorsRes.ok) {
        const vendorsData = await vendorsRes.json().catch(() => ({}));
        vendors = Array.isArray(vendorsData?.vendors) ? vendorsData.vendors : [];
      } else {
        const fallbackRes = await fetch(`/api/all-vendors`, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (!fallbackRes.ok) {
          const vendorsError = await vendorsRes.json().catch(() => ({}));
          const fallbackError = await fallbackRes.json().catch(() => ({}));
          throw new Error(vendorsError?.error || fallbackError?.error || "Failed to load vendors");
        }

        const fallbackData = await fallbackRes.json().catch(() => ({}));
        vendors = Array.isArray(fallbackData?.vendors) ? fallbackData.vendors : [];
      }

      const existingTeamIds = new Set(
        (teamMembers || [])
          .map((member: any) => (member?.vendor_id || member?.user_id || member?.users?.id || "").toString())
          .filter((id: string) => id.length > 0)
      );

      const availableVendors = vendors
        .filter((vendor: TeamVendorOption) => {
          const vendorId = (vendor?.id || "").toString();
          return vendorId.length > 0 && !existingTeamIds.has(vendorId);
        })
        .sort((a: TeamVendorOption, b: TeamVendorOption) => {
          const aName = `${a.profiles?.first_name || ""} ${a.profiles?.last_name || ""}`.trim().toLowerCase();
          const bName = `${b.profiles?.first_name || ""} ${b.profiles?.last_name || ""}`.trim().toLowerCase();
          return aName.localeCompare(bName);
        });

      setAddVendorOptions(availableVendors);
      setSelectedVendorToAdd((prev) => {
        if (prev && availableVendors.some((vendor) => vendor.id === prev)) return prev;
        return availableVendors[0]?.id || "";
      });
    } catch (err: any) {
      setAddVendorOptions([]);
      setSelectedVendorToAdd("");
      setMessage(err?.message || "Failed to load vendors");
    } finally {
      setLoadingAddVendors(false);
    }
  };

  const openAddVendorModal = async () => {
    setShowAddVendorModal(true);
    setAddVendorSearch("");
    setSelectedVendorToAdd("");
    await loadVendorsForImmediateTeamAdd();
  };

  const handleAddVendorToTeamImmediately = async () => {
    if (!eventId || !selectedVendorToAdd) return;

    setAddingVendorToTeam(true);
    setMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/team`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          vendorIds: [selectedVendorToAdd],
          autoConfirm: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to add vendor to team");
      }

      setMessage(`Success: ${data?.message || "Vendor added to team as confirmed."}`);
      setShowAddVendorModal(false);
      setAddVendorSearch("");
      setSelectedVendorToAdd("");
      await loadTeam(false);
    } catch (err: any) {
      setMessage(err?.message || "Failed to add vendor to team");
    } finally {
      setAddingVendorToTeam(false);
    }
  };

  const getTeamMemberDisplayName = (member: any): string => {
    const firstName = (member?.users?.profiles?.first_name || "").toString().trim();
    const lastName = (member?.users?.profiles?.last_name || "").toString().trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;

    const email = (member?.users?.email || "").toString().trim();
    return email || "this team member";
  };

  const handleUninviteTeamMember = async (member: any) => {
    if (!eventId || !member?.id) return;

    const memberName = getTeamMemberDisplayName(member);
    if (member?.has_attestation) {
      setMessage(
        `${memberName} cannot be uninvited because they already have an attestation for this event.`
      );
      return;
    }

    if (!window.confirm(`Uninvite ${memberName} from this event?`)) return;

    setUninvitingMemberId(member.id);
    setMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/team/${member.id}`, {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to uninvite team member");
      }

      setMessage(`Success: ${memberName} was uninvited.`);
      await loadTeam(false);
      setLocationsLoaded(false);
    } catch (err: any) {
      setMessage(err?.message || "Failed to uninvite team member");
    } finally {
      setUninvitingMemberId(null);
    }
  };

  const getTeamMemberId = (member: any): string => {
    return (member?.vendor_id || member?.user_id || member?.users?.id || "").toString();
  };

  const loadLocations = async () => {
    if (!eventId) return;
    setLoadingLocations(true);
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/locations`, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to load locations");
      }

      const data = await res.json();
      const locations: EventLocation[] = data?.locations || [];
      const assignments: EventLocationAssignment[] = data?.assignments || [];

      const assignmentMap: Record<string, string[]> = {};
      for (const location of locations) {
        assignmentMap[location.id] = [];
      }
      for (const assignment of assignments) {
        if (!assignmentMap[assignment.location_id]) {
          assignmentMap[assignment.location_id] = [];
        }
        assignmentMap[assignment.location_id].push(assignment.vendor_id);
      }

      setEventLocations(locations);
      setLocationAssignments(assignmentMap);
      setEditingLocationIds({});
      setLocationAssignmentDrafts({});
      setLocationsLoaded(true);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load locations");
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleAddLocation = async () => {
    const name = newLocationName.trim();
    const notes = newLocationNotes.trim();
    if (!eventId || !name) return;

    setCreatingLocation(true);
    setMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/locations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name, notes: notes || null }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to create location");
      }

      setNewLocationName("");
      setNewLocationNotes("");
      setMessage("Location added successfully");
      await loadLocations();
    } catch (err: any) {
      setMessage(err?.message || "Failed to create location");
    } finally {
      setCreatingLocation(false);
    }
  };

  const startLocationAssignmentEdit = async (locationId: string) => {
    if (!locationId) return;

    if (locationTeamVendors.length === 0 && !loadingLocationTeamVendors) {
      await loadLocationCreateTeamModalData();
    }

    setEditingLocationIds((prev) => ({ ...prev, [locationId]: true }));
    setLocationAssignmentDrafts((prev) => ({
      ...prev,
      [locationId]: [...(locationAssignments[locationId] || [])],
    }));
  };

  const cancelLocationAssignmentEdit = (locationId: string) => {
    setEditingLocationIds((prev) => ({ ...prev, [locationId]: false }));
    setLocationAssignmentDrafts((prev) => {
      const next = { ...prev };
      delete next[locationId];
      return next;
    });
  };

  const toggleLocationAssignmentDraft = (locationId: string, memberId: string) => {
    setLocationAssignmentDrafts((prev) => {
      const current = new Set(prev[locationId] || []);
      if (current.has(memberId)) {
        current.delete(memberId);
      } else {
        current.add(memberId);
      }

      return {
        ...prev,
        [locationId]: Array.from(current),
      };
    });
  };

  const inviteVendorsFromLocationSelection = async (vendorIds: string[]) => {
    if (!eventId) return;
    if (sendingLocationInviteRequests) {
      return;
    }

    const uniqueVendorIds = Array.from(
      new Set(vendorIds.map((id) => String(id || "").trim()).filter(Boolean))
    );
    if (uniqueVendorIds.length === 0) {
      setMessage("No vendors selected to invite.");
      return;
    }

    const BATCH_SIZE = 20;
    const BATCH_DELAY_MS = 300;

    setMessage("");
    setSendingLocationInviteRequests(true);
    try {
      const token = await getSessionToken();

      for (let index = 0; index < uniqueVendorIds.length; index += BATCH_SIZE) {
        const batch = uniqueVendorIds.slice(index, index + BATCH_SIZE);
        const res = await fetch(`/api/events/${eventId}/team`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ vendorIds: batch }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Failed to send invitations");
        }

        if (index + BATCH_SIZE < uniqueVendorIds.length) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }

      setMessage(
        `Invitations sent for ${uniqueVendorIds.length} vendor${uniqueVendorIds.length === 1 ? "" : "s"}.`
      );
      await loadLocationCreateTeamModalData();
      await loadTeam(true);
    } catch (err: any) {
      setMessage(err?.message || "Failed to send invitations");
    } finally {
      setSendingLocationInviteRequests(false);
    }
  };

  const handleInviteSingleLocationVendor = async (vendorId: string) => {
    if (!canSendTeamInvites) {
      setMessage("You do not have permission to send team invitations.");
      return;
    }
    if (sendingLocationInviteRequests) return;

    const normalizedVendorId = String(vendorId || "").trim();
    if (!normalizedVendorId) return;

    setInvitingLocationVendorIds((prev) => {
      const next = new Set(prev);
      next.add(normalizedVendorId);
      return next;
    });

    try {
      await inviteVendorsFromLocationSelection([normalizedVendorId]);
    } finally {
      setInvitingLocationVendorIds((prev) => {
        const next = new Set(prev);
        next.delete(normalizedVendorId);
        return next;
      });
    }
  };

  const handleInviteAllAssignedLocationVendors = async () => {
    if (!canSendTeamInvites) {
      setMessage("You do not have permission to send team invitations.");
      return;
    }
    if (sendingLocationInviteRequests) return;

    const uninvitedSelectedIds = savedAssignedUninvitedLocationVendorIds;

    if (uninvitedSelectedIds.length === 0) {
      setMessage("No saved uninvited assigned vendors to invite.");
      return;
    }

    setInvitingAllLocationVendors(true);
    setInvitingLocationVendorIds((prev) => {
      const next = new Set(prev);
      uninvitedSelectedIds.forEach((id) => next.add(String(id)));
      return next;
    });

    try {
      await inviteVendorsFromLocationSelection(uninvitedSelectedIds);
    } finally {
      setInvitingAllLocationVendors(false);
      setInvitingLocationVendorIds((prev) => {
        const next = new Set(prev);
        uninvitedSelectedIds.forEach((id) => next.delete(String(id)));
        return next;
      });
    }
  };

  const saveLocationAssignments = async (locationId: string) => {
    if (!eventId || !locationId) return;

    setSavingLocationId(locationId);
    setMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/locations`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          locationId,
          teamMemberIds: locationAssignmentDrafts[locationId] || [],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to save location assignments");
      }

      setMessage("Location assignments saved successfully");
      setEditingLocationIds((prev) => ({ ...prev, [locationId]: false }));
      setLocationAssignmentDrafts((prev) => {
        const next = { ...prev };
        delete next[locationId];
        return next;
      });
      await loadLocations();
    } catch (err: any) {
      setMessage(err?.message || "Failed to save location assignments");
    } finally {
      setSavingLocationId(null);
    }
  };

  const handleDeleteLocation = async (locationId: string) => {
    if (!eventId || !locationId) return;
    if (!window.confirm("Delete this location and all related assignments?")) return;

    setDeletingLocationId(locationId);
    setMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/locations`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ locationId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete location");
      }

      setMessage("Location deleted successfully");
      await loadLocations();
    } catch (err: any) {
      setMessage(err?.message || "Failed to delete location");
    } finally {
      setDeletingLocationId(null);
    }
  };

  const handleSendLocationAssignments = async () => {
    if (!eventId) return;
    if (assignedLocationRecipientCount === 0) {
      setMessage("No assigned team members found for Call Time.");
      return;
    }

    if (
      !window.confirm(
        `Send Call Time to ${assignedLocationRecipientCount} team member${assignedLocationRecipientCount === 1 ? "" : "s"}?`
      )
    ) {
      return;
    }

    setSendingLocationEmails(true);
    setMessage("");
    try {
      const token = await getSessionToken();
      const res = await fetch(`/api/events/${eventId}/locations/send-emails`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to send Call Time emails");
      }

      const sentCount = Number(data?.sentCount || 0);
      const failedCount = Number(data?.failedCount || 0);

      if (failedCount > 0) {
        setMessage(`Call Time sent to ${sentCount} users. Failed: ${failedCount}.`);
      } else {
        setMessage(`Success: Call Time sent to ${sentCount} users.`);
      }
    } catch (err: any) {
      setMessage(err?.message || "Failed to send Call Time emails");
    } finally {
      setSendingLocationEmails(false);
    }
  };

  const handleExportLocations = async () => {
    try {
      if (eventLocations.length === 0) {
        setMessage("No locations to export.");
        return;
      }

      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const pageWidth = 612;
      const pageHeight = 792;
      const margin = 44;

      let page = pdfDoc.addPage([pageWidth, pageHeight]);
      let y = pageHeight - margin;

      const ensureSpace = (requiredHeight = 20) => {
        if (y < margin + requiredHeight) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
      };

      const drawLine = (text: string, font: any, size: number, color = rgb(0, 0, 0)) => {
        page.drawText(text, {
          x: margin,
          y,
          size,
          font,
          color,
        });
        y -= size + 6;
      };

      const wrapText = (text: string, font: any, size: number, maxWidth: number): string[] => {
        const clean = (text || "").trim();
        if (!clean) return [""];

        const words = clean.split(/\s+/);
        const lines: string[] = [];
        let current = "";

        for (const word of words) {
          const candidate = current ? `${current} ${word}` : word;
          const candidateWidth = font.widthOfTextAtSize(candidate, size);

          if (candidateWidth <= maxWidth) {
            current = candidate;
            continue;
          }

          if (current) {
            lines.push(current);
            current = word;
          } else {
            lines.push(word);
            current = "";
          }
        }

        if (current) lines.push(current);
        return lines.length > 0 ? lines : [clean];
      };

      const eventName = (event?.event_name || "Event").trim();
      const dateLabel = event?.event_date ? String(event.event_date).slice(0, 10) : "";

      drawLine("Locations Assignment Report", boldFont, 16);
      drawLine(`Event: ${eventName}`, boldFont, 12);
      if (dateLabel) {
        drawLine(`Date: ${dateLabel}`, regularFont, 10);
      }
      y -= 4;

      for (const loc of eventLocations) {
        const assignedIds = locationAssignments[loc.id] || [];
        const assignedIdSet = new Set(assignedIds);
        const assignedMembers = sortedTeamMembers.filter((member: any) =>
          assignedIdSet.has(getTeamMemberId(member))
        );

        ensureSpace(44);
        drawLine(`Station: ${loc.name}`, boldFont, 12, rgb(0.1, 0.1, 0.1));
        if (loc.notes) {
          const noteLines = wrapText(`Notes: ${loc.notes}`, regularFont, 10, pageWidth - margin * 2);
          for (const noteLine of noteLines) {
            ensureSpace(18);
            drawLine(noteLine, regularFont, 10, rgb(0.25, 0.25, 0.25));
          }
        }

        if (assignedMembers.length === 0) {
          ensureSpace(18);
          drawLine("No vendors assigned.", regularFont, 10, rgb(0.45, 0.45, 0.45));
          y -= 6;
          continue;
        }

        ensureSpace(18);
        drawLine("Assigned Vendors:", boldFont, 10, rgb(0.15, 0.15, 0.15));

        for (const member of assignedMembers) {
          const profile = member?.users?.profiles;
          const firstName = profile?.first_name || "";
          const lastName = profile?.last_name || "";
          const fullName = `${firstName} ${lastName}`.trim();
          const vendorLabel = `- ${fullName || "Unknown Vendor"}`;
          const vendorLines = wrapText(vendorLabel, regularFont, 10, pageWidth - margin * 2);
          for (const vendorLine of vendorLines) {
            ensureSpace(18);
            drawLine(vendorLine, regularFont, 10);
          }
        }

        y -= 6;
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = new ArrayBuffer(pdfBytes.length);
      new Uint8Array(pdfBuffer).set(pdfBytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      const safeEventName = (eventName || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      link.href = url;
      link.download = `${safeEventName || "event"}-locations-${today}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("Locations PDF exported successfully.");
    } catch (err: any) {
      setMessage(err?.message || "Failed to export locations");
    }
  };

  const buildTeamExportRows = (): Record<string, string | number>[] => {
    return filteredTeamListMembers.map((member: any) => {
      const profile = member?.users?.profiles;
      const firstName = (profile?.first_name || "").toString().trim();
      const lastName = (profile?.last_name || "").toString().trim();
      const fullName = `${firstName} ${lastName}`.trim() || "N/A";
      const phone = (profile?.phone || "N/A").toString();
      const division = (member?.users?.division || "N/A").toString();
      const status = (member?.status || "Unknown").toString();
      const hasAttestation = Boolean(member?.has_attestation);
      const invitedOnRaw = String(member?.created_at || "");
      const invitedOn = invitedOnRaw
        ? new Date(invitedOnRaw).toLocaleString("en-US")
        : "N/A";

      return {
        "Event Name": event?.event_name || "N/A",
        "Event Date": event?.event_date ? String(event.event_date).slice(0, 10) : "N/A",
        Vendor: fullName,
        Phone: phone,
        Division: division,
        Status: status,
        "Attestation Submitted": hasAttestation ? "Yes" : "No",
        "Invited On": invitedOn,
        "Team Member ID": String(member?.id || ""),
        "Vendor ID": String(member?.vendor_id || member?.users?.id || ""),
      };
    });
  };

  const handleExportTeamMembers = async () => {
    try {
      if (!event) {
        setMessage("Event data is still loading.");
        return;
      }

      const rows = buildTeamExportRows();
      if (rows.length === 0) {
        setMessage("No team rows to export.");
        return;
      }

      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();

      const summaryRows = [
        {
          "Event Name": event.event_name || "N/A",
          "Event Date": event.event_date ? String(event.event_date).slice(0, 10) : "N/A",
          "Total Invited": teamMembers.length,
          "Displayed Rows": rows.length,
          Confirmed: teamMembers.filter((m: any) => m?.status === "confirmed").length,
          Pending: teamMembers.filter((m: any) => m?.status === "pending_confirmation").length,
          "With Attestation": teamMembers.filter((m: any) => Boolean(m?.has_attestation)).length,
          "Exported At": new Date().toLocaleString("en-US"),
        },
      ];

      const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
      const teamSheet = XLSX.utils.json_to_sheet(rows);

      summarySheet["!cols"] = [
        { wch: 30 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 12 },
        { wch: 12 },
        { wch: 18 },
        { wch: 24 },
      ];

      teamSheet["!cols"] = [
        { wch: 28 },
        { wch: 14 },
        { wch: 24 },
        { wch: 18 },
        { wch: 14 },
        { wch: 18 },
        { wch: 20 },
        { wch: 24 },
        { wch: 38 },
        { wch: 38 },
      ];

      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
      XLSX.utils.book_append_sheet(workbook, teamSheet, "Team");

      const fileBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const blob = new Blob([fileBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const safeEventName = (event.event_name || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      link.href = url;
      link.download = `${safeEventName || "event"}-team-${timestamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("Team data exported successfully.");
    } catch (err: any) {
      setMessage(err?.message || "Failed to export team data");
    }
  };

  const GATE_PHONE_OFFSET_MINUTES = 30;
  const GATE_PHONE_OFFSET_MS = GATE_PHONE_OFFSET_MINUTES * 60 * 1000;

  const getDisplayedWorkedMs = (uid: string): number => {
    let totalMs = timesheetTotals[uid] || 0;
    const span = timesheetSpans[uid];

    if ((!totalMs || totalMs <= 0) && span?.firstIn && span?.lastOut) {
      try {
        totalMs = Math.max(
          new Date(span.lastOut).getTime() - new Date(span.firstIn).getTime(),
          0
        );
      } catch {
        totalMs = 0;
      }
    }

    if (span?.firstMealStart && span?.lastMealEnd) {
      const meal1Ms =
        new Date(span.lastMealEnd).getTime() - new Date(span.firstMealStart).getTime();
      if (meal1Ms > 0) totalMs = Math.max(totalMs - meal1Ms, 0);
    }

    if (span?.secondMealStart && span?.secondMealEnd) {
      const meal2Ms =
        new Date(span.secondMealEnd).getTime() - new Date(span.secondMealStart).getTime();
      if (meal2Ms > 0) totalMs = Math.max(totalMs - meal2Ms, 0);
    }

    // Include Gate/Phone lead time as the initial worked segment for hour calculations only.
    if (totalMs > 0 && span?.firstIn) {
      totalMs += GATE_PHONE_OFFSET_MS;
    }

    return totalMs;
  };

  const getTotalDisplayedWorkedMs = (): number =>
    Object.keys(timesheetTotals).reduce((sum, uid) => sum + getDisplayedWorkedMs(uid), 0);

  const formatHoursFromMs = (totalMs: number): string => {
    if (!Number.isFinite(totalMs) || totalMs <= 0) return "0:00";
    const totalMinutes = Math.floor(totalMs / 60000);
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return `${hh}:${String(mm).padStart(2, "0")}`;
  };

  const buildPaymentExportRows = (): Record<string, string | number>[] => {
    const eventState = event?.state?.toUpperCase()?.trim() || "CA";
    const baseRate = getBaseRateForState(eventState);
    const netSales = sharesData?.netSales || 0;
    const poolPercent = Number(commissionPool || event?.commission_pool || 0) || 0;
    const totalCommissionPool = netSales * poolPercent;
    const perVendorCommissionShare = vendorCount > 0 ? totalCommissionPool / vendorCount : 0;
    const totalTips = Number(tips) || 0;

    const totalEligibleHours = teamMembers.reduce((sum: number, member: any) => {
      if (member?.users?.division === "trailers") return sum;
      const uid = (member?.user_id || member?.vendor_id || member?.users?.id || "").toString();
      if (!uid) return sum;
      return sum + getDisplayedWorkedMs(uid) / (1000 * 60 * 60);
    }, 0);

    return filteredTeamMembers.map((member: any) => {
      const profile = member?.users?.profiles;
      const firstName = (profile?.first_name || "").toString().trim();
      const lastName = (profile?.last_name || "").toString().trim();
      const fullName = `${firstName} ${lastName}`.trim() || "N/A";
      const email = (member?.users?.email || "N/A").toString();
      const division = (member?.users?.division || "").toString();
      const uid = (member?.user_id || member?.vendor_id || member?.users?.id || "").toString();
      const totalMs = getDisplayedWorkedMs(uid);
      const actualHours = totalMs / (1000 * 60 * 60);
      const hoursHHMM = formatHoursFromMs(totalMs);
      const extAmtOnRegRate = actualHours * baseRate * 1.5;
      const isTrailersDivision = division === "trailers";
      const totalFinalCommission = isTrailersDivision
        ? extAmtOnRegRate
        : Math.max(extAmtOnRegRate, perVendorCommissionShare);
      const commissionAmount =
        !isTrailersDivision && actualHours > 0 && vendorCount > 0
          ? Math.max(0, totalFinalCommission - extAmtOnRegRate)
          : 0;
      const rawFinalCommissionRate = actualHours > 0 ? totalFinalCommission / actualHours : baseRate;
      const finalCommissionRate = Math.max(28.5, rawFinalCommissionRate);
      const proratedTips =
        !isTrailersDivision && totalEligibleHours > 0
          ? (totalTips * actualHours) / totalEligibleHours
          : 0;
      const restBreak = getRestBreakAmount(actualHours, eventState);
      const otherAmount = (adjustments[uid] || 0) + (reimbursements[uid] || 0);
      const totalGrossPay = totalFinalCommission + proratedTips + restBreak + otherAmount;
      const money = (amount: number) => `$${formatPayrollMoney(amount)}`;

      const row: Record<string, string | number> = {
        Employee: fullName,
        Email: email,
        Division: division || "N/A",
        "Reg Rate": money(baseRate),
        "Loaded Rate": money(finalCommissionRate),
        "Hours (HH:MM)": actualHours > 0 ? hoursHHMM : "0:00",
        "Hours (Decimal)": Number(actualHours.toFixed(2)),
        "Ext Amt on Reg Rate": money(extAmtOnRegRate),
        "Commission Amt": money(commissionAmount),
        "Total Final Commission": money(totalFinalCommission),
        Tips: money(proratedTips),
      };

      if (!hideRestBreakColumn) {
        row["Rest Break"] = money(restBreak);
      }

      row.Other = money(otherAmount);
      row["Total Gross Pay"] = money(totalGrossPay);

      return row;
    });
  };

  const handleExportPayments = async () => {
    try {
      if (!event) {
        setMessage("Event data is still loading.");
        return;
      }

      const rows = buildPaymentExportRows();
      if (rows.length === 0) {
        setMessage("No payment rows to export.");
        return;
      }

      const parseExportMoney = (value: unknown): number => {
        const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const totals = rows.reduce<{ hours: number; gross: number }>(
        (acc, row) => ({
          hours: acc.hours + Number(row["Hours (Decimal)"] || 0),
          gross: acc.gross + parseExportMoney(row["Total Gross Pay"]),
        }),
        { hours: 0, gross: 0 }
      );

      const filtersApplied = [
        staffSearch.trim() ? `Search: ${staffSearch.trim()}` : "",
        staffRoleFilter ? `Role: ${staffRoleFilter}` : "",
      ]
        .filter(Boolean)
        .join(" | ") || "None";

      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();

      const summaryRows = [
        { Field: "Event", Value: event.event_name || "Event" },
        { Field: "Date", Value: event.event_date ? String(event.event_date).slice(0, 10) : "N/A" },
        { Field: "Venue", Value: event.venue || "N/A" },
        { Field: "State", Value: event.state || "N/A" },
        { Field: "Rows Exported", Value: rows.length },
        { Field: "Total Hours", Value: totals.hours.toFixed(2) },
        { Field: "Total Gross Pay", Value: `$${formatPayrollMoney(totals.gross)}` },
        { Field: "Filters Applied", Value: filtersApplied },
      ];

      const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
      summarySheet["!cols"] = [{ wch: 24 }, { wch: 42 }];

      const paymentsSheet = XLSX.utils.json_to_sheet(rows);
      const paymentColumns = [
        { wch: 26 }, // Employee
        { wch: 30 }, // Email
        { wch: 14 }, // Division
        { wch: 12 }, // Reg Rate
        { wch: 12 }, // Loaded Rate
        { wch: 14 }, // Hours (HH:MM)
        { wch: 14 }, // Hours (Decimal)
        { wch: 18 }, // Ext Amt on Reg Rate
        { wch: 16 }, // Commission Amt
        { wch: 20 }, // Total Final Commission
        { wch: 10 }, // Tips
      ];
      if (!hideRestBreakColumn) {
        paymentColumns.push({ wch: 12 }); // Rest Break
      }
      paymentColumns.push({ wch: 10 }); // Other
      paymentColumns.push({ wch: 14 }); // Total Gross Pay
      paymentsSheet["!cols"] = paymentColumns;

      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
      XLSX.utils.book_append_sheet(workbook, paymentsSheet, "Payments");

      const fileBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
      const blob = new Blob([fileBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date()
        .toISOString()
        .replace("T", "-")
        .replace(/:/g, "-")
        .slice(0, 19);
      const safeEventName = (event.event_name || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      link.href = url;
      link.download = `${safeEventName || "event"}-payments-${timestamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("Payments exported successfully.");
    } catch (err: any) {
      setMessage(err?.message || "Failed to export payments");
    }
  };

  const loadAdjustmentsFromPayments = async () => {
    try {
      if (!eventId) return;
      const token = await getSessionToken();
      const res = await fetch(`/api/payment-adjustments?event_id=${encodeURIComponent(eventId)}`, {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) return;
      const json = await res.json();
      setAdjustments(json.adjustments || {});
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
      const token = await getSessionToken();
      const url = `/api/events/${eventId}/timesheet`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      const grossCollected = Number(ticketSales) || 0;
      const tipsNum = Number(tips) || 0;
      const totalSales = Math.max(grossCollected - tipsNum, 0);
      const manualTaxInput = manualTaxAmount.trim();
      const taxFromRate = Math.max(totalSales * ((Number(stateTaxRate) || 0) / 100), 0);
      const taxAmountForSave = manualTaxInput === ""
        ? taxFromRate
        : Math.max(Number(manualTaxInput) || 0, 0);
      const taxRatePercentFromManual = totalSales > 0 ? (taxAmountForSave / totalSales) * 100 : 0;
      const payload = {
        ...event,
        ticket_sales: ticketSales !== "" ? Number(ticketSales) : null,
        ticket_count: ticketCount !== "" ? Number(ticketCount) : null,
        commission_pool: commissionPool !== "" ? Number(commissionPool) : null, // fraction (0.04)
        tax_rate_percent: Number(taxRatePercentFromManual.toFixed(6)),
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
        setStateTaxRate(taxRatePercentFromManual);
        setTaxRate(taxRatePercentFromManual.toString());
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
    const taxPct = Number(stateTaxRate) || 0;

    const totalSales = Math.max(grossCollected - tipsNum, 0); // Total collected - Tips
    const manualTaxInput = manualTaxAmount.trim();
    const taxFromRate = Math.max(totalSales * (taxPct / 100), 0);
    const tax = manualTaxInput === ""
      ? taxFromRate
      : Math.max(Number(manualTaxInput) || 0, 0);
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

  // Memoize shares calculation - used across sales tab, payment tab, and save logic
  const sharesData = useMemo(() => calculateShares(), [event, ticketSales, tips, manualTaxAmount, stateTaxRate]);

  // Calculate commission amount - updates reactively when inputs change
  const calculatedCommission = useMemo(() => {
    if (!sharesData) return 0;
    const pool = commissionPool !== ""
      ? Number(commissionPool)
      : (event?.commission_pool || 0);
    return sharesData.netSales * pool;
  }, [sharesData, commissionPool, event?.commission_pool]);

  const commissionPerVendor = useMemo(() => {
    return vendorCount > 0 ? (calculatedCommission / vendorCount) : 0;
  }, [calculatedCommission, vendorCount]);

  // Helper to format ISO -> "HH:mm" for inputs
  const isoToHHMM = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const isoToPacificHHMM = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "America/Los_Angeles",
    }).formatToParts(d);
    const hh = (parts.find((p) => p.type === "hour")?.value || "00").padStart(2, "0");
    const mm = (parts.find((p) => p.type === "minute")?.value || "00").padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const subtractMinutesFromHHMM = (hhmm: string, minutes: number): string => {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
    const [hh, mm] = hhmm.split(":").map((value) => Number(value));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
    const dayMinutes = 24 * 60;
    const totalMinutes = (((hh * 60 + mm - minutes) % dayMinutes) + dayMinutes) % dayMinutes;
    const outHh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const outMm = String(totalMinutes % 60).padStart(2, "0");
    return `${outHh}:${outMm}`;
  };

  const getPacificTzAbbr = (iso?: string | null): string => {
    if (!iso) return "PT";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "PT";
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
      timeZone: "America/Los_Angeles",
    }).format(d);
    const match = formatted.match(/\b(PST|PDT)\b/);
    return match ? match[1] : "PT";
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
        firstIn: isoToPacificHHMM(span.firstIn),
        lastOut: isoToPacificHHMM(span.lastOut),
        firstMealStart: isoToPacificHHMM(span.firstMealStart),
        lastMealEnd: isoToPacificHHMM(span.lastMealEnd),
        secondMealStart: isoToPacificHHMM(span.secondMealStart),
        secondMealEnd: isoToPacificHHMM(span.secondMealEnd),
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
  const roundPayrollAmount = (amount: number): number => {
    if (!Number.isFinite(amount)) return 0;
    const absAmount = Math.abs(amount);
    if (absAmount < 1000) {
      // Normalize to 3 decimals first to absorb floating drift near .005 boundaries.
      // Example: 237.024999999 should behave like 237.025 -> 237.03.
      const normalizedThousandths = Math.round((absAmount + 1e-9) * 1000) / 1000;
      const roundedCents = Math.round((normalizedThousandths + 1e-9) * 100) / 100;
      return amount < 0 ? -roundedCents : roundedCents;
    }
    const roundedHundreds = Math.round((absAmount + 1e-9) / 100) * 100;
    return amount < 0 ? -roundedHundreds : roundedHundreds;
  };
  const formatPayrollMoney = (amount: number): string =>
    roundPayrollAmount(amount).toFixed(2);

  const payrollState = event?.state?.toUpperCase()?.trim() || "CA";
  const hideRestBreakColumn = payrollState === "NV" || payrollState === "WI";

  // Helper: use the same worked-hours calculation as Timesheet/Payment (includes Gate/Phone offset).
  const getMealDeductedMsForSave = (uid: string) => {
    return getDisplayedWorkedMs(uid);
  };

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

      const currentShares = sharesData;
      const netSales = sharesData?.netSales || 0;
      const poolPercent = Number(commissionPool || event?.commission_pool || 0) || 0;
      const totalCommissionPool = netSales * poolPercent;
      const totalTips = Number(tips) || 0;

      // Only include non-trailers in the hours pool for commissions/tips prorating
      const totalEligibleHours = teamMembers.reduce((sum: number, member: any) => {
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const memberDivision = member.users?.division;
        if (memberDivision === 'trailers') return sum;
        const ms = getDisplayedWorkedMs(uid);
        return sum + (ms / (1000 * 60 * 60));
      }, 0);

      const perVendorCommissionShare =
        vendorCount > 0 ? totalCommissionPool / vendorCount : 0;

      // Build vendor payments array using the same UI hour calculation.
      const vendorPayments = teamMembers.map((member: any) => {
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const totalMs = getDisplayedWorkedMs(uid);
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
          !isTrailersDivision && actualHours > 0 && vendorCount > 0
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

      const currentShares = sharesData;
      const netSales = sharesData?.netSales || 0;
      const poolPercent = Number(commissionPool || event?.commission_pool || 0) || 0;
      const totalCommissionPool = netSales * poolPercent;
      const totalTips = Number(tips) || 0;

      // Only include non-trailers in the hours pool for email/payroll preview prorating
      const totalEligibleHoursEmail = teamMembers.reduce((sum: number, member: any) => {
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const memberDivision = member.users?.division;
        if (memberDivision === 'trailers') return sum;
        const ms = getMealDeductedMsForSave(uid);
        return sum + (ms / (1000 * 60 * 60));
      }, 0);

      const perVendorCommissionShare =
        vendorCount > 0 ? totalCommissionPool / vendorCount : 0;

      const payrollData = teamMembers.map((member: any) => {
        const profile = member.users?.profiles;
        const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
        const totalMs = getMealDeductedMsForSave(uid);
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
          !isTrailersDivision && actualHours > 0 && vendorCount > 0
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
          regularPay: formatPayrollMoney(extAmtOnRegRate),
          overtimeHours: overtimeHours.toFixed(2),
          overtimePay: formatPayrollMoney(overtimePay),
          doubletimeHours: doubletimeHours.toFixed(2),
          doubletimePay: formatPayrollMoney(doubletimePay),
          commission: formatPayrollMoney(commissionAmount),
          tips: formatPayrollMoney(proratedTips),
          restBreak: formatPayrollMoney(restBreak),
          adjustment: formatPayrollMoney(adjustment),
          totalPay: formatPayrollMoney(totalPay),
          baseRate: formatPayrollMoney(baseRate),
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

  const shares = sharesData;

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
                ["locations", "Locations", "M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z"],
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
                        step="0.01"
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
                        step="0.01"
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
                        step="0.01"
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
                        <span className="text-lg font-bold text-gray-900">= Adjusted Gross Amount</span>
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
                <div className="flex items-center gap-2">
                  {canManageTeam && (
                    <button
                      onClick={openAddVendorModal}
                      disabled={loadingAddVendors || addingVendorToTeam}
                      className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                    >
                      Add Vendor + Confirm
                    </button>
                  )}
                  <button
                    onClick={handleExportTeamMembers}
                    disabled={loadingTeam || filteredTeamListMembers.length === 0}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    Export Excel
                  </button>
                  <button
                    onClick={() => setShowUninvitedHistoryModal(true)}
                    disabled={loadingTeam || uninvitedTeamMembers.length === 0}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    Uninvited ({uninvitedTeamMembers.length})
                  </button>
                  <button
                    onClick={() => loadTeam(false)}
                    disabled={loadingTeam}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    {loadingTeam ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              {loadingTeam ? (
                <div className="text-center py-12">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-4 text-gray-600">Loading team members...</p>
                </div>
              ) : teamMembers.length === 0 && uninvitedTeamMembers.length === 0 ? (
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600 text-lg font-medium">No team members assigned yet</p>
                  <p className="text-gray-500 text-sm mt-2">
                    {canManageTeam
                      ? "Use Add Vendor + Confirm to add members instantly."
                      : "No team members assigned to this event yet."}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
                    <div className="bg-rose-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-rose-600 mb-1">Uninvited</div>
                      <div className="text-2xl font-bold text-rose-900">{uninvitedTeamMembers.length}</div>
                    </div>
                  </div>

                  {teamMembers.length > 0 ? (
                    <>
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
                              {canUninviteTeamMember && (
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase keeping-wider">
                                  Actions
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {filteredTeamListMembers.length === 0 ? (
                              <tr>
                                <td colSpan={canUninviteTeamMember ? 6 : 5} className="px-6 py-8 text-center text-sm text-gray-500">
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
                              const hasAttestation = Boolean(member?.has_attestation);

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
                                    {hasAttestation && (
                                      <div className="mt-1 text-xs font-semibold text-purple-700">
                                        Attestation Submitted
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(member.created_at).toLocaleDateString("en-US", {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </td>
                                  {canUninviteTeamMember && (
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                      <button
                                        onClick={() => {
                                          void handleUninviteTeamMember(member);
                                        }}
                                        disabled={uninvitingMemberId === member.id || hasAttestation}
                                        title={
                                          hasAttestation
                                            ? "Cannot uninvite: attestation already submitted"
                                            : "Uninvite this team member"
                                        }
                                        className="text-red-600 hover:text-red-700 font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                      >
                                        {uninvitingMemberId === member.id ? "Uninviting..." : "Uninvite"}
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="bg-gray-50 rounded-lg p-6 text-center text-sm text-gray-600">
                      No currently invited team members.
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* LOCATIONS TAB */}
          {activeTab === "locations" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Locations</h2>
                  <div className="text-sm text-gray-600 mt-1">
                    Vendors: {assignedVendorCount}
                    {vendorCount !== assignedVendorCount && (
                      <span className="text-gray-500"> ({vendorCount} with timesheets)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canSendTeamInvites && (
                    <button
                      onClick={openLocationCreateTeamModal}
                      disabled={loadingLocationTeamVendors || savingLocationTeam}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                    >
                      Add Vendors
                    </button>
                  )}
                  {canSendTeamInvites && (
                    <button
                      onClick={() => {
                        void handleInviteAllAssignedLocationVendors();
                      }}
                      disabled={
                        invitingAllLocationVendors ||
                        sendingLocationInviteRequests ||
                        savedAssignedUninvitedLocationVendorIds.length === 0
                      }
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                    >
                      {invitingAllLocationVendors
                        ? "Inviting..."
                        : `Invite Assigned (${savedAssignedUninvitedLocationVendorIds.length})`}
                    </button>
                  )}
                  <button
                    onClick={handleSendLocationAssignments}
                    disabled={
                      !canManageLocations ||
                      sendingLocationEmails ||
                      loadingLocations ||
                      assignedLocationRecipientCount === 0
                    }
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    {sendingLocationEmails
                      ? "Sending..."
                      : `Call Time${assignedLocationRecipientCount > 0 ? ` (${assignedLocationRecipientCount})` : ""}`}
                  </button>
                  <button
                    onClick={handleExportLocations}
                    disabled={loadingLocations || eventLocations.length === 0}
                    className="bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    Export
                  </button>
                  <button
                    onClick={loadLocations}
                    disabled={loadingLocations}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    {loadingLocations ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="bg-white border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location Name
                    </label>
                    <input
                      type="text"
                      value={newLocationName}
                      onChange={(e) => setNewLocationName(e.target.value)}
                      placeholder="Example: Main Gate"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      disabled={!canManageLocations}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Notes (Optional)
                    </label>
                    <input
                      type="text"
                      value={newLocationNotes}
                      onChange={(e) => setNewLocationNotes(e.target.value)}
                      placeholder="Example: VIP entrance"
                      className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      disabled={!canManageLocations}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleAddLocation}
                    disabled={!canManageLocations || creatingLocation || !newLocationName.trim()}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    {creatingLocation ? "Adding..." : "Add Location"}
                  </button>
                </div>
              </div>

              {!canManageLocations && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Read-only access. Only exec/admin/manager/supervisor roles can manage locations.
                </div>
              )}

              {loadingLocations ? (
                <div className="text-center py-12">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-4 text-gray-600">Loading locations...</p>
                </div>
              ) : eventLocations.length === 0 ? (
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <p className="text-gray-600 text-lg font-medium">No locations added yet</p>
                  <p className="text-gray-500 text-sm mt-2">Add your first location and assign team members to it.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {eventLocations.map((loc) => {
                    const assignedIds = locationAssignments[loc.id] || [];
                    const isEditing = !!editingLocationIds[loc.id];
                    const selectedIds = locationAssignmentDrafts[loc.id] || [];
                    const assignedMembers = assignedIds.map((memberId) => {
                      const existing = locationAssignableMemberById.get(memberId);
                      if (existing) return existing;
                      return {
                        id: memberId,
                        email: "",
                        division: "",
                        distance: null,
                        status: null,
                        isExistingMember: false,
                        profiles: {
                          first_name: "Unknown",
                          last_name: "",
                          phone: "",
                        },
                      } as TeamVendorOption;
                    });

                    return (
                      <div key={loc.id} className="bg-white border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">{loc.name}</h3>
                            <p className="text-xs text-gray-500 mt-1">
                              {assignedIds.length} assigned {assignedIds.length === 1 ? "member" : "members"}
                            </p>
                            {loc.notes && (
                              <p className="text-sm text-gray-600 mt-2">{loc.notes}</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteLocation(loc.id)}
                            disabled={!canManageLocations || deletingLocationId === loc.id}
                            className="text-red-600 hover:text-red-700 text-sm font-medium disabled:text-gray-400"
                          >
                            {deletingLocationId === loc.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>

                        {!isEditing ? (
                          <div className="space-y-4">
                            {assignedMembers.length === 0 ? (
                              <div className="text-sm text-gray-500 bg-gray-50 border rounded-lg p-4">
                                No vendors assigned to this station yet.
                              </div>
                            ) : (
                              <div className="border rounded-lg overflow-hidden">
                                {assignedMembers.map((member) => {
                                  const memberId = String(member?.id || "");
                                  const profile = member?.profiles;
                                  const firstName = profile?.first_name || "Unknown";
                                  const lastName = profile?.last_name || "";
                                  const fullName = `${firstName} ${lastName}`.trim();
                                  const email = member?.email || "No email";
                                  const isUninvited = !member?.isExistingMember;

                                  return (
                                    <div
                                      key={`${loc.id}-assigned-${memberId}`}
                                      className="flex items-center justify-between gap-3 px-4 py-3 border-b last:border-b-0"
                                    >
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <p className="text-sm font-medium text-gray-900 truncate">{fullName}</p>
                                          {isUninvited && (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                                              Not Invited
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-gray-500 truncate">{email}</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {isUninvited && canSendTeamInvites && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              void handleInviteSingleLocationVendor(memberId);
                                            }}
                                            disabled={
                                              invitingLocationVendorIds.has(memberId) ||
                                              invitingAllLocationVendors ||
                                              sendingLocationInviteRequests
                                            }
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-1.5 px-3 rounded transition disabled:bg-gray-400"
                                          >
                                            {invitingLocationVendorIds.has(memberId) ? "Inviting..." : "Invite"}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="flex justify-end">
                              <button
                                onClick={() => {
                                  void startLocationAssignmentEdit(loc.id);
                                }}
                                disabled={!canManageLocations}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                              >
                                Add Vendors
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <p className="text-xs text-gray-500">
                              Select vendors for this location, then save assignments.
                            </p>

                            {locationAssignableMembers.length === 0 ? (
                              <div className="text-sm text-gray-500 bg-gray-50 border rounded-lg p-4 space-y-3">
                                <p>No available users found for this event date.</p>
                                <button
                                  onClick={() => {
                                    void loadLocationCreateTeamModalData();
                                  }}
                                  disabled={loadingLocationTeamVendors}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                                >
                                  {loadingLocationTeamVendors ? "Loading..." : "Load Available Users"}
                                </button>
                              </div>
                            ) : (
                              <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                                {locationAssignableMembers.map((member) => {
                                  const memberId = String(member?.id || "");
                                  if (!memberId) return null;

                                  const profile = member?.profiles;
                                  const firstName = profile?.first_name || "Unknown";
                                  const lastName = profile?.last_name || "";
                                  const fullName = `${firstName} ${lastName}`.trim();
                                  const email = member?.email || "No email";
                                  const checked = selectedIds.includes(memberId);

                                  const assignedToOtherLocation = eventLocations
                                    .filter((locationItem) => locationItem.id !== loc.id)
                                    .some((locationItem) =>
                                      (locationAssignments[locationItem.id] || []).includes(memberId)
                                    );
                                  if (assignedToOtherLocation) return null;

                                  return (
                                    <div
                                      key={`${loc.id}-${memberId}`}
                                      className="flex items-center justify-between gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-gray-50 cursor-pointer"
                                      onClick={() => {
                                        if (!canManageLocations) return;
                                        toggleLocationAssignmentDraft(loc.id, memberId);
                                      }}
                                    >
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <p className="text-sm font-medium text-gray-900 truncate">{fullName}</p>
                                          {!member.isExistingMember && (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                                              Not Invited
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs text-gray-500 truncate">{email}</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={!canManageLocations}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={() => toggleLocationAssignmentDraft(loc.id, memberId)}
                                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => cancelLocationAssignmentEdit(loc.id)}
                                disabled={!canManageLocations || savingLocationId === loc.id}
                                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded transition disabled:bg-gray-100 disabled:text-gray-400"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => saveLocationAssignments(loc.id)}
                                disabled={!canManageLocations || savingLocationId === loc.id}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                              >
                                {savingLocationId === loc.id ? "Saving..." : "Save Assignments"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

{/* TIMESHEET TAB */}
{activeTab === "timesheet" && (

  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <h2 className="text-2xl font-bold">TimeSheet</h2>
      <div className="text-sm text-gray-500 text-right">
        <div className="font-medium text-gray-700">
          Vendors: {assignedVendorCount}
          {vendorCount !== assignedVendorCount && (
            <span className="text-gray-500"> ({vendorCount} with timesheets)</span>
          )}
        </div>
        <div>
          Event window (CA time):{" "}
          {isoToPacificHHMM(event?.start_time)}{" "}
          – {isoToPacificHHMM(event?.end_time)}{" "}
          {getPacificTzAbbr(event?.start_time || event?.end_time)}
        </div>
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

    {/* Summary - unchanged */}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* ... same as before ... */}
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
              Gate/Phone
            </th>
            <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
              Clock In
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
              Clock Out
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
          {sortedTeamMembers.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-8 text-center text-gray-500 text-sm">
                No time entries yet
              </td>
            </tr>
          ) : (
            sortedTeamMembers.map((m: any) => {
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

              // ─── Use Pacific time conversion everywhere ───
              const firstClockIn     = isoToPacificHHMM(span.firstIn);
              const lastClockOut     = isoToPacificHHMM(span.lastOut);
              const firstMealStart   = isoToPacificHHMM(span.firstMealStart);
              const lastMealEnd      = isoToPacificHHMM(span.lastMealEnd);
              const secondMealStart  = isoToPacificHHMM(span.secondMealStart);
              const secondMealEnd    = isoToPacificHHMM(span.secondMealEnd);

              const isEditing = canEditTimesheets && editingTimesheetUserId === uid;

              const draft = timesheetDrafts[uid] || {
                firstIn: firstClockIn,
                lastOut: lastClockOut,
                firstMealStart,
                lastMealEnd,
                secondMealStart,
                secondMealEnd,
              };
              const gatePhoneTime = subtractMinutesFromHHMM(
                isEditing ? draft.firstIn : firstClockIn,
                GATE_PHONE_OFFSET_MINUTES
              );
              const hours = formatHoursFromMs(getDisplayedWorkedMs(uid));

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
                      value={gatePhoneTime}
                      placeholder="--:--"
                      readOnly
                      className="border rounded px-2 py-1 text-sm w-28 bg-gray-100 cursor-not-allowed"
                    />
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

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={isEditing ? draft.lastOut : lastClockOut}
                      onChange={(e) => updateTimesheetDraft(uid, "lastOut", e.target.value)}
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
                        <>
                          <button
                            onClick={() => startTimesheetEdit(uid, span)}
                            className="text-blue-600 hover:text-blue-700 font-medium text-xs"
                          >
                            Edit
                          </button>
                          {userRole === "exec" && (
                            <button
                              onClick={async () => {
                                try {
                                  const { data: sess } = await supabase.auth.getSession();
                                  const token = sess?.session?.access_token;
                                  if (!token) return;
                                  const res = await fetch(
                                    `/api/events/${eventId}/attestation-pdf?userId=${encodeURIComponent(uid)}`,
                                    { headers: { Authorization: `Bearer ${token}` } }
                                  );
                                  if (!res.ok) return;
                                  const blob = await res.blob();
                                  const blobUrl = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = blobUrl;
                                  a.download = `attestation-${firstName}_${lastName}.pdf`;
                                  document.body.appendChild(a);
                                  a.click();
                                  a.remove();
                                  URL.revokeObjectURL(blobUrl);
                                } catch { /* silent */ }
                              }}
                              className="text-purple-600 hover:text-purple-700 font-medium text-xs ml-2"
                              title="Download attestation PDF"
                            >
                              Attestation
                            </button>
                          )}
                        </>
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
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">HR Management</h2>
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-600">
                    Vendors: {assignedVendorCount}
                    {vendorCount !== assignedVendorCount && (
                      <span className="text-gray-500"> ({vendorCount} with timesheets)</span>
                    )}
                  </div>
                  <button
                    onClick={handleExportPayments}
                    disabled={loadingPaymentTab || filteredTeamMembers.length === 0}
                    className="bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                  >
                    Export Payments
                  </button>
                </div>
              </div>

              {loadingPaymentTab && (
                <div className="text-center py-6 bg-white border rounded-lg">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-3 text-sm text-gray-600">Loading payment data...</p>
                </div>
              )}

              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-blue-600">Staff Assigned</div>
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-blue-900">{vendorCount}</div>
                  <div className="text-xs text-blue-600 mt-1">vendors with time entries</div>
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
                      const totalMs = getTotalDisplayedWorkedMs();
                      return formatHoursFromMs(totalMs);
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
                      const totalMs = getTotalDisplayedWorkedMs();
                      const totalHours = totalMs / (1000 * 60 * 60);

                      // Use rates from database based on venue state
                      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                      const baseRate = getBaseRateForState(eventState);

                      const totalPayment = totalHours * baseRate;
                      return formatPayrollMoney(totalPayment);
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

                <div className="bg-indigo-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-indigo-600">Commission per Vendor</div>
                    <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-indigo-900">
                    ${formatPayrollMoney(commissionPerVendor)}
                  </div>
                  <div className="text-xs text-indigo-600 mt-1">
                    {vendorCount} vendor{vendorCount === 1 ? '' : 's'} with timesheets
                  </div>
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
                      ${formatPayrollMoney(getBaseRateForState(event?.state || 'CA'))}/hr
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
                  <table className="w-full table-fixed text-xs leading-4">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700 w-[18rem]">Employee</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700" title="Regular Rate">Reg</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700" title="Loaded Rate">Loaded</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700">Hours</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700" title="Extended Amount on Regular Rate">Ext @ Reg</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700" title="Commission Amount">Comm</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700" title="Total Final Commission">Final Comm</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700">Tips</th>
                        {!hideRestBreakColumn && (
                          <th className="text-left px-2 py-2 font-semibold text-gray-700">Rest</th>
                        )}
                        <th className="text-left px-2 py-2 font-semibold text-gray-700">Other</th>
                        <th className="text-left px-2 py-2 font-semibold text-gray-700">Gross Pay</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-700 w-[7.5rem]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredTeamMembers.length === 0 ? (
                        <tr>
                          <td colSpan={hideRestBreakColumn ? 11 : 12} className="p-8 text-center text-gray-500">
                            No staff found matching filters
                          </td>
                        </tr>
                      ) : (
                        filteredTeamMembers.map((member: any) => {
                          const profile = member.users?.profiles;
                          const firstName = profile?.first_name || "N/A";
                          const lastName = profile?.last_name || "";
                          const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();
                          const hasAttestation = Boolean(member?.has_attestation);

                          // Worked hours include meal deductions plus Gate/Phone lead time.
                          const totalMs = getDisplayedWorkedMs(uid);
                          const actualHours = totalMs / (1000 * 60 * 60);
                          const hoursHHMM = formatHoursFromMs(totalMs);
                          // Hours pool for prorating excludes 'trailers' division
                          const totalEligibleHours = teamMembers.reduce((sum: number, m: any) => {
                            const mDivision = m.users?.division;
                            if (mDivision === 'trailers') return sum;
                            const mUid = (m.user_id || m.vendor_id || m.users?.id || '').toString();
                            return sum + (getDisplayedWorkedMs(mUid) / (1000 * 60 * 60));
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
                          const currentShares = sharesData;
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
                            !isTrailersDivision && actualHours > 0 && vendorCount > 0
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
                              <td className="px-2 py-2 align-top">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-[10px]">
                                    {firstName.charAt(0)}
                                    {lastName.charAt(0)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-gray-900 text-sm truncate">
                                      {firstName} {lastName}
                                    </div>
                                    <div className="text-[10px] text-gray-500 break-all">
                                      {member.users?.email || "N/A"}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Reg Rate */}
                              <td className="px-2 py-2 align-top">
                                <div className="font-medium text-gray-900">
                                  ${formatPayrollMoney(baseRate)}/hr
                                </div>
                              </td>

                              {/* Loaded Rate */}
                              <td className="px-2 py-2 align-top">
                                <div className={`font-medium ${finalCommissionRate > baseRate ? 'text-orange-600' : 'text-gray-900'}`}>
                                  ${formatPayrollMoney(finalCommissionRate)}/hr
                                </div>
                              </td>

                              {/* Hours */}
                              <td className="px-2 py-2 align-top">
                                <div className="font-medium text-gray-900">
                                  {actualHours > 0 ? hoursHHMM : "0:00"}
                                </div>
                              </td>

                              {/* Ext Amt on Reg Rate */}
                              <td className="px-2 py-2 align-top">
                                <div className="text-sm font-medium text-green-600">
                                  ${formatPayrollMoney(extAmtOnRegRate)}
                                </div>
                                <div className="hidden xl:block text-[10px] text-gray-500 mt-1">
                                  {hoursHHMM} × ${formatPayrollMoney(baseRate)} × 1.5
                                </div>
                              </td>

                              {/* Commission Amt */}
                              <td className="px-2 py-2 align-top">
                                <div className="text-sm font-medium text-green-600">
                                  ${formatPayrollMoney(commissionAmount)}
                                </div>
                                <div className="hidden xl:block text-[10px] text-gray-500">
                                  Pool {(poolPercent * 100).toFixed(2)}%
                                </div>
                              </td>

                              {/* Total Final Commission */}
                              <td className="px-2 py-2 align-top">
                                <div className="text-sm font-medium text-green-600">
                                  ${formatPayrollMoney(totalFinalCommission)}
                                </div>
                              </td>

                              {/* Tips */}
                              <td className="px-2 py-2 align-top">
                                <div className="text-sm font-medium text-green-600">
                                  ${formatPayrollMoney(proratedTips)}
                                </div>
                              </td>

                              {!hideRestBreakColumn && (
                                <td className="px-2 py-2 align-top">
                                  <div className="text-sm font-medium text-green-600">
                                    ${formatPayrollMoney(restBreak)}
                                  </div>
                                  <div className="hidden xl:block text-[10px] text-gray-500 mt-1">
                                    {hoursHHMM} {actualHours > 10 ? '>' : '≤'} 10h
                                  </div>
                                </td>
                              )}

                              {/* Other (Adjustments + Reimbursements) - Editable */}
                              <td className="px-2 py-2 align-top">
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
                                        className="w-14 px-1 py-0.5 border border-blue-500 rounded text-xs"
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
                                        className="w-14 px-1 py-0.5 border border-blue-500 rounded text-xs"
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
                                        ${otherAmount >= 0 ? '+' : ''}{formatPayrollMoney(otherAmount)}
                                      </span>
                                    ) : (
                                      <span className="text-gray-400">$0.00</span>
                                    )}
                                  </div>
                                )}
                                <div className="hidden xl:block text-[10px] text-gray-500 mt-1">
                                  {canEditTimesheets ? "Click to edit" : "Exec only"}
                                </div>
                              </td>

                              {/* Total Gross Pay */}
                              <td className="px-2 py-2 align-top">
                                <div className="text-sm font-bold text-green-700">
                                  ${formatPayrollMoney(totalGrossPay)}
                                </div>
                              </td>

                              {/* Actions */}
                              <td className="px-2 py-2 text-right align-top whitespace-nowrap">
                                <div className="inline-flex flex-col items-end gap-1">
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
                                    className="text-blue-600 hover:text-blue-700 font-medium text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {editingMemberId === member.id ? 'Done' : 'Edit'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      void handleUninviteTeamMember(member);
                                    }}
                                    disabled={
                                      !canUninviteTeamMember ||
                                      uninvitingMemberId === member.id ||
                                      hasAttestation
                                    }
                                    title={
                                      hasAttestation
                                        ? "Cannot remove: attestation already submitted"
                                        : "Remove from this event"
                                    }
                                    className="text-red-600 hover:text-red-700 font-medium text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    {uninvitingMemberId === member.id ? "Removing..." : "Remove"}
                                  </button>
                                </div>
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
                      const totalMs = getTotalDisplayedWorkedMs();
                      const totalHours = totalMs / (1000 * 60 * 60);

                      // Use rates from database based on venue state
                      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                      const baseRate = getBaseRateForState(eventState);

                      const totalPayment = totalHours * baseRate;
                      return formatPayrollMoney(totalPayment);
                    })()}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Overtime</span>
                    <span className="font-semibold text-gray-900">$0.00</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Tips</span>
                    <span className="font-semibold text-gray-900">${formatPayrollMoney(Number(tips) || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Adjustments</span>
                    <span className={`font-semibold ${(() => {
                      const total = Object.values(adjustments).reduce((sum, val) => sum + val, 0);
                      return total >= 0 ? 'text-green-600' : 'text-red-600';
                    })()}`}>
                      ${(() => {
                        const total = Object.values(adjustments).reduce((sum, val) => sum + val, 0);
                        return (total >= 0 ? '+' : '') + formatPayrollMoney(total);
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
                        return (total >= 0 ? '+' : '') + formatPayrollMoney(total);
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-lg font-bold text-gray-900">Total Payroll</span>
                    <span className="text-2xl font-bold text-green-600">${(() => {
                      const totalMs = getTotalDisplayedWorkedMs();
                      const totalHours = totalMs / (1000 * 60 * 60);

                      // Use rates from database based on venue state
                      const eventState = event?.state?.toUpperCase()?.trim() || 'CA';
                      const baseRate = getBaseRateForState(eventState);

                      const basePay = totalHours * baseRate;
                      const tipsAmount = Number(tips) || 0;
                      const adjustmentsTotal = Object.values(adjustments).reduce((sum, val) => sum + val, 0);
                      const reimbursementsTotal = Object.values(reimbursements).reduce((sum, val) => sum + val, 0);
                      const totalPayroll = basePay + tipsAmount + adjustmentsTotal + reimbursementsTotal;

                      return formatPayrollMoney(totalPayroll);
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

      {showLocationCreateTeamModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeLocationCreateTeamModal}
        >
          <div
            className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Add Vendors</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {event?.event_name || "Selected Event"} {event?.event_date ? `- ${event.event_date}` : ""}
                </p>
              </div>
              <button
                onClick={closeLocationCreateTeamModal}
                disabled={savingLocationTeam || resendingLocationTeamConfirmations}
                className="text-gray-500 hover:text-gray-700 disabled:text-gray-300"
                aria-label="Close add vendors modal"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto space-y-4">
              {locationTeamMessage && (
                <div
                  className={`rounded-lg px-4 py-3 text-sm border ${
                    locationTeamMessage.toLowerCase().includes("success") ||
                    locationTeamMessage.toLowerCase().includes("awaiting confirmation") ||
                    locationTeamMessage.toLowerCase().includes("resent")
                      ? "bg-green-50 border-green-200 text-green-800"
                      : "bg-red-50 border-red-200 text-red-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span>{locationTeamMessage}</span>
                    <button
                      onClick={() => setLocationTeamMessage("")}
                      className="text-gray-500 hover:text-gray-700"
                      aria-label="Close team message"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={locationTeamSearchQuery}
                  onChange={(e) => setLocationTeamSearchQuery(e.target.value)}
                  placeholder="Search vendors by name, email, phone, division, or status"
                  className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={loadingLocationTeamVendors}
                />
                <button
                  onClick={loadLocationCreateTeamModalData}
                  disabled={loadingLocationTeamVendors || savingLocationTeam || resendingLocationTeamConfirmations}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200"
                >
                  {loadingLocationTeamVendors ? "Loading..." : "Reload"}
                </button>
              </div>

              {loadingLocationTeamVendors ? (
                <div className="py-10 text-center text-gray-600">
                  <div className="inline-block w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-3 text-sm">Loading available users for this date...</p>
                </div>
              ) : locationTeamVendors.length === 0 ? (
                <div className="py-10 text-center bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">No available users found for this event date.</p>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    <span className="font-semibold">{locationTeamVendors.length}</span>{" "}
                    vendor{locationTeamVendors.length !== 1 ? "s" : ""} available on this date.
                  </div>

                  <div className="flex items-center justify-between border-b border-gray-200 pb-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={(() => {
                          const newVendors = filteredLocationTeamVendors.filter((vendor) => !vendor.isExistingMember);
                          return newVendors.length > 0 && newVendors.every((vendor) => selectedLocationTeamMembers.has(vendor.id));
                        })()}
                        onChange={handleSelectAllLocationTeam}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Select All (
                      {filteredLocationTeamVendors.filter((vendor) => !vendor.isExistingMember).length} new)
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleResendLocationTeamConfirmations}
                        disabled={
                          pendingLocationTeamInvitesCount === 0 ||
                          resendingLocationTeamConfirmations ||
                          savingLocationTeam
                        }
                        className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200"
                      >
                        {resendingLocationTeamConfirmations
                          ? "Resending..."
                          : `Resend Confirmation (${pendingLocationTeamInvitesCount})`}
                      </button>
                      <button
                        onClick={handleCreateTeamFromLocations}
                        disabled={
                          selectedLocationTeamMembers.size === 0 ||
                          savingLocationTeam ||
                          allLocationAvailableVendorsInvited ||
                          resendingLocationTeamConfirmations
                        }
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:bg-gray-400"
                      >
                        {savingLocationTeam
                          ? "Sending..."
                          : allLocationAvailableVendorsInvited
                            ? "All Invited"
                            : `Send Invitations (${selectedLocationTeamMembers.size})`}
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[48vh] overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {filteredLocationTeamVendors.length === 0 && (
                      <div className="px-4 py-10 text-center text-sm text-gray-500">
                        No vendors match your search.
                      </div>
                    )}
                    {filteredLocationTeamVendors.map((vendor) => {
                      const firstName = (vendor.profiles?.first_name || "").toString();
                      const lastName = (vendor.profiles?.last_name || "").toString();
                      const fullName = `${firstName} ${lastName}`.trim() || vendor.email || "Vendor";
                      const phone = (vendor.profiles?.phone || "").toString();
                      const isExistingMember = Boolean(vendor.isExistingMember);
                      const vendorStatus = String(vendor.status || "").toLowerCase();

                      return (
                        <div
                          key={vendor.id}
                          className={`px-4 py-3 flex items-start gap-3 ${isExistingMember ? "" : "cursor-pointer hover:bg-gray-50"}`}
                          onClick={() => {
                            if (!isExistingMember) toggleLocationTeamMember(vendor.id);
                          }}
                        >
                          {!isExistingMember ? (
                            <input
                              type="checkbox"
                              checked={selectedLocationTeamMembers.has(vendor.id)}
                              onChange={() => toggleLocationTeamMember(vendor.id)}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          ) : (
                            <div className="mt-1 h-4 w-4"></div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-gray-900 truncate">{fullName}</div>
                              <div className="flex items-center gap-2">
                                {isExistingMember && (
                                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">
                                    {vendorStatus === "confirmed"
                                      ? "Confirmed"
                                      : vendorStatus === "declined"
                                        ? "Declined"
                                        : "Invited"}
                                  </span>
                                )}
                                {vendor.distance !== null && vendor.distance !== undefined && (
                                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                                    {vendor.distance} mi
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              {vendor.email || "N/A"}
                              {phone ? ` | ${phone}` : ""}
                              {vendor.division ? ` | ${vendor.division}` : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showUninvitedHistoryModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeUninvitedHistoryModal}
        >
          <div
            className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-gray-200 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Uninvited Team Members</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Persistent record stored in the database. Total: {uninvitedTeamMembers.length}
                </p>
              </div>
              <button
                onClick={closeUninvitedHistoryModal}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close uninvited history modal"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto">
              {uninvitedTeamMembers.length === 0 ? (
                <div className="py-10 text-center bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">No uninvited team members found for this event.</p>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
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
                          Previous Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                          Uninvited By
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">
                          Uninvited On
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {uninvitedTeamMembers.map((row) => {
                        const previousStatus = (row.previous_status || "")
                          .replace(/_/g, " ")
                          .trim();
                        const formattedPreviousStatus = previousStatus
                          ? previousStatus.charAt(0).toUpperCase() + previousStatus.slice(1)
                          : "N/A";
                        const uninvitedByName =
                          row.uninvited_by_name || row.uninvited_by_email || "Unknown";

                        return (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {row.vendor_name || "Unknown"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {row.vendor_email || "N/A"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {formattedPreviousStatus}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                              {uninvitedByName}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {row.uninvited_at
                                ? new Date(row.uninvited_at).toLocaleString("en-US", {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })
                                : "N/A"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200">
              <button
                onClick={closeUninvitedHistoryModal}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddVendorModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeAddVendorModal}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Add Vendor To Team</h3>
                <p className="text-sm text-gray-500 mt-1">The vendor will be added as confirmed immediately.</p>
              </div>
              <button
                onClick={closeAddVendorModal}
                disabled={addingVendorToTeam}
                className="text-gray-500 hover:text-gray-700 disabled:text-gray-300"
                aria-label="Close add vendor modal"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={addVendorSearch}
                  onChange={(e) => setAddVendorSearch(e.target.value)}
                  placeholder="Search by name, email, phone, or division"
                  className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={loadingAddVendors || addingVendorToTeam}
                />
                <button
                  onClick={loadVendorsForImmediateTeamAdd}
                  disabled={loadingAddVendors || addingVendorToTeam}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200"
                >
                  {loadingAddVendors ? "Loading..." : "Reload"}
                </button>
              </div>

              {loadingAddVendors ? (
                <div className="py-10 text-center text-gray-600">
                  <div className="inline-block w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-3 text-sm">Loading vendors...</p>
                </div>
              ) : filteredAddVendorOptions.length === 0 ? (
                <div className="py-10 text-center bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">No available vendors to add.</p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {filteredAddVendorOptions.map((vendor) => {
                    const firstName = (vendor.profiles?.first_name || "").toString();
                    const lastName = (vendor.profiles?.last_name || "").toString();
                    const phone = (vendor.profiles?.phone || "").toString();
                    const fullName = `${firstName} ${lastName}`.trim() || vendor.email;
                    const isSelected = selectedVendorToAdd === vendor.id;

                    return (
                      <button
                        key={vendor.id}
                        type="button"
                        onClick={() => setSelectedVendorToAdd(vendor.id)}
                        className={`w-full text-left px-4 py-3 transition ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{fullName}</div>
                            <div className="text-xs text-gray-600 mt-1">
                              {vendor.email}
                              {phone ? ` • ${phone}` : ""}
                              {vendor.division ? ` • ${vendor.division}` : ""}
                            </div>
                          </div>
                          {isSelected && (
                            <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-700">
                              Selected
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200">
              <button
                onClick={closeAddVendorModal}
                disabled={addingVendorToTeam}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 disabled:text-gray-400 disabled:border-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleAddVendorToTeamImmediately}
                disabled={!selectedVendorToAdd || loadingAddVendors || addingVendorToTeam}
                className="px-4 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:bg-gray-400"
              >
                {addingVendorToTeam ? "Adding..." : "Add + Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
