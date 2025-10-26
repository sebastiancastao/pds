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
  distance: number;
  profiles: {
    first_name: string;
    last_name: string;
    phone: string | null;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
  };
};

export default function DashboardPage() {
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

  const toIsoDateTime = (dateStr: string, timeStr?: string | null) => {
    if (!dateStr) return undefined;
    if (!timeStr) return new Date(`${dateStr}T00:00:00`).toISOString();
    // Construct a local time ISO string; FullCalendar will handle rendering
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
  }, []);

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
            // Keep the vendor with the smallest distance to any venue
            if (!existing || vendor.distance < existing.distance) {
              vendorMap.set(vendor.id, vendor);
            }
          });
        }
      });

      // Convert to array and sort by distance
      const allVendors = Array.from(vendorMap.values()).sort((a, b) => a.distance - b.distance);
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

  // Calculate statistics
  const stats = {
    totalEvents: events.length,
    activeEvents: events.filter(e => e.is_active).length,
    upcomingEvents: events.filter(e => new Date(e.event_date) >= new Date()).length,
    totalTicketSales: events.reduce((sum, e) => sum + (e.ticket_sales || 0), 0),
    totalCommissionPool: events.reduce((sum, e) => sum + (e.commission_pool || 0), 0),
    totalRequiredStaff: events.reduce((sum, e) => sum + (e.required_staff || 0), 0),
    totalConfirmedStaff: events.reduce((sum, e) => sum + (e.confirmed_staff || 0), 0),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-12 px-6">
        {/* Header Section */}
        <div className="mb-12">
          <h1 className="text-5xl font-semibold text-gray-900 mb-3 tracking-tight">Events</h1>
          <p className="text-lg text-gray-600 font-normal">Manage your events and invite vendors seamlessly.</p>
        </div>

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
                  <div className="apple-stat-value">{stats.totalEvents}</div>
                  <div className="apple-stat-sublabel">{stats.activeEvents} active</div>
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
                  <div className="apple-stat-value">{stats.upcomingEvents}</div>
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
                  <div className="apple-stat-value">${(stats.totalTicketSales / 1000).toFixed(1)}k</div>
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
                  <div className="apple-stat-value">{stats.totalConfirmedStaff}/{stats.totalRequiredStaff}</div>
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
                  ${stats.totalCommissionPool.toLocaleString()}
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
                      {stats.totalRequiredStaff > 0
                        ? Math.round((stats.totalConfirmedStaff / stats.totalRequiredStaff) * 100)
                        : 0}%
                    </span>
                  </div>
                  <div className="apple-progress-bar">
                    <div
                      className="apple-progress-fill"
                      style={{
                        width: stats.totalRequiredStaff > 0
                          ? `${(stats.totalConfirmedStaff / stats.totalRequiredStaff) * 100}%`
                          : '0%'
                      }}
                    ></div>
                  </div>
                </div>
                <div className="text-sm text-gray-600">
                  {stats.totalConfirmedStaff} of {stats.totalRequiredStaff} positions filled
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
                            <div className="apple-distance-badge">
                              {vendor.distance} mi
                            </div>
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
                            <span className="flex items-center">
                              <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              </svg>
                              {vendor.profiles.city}, {vendor.profiles.state}
                            </span>
                            <span className="text-gray-400">•</span>
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
                        {availableVendors.length} vendor{availableVendors.length !== 1 ? 's have' : ' has'} confirmed availability for this date
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
                            <div className="apple-distance-badge">
                              {vendor.distance} mi
                            </div>
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
                            <span className="flex items-center">
                              <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              </svg>
                              {vendor.profiles.city}, {vendor.profiles.state}
                            </span>
                            <span className="text-gray-400">•</span>
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
