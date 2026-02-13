// app/(dashboard)/dashboard/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import { geocodeAddress, getUserRegion } from "@/lib/geocoding";
import { safeDecrypt } from "@/lib/encryption";
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

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"events" | "hr">("events");
  const [hrView, setHrView] = useState<"overview" | "employees" | "leaves">("overview");

  // Auth & Access Control
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [userRole, setUserRole] = useState<string>("");
  const [userRegionId, setUserRegionId] = useState<string | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedRegion, setDetectedRegion] = useState<{ id: string; name: string } | null>(null);

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
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [showOnlyPendingAvailability, setShowOnlyPendingAvailability] = useState(false);
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);

  // Team creation for a given event
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [availableVendors, setAvailableVendors] = useState<Vendor[]>([]);
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<Set<string>>(new Set());
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const [selectedTeamRegion, setSelectedTeamRegion] = useState<string>("all");
  const [teamSearchQuery, setTeamSearchQuery] = useState("");

  // Staff predictions for events
  const [predictions, setPredictions] = useState<Record<string, { predictedStaff: number; confidence: number; loading: boolean }>>({});

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
        if (!query) return true;
        const fullName = `${v.profiles.first_name || ""} ${v.profiles.last_name || ""}`.trim().toLowerCase();
        return fullName.includes(query) || v.email.toLowerCase().includes(query);
      });
  }, [vendors, vendorSearchQuery, showOnlyPendingAvailability, hasActiveAvailability]);

  const selectedVisibleVendorCount = filteredAndSortedVendors.filter((v) => selectedVendors.has(v.id)).length;
  const allVisibleVendorsSelected =
    filteredAndSortedVendors.length > 0 && selectedVisibleVendorCount === filteredAndSortedVendors.length;
  const filteredTeamVendors = useMemo(() => {
    const query = teamSearchQuery.trim().toLowerCase();
    if (!query) return availableVendors;

    return availableVendors.filter((v) => {
      const firstName = safeDecrypt(v.profiles.first_name || "");
      const lastName = safeDecrypt(v.profiles.last_name || "");
      const phone = v.profiles.phone ? safeDecrypt(v.profiles.phone) : "";
      const fullName = `${firstName} ${lastName}`.trim().toLowerCase();
      return (
        fullName.includes(query) ||
        v.email.toLowerCase().includes(query) ||
        phone.toLowerCase().includes(query) ||
        (v.division || "").toLowerCase().includes(query) ||
        (v.role || "").toLowerCase().includes(query)
      );
    });
  }, [availableVendors, teamSearchQuery]);

  // HR tab state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedState, setSelectedState] = useState<string>("all");
  const [selectedEmployeeRegion, setSelectedEmployeeRegion] = useState<string>("all");
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeesError, setEmployeesError] = useState<string>("");

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
      console.error("[DASHBOARD] Error loading prediction:", err);
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
      console.log('[DASHBOARD-HR] ð Loading employees with filters:', { stateFilter, regionFilter });
      const res = await fetch(`/api/employees${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load employees");
      console.log('[DASHBOARD-HR] ð¦ Employees loaded:', {
        count: data.employees?.length || 0,
        region: data.region?.name || 'all',
        geo_filtered: data.geo_filtered
      });
      setEmployees(data.employees || []);
      if (data.stats?.states) setAvailableStates(data.stats.states);
    } catch (err: any) {
      console.error('[DASHBOARD-HR] â Error loading employees:', err);
      setEmployeesError(err.message || "Failed to load employees");
    }
    setLoadingEmployees(false);
  }, []);

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

        // Fetch profile data - try both possible foreign key columns
        console.log('[DASHBOARD] ð Fetching profile for user:', session.user.id);

        // Debug: Check what's in profiles table
        const debugProfiles = await supabase
          .from('profiles')
          .select('id, user_id, latitude, longitude')
          .limit(3);

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
          .select('*')
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
            .select('*')
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

        // Only allow manager and exec users
        const role = userData.role as string;
        const regionId = userData.region_id as string | null;

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

        if (role !== 'manager' && role !== 'exec') {
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
                if (role === 'manager') {
                  console.log('[DASHBOARD] ð¤ Setting manager region filters to:', userRegion.id);
                  setSelectedRegion(userRegion.id);
                  setSelectedEmployeeRegion(userRegion.id);
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
                if (role === 'manager') {
                  setSelectedRegion(region.id);
                  setSelectedEmployeeRegion(region.id);
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
                maximumAge: 300000, // 5 minutes cache
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
                if (role === 'manager') {
                  console.log('[DASHBOARD] ð¤ Setting manager region filters to:', userRegion.id);
                  setSelectedRegion(userRegion.id);
                  setSelectedEmployeeRegion(userRegion.id);
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

    const loadHRMockData = async () => {
      // Replace with real sources as you wire APIs
      await new Promise((r) => setTimeout(r, 200));
      const mockLeaves: LeaveRequest[] = [
        { id: "1", employee_id: "4", employee_name: "Emily Davis", leave_type: "vacation", start_date: "2025-11-01", end_date: "2025-11-10", status: "pending", reason: "Family vacation", days: 10 },
        { id: "2", employee_id: "2", employee_name: "Sarah Johnson", leave_type: "sick", start_date: "2025-10-28", end_date: "2025-10-29", status: "approved", reason: "Medical appointment", days: 2 },
        { id: "3", employee_id: "1", employee_name: "John Smith", leave_type: "personal", start_date: "2025-11-15", end_date: "2025-11-15", status: "pending", reason: "Personal matter", days: 1 },
      ];
      const mockDepts: Department[] = [
        { name: "Engineering", employee_count: 2, color: "blue" },
        { name: "Marketing", employee_count: 1, color: "purple" },
        { name: "Sales", employee_count: 1, color: "green" },
        { name: "HR", employee_count: 1, color: "orange" },
      ];
      setLeaveRequests(mockLeaves);
      setDepartments(mockDepts);
    };

    // For managers, use the detected region from geocoding (if available)
    // Otherwise, fall back to database region_id or 'all' for executives
    const initialRegion = userRole === 'manager' && detectedRegion
      ? detectedRegion.id
      : (userRole === 'manager' && userRegionId ? userRegionId : 'all');

    console.log('[DASHBOARD] ð Initial load with region:', initialRegion, { userRole, detectedRegion: detectedRegion?.name, userRegionId });

    loadEvents();
    loadEmployees('all', initialRegion);
    loadHRMockData();
    loadRegions();
  }, [isAuthorized, loadEmployees, userRole, userRegionId, detectedRegion]);

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

  const hrStats = {
    totalEmployees: employees.length,
    activeEmployees: employees.filter((e) => e.status === "active").length,
    onLeaveEmployees: employees.filter((e) => e.status === "on_leave").length,
    newHiresThisMonth: employees.filter((e) => {
      const d = new Date(e.hire_date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
    pendingLeaves: leaveRequests.filter((l) => l.status === "pending").length,
    totalDepartments: departments.length,
  };

  // Region + vendors helpers
  const loadRegions = async () => {
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
        setRegions(data.regions || []);
      } else {
        console.error('[DASHBOARD] â Failed to load regions, status:', res.status);
      }
    } catch (err) {
      console.error("[DASHBOARD] â Failed to load regions:", err);
    }
  };

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
    // For managers, use their detected region from geocoding; for execs, show all
    const initialRegion = userRole === 'manager' && detectedRegion
      ? detectedRegion.id
      : (userRole === 'manager' && userRegionId ? userRegionId : "all");
    console.log('[DASHBOARD] ð Opening vendor modal with region:', initialRegion, { userRole, detectedRegion: detectedRegion?.name });
    setSelectedRegion(initialRegion);
    setMessage("");
    loadRegions();
    loadAllVendors(initialRegion);
  };
  const closeVendorModal = () => {
    setShowVendorModal(false);
    setVendors([]);
    setSelectedVendors(new Set());
    setVendorSearchQuery("");
    setMessage("");
  };
  const handleRegionChange = async (newRegion: string) => {
    console.log('[DASHBOARD] ð Region changed:', { from: selectedRegion, to: newRegion, userRole });
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

  const loadTeamVendors = async (event: EventItem, regionId: string = "all") => {
    setLoadingAvailable(true);
    console.log('[DASHBOARD-TEAM] ð Loading team vendors for event:', event.id, 'with regionId:', regionId);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Use geographic filtering when a specific region is selected
      // This ensures vendors are filtered by geographic boundaries (radius from region center)
      const useGeoFilter = regionId !== "all";
      const params = new URLSearchParams();
      if (regionId && regionId !== "all") {
        params.append("region_id", regionId);
        if (useGeoFilter) {
          params.append("geo_filter", "true");
        }
      }
      const url = `/api/events/${event.id}/available-vendors${params.toString() ? `?${params.toString()}` : ""}`;
      console.log('[DASHBOARD-TEAM] ð¡ Fetching available vendors from:', url, { useGeoFilter, regionId });

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
    setTeamMessage("");
    setSelectedTeamRegion("all");
    setTeamSearchQuery("");
  };
  const toggleTeamMember = (id: string) => {
    const s = new Set(selectedTeamMembers);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedTeamMembers(s);
  };
  const handleSelectAllTeam = () => {
    const visibleNewVendorIds = filteredTeamVendors
      .filter((v) => !(v as any).isExistingMember)
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
    // Prevent managers from changing regions
    if (userRole === 'manager') {
      console.warn('[DASHBOARD-HR] â ï¸ Managers cannot change regions');
      return;
    }
    console.log('[DASHBOARD-HR] ð Region changed:', { from: selectedEmployeeRegion, to: newRegion });
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
              <Link
                href="/global-calendar"
                className="apple-button apple-button-secondary flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Global Calendar
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* HR TAB */}
        {activeTab === "hr" && (
          <>
            {/* Quick Actions */}
            <div className="flex flex-wrap gap-3 mb-10">
              <button className="apple-button apple-button-primary">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Add Employee
              </button>
              <button className="apple-button apple-button-secondary">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                View Calendar
              </button>
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
                <button
                  onClick={() => setHrView("leaves")}
                  className={`pb-4 px-2 font-semibold transition-colors relative ${
                    hrView === "leaves" ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Leave Requests
                  {hrStats.pendingLeaves > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
                      {hrStats.pendingLeaves}
                    </span>
                  )}
                  {hrView === "leaves" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
                </button>
              </div>
            </div>

            {/* HR Overview */}
            {hrView === "overview" && (
              <div className="space-y-8">
                <section>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4 keeping-tight">Key Metrics</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="apple-stat-card apple-stat-card-blue">
                      <div className="apple-stat-icon apple-stat-icon-blue">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </div>
                      <div className="apple-stat-content">
                        <div className="apple-stat-label">Total Employees</div>
                        <div className="apple-stat-value">{hrStats.totalEmployees}</div>
                        <div className="apple-stat-sublabel">{hrStats.activeEmployees} active</div>
                      </div>
                    </div>
                    <div className="apple-stat-card apple-stat-card-purple">
                      <div className="apple-stat-icon apple-stat-icon-purple">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div className="apple-stat-content">
                        <div className="apple-stat-label">Departments</div>
                        <div className="apple-stat-value">{hrStats.totalDepartments}</div>
                        <div className="apple-stat-sublabel">active divisions</div>
                      </div>
                    </div>
                    <div className="apple-stat-card apple-stat-card-green">
                      <div className="apple-stat-icon apple-stat-icon-green">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                        </svg>
                      </div>
                      <div className="apple-stat-content">
                        <div className="apple-stat-label">New Hires</div>
                        <div className="apple-stat-value">{hrStats.newHiresThisMonth}</div>
                        <div className="apple-stat-sublabel">this month</div>
                      </div>
                    </div>
                    <div className="apple-stat-card apple-stat-card-orange">
                      <div className="apple-stat-icon apple-stat-icon-orange">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="apple-stat-content">
                        <div className="apple-stat-label">Pending Leaves</div>
                        <div className="apple-stat-value">{hrStats.pendingLeaves}</div>
                        <div className="apple-stat-sublabel">need approval</div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Departments */}
                <section>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4 keeping-tight">Department Overview</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {departments.map((dept) => (
                      <div key={dept.name} className="apple-card p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">{dept.name}</h3>
                          <div className={`w-3 h-3 rounded-full bg-${dept.color}-500`} />
                        </div>
                        <div className="text-3xl font-bold text-gray-900 mb-2">{dept.employee_count}</div>
                        <div className="text-sm text-gray-600">{dept.employee_count === 1 ? "employee" : "employees"}</div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Recent Leaves */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Recent Leave Requests</h2>
                    <button onClick={() => setHrView("leaves")} className="text-blue-600 hover:text-blue-700 font-medium text-sm">
                      View All â
                    </button>
                  </div>
                  <div className="apple-card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left p-4 font-semibold text-gray-700">Employee</th>
                            <th className="text-left p-4 font-semibold text-gray-700">Type</th>
                            <th className="text-left p-4 font-semibold text-gray-700">Dates</th>
                            <th className="text-left p-4 font-semibold text-gray-700">Days</th>
                            <th className="text-left p-4 font-semibold text-gray-700">Status</th>
                            <th className="text-right p-4 font-semibold text-gray-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {leaveRequests.slice(0, 3).map((r) => (
                            <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-4">
                                <div className="font-medium text-gray-900">{r.employee_name}</div>
                              </td>
                              <td className="p-4">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getLeaveTypeColor(r.leave_type)}`}>
                                  {r.leave_type}
                                </span>
                              </td>
                              <td className="p-4 text-gray-600 text-sm">
                                {new Date(r.start_date).toLocaleDateString()} - {new Date(r.end_date).toLocaleDateString()}
                              </td>
                              <td className="p-4 text-gray-900 font-medium">{r.days}</td>
                              <td className="p-4">
                                <span
                                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                                    r.status === "pending"
                                      ? "bg-yellow-100 text-yellow-700"
                                      : r.status === "approved"
                                      ? "bg-green-100 text-green-700"
                                      : "bg-red-100 text-red-700"
                                  }`}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                {r.status === "pending" && (
                                  <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => handleApproveLeave(r.id)} className="text-green-600 hover:text-green-700 font-medium text-sm">
                                      Approve
                                    </button>
                                    <button onClick={() => handleRejectLeave(r.id)} className="text-red-600 hover:text-red-700 font-medium text-sm">
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
                    {/* Region filter - Show for both Managers and Executives */}
                    <select
                      value={selectedEmployeeRegion}
                      onChange={(e) => handleEmployeeRegionChange(e.target.value)}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">{"\uD83D\uDDFA\uFE0F All Regions"}</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {getRegionIcon(r.name)} {r.name} {detectedRegion?.id === r.id && userRole === 'manager' ? '(Your Region)' : ''}
                        </option>
                      ))}
                    </select>
                    {/* State and Department filters - Only show for Executives */}
                    {userRole === 'exec' && (
                      <>
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
                      </>
                    )}
                  </div>
                </div>

                {/* Manager Region Info Banner */}
                {userRole === 'manager' && detectedRegion && selectedEmployeeRegion !== "all" && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                    <div className="flex items-center text-xs text-blue-800">
                      <svg className="w-4 h-4 mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>
                        Your region was auto-detected: <strong>{detectedRegion.name}</strong> .
                        Showing {employees.length} {employees.length === 1 ? "employee" : "employees"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Executive Filter Banner */}
                {userRole === 'exec' && (selectedState !== "all" || selectedEmployeeRegion !== "all") && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center text-sm text-blue-800">
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                      </svg>
                      <span className="font-medium">Filters Active:</span>
                      {selectedEmployeeRegion !== "all" && (
                        <span className="ml-1">{regions.find(r => r.id === selectedEmployeeRegion)?.name || selectedEmployeeRegion}</span>
                      )}
                      {selectedEmployeeRegion !== "all" && selectedState !== "all" && <span className="mx-1">.</span>}
                      {selectedState !== "all" && <span>{selectedState}</span>}
                      <span className="ml-2 text-blue-600">. {employees.length} {employees.length === 1 ? "employee" : "employees"} found</span>
                    </div>
                    <button
                      onClick={() => {
                        handleStateFilterChange("all");
                        handleEmployeeRegionChange("all");
                      }}
                      className="text-xs text-blue-700 hover:text-blue-900 font-medium flex items-center"
                    >
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

            {/* HR Leaves */}
            {hrView === "leaves" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Leave Requests</h2>
                  <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div className="space-y-4">
                  {leaveRequests.map((r) => (
                    <div key={r.id} className="apple-card p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="text-xl font-semibold text-gray-900">{r.employee_name}</h3>
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getLeaveTypeColor(r.leave_type)}`}>
                              {r.leave_type}
                            </span>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                r.status === "pending"
                                  ? "bg-yellow-100 text-yellow-700"
                                  : r.status === "approved"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {r.status}
                            </span>
                          </div>
                          <div className="space-y-2 text-sm text-gray-600">
                            <div className="flex items-center">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {new Date(r.start_date).toLocaleDateString()} - {new Date(r.end_date).toLocaleDateString()}
                              <span className="ml-2 font-medium text-gray-900">({r.days} day{r.days !== 1 ? "s" : ""})</span>
                            </div>
                            <div className="flex items-start">
                              <svg className="w-4 h-4 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span>{r.reason}</span>
                            </div>
                          </div>
                        </div>
                        {r.status === "pending" && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleApproveLeave(r.id)} className="apple-button apple-button-primary text-sm">
                              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Approve
                            </button>
                            <button onClick={() => handleRejectLeave(r.id)} className="apple-button apple-button-secondary text-sm">
                              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {leaveRequests.length === 0 && (
                  <div className="apple-card text-center py-16">
                    <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 text-lg">No leave requests</p>
                    <p className="text-gray-400 text-sm mt-2">All caught up!</p>
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
                      <div className="font-semibold mb-1">3-Week Work Period</div>
                      <div className="text-xs text-gray-600">Weâll invite selected vendors to share availability</div>
                    </div>
                  </div>

                  {/* Region Filter - For both managers and executives */}
                  <div className="mb-6">
                    {/* Auto-detection notice for managers */}
                    {userRole === 'manager' && detectedRegion && (
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
                      teamMessage.toLowerCase().includes("awaiting confirmation")
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
                          const newVendors = filteredTeamVendors.filter((v) => !(v as any).isExistingMember);
                          return newVendors.length > 0 && newVendors.every(v => selectedTeamMembers.has(v.id));
                        })()}
                        onChange={handleSelectAllTeam}
                        className="apple-checkbox"
                      />
                      <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                        Select All ({filteredTeamVendors.filter((v) => !(v as any).isExistingMember).length} new)
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
    </div>
  );
}
