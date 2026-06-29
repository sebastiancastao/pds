// app/(dashboard)/dashboard/page.tsx
"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { geocodeAddress, getUserRegion } from "@/lib/geocoding";
import { safeDecrypt } from "@/lib/encryption";
import { getVenueAbbreviation } from "@/lib/utils";
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
  is_empty?: boolean;
  event_type?: "normal" | "special";
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
  has_submitted_availability?: boolean;
  availability_responded_at?: string | null;
  availability_scope_start?: string | null;
  availability_scope_end?: string | null;
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

const BULK_AVAILABILITY_DURATION_WEEKS = 6;
const EventCalendar = dynamic(
  () => import("@/components/event-calendar").then((mod) => mod.EventCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-16">
        <div className="apple-spinner" />
        <span className="ml-3 text-gray-600">Loading calendar...</span>
      </div>
    ),
  }
);

const isScopedManagerRole = (role?: string | null) =>
  role === "manager" || role === "supervisor" || role === "supervisor2" || role === "supervisor3";

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"events">("events");
  const [showHelpDeskModal, setShowHelpDeskModal] = useState(false);

  // Auth & Access Control
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [userRole, setUserRole] = useState<string>("");
  const [userRegionId, setUserRegionId] = useState<string | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedRegion, setDetectedRegion] = useState<{ id: string; name: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentUserEmail, setCurrentUserEmail] = useState<string>("");
  const [currentUserFirstName, setCurrentUserFirstName] = useState<string>("");
  const [currentUserLastName, setCurrentUserLastName] = useState<string>("");

  // Events
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [deleteConfirmEvent, setDeleteConfirmEvent] = useState<EventItem | null>(null);
  const [alertModal, setAlertModal] = useState<{
    title: string;
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [selectedVenue, setSelectedVenue] = useState<string>("all");
  const [selectedEventType, setSelectedEventType] = useState<string>("all");
  const [eventSearchQuery, setEventSearchQuery] = useState<string>("");
  const [eventStartDate, setEventStartDate] = useState<string>("");
  const [eventEndDate, setEventEndDate] = useState<string>("");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);

  // Vendors / Regions (Calendar Availability Request)
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [showOnlyPendingAvailability, setShowOnlyPendingAvailability] = useState(false);
  const [selectedVendorState, setSelectedVendorState] = useState<string>("all");
  const [selectedVendorCity, setSelectedVendorCity] = useState<string>("all");
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);

  // Team creation for a given event
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [availableVendors, setAvailableVendors] = useState<Vendor[]>([]);
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<Set<string>>(new Set());
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [resendingTeamConfirmations, setResendingTeamConfirmations] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const [selectedTeamRegion, setSelectedTeamRegion] = useState<string>("all");
  const [selectedTeamState, setSelectedTeamState] = useState<string>("all");
  const [selectedTeamCity, setSelectedTeamCity] = useState<string>("all");
  const [teamSearchQuery, setTeamSearchQuery] = useState("");

  // Check-in confusion warning
  const [checkInWarning, setCheckInWarning] = useState<{ event: EventItem; similarEvents: EventItem[] } | null>(null);

  const handleCheckInClick = useCallback((ev: EventItem) => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Check if event is today
    if (ev.event_date === todayStr) {
      router.push(`/check-in?eventId=${ev.id}`);
      return;
    }

    // Check if event crosses midnight and today is the next day (still active)
    const eventDate = new Date(ev.event_date + "T00:00:00");
    const nextDay = new Date(eventDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`;
    const crossesMidnight = ev.start_time && ev.end_time && ev.end_time <= ev.start_time;
    if (crossesMidnight && todayStr === nextDayStr) {
      router.push(`/check-in?eventId=${ev.id}`);
      return;
    }

    // Collect: same-name events + the closest previous event by date
    const sameName = events.filter((o) => o.id !== ev.id && o.event_name === ev.event_name);
    const previous = events
      .filter((o) => o.id !== ev.id && o.event_date < ev.event_date)
      .sort((a, b) => b.event_date.localeCompare(a.event_date))[0];
    const similar = [...sameName];
    if (previous && !similar.some((s) => s.id === previous.id)) similar.push(previous);

    setCheckInWarning({ event: ev, similarEvents: similar });
  }, [events, router]);

  // Format "HH:MM" or "HH:MM:SS" → "9:00 AM" style
  const fmt12h = (t?: string | null): string => {
    if (!t) return "";
    const [hStr, mStr = "00"] = t.split(":");
    const h = parseInt(hStr, 10);
    return `${h % 12 || 12}:${mStr.padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };

  const hasActiveAvailability = useCallback((vendor: Vendor) => {
    const hasInvitationAvailability = !!(vendor.has_submitted_availability || vendor.availability_responded_at);
    if (!hasInvitationAvailability || !vendor.availability_scope_start || !vendor.availability_scope_end) {
      return false;
    }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${now.getFullYear()}-${month}-${day}`;
    return vendor.availability_scope_start <= today && vendor.availability_scope_end >= today;
  }, []);

  const availableVendorStates = useMemo(() => {
    const states = vendors.map((v) => v.profiles.state).filter((s): s is string => Boolean(s));
    return [...new Set(states)].sort();
  }, [vendors]);

  const availableVendorCities = useMemo(() => {
    const cities = vendors
      .filter((v) => selectedVendorState === "all" || v.profiles.state === selectedVendorState)
      .map((v) => v.profiles.city)
      .filter((c): c is string => Boolean(c));
    return [...new Set(cities)].sort();
  }, [vendors, selectedVendorState]);

  const filteredAndSortedVendors = useMemo(() => {
    const query = vendorSearchQuery.trim().toLowerCase();
    return [...vendors]
      .sort((a, b) => {
        const aName = `${a.profiles.first_name || ""} ${a.profiles.last_name || ""}`.trim().toLowerCase();
        const bName = `${b.profiles.first_name || ""} ${b.profiles.last_name || ""}`.trim().toLowerCase();
        return aName.localeCompare(bName);
      })
      .filter((v) => {
        const hasSubmittedAvailability = hasActiveAvailability(v);
        if (showOnlyPendingAvailability && hasSubmittedAvailability) return false;
        if (selectedVendorState !== "all" && v.profiles.state !== selectedVendorState) return false;
        if (selectedVendorCity !== "all" && v.profiles.city !== selectedVendorCity) return false;
        if (!query) return true;
        const fullName = `${v.profiles.first_name || ""} ${v.profiles.last_name || ""}`.trim().toLowerCase();
        return fullName.includes(query) || v.email.toLowerCase().includes(query);
      });
  }, [vendors, vendorSearchQuery, showOnlyPendingAvailability, hasActiveAvailability, selectedVendorState, selectedVendorCity]);

  const selectedVisibleVendorCount = filteredAndSortedVendors.filter((v) => selectedVendors.has(v.id)).length;
  const allVisibleVendorsSelected =
    filteredAndSortedVendors.length > 0 && selectedVisibleVendorCount === filteredAndSortedVendors.length;
  const availableTeamStates = useMemo(() => {
    const states = availableVendors.map((v) => v.profiles.state).filter((s): s is string => Boolean(s));
    return [...new Set(states)].sort();
  }, [availableVendors]);

  const availableTeamCities = useMemo(() => {
    const cities = availableVendors
      .filter((v) => selectedTeamState === "all" || v.profiles.state === selectedTeamState)
      .map((v) => v.profiles.city)
      .filter((c): c is string => Boolean(c));
    return [...new Set(cities)].sort();
  }, [availableVendors, selectedTeamState]);

  const filteredTeamVendors = useMemo(() => {
    const getFullName = (v: any) => {
      const fn = safeDecrypt(v.profiles.first_name || "");
      const ln = safeDecrypt(v.profiles.last_name || "");
      return `${fn} ${ln}`.trim().toLowerCase();
    };

    const query = teamSearchQuery.trim().toLowerCase();
    const list = availableVendors
      .filter((v) => {
        if (selectedTeamState !== "all" && v.profiles.state !== selectedTeamState) return false;
        if (selectedTeamCity !== "all" && v.profiles.city !== selectedTeamCity) return false;
        if (!query) return true;
        const fullName = getFullName(v);
        const phone = v.profiles.phone ? safeDecrypt(v.profiles.phone) : "";
        return (
          fullName.includes(query) ||
          v.email.toLowerCase().includes(query) ||
          phone.toLowerCase().includes(query) ||
          (v.division || "").toLowerCase().includes(query) ||
          (v.role || "").toLowerCase().includes(query)
        );
      });
    list.sort((a, b) => getFullName(a).localeCompare(getFullName(b)));
    return list;
  }, [availableVendors, teamSearchQuery, selectedTeamState, selectedTeamCity]);

  // Help Desk state
  type HelpDeskTicket = {
    id: string;
    ticket_number: string;
    ticket_date: string;
    urgency: "low" | "medium" | "high" | "critical";
    status: "open" | "in_progress" | "resolved" | "closed";
    description: string;
    created_at: string;
  };
  const [ticketDate, setTicketDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [ticketUrgency, setTicketUrgency] = useState("medium");
  const [ticketDescription, setTicketDescription] = useState("");
  const [submittingHelpDesk, setSubmittingHelpDesk] = useState(false);
  const [helpDeskError, setHelpDeskError] = useState("");
  const [helpDeskSuccess, setHelpDeskSuccess] = useState("");
  const [helpDeskTickets, setHelpDeskTickets] = useState<HelpDeskTicket[]>([]);
  const [helpDeskTicketsLoading, setHelpDeskTicketsLoading] = useState(false);

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

  const formatDateOnly = (value?: string | null) => {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString();
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const getRegionIcon = (regionName?: string | null) => {
    const name = (regionName || "").toLowerCase();
    if (/\bny\b|new york/.test(name)) return "\uD83D\uDDFD\uFE0F";
    if (/\bca\b|california|los angeles|san diego|san francisco/.test(name)) return "\uD83C\uDF07";
    if (/\bnv\b|nevada|las vegas/.test(name)) return "\uD83C\uDFDC\uFE0F";
    if (/\baz\b|arizona|phoenix/.test(name)) return "\uD83C\uDF35";
    if (/\btx\b|texas/.test(name)) return "\uD83E\uDD20";
    if (/\bwi\b|wisconsin/.test(name)) return "\uD83E\uDDC0";
    if (/\beast\b|\bwest\b|\bnorth\b|\bsouth\b/.test(name)) return "\uD83E\uDDED";
    return "\uD83D\uDCCD";
  };


  const initialRegion = detectedRegion?.id || userRegionId || "all";

  // Auth check - MUST run first
  useEffect(() => {
    const checkAuth = async () => {
      try {
        console.log('[DASHBOARD] ð Starting auth check...');
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        console.log('[DASHBOARD] ð Session check result:', {
          hasSession: !!session,
          userId: session?.user?.id,
          error: sessionError?.message
        });

        if (sessionError) {
          console.error('[DASHBOARD] â Session error:', sessionError);
          router.replace('/login');
          return;
        }

        if (!session) {
          console.error('[DASHBOARD] â No session found, redirecting to login');
          router.replace('/login');
          return;
        }

        console.log('[DASHBOARD] â Session found, fetching user data for:', session.user.id);

        // Check user role and region from users table (coordinates are in profiles table)
        const { data: userData, error: userError } = await (supabase
          .from('users')
          .select('role, region_id')
          .eq('id', session.user.id)
          .single() as any);

        console.log('[DASHBOARD] ð User data fetch result:', {
          success: !!userData,
          hasError: !!userError,
          errorCode: userError?.code,
          errorMessage: userError?.message
        });

        if (userError) {
          console.error('[DASHBOARD] â User data fetch error:', userError);
          router.replace('/login');
          return;
        }

        if (!userData) {
          console.error('[DASHBOARD] â No user data found');
          router.replace('/login');
          return;
        }

        console.log('[DASHBOARD] ð User data from users table:', JSON.stringify(userData, null, 2));

        const role = userData.role as string;
        const regionId = userData.region_id as string | null;
        if (!isScopedManagerRole(role) && role !== "exec") {
          console.error("[DASHBOARD] Access denied - user role:", role);
          router.replace("/login");
          return;
        }

        setUserRole(role);
        setUserRegionId(regionId);
        setCurrentUserId(session.user.id);
        setCurrentUserEmail(session.user.email ?? "");
        setIsAuthorized(true);
        setAuthChecking(false);

        // Fetch profile data - try both possible foreign key columns
        const debugProfiles = { data: [], error: null as { message?: string } | null };
        console.log('[DASHBOARD] ð Fetching profile for user:', session.user.id);


        console.log('[DASHBOARD] ð DEBUG - Sample profiles:', {
          count: debugProfiles.data?.length,
          samples: debugProfiles.data,
          error: debugProfiles.error?.message
        });

        let profileData: any = null;
        let profileError: any = null;

        // Try 1: user_id column
        const result1 = await supabase
          .from('profiles')
          .select('city, state, latitude, longitude, first_name, last_name')
          .eq('user_id', session.user.id)
          .maybeSingle();

        console.log('[DASHBOARD] ð Profile query (user_id):', {
          found: !!result1.data,
          error: result1.error?.message,
          dataPreview: result1.data ? 'Found' : 'Not found',
          searchingFor: session.user.id
        });

        if (result1.data) {
          profileData = result1.data;
        } else if (!result1.error) {
          // Try 2: id column as foreign key
          console.log('[DASHBOARD] ð Trying with id column...');
          const result2 = await supabase
            .from('profiles')
            .select('city, state, latitude, longitude, first_name, last_name')
            .eq('id', session.user.id)
            .maybeSingle();

          console.log('[DASHBOARD] ð Profile query (id):', {
            found: !!result2.data,
            error: result2.error?.message
          });

          profileData = result2.data;
          profileError = result2.error;
        } else {
          profileError = result1.error;
        }

        console.log('[DASHBOARD] ð Final profile data:', profileData ? {
          hasLatitude: !!profileData.latitude,
          hasLongitude: !!profileData.longitude,
          latitude: profileData.latitude,
          longitude: profileData.longitude
        } : null);

        if (profileError) {
          console.warn('[DASHBOARD] â ï¸ Profile fetch error (non-fatal):', profileError);
        }

        if (profileData?.first_name) setCurrentUserFirstName(profileData.first_name);
        if (profileData?.last_name) setCurrentUserLastName(profileData.last_name);

        // Get coordinates from profiles table (they only exist there)
        let userLat = profileData?.latitude;
        let userLng = profileData?.longitude;

        console.log('[DASHBOARD] ð Coordinates from profiles table:', {
          lat: userLat,
          lng: userLng,
          hasCoordinates: !!(userLat && userLng)
        });

        // If no coordinates but user has address, geocode it
        if ((!userLat || !userLng) && profileData?.city && profileData?.state) {
          console.log('[DASHBOARD] ðºï¸ No coordinates found, attempting to geocode address:', {
            city: profileData.city,
            state: profileData.state
          });

          try {
            // Use a simple placeholder address for geocoding - just city and state
            const geocodeResult = await geocodeAddress(
              '', // No street address
              profileData.city,
              profileData.state
            );

            if (geocodeResult) {
              userLat = geocodeResult.latitude;
              userLng = geocodeResult.longitude;
              console.log('[DASHBOARD] â Address geocoded successfully:', {
                lat: userLat,
                lng: userLng,
                display_name: geocodeResult.display_name
              });

              // Optionally update the profile with the geocoded coordinates
              // (commented out to avoid unnecessary writes)
              // await supabase.from('profiles').update({
              //   latitude: userLat,
              //   longitude: userLng
              // }).eq('id', session.user.id);
            } else {
              console.warn('[DASHBOARD] â ï¸ Geocoding returned no results for address');
            }
          } catch (geocodeErr) {
            console.error('[DASHBOARD] â Geocoding failed:', geocodeErr);
          }
        }

        if (role !== 'manager' && role !== 'exec' && role !== 'supervisor' && role !== 'supervisor2' && role !== 'supervisor3') {
          console.error('[DASHBOARD] Access denied - user role:', role);
          router.replace('/login');
          return;
        }

        console.log('[DASHBOARD] â Access granted - user role:', role, 'region:', regionId, 'coords:', { userLat, userLng });

        setUserRole(role);
        setUserRegionId(regionId);

        // IMPORTANT: Grant access immediately - geocoding should NOT block dashboard access
        setIsAuthorized(true);
        console.log('[DASHBOARD] ð¯ Authorization granted, proceeding with region detection...');

        // Priority order for determining user's region (non-blocking):
        // 1. Geocoding from coordinates (most accurate)
        // 2. Database region_id (fallback)
        // 3. No region (user will see all data)

        // Wrap geocoding in try-catch to ensure it never blocks access
        try {
          let regionDetected = false;

          // If user has coordinates, find their region
          // This applies to both managers and executives
          if (userLat && userLng) {
          console.log('[DASHBOARD] ð Determining region from coordinates:', { userLat, userLng });
          setUserCoordinates({ lat: userLat, lng: userLng });

          // Fetch all regions to determine which one the user is in
          try {
            const regionsRes = await fetch('/api/regions');
            if (regionsRes.ok) {
              const regionsData = await regionsRes.json();
              const allRegions = regionsData.regions || [];

              // Use the geocoding utility to find the user's region
              const userRegion = getUserRegion(userLat, userLng, allRegions);

              if (userRegion) {
                console.log('[DASHBOARD] â User detected in region:', userRegion.name);
                setDetectedRegion({ id: userRegion.id, name: userRegion.name });
                regionDetected = true;

                // For managers, auto-set their region filter
                // For executives, they can still change it
                if (role === 'manager' || role === 'supervisor' || role === 'supervisor2' || role === 'supervisor3') {
                  console.log('[DASHBOARD] ð¤ Setting manager region filters to:', userRegion.id);
                  setSelectedRegion(userRegion.id);
                }
              } else {
                console.warn('[DASHBOARD] â ï¸ No region found within radius for user coordinates');
              }
            }
          } catch (err) {
            console.error('[DASHBOARD] â Failed to determine user region:', err);
          }
        } else {
          console.log('[DASHBOARD] â ï¸ No coordinates available for region detection');
        }

        // Fallback: If geocoding didn't work but user has a region_id, use that
        if (!regionDetected && regionId) {
          console.log('[DASHBOARD] ð Using database region_id as fallback:', regionId);
          // Fetch region name for display
          try {
            const regionsRes = await fetch('/api/regions');
            if (regionsRes.ok) {
              const regionsData = await regionsRes.json();
              const region = regionsData.regions?.find((r: any) => r.id === regionId);
              if (region) {
                console.log('[DASHBOARD] â Region found from database:', region.name);
                setDetectedRegion({ id: region.id, name: region.name });
                if (role === 'manager' || role === 'supervisor' || role === 'supervisor2' || role === 'supervisor3') {
                  setSelectedRegion(region.id);
                }
                regionDetected = true;
              }
            }
          } catch (err) {
            console.error('[DASHBOARD] â Failed to fetch region data:', err);
          }
        }

        // Last resort: Use browser geolocation to determine current location
        if (!regionDetected) {
          console.log('[DASHBOARD] ð Attempting browser geolocation...');
          try {
            // Get user's current location from browser
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
              if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
              }
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 10000,
                maximumAge: 0, // no cache - always get fresh location
                enableHighAccuracy: false
              });
            });

            const currentLat = position.coords.latitude;
            const currentLng = position.coords.longitude;

            console.log('[DASHBOARD] ð Browser location obtained:', { currentLat, currentLng });

            // Fetch regions and determine which one the user is in
            const regionsRes = await fetch('/api/regions');
            if (regionsRes.ok) {
              const regionsData = await regionsRes.json();
              const allRegions = regionsData.regions || [];

              // Use the geocoding utility to find the user's region
              const userRegion = getUserRegion(currentLat, currentLng, allRegions);

              if (userRegion) {
                console.log('[DASHBOARD] â User location detected in region:', userRegion.name);
                setDetectedRegion({ id: userRegion.id, name: userRegion.name });
                setUserCoordinates({ lat: currentLat, lng: currentLng });
                if (role === 'manager' || role === 'supervisor' || role === 'supervisor2' || role === 'supervisor3') {
                  console.log('[DASHBOARD] ð¤ Setting manager region filters to:', userRegion.id);
                  setSelectedRegion(userRegion.id);
                }
                regionDetected = true;
              } else {
                console.warn('[DASHBOARD] â ï¸ Current location is not within any defined region');
              }
            }
          } catch (geoErr: any) {
            console.warn('[DASHBOARD] â ï¸ Browser geolocation failed:', geoErr.message);
          }
        }

          // If still no region detected, warn the user (but still allow access)
          if (!regionDetected && role === 'manager') {
            console.warn('[DASHBOARD] â ï¸ Manager has no region assigned. Showing all data. Please allow location access or set coordinates in profile for region filtering.');
          } else if (!regionDetected) {
            console.log('[DASHBOARD] â¹ï¸ No region detected for executive. User can select region from dropdown.');
          }

          console.log('[DASHBOARD] ð Auth check complete. Region detection:', regionDetected ? 'SUCCESS' : 'NONE');
        } catch (regionErr) {
          // Geocoding failed, but this should NOT block access
          console.error('[DASHBOARD] â ï¸ Region detection failed (non-fatal):', regionErr);
          console.log('[DASHBOARD] â¹ï¸ User can still access dashboard, region filtering disabled.');
        }
      } catch (err: any) {
        console.error('[DASHBOARD] â FATAL: Auth check error:', {
          message: err?.message,
          stack: err?.stack,
          error: err
        });
        console.error('[DASHBOARD] â Redirecting to login due to fatal error');
        router.replace('/login');
      } finally {
        console.log('[DASHBOARD] ð Auth check finally block, setting authChecking to false');
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
        const res = await fetch("/api/events", {
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

    console.log('[DASHBOARD] ð Initial load with region:', initialRegion, { userRole, detectedRegion: detectedRegion?.name, userRegionId });

    loadEvents();
  }, [isAuthorized]);

  const venueOptions = Array.from(new Set(events.map((e) => e.venue))).sort();
  const hasEventSearch = eventSearchQuery.trim().length > 0;
  const hasEventDateFilter = Boolean(eventStartDate || eventEndDate);
  const hasActiveEventFilters = selectedVenue !== "all" || selectedEventType !== "all" || hasEventSearch || hasEventDateFilter || selectedCalendarEventId !== null;
  const filteredEvents = useMemo(() => {
    if (selectedCalendarEventId !== null) {
      return events.filter((e) => e.id === selectedCalendarEventId);
    }
    const query = eventSearchQuery.trim().toLowerCase();
    return events.filter((e) => {
      if (selectedVenue !== "all" && e.venue !== selectedVenue) return false;
      if (selectedEventType !== "all" && (e.event_type || "normal") !== selectedEventType) return false;
      if (query) {
        const searchableText = [
          e.event_name,
          e.artist || "",
          e.venue,
          e.city || "",
          e.state || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!searchableText.includes(query)) return false;
      }
      if (hasEventDateFilter) {
        if (eventStartDate && e.event_date < eventStartDate) return false;
        if (eventEndDate && e.event_date > eventEndDate) return false;
      }
      return true;
    });
  }, [events, selectedVenue, selectedEventType, eventSearchQuery, hasEventDateFilter, eventStartDate, eventEndDate, selectedCalendarEventId]);
  const managerScopedRegionId = useMemo(() => {
    if (!isScopedManagerRole(userRole)) return "all";
    return detectedRegion?.id || userRegionId || "all";
  }, [detectedRegion?.id, userRegionId, userRole]);
  const calendarEvents = useMemo(
    () =>
      filteredEvents.map((ev) => {
        const startIso = toIsoDateTime(ev.event_date, ev.start_time);
        let endIso = toIsoDateTime(ev.event_date, ev.end_time);
        if (!endIso && startIso) endIso = addHours(startIso, 1);
        const abbrev = getVenueAbbreviation(ev.venue);
        const title = abbrev ? `${ev.event_name} (${abbrev})` : ev.event_name;
        return { id: ev.id, title, start: startIso, end: endIso, allDay: false };
      }),
    [filteredEvents]
  );

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


  // Region + vendors helpers
  const loadRegions = useCallback(async () => {
    if (regions.length > 0) return regions;
    console.log('[DASHBOARD] ð Loading regions...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/regions", {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[DASHBOARD] â Regions loaded:', data.regions?.length || 0, data.regions);
        const nextRegions = Array.isArray(data.regions) ? data.regions : [];
        setRegions(nextRegions);
        return nextRegions;
      } else {
        console.error('[DASHBOARD] â Failed to load regions, status:', res.status);
      }
    } catch (err) {
      console.error("[DASHBOARD] â Failed to load regions:", err);
    }
    return [];
  }, [regions.length]);

  const loadHelpDeskTickets = useCallback(async () => {
    setHelpDeskTicketsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/helpdesk/tickets", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        cache: "no-store",
      });
      const body = await res.json();
      if (res.ok) setHelpDeskTickets(body.tickets ?? []);
    } catch (err) {
      console.error("Error loading help desk tickets:", err);
    } finally {
      setHelpDeskTicketsLoading(false);
    }
  }, []);

  const submitHelpDeskTicket = async () => {
    if (!ticketDate) { setHelpDeskError("Date is required."); return; }
    if (!ticketUrgency) { setHelpDeskError("Urgency is required."); return; }
    if (!ticketDescription.trim()) { setHelpDeskError("Description is required."); return; }
    setSubmittingHelpDesk(true);
    setHelpDeskError("");
    setHelpDeskSuccess("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/helpdesk/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          ticket_date: ticketDate,
          urgency: ticketUrgency,
          description: ticketDescription.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to submit ticket");
      setHelpDeskTickets((prev) => [body.ticket, ...prev]);
      setTicketDate(new Date().toISOString().slice(0, 10));
      setTicketUrgency("medium");
      setTicketDescription("");
      setHelpDeskSuccess("Ticket submitted. The team will be notified shortly.");
    } catch (err: any) {
      setHelpDeskError(err.message || "Failed to submit ticket");
    } finally {
      setSubmittingHelpDesk(false);
    }
  };

  useEffect(() => {
    if (!isAuthorized || !showHelpDeskModal) return;
    void loadHelpDeskTickets();
  }, [showHelpDeskModal, isAuthorized, loadHelpDeskTickets]);

  const buildVendorUrl = (venue: string, regionId: string) => {
    const params = new URLSearchParams({ venue });
    if (regionId && regionId !== "all") params.append("region_id", regionId);
    return `/api/vendors?${params.toString()}`;
  };

  const loadAllVendors = async (regionId: string = selectedRegion) => {
    console.log('[DASHBOARD] ð loadAllVendors called with regionId:', regionId);
    setLoadingVendors(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Use geographic filtering when a specific region is selected
      // This ensures vendors are filtered by geographic boundaries (radius from region center)
      const useGeoFilter = regionId !== "all";
      const url = `/api/all-vendors${regionId !== "all" ? `?region_id=${regionId}${useGeoFilter ? '&geo_filter=true' : ''}` : ""}`;
      console.log('[DASHBOARD] ð¡ Fetching vendors from:', url, { useGeoFilter, userRole, regionId });

      // Fetch ALL vendors from the database directly, not filtered by venue
      const res = await fetch(url, {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });

      console.log('[DASHBOARD] ð¥ Response status:', res.status, res.ok ? 'â' : 'â');

      if (!res.ok) {
        let errorMessage = "Failed to load vendors";
        try {
          const errorData = await res.json();
          console.error('[DASHBOARD] â API error:', errorData);
          errorMessage = errorData.error || errorMessage;
        } catch (parseErr) {
          // If JSON parsing fails, try to get text
          const errorText = await res.text();
          console.error('[DASHBOARD] â Non-JSON error response:', errorText.substring(0, 200));
          errorMessage = `Server error (${res.status}): ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      console.log('[DASHBOARD] ð¦ Received data:', {
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

      console.log('[DASHBOARD] â Setting vendors state:', allVendors.length);
      setVendors(allVendors);
    } catch (err: any) {
      console.error("[DASHBOARD] â Error loading vendors:", err);
      setMessage(err.message || "Network error loading vendors");
    }
    setLoadingVendors(false);
  };

  // UI handlers
  const openVendorModal = () => {
    setShowVendorModal(true);
    setSelectedVendors(new Set());
    setVendorSearchQuery("");
    const initialRegion = managerScopedRegionId;
    console.log('[DASHBOARD] ð Opening vendor modal with region:', initialRegion, { userRole, detectedRegion: detectedRegion?.name });
    setSelectedRegion(initialRegion);
    setMessage("");
    void loadRegions();
    void loadAllVendors(initialRegion);
  };
  const closeVendorModal = () => {
    setShowVendorModal(false);
    setVendors([]);
    setSelectedVendors(new Set());
    setVendorSearchQuery("");
    setSelectedVendorState("all");
    setSelectedVendorCity("all");
    setMessage("");
  };
  const handleRegionChange = async (newRegion: string) => {
    console.log('[DASHBOARD] ð Region changed:', { from: selectedRegion, to: newRegion, userRole });
    setSelectedRegion(newRegion);
    setSelectedVendors(new Set());
    setSelectedVendorState("all");
    setSelectedVendorCity("all");
    loadAllVendors(newRegion);
  };
  const toggleVendorSelection = (id: string) => {
    const s = new Set(selectedVendors);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedVendors(s);
  };
  const handleSelectAll = () => {
    setSelectedVendors((prev) => {
      const next = new Set(prev);
      const allVisibleSelected =
        filteredAndSortedVendors.length > 0 && filteredAndSortedVendors.every((v) => next.has(v.id));

      if (allVisibleSelected) {
        filteredAndSortedVendors.forEach((v) => next.delete(v.id));
      } else {
        filteredAndSortedVendors.forEach((v) => next.add(v.id));
      }
      return next;
    });
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
        body: JSON.stringify({ vendorIds: Array.from(selectedVendors), durationWeeks: BULK_AVAILABILITY_DURATION_WEEKS }),
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

  const openDeleteConfirmModal = (event: EventItem) => {
    if ((userRole !== "exec" && userRole !== "manager") || deletingEventId) return;
    setDeleteConfirmEvent(event);
  };

  const handleDeleteEvent = async () => {
    if (!deleteConfirmEvent) return;

    const event = deleteConfirmEvent;
    if ((userRole !== "exec" && userRole !== "manager") || deletingEventId) return;

    setDeletingEventId(event.id);
    setError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${event.id}`, {
        method: "DELETE",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete event");
      }

      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      setDeleteConfirmEvent(null);
      setAlertModal({
        title: "Event Deleted",
        message: `"${event.event_name}" was deleted successfully.`,
        type: "success",
      });
    } catch (err: any) {
      setDeleteConfirmEvent(null);
      setAlertModal({
        title: "Delete Failed",
        message: err?.message || "Failed to delete event",
        type: "error",
      });
    } finally {
      setDeletingEventId(null);
    }
  };

  const loadTeamVendors = async (event: EventItem, regionId: string = "all") => {
    setLoadingAvailable(true);
    console.log('[DASHBOARD-TEAM] ð Loading team vendors for event:', event.id, 'with regionId:', regionId);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Filter by region_id field (same approach as availability-by-region report),
      // not geo distance — geo filter excludes vendors who lack coordinates or live
      // outside the fixed radius even though they are assigned to that region.
      const params = new URLSearchParams();
      if (regionId && regionId !== "all") {
        params.append("region_id", regionId);
      }
      const url = `/api/events/${event.id}/available-vendors${params.toString() ? `?${params.toString()}` : ""}`;
      console.log('[DASHBOARD-TEAM] Fetching available vendors from:', url, { regionId });

      const res = await fetch(url, {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const data = await res.json();
      if (res.ok) {
        console.log('[DASHBOARD-TEAM] â Loaded', data.vendors?.length || 0, 'available vendors');
        setAvailableVendors(data.vendors || []);
      } else {
        console.error('[DASHBOARD-TEAM] â Failed to load available vendors:', data.error);
        setTeamMessage("Failed to load available vendors");
      }
    } catch (err) {
      console.error('[DASHBOARD-TEAM] â Network error loading available vendors:', err);
      setTeamMessage("Network error loading available vendors");
    }
    setLoadingAvailable(false);
  };

  const openTeamModal = async (event: EventItem) => {
    setSelectedEvent(event);
    setShowTeamModal(true);
    setTeamMessage("");
    setSelectedTeamRegion("all");
    setTeamSearchQuery("");
    // Ensure regions are loaded for the region filter
    void loadRegions();

    // Load available vendors first
    await loadTeamVendors(event, "all");

    // Load existing team members and merge with available vendors
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${event.id}/team`, {
        method: "GET",
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const data = await res.json();
      if (res.ok && data.team && data.team.length > 0) {
        console.log('[DASHBOARD-TEAM] ð Loading', data.team.length, 'existing team members');

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
        console.log('[DASHBOARD-TEAM] â Pre-selecting', existingMemberIds.size, 'existing team members');
        setSelectedTeamMembers(existingMemberIds);
      } else {
        // No existing team - start with empty selection
        setSelectedTeamMembers(new Set());
      }
    } catch (err) {
      console.error('[DASHBOARD-TEAM] â Error loading existing team members:', err);
      // Continue anyway - user can still create a team
      setSelectedTeamMembers(new Set());
    }
  };

  const handleTeamRegionChange = async (regionId: string) => {
    setSelectedTeamRegion(regionId);
    setSelectedTeamState("all");
    setSelectedTeamCity("all");

    if (selectedEvent) {
      // Load vendors for the new region
      await loadTeamVendors(selectedEvent, regionId);

      // Re-load and preserve existing team members
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/events/${selectedEvent.id}/team`, {
          method: "GET",
          headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        });
        const data = await res.json();
        if (res.ok && data.team && data.team.length > 0) {
          // Convert team members to vendor format and merge
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
            status: member.status,
            isExistingMember: true,
          }));

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

          // Keep existing team members selected
          const existingMemberIds = new Set<string>(
            (data.team as any[])
              .map((member: any) => String(member?.vendor_id ?? ""))
              .filter((id) => id.length > 0)
          );
          setSelectedTeamMembers(existingMemberIds);
        }
      } catch (err) {
        console.error('[DASHBOARD-TEAM] â Error preserving existing team members on region change:', err);
      }
    }
  };

  const closeTeamModal = () => {
    setShowTeamModal(false);
    setSelectedEvent(null);
    setAvailableVendors([]);
    setSelectedTeamMembers(new Set());
    setResendingTeamConfirmations(false);
    setTeamMessage("");
    setSelectedTeamRegion("all");
    setSelectedTeamState("all");
    setSelectedTeamCity("all");
    setTeamSearchQuery("");
  };
  const toggleTeamMember = (id: string) => {
    const s = new Set(selectedTeamMembers);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedTeamMembers(s);
  };
  const handleSelectAllTeam = () => {
    const visibleNewVendorIds = filteredTeamVendors
      .filter((v) => !(v as any).isExistingMember && !(v as any).confirmedElsewhere)
      .map((v) => v.id);

    if (visibleNewVendorIds.length === 0) return;

    const allVisibleNewSelected = visibleNewVendorIds.every((id) => selectedTeamMembers.has(id));
    const nextSelected = new Set(selectedTeamMembers);

    if (allVisibleNewSelected) {
      visibleNewVendorIds.forEach((id) => nextSelected.delete(id));
    } else {
      visibleNewVendorIds.forEach((id) => nextSelected.add(id));
    }

    setSelectedTeamMembers(nextSelected);
  };
  const getSelectedInvitableTeamMemberIds = () =>
    Array.from(selectedTeamMembers).filter((id) => {
      const vendor = availableVendors.find((v) => v.id === id);
      return Boolean(vendor) && !(vendor as any).isExistingMember && !(vendor as any).confirmedElsewhere;
    });
  const handleSaveTeam = async () => {
    if (!selectedEvent) return;

    const selectedIds = getSelectedInvitableTeamMemberIds();
    if (selectedIds.length === 0) return;
    const outOfVenueIds = selectedIds.filter((id) => {
      const v = availableVendors.find((v) => v.id === id);
      return (v as any)?.isOutOfVenue && !(v as any)?.isExistingMember;
    });
    const inVenueIds = selectedIds.filter((id) => !outOfVenueIds.includes(id));

    setSavingTeam(true);
    setTeamMessage("");
    const messages: string[] = [];
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (inVenueIds.length > 0) {
        const res = await fetch(`/api/events/${selectedEvent.id}/team`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ vendorIds: inVenueIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create team");
        messages.push(data.message || `${inVenueIds.length} invitation(s) sent.`);
      }

      if (outOfVenueIds.length > 0) {
        const res = await fetch(`/api/events/${selectedEvent.id}/location-proposals`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ vendorIds: outOfVenueIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to submit requests");
        messages.push(data.message || `${outOfVenueIds.length} request(s) submitted for exec review.`);
      }

      setTeamMessage(messages.join(" ") || "Done.");
      setTimeout(() => closeTeamModal(), 1500);
    } catch (err: any) {
      setTeamMessage(err.message || "Network error");
    } finally {
      setSavingTeam(false);
    }
  };

  const handleResendTeamConfirmations = async () => {
    if (!selectedEvent) return;

    const invitedVendorIds = availableVendors
      .filter((vendor) => {
        const status = String((vendor as any).status || "").toLowerCase();
        return Boolean((vendor as any).isExistingMember) && status !== "confirmed" && status !== "declined";
      })
      .map((vendor) => vendor.id);

    if (invitedVendorIds.length === 0) {
      setTeamMessage("No invited vendors are pending confirmation.");
      return;
    }

    setResendingTeamConfirmations(true);
    setTeamMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${selectedEvent.id}/team/resend-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ vendorIds: invitedVendorIds }),
      });
      const data = await res.json();

      if (res.ok) {
        setTeamMessage(
          data.message ||
          `Successfully resent confirmation to ${invitedVendorIds.length} invited vendor${invitedVendorIds.length !== 1 ? "s" : ""}.`
        );
      } else {
        setTeamMessage(data.error || "Failed to resend confirmations");
      }
    } catch {
      setTeamMessage("Network error resending confirmations");
    } finally {
      setResendingTeamConfirmations(false);
    }
  };

  // Leaves

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
  const selectedInvitableTeamMembersCount = getSelectedInvitableTeamMemberIds().length;
  const pendingTeamInvitesCount = availableVendors.filter((vendor) => {
    const status = String((vendor as any).status || "").toLowerCase();
    return Boolean((vendor as any).isExistingMember) && status !== "confirmed" && status !== "declined";
  }).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-12 px-6">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-5xl font-semibold text-gray-900 mb-3 keeping-tight">Dashboard</h1>
              <p className="text-lg text-gray-600 font-normal">
                {activeTab === "events"
                  ? "Manage your events and invite vendors seamlessly."
                  : "Manage employees, leave requests, and workforce analytics."}
              </p>
              <div className="mt-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                  <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Manager & Executive Access
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {userRole !== 'supervisor' && userRole !== 'supervisor2' && (
                <Link
                  href="/global-calendar"
                  className="apple-button apple-button-secondary flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Actual Global Calendar
                </Link>
              )}
              <Link
                href="/planned-calendar"
                className="apple-button apple-button-secondary flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                Planning Calendar
              </Link>
              <button
                onClick={() => setShowHelpDeskModal(true)}
                className="apple-button apple-button-secondary flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Help Desk
              </button>
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
            <div className="flex flex-wrap gap-3 mb-10">
              <Link href="/create-event?returnTo=dashboard">
                <button className="apple-button apple-button-primary">
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Event
                </button>
              </Link>
              <button
                onClick={openVendorModal}
                disabled={loading}
                className={`apple-button ${
                  loading ? "apple-button-disabled" : "apple-button-secondary"
                }`}
              >
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Calendar Availability Request
              </button>
            </div>

            {/* Overview */}
            {!loading && !error && events.length > 0 && (
              <section className="mb-10">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4 keeping-tight">Overview</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                  <div className="apple-stat-card apple-stat-card-blue">
                    <div className="apple-stat-icon apple-stat-icon-blue">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="apple-stat-content">
                      <div className="apple-stat-label">Total Events</div>
                      <div className="apple-stat-value">{eventStats.totalEvents}</div>
                      <div className="apple-stat-sublabel">{eventStats.activeEvents} active</div>
                    </div>
                  </div>
                  <div className="apple-stat-card apple-stat-card-purple">
                    <div className="apple-stat-icon apple-stat-icon-purple">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="apple-stat-content">
                      <div className="apple-stat-label">Upcoming</div>
                      <div className="apple-stat-value">{eventStats.upcomingEvents}</div>
                      <div className="apple-stat-sublabel">scheduled ahead</div>
                    </div>
                  </div>
                  <div className="apple-stat-card apple-stat-card-green">
                    <div className="apple-stat-icon apple-stat-icon-green">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                      </svg>
                    </div>
                    <div className="apple-stat-content">
                      <div className="apple-stat-label">Total collected</div>
                      <div className="apple-stat-value">${(eventStats.totalTicketSales / 1000).toFixed(1)}k</div>
                      <div className="apple-stat-sublabel">total revenue</div>
                    </div>
                  </div>
                </div>
              </section>
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
                  <div className="apple-card apple-calendar-wrapper apple-calendar-wrapper-expanded">
                    <EventCalendar events={calendarEvents} onEventClick={(id) => { setSelectedCalendarEventId(id); setSelectedVenue("all"); setEventSearchQuery(""); setEventStartDate(""); setEventEndDate(""); }} />
                  </div>
                )}
              </section>

            {/* All Events */}
            <section>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 keeping-tight">All Events</h2>
              {!loading && !error && events.length > 0 && (
                <div className="mb-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="md:col-span-2 xl:col-span-2">
                      <label htmlFor="event-search" className="block text-sm font-semibold text-gray-700 mb-2">
                        Search Events
                      </label>
                      <input
                        id="event-search"
                        type="search"
                        placeholder="Search by event, venue, artist, city, or state"
                        value={eventSearchQuery}
                        onChange={(e) => setEventSearchQuery(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      />
                    </div>
                    <div>
                      <label htmlFor="event-venue-filter" className="block text-sm font-semibold text-gray-700 mb-2">
                        Filter by Venue
                        {venueOptions.length > 0 && (
                          <span className="ml-2 text-xs font-normal text-gray-500">({venueOptions.length} venues)</span>
                        )}
                      </label>
                      <select
                        id="event-venue-filter"
                        value={selectedVenue}
                        onChange={(e) => setSelectedVenue(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      >
                        <option value="all">All Venues</option>
                        {venueOptions.map((venue) => (
                          <option key={venue} value={venue}>
                            {venue}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="event-type-filter" className="block text-sm font-semibold text-gray-700 mb-2">Filter by Type</label>
                      <select
                        id="event-type-filter"
                        value={selectedEventType}
                        onChange={(e) => setSelectedEventType(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      >
                        <option value="all">All Types</option>
                        <option value="normal">Normal</option>
                        <option value="special">Special</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="event-start-date" className="block text-sm font-semibold text-gray-700 mb-2">Start</label>
                        <input
                          id="event-start-date"
                          type="date"
                          value={eventStartDate}
                          onChange={(e) => setEventStartDate(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                      <div>
                        <label htmlFor="event-end-date" className="block text-sm font-semibold text-gray-700 mb-2">End</label>
                        <input
                          id="event-end-date"
                          type="date"
                          value={eventEndDate}
                          onChange={(e) => setEventEndDate(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 gap-3">
                    <p className="text-xs text-gray-500">
                      Showing {filteredEvents.length} of {events.length} event{events.length === 1 ? "" : "s"}.
                      {" "}
                      {hasEventDateFilter
                        ? "Time period filter is active."
                        : "Select a start or end date to enable the time period filter."}
                    </p>
                    {hasActiveEventFilters && (
                      <button
                        onClick={() => {
                          setSelectedVenue("all");
                          setSelectedEventType("all");
                          setEventSearchQuery("");
                          setEventStartDate("");
                          setEventEndDate("");
                          setSelectedCalendarEventId(null);
                        }}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                </div>
              )}
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
                  <p className="text-gray-500 text-lg">No events match the current filters</p>
                  <p className="text-gray-400 text-sm mt-2">Try changing search text, venue, or date period.</p>
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
                            {ev.event_type === "special" && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                                Special
                              </span>
                            )}
                          </div>
                          <div className="flex items-center text-gray-600 mb-2">
                            <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="font-medium">{ev.venue}</span>
                            {ev.city && ev.state && <span className="ml-2 text-gray-500">. {ev.city}, {ev.state}</span>}
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
                            <span className="mx-2">.</span>
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>
                              {ev.start_time?.slice(0, 5)} - {ev.end_time?.slice(0, 5)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {ev.event_type === "special" ? (
                            <Link href={`/time-sheets/${ev.id}`}>
                              <button className="apple-button apple-button-secondary text-sm py-2 px-4">
                                <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                </svg>
                                Time Sheets
                              </button>
                            </Link>
                          ) : (
                            <button onClick={() => handleCheckInClick(ev)} className="apple-button apple-button-secondary text-sm py-2 px-4">
                              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Check In
                            </button>
                          )}
                          <button onClick={() => openTeamModal(ev)} className="apple-button apple-button-secondary text-sm py-2 px-4">
                            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            Create Team
                          </button>
                          <Link href={`/admin-email-team?eventId=${ev.id}&from=dashboard`}>
                            <button className="apple-button apple-button-secondary text-sm py-2 px-4">
                              <svg className="w-5 h-5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 7.5C4 6.672 4.672 6 5.5 6h13c.828 0 1.5.672 1.5 1.5v9c0 .828-.672 1.5-1.5 1.5h-13A1.5 1.5 0 014 16.5v-9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4.5 8l6.682 4.454a1.5 1.5 0 001.636 0L19.5 8" />
                              </svg>
                              Email Team
                            </button>
                          </Link>
                          <Link href={`/event-dashboard/${ev.id}`}>
                            <button className="apple-icon-button">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </Link>
                        </div>
                      </div>
                      {(userRole === "exec" || userRole === "manager") && (
                        <div className="mt-4 flex justify-end">
                          <button
                            onClick={() => openDeleteConfirmModal(ev)}
                            disabled={deletingEventId === ev.id}
                            className={`apple-icon-button ${
                              deletingEventId === ev.id ? "apple-icon-button-disabled" : "apple-icon-button-danger"
                            }`}
                            aria-label="Delete event"
                            title="Delete event"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}


      </div>


      {/* Help Desk Modal */}
      {showHelpDeskModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => { if (submittingHelpDesk) return; setShowHelpDeskModal(false); setHelpDeskError(""); setHelpDeskSuccess(""); }}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white shadow-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Help Desk</h3>
                <p className="mt-0.5 text-sm text-gray-500">Submit a new ticket or view recent requests.</p>
              </div>
              <button
                type="button"
                onClick={() => { if (submittingHelpDesk) return; setShowHelpDeskModal(false); setHelpDeskError(""); setHelpDeskSuccess(""); }}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1">

              {/* Create ticket form */}
              <div className="px-6 pt-5 pb-4 space-y-4 border-b border-gray-100">
                <h4 className="text-sm font-semibold text-gray-700">New Ticket</h4>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={ticketDate}
                      onChange={(e) => { setTicketDate(e.target.value); setHelpDeskError(""); setHelpDeskSuccess(""); }}
                      className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 bg-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Urgency <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={ticketUrgency}
                      onChange={(e) => setTicketUrgency(e.target.value)}
                      className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 bg-white"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={ticketDescription}
                    onChange={(e) => { setTicketDescription(e.target.value); setHelpDeskError(""); setHelpDeskSuccess(""); }}
                    rows={4}
                    placeholder="Describe the issue in detail…"
                    className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200 resize-none"
                  />
                </div>

                {helpDeskError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{helpDeskError}</div>
                )}
                {helpDeskSuccess && (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{helpDeskSuccess}</div>
                )}
              </div>

              {/* Recent tickets */}
              <div className="px-6 py-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Recent Tickets</h4>
                {helpDeskTicketsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                    <div className="apple-spinner w-4 h-4" /> Loading…
                  </div>
                ) : helpDeskTickets.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No tickets yet.</p>
                ) : (
                  <div className="space-y-2">
                    {helpDeskTickets.map((t) => {
                      const urgencyStyle: Record<string, string> = {
                        low: "bg-gray-100 text-gray-600 border-gray-200",
                        medium: "bg-blue-50 text-blue-700 border-blue-200",
                        high: "bg-orange-50 text-orange-700 border-orange-200",
                        critical: "bg-red-50 text-red-700 border-red-200",
                      };
                      const statusStyle: Record<string, string> = {
                        open: "bg-amber-50 text-amber-700 border-amber-200",
                        in_progress: "bg-blue-50 text-blue-700 border-blue-200",
                        resolved: "bg-green-50 text-green-700 border-green-200",
                        closed: "bg-gray-100 text-gray-500 border-gray-200",
                      };
                      const statusLabel: Record<string, string> = {
                        open: "Open", in_progress: "In Progress", resolved: "Resolved", closed: "Closed",
                      };
                      return (
                        <div key={t.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-mono font-semibold text-gray-500 shrink-0">{t.ticket_number}</span>
                              <p className="text-sm text-gray-700 truncate">{t.description}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${urgencyStyle[t.urgency] ?? urgencyStyle.medium}`}>
                                {t.urgency.charAt(0).toUpperCase() + t.urgency.slice(1)}
                              </span>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusStyle[t.status] ?? statusStyle.open}`}>
                                {statusLabel[t.status] ?? t.status}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400">{t.ticket_date}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 shrink-0">
              <button
                type="button"
                onClick={() => { setShowHelpDeskModal(false); setHelpDeskError(""); setHelpDeskSuccess(""); }}
                disabled={submittingHelpDesk}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void submitHelpDeskTicket()}
                disabled={submittingHelpDesk || !ticketDate || !ticketUrgency || !ticketDescription.trim()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingHelpDesk ? "Submitting…" : "Submit Ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Availability Modal */}
      {showVendorModal && (
        <div className="apple-modal-overlay">
          <div className="apple-modal">
            <div className="apple-modal-header">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Calendar Availability Request</h2>
                <p className="text-gray-600 text-sm mt-1">Ask vendors for their availability over the next 6 weeks</p>
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
                    (
                      message.toLowerCase().includes("success") ||
                      message.toLowerCase().includes("awaiting confirmation")
                    ) ? "apple-alert-success" : "apple-alert-error"
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
                      <div className="font-semibold mb-1">6-Week Work Period</div>
                      <div className="text-xs text-gray-600">Weâll invite selected vendors to share availability</div>
                    </div>
                  </div>

                  {/* Region Filter - For both managers and executives */}
                  <div className="mb-6">
                    {/* Auto-detection notice for managers */}
                    {(userRole === 'manager' || userRole === 'supervisor' || userRole === 'supervisor2' || userRole === 'supervisor3') && detectedRegion && (
                      <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                        <div className="flex items-center text-xs text-blue-800">
                          <svg className="w-4 h-4 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Your region was auto-detected: <strong>{detectedRegion.name}</strong>. You can change it below if needed.</span>
                        </div>
                      </div>
                    )}

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
                      <option value="all">{"\uD83D\uDDFA\uFE0F All Regions"}</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {getRegionIcon(r.name)} {r.name} {detectedRegion?.id === r.id ? '(Your Region)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-xs text-gray-500">
                        {selectedRegion === "all"
                          ? "Showing vendors from all regions"
                          : `Showing ${vendors.length} ${vendors.length === 1 ? "vendor" : "vendors"} in ${regions.find(r => r.id === selectedRegion)?.name || 'selected region'}`
                        }
                      </p>
                      {selectedRegion !== "all" && (
                        <button onClick={() => handleRegionChange("all")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                          Clear filter
                        </button>
                      )}
                    </div>
                  </div>

                  {(availableVendorStates.length > 0 || availableVendorCities.length > 0) && (
                    <div className="mb-6 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Filter by State</label>
                        <select
                          value={selectedVendorState}
                          onChange={(e) => { setSelectedVendorState(e.target.value); setSelectedVendorCity("all"); }}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                        >
                          <option value="all">All States</option>
                          {availableVendorStates.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Filter by City</label>
                        <select
                          value={selectedVendorCity}
                          onChange={(e) => setSelectedVendorCity(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                        >
                          <option value="all">All Cities</option>
                          {availableVendorCities.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="mb-6">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Search Vendors</label>
                    <input
                      type="text"
                      value={vendorSearchQuery}
                      onChange={(e) => setVendorSearchQuery(e.target.value)}
                      placeholder="Search by name or email"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                    <p className="text-xs text-gray-500 mt-1.5">
                      Showing {filteredAndSortedVendors.length} of {vendors.length}{" "}
                      {vendors.length === 1 ? "vendor" : "vendors"}
                    </p>
                    <label className="mt-2 inline-flex items-center cursor-pointer text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={showOnlyPendingAvailability}
                        onChange={(e) => setShowOnlyPendingAvailability(e.target.checked)}
                        className="mr-2 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Show only vendors who have not sent availability
                    </label>
                  </div>

                  <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
                    <label className="flex items-center cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={allVisibleVendorsSelected}
                        onChange={handleSelectAll}
                        disabled={filteredAndSortedVendors.length === 0}
                        className="apple-checkbox"
                      />
                      <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                        Select All ({filteredAndSortedVendors.length})
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
                    {filteredAndSortedVendors.length === 0 && (
                      <div className="apple-empty-state py-10">
                        <p className="text-sm text-gray-500">No vendors match your search</p>
                      </div>
                    )}
                    {filteredAndSortedVendors.map((v) => (
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
                              {hasActiveAvailability(v) && (
                                <div className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-md">Availability sent</div>
                              )}
                              {v.distance !== null ? (
                                <div className={v.distance <= 50 ? "apple-distance-badge-nearby" : "apple-distance-badge"}>{v.distance} mi</div>
                              ) : (
                                <div className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md">No location</div>
                              )}
                            </div>
                          </div>
                          <div className="text-gray-600 text-sm mb-1">
                            {v.email}
                            {v.profiles.phone && (
                              <>
                                <span className="mx-2 text-gray-400">.</span>
                                {v.profiles.phone}
                              </>
                            )}
                          {hasActiveAvailability(v) && v.availability_responded_at && (
                            <div className="text-xs text-green-700 mb-1">
                              Sent availability: {formatDateTime(v.availability_responded_at)}
                              {v.availability_scope_start && v.availability_scope_end && (
                                <> · Scope: {formatDateOnly(v.availability_scope_start)} to {formatDateOnly(v.availability_scope_end)}</>
                              )}
                            </div>
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
                                <span className="text-gray-400">.</span>
                              </>
                            )}
                            <span>{v.division}</span>
                            <span className="text-gray-400">.</span>
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
                    (
                      teamMessage.toLowerCase().includes("success") ||
                      teamMessage.toLowerCase().includes("awaiting confirmation") ||
                      teamMessage.toLowerCase().includes("resent")
                    ) ? "apple-alert-success" : "apple-alert-error"
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

              {/* Region Filter */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Filter by Region
                  {regions.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-gray-500">({regions.length} regions)</span>
                  )}
                </label>
                <select
                  value={selectedTeamRegion}
                  onChange={(e) => handleTeamRegionChange(e.target.value)}
                  disabled={loadingAvailable}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                >
                  <option value="all">{"\uD83D\uDDFA\uFE0F All Regions"}</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {getRegionIcon(r.name)} {r.name} {detectedRegion?.id === r.id ? '(Your Region)' : ''}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-gray-500">
                    {selectedTeamRegion === "all"
                      ? "Showing vendors from all regions"
                      : `Showing ${availableVendors.length} ${availableVendors.length === 1 ? "vendor" : "vendors"} in ${regions.find(r => r.id === selectedTeamRegion)?.name || 'selected region'}`
                    }
                  </p>
                  {selectedTeamRegion !== "all" && (
                    <button onClick={() => handleTeamRegionChange("all")} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      Clear filter
                    </button>
                  )}
                </div>
              </div>

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

                  {(availableTeamStates.length > 0 || availableTeamCities.length > 0) && (
                    <div className="mb-4 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Filter by State</label>
                        <select
                          value={selectedTeamState}
                          onChange={(e) => { setSelectedTeamState(e.target.value); setSelectedTeamCity("all"); }}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                        >
                          <option value="all">All States</option>
                          {availableTeamStates.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Filter by City</label>
                        <select
                          value={selectedTeamCity}
                          onChange={(e) => setSelectedTeamCity(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                        >
                          <option value="all">All Cities</option>
                          {availableTeamCities.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="mb-4">
                    <input
                      type="search"
                      value={teamSearchQuery}
                      onChange={(e) => setTeamSearchQuery(e.target.value)}
                      placeholder="Search vendors by name, email, phone, division, or role..."
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                  </div>

                  <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
                    <label className="flex items-center cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={(() => {
                          const newVendors = filteredTeamVendors.filter((v) => !(v as any).isExistingMember && !(v as any).confirmedElsewhere);
                          return newVendors.length > 0 && newVendors.every(v => selectedTeamMembers.has(v.id));
                        })()}
                        onChange={handleSelectAllTeam}
                        className="apple-checkbox"
                      />
                      <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                        Select All ({filteredTeamVendors.filter((v) => !(v as any).isExistingMember && !(v as any).confirmedElsewhere).length} new)
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleResendTeamConfirmations}
                        disabled={pendingTeamInvitesCount === 0 || resendingTeamConfirmations || savingTeam}
                        className={`apple-button ${pendingTeamInvitesCount === 0 || resendingTeamConfirmations || savingTeam ? "apple-button-disabled" : "apple-button-secondary"}`}
                      >
                        {resendingTeamConfirmations ? "Resending..." : `Resend Confirmation (${pendingTeamInvitesCount})`}
                      </button>
                      <button
                        onClick={handleSaveTeam}
                        disabled={selectedInvitableTeamMembersCount === 0 || savingTeam || allAvailableVendorsInvited || resendingTeamConfirmations}
                        className={`apple-button ${selectedInvitableTeamMembersCount === 0 || savingTeam || allAvailableVendorsInvited || resendingTeamConfirmations ? "apple-button-disabled" : "apple-button-primary"}`}
                      >
                        {savingTeam ? "Creating..." : allAvailableVendorsInvited ? "All Invited" : `Create Team (${selectedInvitableTeamMembersCount})`}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredTeamVendors.length === 0 && (
                      <div className="apple-empty-state !py-8">
                        <p className="text-sm text-gray-500">No vendors match your search</p>
                      </div>
                    )}
                    {filteredTeamVendors.map((v) => {
                      const firstName = safeDecrypt(v.profiles.first_name);
                      const lastName = safeDecrypt(v.profiles.last_name);
                      const phone = v.profiles.phone ? safeDecrypt(v.profiles.phone) : null;

                      return (
                        <div key={v.id} className="apple-vendor-card" onClick={() => !(v as any).isExistingMember && !(v as any).confirmedElsewhere && toggleTeamMember(v.id)}>
                          {!(v as any).isExistingMember && !(v as any).confirmedElsewhere ? (
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
                              alt={`${firstName} ${lastName}`}
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
                            {firstName?.charAt(0)}
                            {lastName?.charAt(0)}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-semibold text-gray-900">
                                {firstName} {lastName}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap justify-end">
                                {(v as any).confirmedElsewhere && (
                                  <div className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-md font-medium">
                                    Busy
                                  </div>
                                )}
                                {(v as any).isExistingMember && (
                                  <div className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-md font-medium">
                                    {(v as any).status === 'confirmed' ? 'Confirmed' :
                                     (v as any).status === 'declined' ? 'Declined' :
                                     'Invited'}
                                  </div>
                                )}
                                {(v as any).partialAvailability && (
                                  <div className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded-md font-medium flex items-center gap-1">
                                    <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    {fmt12h((v as any).availableFrom)}–{fmt12h((v as any).availableTo)}
                                  </div>
                                )}
                                {(v as any).isOutOfVenue && !(v as any).isExistingMember && (
                                  <div className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded-md font-medium">
                                    Out of Venue
                                  </div>
                                )}
                                {v.distance !== null ? (
                                  <div className={v.distance <= 50 ? "apple-distance-badge-nearby" : "apple-distance-badge"}>{v.distance} mi</div>
                                ) : (
                                  <div className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md">No location</div>
                                )}
                              </div>
                          </div>
                          <div className="text-gray-600 text-sm mb-1">
                            {v.email}
                            {phone && (
                              <>
                                <span className="mx-2 text-gray-400">.</span>
                                {phone}
                              </>
                            )}
                          {hasActiveAvailability(v) && v.availability_responded_at && (
                            <div className="text-xs text-green-700 mb-1">
                              Sent availability: {formatDateTime(v.availability_responded_at)}
                              {v.availability_scope_start && v.availability_scope_end && (
                                <> · Scope: {formatDateOnly(v.availability_scope_start)} to {formatDateOnly(v.availability_scope_end)}</>
                              )}
                            </div>
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
                                <span className="text-gray-400">.</span>
                              </>
                            )}
                            <span>{v.division}</span>
                            <span className="text-gray-400">.</span>
                            <span>{v.role}</span>
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

      {/* Delete Event Confirmation Modal */}
      {deleteConfirmEvent && (
        <div
          className="apple-modal-overlay"
          onClick={() => {
            if (!deletingEventId) setDeleteConfirmEvent(null);
          }}
        >
          <div
            className="apple-modal"
            style={{ maxWidth: "30rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="apple-modal-header">
              <h2 className="text-lg font-semibold text-gray-900">Delete Event</h2>
              <button
                className="apple-close-button"
                onClick={() => setDeleteConfirmEvent(null)}
                disabled={!!deletingEventId}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div style={{ padding: "1.25rem" }}>
              <p className="text-sm text-gray-700 mb-2">
                Are you sure you want to delete <strong>{deleteConfirmEvent.event_name}</strong>?
              </p>
              <p className="text-xs text-gray-500 mb-4">
                {deleteConfirmEvent.is_empty
                  ? "This action cannot be undone."
                  : "This will also permanently delete associated team, time, location, invitation, and payment data. This action cannot be undone."}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="apple-button apple-button-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setDeleteConfirmEvent(null)}
                  disabled={!!deletingEventId}
                >
                  Cancel
                </button>
                <button
                  className={`apple-button ${deletingEventId ? "apple-button-disabled" : "apple-button-primary"}`}
                  style={{ flex: 1, background: deletingEventId ? undefined : "#DC2626" }}
                  onClick={handleDeleteEvent}
                  disabled={!!deletingEventId}
                >
                  {deletingEventId ? "Deleting..." : "Delete Event"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertModal && (
        <div className="apple-modal-overlay" onClick={() => setAlertModal(null)}>
          <div
            className="apple-modal"
            style={{ maxWidth: "28rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="apple-modal-header">
              <h2 className="text-lg font-semibold text-gray-900">{alertModal.title}</h2>
              <button className="apple-close-button" onClick={() => setAlertModal(null)}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div style={{ padding: "1.25rem" }}>
              <div
                style={{
                  fontSize: 14,
                  borderRadius: 8,
                  padding: "0.75rem",
                  border: alertModal.type === "success" ? "1px solid #6EE7B7" : "1px solid #FCA5A5",
                  background: alertModal.type === "success" ? "#D1FAE5" : "#FEE2E2",
                  color: alertModal.type === "success" ? "#065F46" : "#991B1B",
                }}
              >
                {alertModal.message}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <button className="apple-button apple-button-primary" onClick={() => setAlertModal(null)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Check-In Warning Modal */}
      {checkInWarning && (
        <div className="apple-modal-overlay" onClick={() => setCheckInWarning(null)}>
          <div className="apple-modal" style={{ maxWidth: "28rem" }} onClick={(e) => e.stopPropagation()}>
            <div className="apple-modal-header">
              <h2 className="text-lg font-semibold text-gray-900">Wrong event?</h2>
              <button className="apple-close-button" onClick={() => setCheckInWarning(null)}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div style={{ padding: "1.25rem" }}>
              <p style={{ color: "#92400E", fontSize: 14, background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem" }}>
                <strong>{checkInWarning.event.event_name}</strong> is on <strong>{checkInWarning.event.event_date}</strong>, not today. Did you mean one of these?
              </p>
              {checkInWarning.similarEvents.map((sim) => (
                <button
                  key={sim.id}
                  className="apple-button apple-button-secondary"
                  style={{ width: "100%", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}
                  onClick={() => { setCheckInWarning(null); router.push(`/check-in?eventId=${sim.id}`); }}
                >
                  <span style={{ fontWeight: 600 }}>{sim.event_name}</span>
                  <span style={{ color: "#6B7280" }}>{sim.event_date} {sim.start_time?.slice(0, 5)}</span>
                </button>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="apple-button apple-button-secondary" style={{ flex: 1 }} onClick={() => setCheckInWarning(null)}>Cancel</button>
                <button className="apple-button apple-button-primary" style={{ flex: 1, background: "#DC2626" }} onClick={() => { const id = checkInWarning.event.id; setCheckInWarning(null); router.push(`/check-in?eventId=${id}`); }}>
                  Use {checkInWarning.event.event_date}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
