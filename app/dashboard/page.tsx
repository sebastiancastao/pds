"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
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
  event_date: string; // ISO date (YYYY-MM-DD)
  start_time: string; // HH:MM:SS
  end_time: string;   // HH:MM:SS
  ticket_sales: number | null;
  artist_share_percent: number;
  venue_share_percent: number;
  pds_share_percent: number;
  commission_pool: number | null;
  required_staff: number | null;
  confirmed_staff: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type Vendor = {
  id: string;
  email: string;
  role: string;
  division: string;
  is_active: boolean;
  distance: number | null;
  hasCoordinates?: boolean;
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
  status: 'active' | 'on_leave' | 'inactive';
  salary: number;
  profile_photo_url?: string | null;
  state: string;
  city: string | null;
  performance_score: number; // 0-100
  projects_completed: number;
  attendance_rate: number; // 0-100
  customer_satisfaction: number; // 0-100
};

type LeaveRequest = {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: 'vacation' | 'sick' | 'personal' | 'unpaid';
  start_date: string;
  end_date: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  days: number;
};

type Department = {
  name: string;
  employee_count: number;
  color: string;
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'events' | 'hr'>('events');
  const [hrView, setHrView] = useState<'overview' | 'employees' | 'leaves'>('overview');

  // Events tab state
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  // Vendor invitation state
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  // Team creation state
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
  const [selectedState, setSelectedState] = useState<string>('all');

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

  useEffect(() => {
    const load = async () => {
      setError("");
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/events', {
          method: 'GET',
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
          }
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load events');
        }
        setEvents(data.events || []);
      } catch (e: any) {
        setError(e.message || 'Failed to load events');
      }
      setLoading(false);
    };
    load();

    // Load HR mock data
    loadHRData();
  }, []);

  const loadHRData = async () => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock employees data
    const mockEmployees: Employee[] = [
      {
        id: '1',
        first_name: 'John',
        last_name: 'Smith',
        email: 'john.smith@company.com',
        phone: '(555) 123-4567',
        department: 'Engineering',
        position: 'Senior Developer',
        hire_date: '2022-01-15',
        status: 'active',
        salary: 95000,
        profile_photo_url: null,
        state: 'California',
        city: 'San Francisco',
        performance_score: 92,
        projects_completed: 24,
        attendance_rate: 98,
        customer_satisfaction: 95,
      },
      {
        id: '2',
        first_name: 'Sarah',
        last_name: 'Johnson',
        email: 'sarah.j@company.com',
        phone: '(555) 234-5678',
        department: 'Marketing',
        position: 'Marketing Manager',
        hire_date: '2021-06-20',
        status: 'active',
        salary: 85000,
        profile_photo_url: null,
        state: 'New York',
        city: 'New York',
        performance_score: 88,
        projects_completed: 18,
        attendance_rate: 96,
        customer_satisfaction: 91,
      },
      {
        id: '3',
        first_name: 'Michael',
        last_name: 'Chen',
        email: 'michael.chen@company.com',
        phone: '(555) 345-6789',
        department: 'Engineering',
        position: 'DevOps Engineer',
        hire_date: '2023-03-10',
        status: 'active',
        salary: 88000,
        profile_photo_url: null,
        state: 'California',
        city: 'Los Angeles',
        performance_score: 90,
        projects_completed: 15,
        attendance_rate: 97,
        customer_satisfaction: 93,
      },
      {
        id: '4',
        first_name: 'Emily',
        last_name: 'Davis',
        email: 'emily.d@company.com',
        phone: '(555) 456-7890',
        department: 'HR',
        position: 'HR Specialist',
        hire_date: '2020-11-05',
        status: 'on_leave',
        salary: 72000,
        profile_photo_url: null,
        state: 'Texas',
        city: 'Austin',
        performance_score: 85,
        projects_completed: 21,
        attendance_rate: 94,
        customer_satisfaction: 89,
      },
      {
        id: '5',
        first_name: 'David',
        last_name: 'Rodriguez',
        email: 'david.r@company.com',
        phone: '(555) 567-8901',
        department: 'Sales',
        position: 'Sales Representative',
        hire_date: '2023-08-22',
        status: 'active',
        salary: 65000,
        profile_photo_url: null,
        state: 'Texas',
        city: 'Dallas',
        performance_score: 87,
        projects_completed: 12,
        attendance_rate: 95,
        customer_satisfaction: 92,
      },
      {
        id: '6',
        first_name: 'Jennifer',
        last_name: 'Wilson',
        email: 'jennifer.w@company.com',
        phone: '(555) 678-9012',
        department: 'Engineering',
        position: 'Frontend Developer',
        hire_date: '2022-09-01',
        status: 'active',
        salary: 82000,
        profile_photo_url: null,
        state: 'New York',
        city: 'Brooklyn',
        performance_score: 91,
        projects_completed: 19,
        attendance_rate: 99,
        customer_satisfaction: 94,
      },
      {
        id: '7',
        first_name: 'Robert',
        last_name: 'Brown',
        email: 'robert.b@company.com',
        phone: '(555) 789-0123',
        department: 'Sales',
        position: 'Sales Manager',
        hire_date: '2020-03-15',
        status: 'active',
        salary: 92000,
        profile_photo_url: null,
        state: 'Florida',
        city: 'Miami',
        performance_score: 93,
        projects_completed: 28,
        attendance_rate: 97,
        customer_satisfaction: 96,
      },
      {
        id: '8',
        first_name: 'Amanda',
        last_name: 'Martinez',
        email: 'amanda.m@company.com',
        phone: '(555) 890-1234',
        department: 'Marketing',
        position: 'Content Strategist',
        hire_date: '2023-01-10',
        status: 'active',
        salary: 68000,
        profile_photo_url: null,
        state: 'Florida',
        city: 'Orlando',
        performance_score: 86,
        projects_completed: 14,
        attendance_rate: 96,
        customer_satisfaction: 90,
      },
    ];

    // Mock leave requests
    const mockLeaveRequests: LeaveRequest[] = [
      {
        id: '1',
        employee_id: '4',
        employee_name: 'Emily Davis',
        leave_type: 'vacation',
        start_date: '2025-11-01',
        end_date: '2025-11-10',
        status: 'pending',
        reason: 'Family vacation',
        days: 10,
      },
      {
        id: '2',
        employee_id: '2',
        employee_name: 'Sarah Johnson',
        leave_type: 'sick',
        start_date: '2025-10-28',
        end_date: '2025-10-29',
        status: 'approved',
        reason: 'Medical appointment',
        days: 2,
      },
      {
        id: '3',
        employee_id: '1',
        employee_name: 'John Smith',
        leave_type: 'personal',
        start_date: '2025-11-15',
        end_date: '2025-11-15',
        status: 'pending',
        reason: 'Personal matter',
        days: 1,
      },
    ];

    // Mock departments
    const mockDepartments: Department[] = [
      { name: 'Engineering', employee_count: 2, color: 'blue' },
      { name: 'Marketing', employee_count: 1, color: 'purple' },
      { name: 'Sales', employee_count: 1, color: 'green' },
      { name: 'HR', employee_count: 1, color: 'orange' },
    ];

    setEmployees(mockEmployees);
    setLeaveRequests(mockLeaveRequests);
    setDepartments(mockDepartments);
  };

  const loadAllVendors = async () => {
    if (events.length === 0) return;

    setLoadingVendors(true);
    setMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();

      // Get unique venues from all events
      const uniqueVenues = [...new Set(events.map(e => e.venue))];

      // Fetch vendors for all venues
      const vendorPromises = uniqueVenues.map(venue =>
        fetch(`/api/vendors?venue=${encodeURIComponent(venue)}`, {
          method: 'GET',
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
          }
        }).then(res => res.json())
      );

      const results = await Promise.all(vendorPromises);

      // Combine all vendors and track their minimum distance to any venue
      const vendorMap = new Map<string, Vendor>();

      results.forEach(result => {
        if (result.vendors) {
          result.vendors.forEach((vendor: Vendor) => {
            const existing = vendorMap.get(vendor.id);
            if (!existing) {
              vendorMap.set(vendor.id, vendor);
            } else if (vendor.distance !== null && existing.distance !== null) {
              if (vendor.distance < existing.distance) {
                vendorMap.set(vendor.id, vendor);
              }
            } else if (vendor.distance !== null && existing.distance === null) {
              vendorMap.set(vendor.id, vendor);
            }
          });
        }
      });

      // Convert to array and sort by distance
      const allVendors = Array.from(vendorMap.values()).sort((a, b) => {
        if (a.distance !== null && b.distance === null) return -1;
        if (a.distance === null && b.distance !== null) return 1;
        if (a.distance !== null && b.distance !== null) {
          return a.distance - b.distance;
        }
        const nameA = `${a.profiles.first_name} ${a.profiles.last_name}`.toLowerCase();
        const nameB = `${b.profiles.first_name} ${b.profiles.last_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      });
      setVendors(allVendors);
    } catch (err: any) {
      setMessage("Network error loading vendors");
    }
    setLoadingVendors(false);
  };

  const toggleVendorSelection = (vendorId: string) => {
    const newSelection = new Set(selectedVendors);
    if (newSelection.has(vendorId)) {
      newSelection.delete(vendorId);
    } else {
      newSelection.add(vendorId);
    }
    setSelectedVendors(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedVendors.size === vendors.length) {
      setSelectedVendors(new Set());
    } else {
      setSelectedVendors(new Set(vendors.map(v => v.id)));
    }
  };

  const handleInvite = async () => {
    if (selectedVendors.size === 0) {
      setMessage("Please select at least one vendor to invite");
      return;
    }

    setSubmitting(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/invitations/bulk-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          vendorIds: Array.from(selectedVendors),
          durationWeeks: 3
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`Successfully sent ${data.stats.sent} invitation(s)!`);
        setSelectedVendors(new Set());

        if (data.stats.failed > 0) {
          setMessage(`Sent ${data.stats.sent} invitations. ${data.stats.failed} failed.`);
        }
      } else {
        setMessage(data.error || "Failed to send invitations");
      }
    } catch (err: any) {
      setMessage("Network error sending invitations");
    } finally {
      setSubmitting(false);
      setTimeout(() => setMessage(""), 5000);
    }
  };

  const openVendorModal = () => {
    setShowVendorModal(true);
    setSelectedVendors(new Set());
    setMessage("");
    loadAllVendors();
  };

  const closeVendorModal = () => {
    setShowVendorModal(false);
    setVendors([]);
    setSelectedVendors(new Set());
    setMessage("");
  };

  const openTeamModal = async (event: EventItem) => {
    setSelectedEvent(event);
    setShowTeamModal(true);
    setSelectedTeamMembers(new Set());
    setTeamMessage("");
    setLoadingAvailable(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${event.id}/available-vendors`, {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      const data = await res.json();
      if (res.ok) {
        setAvailableVendors(data.vendors || []);
      } else {
        setTeamMessage("Failed to load available vendors");
      }
    } catch (err: any) {
      setTeamMessage("Network error loading available vendors");
    }
    setLoadingAvailable(false);
  };

  const closeTeamModal = () => {
    setShowTeamModal(false);
    setSelectedEvent(null);
    setAvailableVendors([]);
    setSelectedTeamMembers(new Set());
    setTeamMessage("");
  };

  const toggleTeamMember = (vendorId: string) => {
    const newSelection = new Set(selectedTeamMembers);
    if (newSelection.has(vendorId)) {
      newSelection.delete(vendorId);
    } else {
      newSelection.add(vendorId);
    }
    setSelectedTeamMembers(newSelection);
  };

  const handleSelectAllTeam = () => {
    if (selectedTeamMembers.size === availableVendors.length) {
      setSelectedTeamMembers(new Set());
    } else {
      setSelectedTeamMembers(new Set(availableVendors.map(v => v.id)));
    }
  };

  const handleSaveTeam = async () => {
    if (!selectedEvent) return;
    if (selectedTeamMembers.size === 0) {
      setTeamMessage("Please select at least one team member");
      return;
    }

    setSavingTeam(true);
    setTeamMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${selectedEvent.id}/team`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          vendorIds: Array.from(selectedTeamMembers)
        })
      });

      const data = await res.json();

      if (res.ok) {
        setTeamMessage(`Team created successfully with ${selectedTeamMembers.size} member${selectedTeamMembers.size !== 1 ? 's' : ''}!`);
        setTimeout(() => {
          closeTeamModal();
        }, 2000);
      } else {
        setTeamMessage(data.error || "Failed to create team");
      }
    } catch (err: any) {
      setTeamMessage("Network error creating team");
    } finally {
      setSavingTeam(false);
    }
  };

  const handleApproveLeave = (leaveId: string) => {
    setLeaveRequests(prev =>
      prev.map(req => req.id === leaveId ? { ...req, status: 'approved' as const } : req)
    );
  };

  const handleRejectLeave = (leaveId: string) => {
    setLeaveRequests(prev =>
      prev.map(req => req.id === leaveId ? { ...req, status: 'rejected' as const } : req)
    );
  };

  const getLeaveTypeColor = (type: string) => {
    switch (type) {
      case 'vacation': return 'text-blue-600 bg-blue-100';
      case 'sick': return 'text-red-600 bg-red-100';
      case 'personal': return 'text-purple-600 bg-purple-100';
      case 'unpaid': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  // Calculate statistics
  const eventStats = {
    totalEvents: events.length,
    activeEvents: events.filter(e => e.is_active).length,
    upcomingEvents: events.filter(e => new Date(e.event_date) >= new Date()).length,
    totalTicketSales: events.reduce((sum, e) => sum + (e.ticket_sales || 0), 0),
    totalCommissionPool: events.reduce((sum, e) => sum + (e.commission_pool || 0), 0),
    totalRequiredStaff: events.reduce((sum, e) => sum + (e.required_staff || 0), 0),
    totalConfirmedStaff: events.reduce((sum, e) => sum + (e.confirmed_staff || 0), 0),
  };

  const hrStats = {
    totalEmployees: employees.length,
    activeEmployees: employees.filter(e => e.status === 'active').length,
    onLeaveEmployees: employees.filter(e => e.status === 'on_leave').length,
    newHiresThisMonth: employees.filter(e => {
      const hireDate = new Date(e.hire_date);
      const now = new Date();
      return hireDate.getMonth() === now.getMonth() && hireDate.getFullYear() === now.getFullYear();
    }).length,
    pendingLeaves: leaveRequests.filter(l => l.status === 'pending').length,
    totalDepartments: departments.length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-12 px-6">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-5xl font-semibold text-gray-900 mb-3 tracking-tight">Dashboard</h1>
          <p className="text-lg text-gray-600 font-normal">
            {activeTab === 'events'
              ? 'Manage your events and invite vendors seamlessly.'
              : 'Manage employees, leave requests, and workforce analytics.'}
          </p>
        </div>

        {/* Main Tabs */}
        <div className="mb-8 border-b border-gray-200">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('events')}
              className={`pb-4 px-2 font-semibold text-lg transition-colors relative ${
                activeTab === 'events'
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Events
              {activeTab === 'events' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
              )}
            </button>
            <button
              onClick={() => setActiveTab('hr')}
              className={`pb-4 px-2 font-semibold text-lg transition-colors relative ${
                activeTab === 'hr'
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              HR
              {activeTab === 'hr' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
              )}
            </button>
          </div>
        </div>

        {/* Events Tab Content */}
        {activeTab === 'events' && (
          <>
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 mb-10">
              <Link href="/create-event">
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
                  loading || events.length === 0
                    ? "apple-button-disabled"
                    : "apple-button-secondary"
                }`}
              >
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Invite Vendors
              </button>
            </div>

            {/* Statistics Overview */}
            {!loading && !error && events.length > 0 && (
              <section className="mb-10">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight">Overview</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {/* Total Events Card */}
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

                  {/* Upcoming Events Card */}
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

                  {/* Ticket Sales Card */}
                  <div className="apple-stat-card apple-stat-card-green">
                    <div className="apple-stat-icon apple-stat-icon-green">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                      </svg>
                    </div>
                    <div className="apple-stat-content">
                      <div className="apple-stat-label">Ticket Sales</div>
                      <div className="apple-stat-value">${(eventStats.totalTicketSales / 1000).toFixed(1)}k</div>
                      <div className="apple-stat-sublabel">total revenue</div>
                    </div>
                  </div>

                  {/* Staff Card */}
                  <div className="apple-stat-card apple-stat-card-orange">
                    <div className="apple-stat-icon apple-stat-icon-orange">
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div className="apple-stat-content">
                      <div className="apple-stat-label">Staff</div>
                      <div className="apple-stat-value">{eventStats.totalConfirmedStaff}/{eventStats.totalRequiredStaff}</div>
                      <div className="apple-stat-sublabel">confirmed</div>
                    </div>
                  </div>
                </div>

                {/* Additional Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Commission Pool Card */}
                  <div className="apple-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Commission Pool</h3>
                      <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-2">
                      ${eventStats.totalCommissionPool.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">
                      Available for distribution across all events
                    </div>
                  </div>

                  {/* Staffing Progress Card */}
                  <div className="apple-card p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Staffing Progress</h3>
                      <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-sm mb-2">
                        <span className="text-gray-600">Confirmed</span>
                        <span className="font-semibold text-gray-900">
                          {eventStats.totalRequiredStaff > 0
                            ? Math.round((eventStats.totalConfirmedStaff / eventStats.totalRequiredStaff) * 100)
                            : 0}%
                        </span>
                      </div>
                      <div className="apple-progress-bar">
                        <div
                          className="apple-progress-fill"
                          style={{
                            width: eventStats.totalRequiredStaff > 0
                              ? `${(eventStats.totalConfirmedStaff / eventStats.totalRequiredStaff) * 100}%`
                              : '0%'
                          }}
                        ></div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-600">
                      {eventStats.totalConfirmedStaff} of {eventStats.totalRequiredStaff} positions filled
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Calendar Section */}
            <section className="mb-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight">Calendar</h2>
              {loading && (
                <div className="apple-card">
                  <div className="flex items-center justify-center py-16">
                    <div className="apple-spinner"></div>
                    <span className="ml-3 text-gray-600">Loading calendar...</span>
                  </div>
                </div>
              )}
              {error && (
                <div className="apple-alert apple-alert-error">{error}</div>
              )}
              {!loading && !error && (
                <div className="apple-card apple-calendar-wrapper">
                  <FullCalendar
                    plugins={[dayGridPlugin]}
                    initialView="dayGridMonth"
                    height="auto"
                    events={events.map(ev => {
                      const startIso = toIsoDateTime(ev.event_date, ev.start_time);
                      let endIso = toIsoDateTime(ev.event_date, ev.end_time);
                      if (!endIso && startIso) {
                        endIso = addHours(startIso, 1);
                      }
                      return {
                        id: ev.id,
                        title: ev.event_name,
                        start: startIso,
                        end: endIso,
                        allDay: false,
                      };
                    })}
                  />
                </div>
              )}
            </section>

            {/* Events List Section */}
            <section>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight">All Events</h2>
              {loading && (
                <div className="apple-card">
                  <div className="flex items-center justify-center py-16">
                    <div className="apple-spinner"></div>
                    <span className="ml-3 text-gray-600">Loading events...</span>
                  </div>
                </div>
              )}
              {error && (
                <div className="apple-alert apple-alert-error">{error}</div>
              )}
              {!loading && !error && events.length === 0 && (
                <div className="apple-card text-center py-16">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-lg">No events created yet</p>
                  <p className="text-gray-400 text-sm mt-2">Get started by creating your first event</p>
                </div>
              )}
              {!loading && !error && events.length > 0 && (
                <div className="space-y-4">
                  {events.map(ev => (
                    <div key={ev.id} className="apple-event-card group">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-xl font-semibold text-gray-900">{ev.event_name}</h3>
                            <span className={`apple-badge ${ev.is_active ? 'apple-badge-success' : 'apple-badge-neutral'}`}>
                              {ev.is_active ? 'Active' : 'Inactive'}
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
                            <span>{ev.start_time?.slice(0,5)} - {ev.end_time?.slice(0,5)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openTeamModal(ev)}
                            className="apple-button apple-button-secondary text-sm py-2 px-4"
                          >
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

        {/* HR Tab Content */}
        {activeTab === 'hr' && (
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Generate Report
              </button>
              <button className="apple-button apple-button-secondary">
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                View Calendar
              </button>
            </div>

            {/* HR Sub-tabs */}
            <div className="mb-8 border-b border-gray-200">
              <div className="flex gap-6">
                <button
                  onClick={() => setHrView('overview')}
                  className={`pb-4 px-2 font-semibold transition-colors relative ${
                    hrView === 'overview'
                      ? 'text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Overview
                  {hrView === 'overview' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
                  )}
                </button>
                <button
                  onClick={() => setHrView('employees')}
                  className={`pb-4 px-2 font-semibold transition-colors relative ${
                    hrView === 'employees'
                      ? 'text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Employees
                  {hrView === 'employees' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
                  )}
                </button>
                <button
                  onClick={() => setHrView('leaves')}
                  className={`pb-4 px-2 font-semibold transition-colors relative ${
                    hrView === 'leaves'
                      ? 'text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Leave Requests
                  {hrStats.pendingLeaves > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
                      {hrStats.pendingLeaves}
                    </span>
                  )}
                  {hrView === 'leaves' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
                  )}
                </button>
              </div>
            </div>

            {/* HR Overview */}
            {hrView === 'overview' && (
              <div className="space-y-8">
                {/* Statistics Cards */}
                <section>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight">Key Metrics</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Total Employees */}
                    <div className="apple-stat-card apple-stat-card-blue">
                      <div className="apple-stat-icon apple-stat-icon-blue">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </div>
                      <div className="apple-stat-content">
                        <div className="apple-stat-label">Total Employees</div>
                        <div className="apple-stat-value">{hrStats.totalEmployees}</div>
                        <div className="apple-stat-sublabel">{hrStats.activeEmployees} active</div>
                      </div>
                    </div>

                    {/* Departments */}
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

                    {/* New Hires */}
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

                    {/* Pending Leaves */}
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

                {/* Department Breakdown */}
                <section>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight">Department Overview</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {departments.map((dept) => (
                      <div key={dept.name} className="apple-card p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900">{dept.name}</h3>
                          <div className={`w-3 h-3 rounded-full bg-${dept.color}-500`}></div>
                        </div>
                        <div className="text-3xl font-bold text-gray-900 mb-2">
                          {dept.employee_count}
                        </div>
                        <div className="text-sm text-gray-600">
                          {dept.employee_count === 1 ? 'employee' : 'employees'}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Recent Leave Requests */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Recent Leave Requests</h2>
                    <button
                      onClick={() => setHrView('leaves')}
                      className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                    >
                      View All →
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
                          {leaveRequests.slice(0, 3).map((request) => (
                            <tr key={request.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-4">
                                <div className="font-medium text-gray-900">{request.employee_name}</div>
                              </td>
                              <td className="p-4">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getLeaveTypeColor(request.leave_type)}`}>
                                  {request.leave_type}
                                </span>
                              </td>
                              <td className="p-4 text-gray-600 text-sm">
                                {new Date(request.start_date).toLocaleDateString()} - {new Date(request.end_date).toLocaleDateString()}
                              </td>
                              <td className="p-4 text-gray-900 font-medium">{request.days}</td>
                              <td className="p-4">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                  request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                  request.status === 'approved' ? 'bg-green-100 text-green-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {request.status}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                {request.status === 'pending' && (
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => handleApproveLeave(request.id)}
                                      className="text-green-600 hover:text-green-700 font-medium text-sm"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      onClick={() => handleRejectLeave(request.id)}
                                      className="text-red-600 hover:text-red-700 font-medium text-sm"
                                    >
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

            {/* HR Employees View */}
            {hrView === 'employees' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">All Employees</h2>
                  <div className="flex items-center gap-3">
                    <input
                      type="search"
                      placeholder="Search employees..."
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                      <option value="">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept.name} value={dept.name}>{dept.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {employees.map((employee) => (
                    <div key={employee.id} className="apple-card p-6 hover:shadow-lg transition-shadow">
                      <div className="flex items-start gap-4">
                        <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-xl flex-shrink-0">
                          {employee.first_name.charAt(0)}{employee.last_name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 mb-1">
                            {employee.first_name} {employee.last_name}
                          </h3>
                          <p className="text-sm text-gray-600 mb-2">{employee.position}</p>
                          <div className="space-y-1">
                            <div className="flex items-center text-xs text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                              {employee.department}
                            </div>
                            <div className="flex items-center text-xs text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              {employee.email}
                            </div>
                            {employee.phone && (
                              <div className="flex items-center text-xs text-gray-500">
                                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                                {employee.phone}
                              </div>
                            )}
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              employee.status === 'active' ? 'bg-green-100 text-green-700' :
                              employee.status === 'on_leave' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {employee.status === 'active' ? 'Active' :
                               employee.status === 'on_leave' ? 'On Leave' : 'Inactive'}
                            </span>
                            <span className="text-xs text-gray-500">
                              Since {new Date(employee.hire_date).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* HR Leave Requests View */}
            {hrView === 'leaves' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Leave Requests</h2>
                  <select className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div className="space-y-4">
                  {leaveRequests.map((request) => (
                    <div key={request.id} className="apple-card p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h3 className="text-xl font-semibold text-gray-900">{request.employee_name}</h3>
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getLeaveTypeColor(request.leave_type)}`}>
                              {request.leave_type}
                            </span>
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              request.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                              request.status === 'approved' ? 'bg-green-100 text-green-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {request.status}
                            </span>
                          </div>
                          <div className="space-y-2 text-sm text-gray-600">
                            <div className="flex items-center">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              {new Date(request.start_date).toLocaleDateString()} - {new Date(request.end_date).toLocaleDateString()}
                              <span className="ml-2 font-medium text-gray-900">({request.days} day{request.days !== 1 ? 's' : ''})</span>
                            </div>
                            <div className="flex items-start">
                              <svg className="w-4 h-4 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span>{request.reason}</span>
                            </div>
                          </div>
                        </div>
                        {request.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleApproveLeave(request.id)}
                              className="apple-button apple-button-primary text-sm"
                            >
                              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectLeave(request.id)}
                              className="apple-button apple-button-secondary text-sm"
                            >
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

      {/* Vendor Invitation Modal */}
      {showVendorModal && (
        <div className="apple-modal-overlay">
          <div className="apple-modal">
            {/* Modal Header */}
            <div className="apple-modal-header">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Invite Vendors</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Invite vendors to work across multiple events for 3 weeks
                </p>
              </div>
              <button
                onClick={closeVendorModal}
                className="apple-close-button"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="apple-modal-body">

              {message && (
                <div className={`apple-alert ${
                  message.includes('success') || message.includes('Successfully')
                    ? 'apple-alert-success'
                    : 'apple-alert-error'
                }`}>
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
                  <div className="apple-spinner mb-4"></div>
                  <p className="text-gray-600">Loading vendors...</p>
                </div>
              ) : vendors.length === 0 ? (
                <div className="apple-empty-state">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-medium text-gray-600">No vendors available</p>
                  <p className="text-sm text-gray-500 mt-2">
                    No active vendors found for your events
                  </p>
                </div>
              ) : (
                <>
                  <div className="apple-info-banner">
                    <svg className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-gray-700">
                      <div className="font-semibold mb-1">3-Week Work Period</div>
                      <div className="text-xs text-gray-600">
                        Selected vendors will receive invitations to work across all your events for the next 3 weeks
                      </div>
                    </div>
                  </div>

                  <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={selectedVendors.size === vendors.length && vendors.length > 0}
                          onChange={handleSelectAll}
                          className="apple-checkbox"
                        />
                        <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                          Select All ({vendors.length} vendors)
                        </span>
                      </label>
                      <div className="flex items-center text-xs text-gray-500">
                        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        </svg>
                        Sorted by proximity
                      </div>
                    </div>
                    <button
                      onClick={handleInvite}
                      disabled={selectedVendors.size === 0 || submitting}
                      className={`apple-button ${
                        selectedVendors.size === 0 || submitting
                          ? "apple-button-disabled"
                          : "apple-button-primary"
                      }`}
                    >
                      {submitting ? "Sending..." : `Send ${selectedVendors.size} Invitation${selectedVendors.size !== 1 ? 's' : ''}`}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {vendors.map((vendor) => (
                      <div
                        key={vendor.id}
                        className="apple-vendor-card"
                        onClick={() => toggleVendorSelection(vendor.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedVendors.has(vendor.id)}
                          onChange={() => toggleVendorSelection(vendor.id)}
                          className="apple-checkbox"
                        />
                        {vendor.profiles.profile_photo_url ? (
                          <img
                            src={vendor.profiles.profile_photo_url}
                            alt={`${vendor.profiles.first_name} ${vendor.profiles.last_name}`}
                            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              if (target.nextSibling) {
                                (target.nextSibling as HTMLElement).style.display = 'flex';
                              }
                            }}
                          />
                        ) : null}
                        <div
                          className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0"
                          style={{ display: vendor.profiles.profile_photo_url ? 'none' : 'flex' }}
                        >
                          {vendor.profiles.first_name?.charAt(0)}{vendor.profiles.last_name?.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-900">
                              {vendor.profiles.first_name} {vendor.profiles.last_name}
                            </div>
                            {vendor.distance !== null ? (
                              <div className="apple-distance-badge">
                                {vendor.distance} mi
                              </div>
                            ) : (
                              <div className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md">
                                No location
                              </div>
                            )}
                          </div>
                          <div className="text-gray-600 text-sm mb-1">
                            {vendor.email}
                            {vendor.profiles.phone && (
                              <>
                                <span className="mx-2 text-gray-400">•</span>
                                {vendor.profiles.phone}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {vendor.profiles.city && vendor.profiles.state && (
                              <>
                                <span className="flex items-center">
                                  <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  </svg>
                                  {vendor.profiles.city}, {vendor.profiles.state}
                                </span>
                                <span className="text-gray-400">•</span>
                              </>
                            )}
                            <span>{vendor.division}</span>
                            <span className="text-gray-400">•</span>
                            <span>{vendor.role}</span>
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
            {/* Modal Header */}
            <div className="apple-modal-header">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Create Team</h2>
                <p className="text-gray-600 text-sm mt-1">
                  {selectedEvent.event_name} - {selectedEvent.event_date}
                </p>
              </div>
              <button
                onClick={closeTeamModal}
                className="apple-close-button"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="apple-modal-body">
              {teamMessage && (
                <div className={`apple-alert mb-6 ${
                  teamMessage.includes('success') || teamMessage.includes('Successfully')
                    ? 'apple-alert-success'
                    : 'apple-alert-error'
                }`}>
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
                  <div className="apple-spinner mb-4"></div>
                  <p className="text-gray-600">Loading available vendors...</p>
                </div>
              ) : availableVendors.length === 0 ? (
                <div className="apple-empty-state">
                  <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-lg font-medium text-gray-600">No Vendors Available</p>
                  <p className="text-sm text-gray-500 mt-2">
                    No vendors have confirmed their availability for this event date
                  </p>
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
                        {availableVendors.length} vendor{availableVendors.length !== 1 ? 's have' : ' has'} confirmed confirmed availability for this date
                      </div>
                    </div>
                  </div>

                  <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
                    <label className="flex items-center cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedTeamMembers.size === availableVendors.length && availableVendors.length > 0}
                        onChange={handleSelectAllTeam}
                        className="apple-checkbox"
                      />
                      <span className="font-medium text-gray-700 group-hover:text-gray-900 transition-colors">
                        Select All ({availableVendors.length})
                      </span>
                    </label>
                    <button
                      onClick={handleSaveTeam}
                      disabled={selectedTeamMembers.size === 0 || savingTeam}
                      className={`apple-button ${
                        selectedTeamMembers.size === 0 || savingTeam
                          ? "apple-button-disabled"
                          : "apple-button-primary"
                      }`}
                    >
                      {savingTeam ? "Creating..." : `Create Team (${selectedTeamMembers.size})`}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {availableVendors.map((vendor) => (
                      <div
                        key={vendor.id}
                        className="apple-vendor-card"
                        onClick={() => toggleTeamMember(vendor.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTeamMembers.has(vendor.id)}
                          onChange={() => toggleTeamMember(vendor.id)}
                          className="apple-checkbox"
                        />
                        {vendor.profiles.profile_photo_url ? (
                          <img
                            src={vendor.profiles.profile_photo_url}
                            alt={`${vendor.profiles.first_name} ${vendor.profiles.last_name}`}
                            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              if (target.nextSibling) {
                                (target.nextSibling as HTMLElement).style.display = 'flex';
                              }
                            }}
                          />
                        ) : null}
                        <div
                          className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0"
                          style={{ display: vendor.profiles.profile_photo_url ? 'none' : 'flex' }}
                        >
                          {vendor.profiles.first_name?.charAt(0)}{vendor.profiles.last_name?.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold text-gray-900">
                              {vendor.profiles.first_name} {vendor.profiles.last_name}
                            </div>
                            {vendor.distance !== null ? (
                              <div className="apple-distance-badge">
                                {vendor.distance} mi
                              </div>
                            ) : (
                              <div className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md">
                                No location
                              </div>
                            )}
                          </div>
                          <div className="text-gray-600 text-sm mb-1">
                            {vendor.email}
                            {vendor.profiles.phone && (
                              <>
                                <span className="mx-2 text-gray-400">•</span>
                                {vendor.profiles.phone}
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {vendor.profiles.city && vendor.profiles.state && (
                              <>
                                <span className="flex items-center">
                                  <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  </svg>
                                  {vendor.profiles.city}, {vendor.profiles.state}
                                </span>
                                <span className="text-gray-400">•</span>
                              </>
                            )}
                            <span>{vendor.division}</span>
                            <span className="text-gray-400">•</span>
                            <span>{vendor.role}</span>
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