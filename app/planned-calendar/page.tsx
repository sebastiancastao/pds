"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "../global-calendar/dashboard-styles.css";
import "./planned-calendar-styles.css";

const EventCalendar = dynamic(
  () => import("@/components/event-calendar").then((mod) => mod.EventCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-16">
        <div className="apple-spinner" />
        <span className="ml-3 text-gray-500">Loading calendar...</span>
      </div>
    ),
  }
);

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
  full_address: string | null;
};

type PlannedEvent = {
  id: string;
  event_name: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  created_at: string;
  updated_at: string;
  venue: Venue;
};

const fmtDate = (d: string): string => {
  const [year, month, day] = d.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export default function PlannedCalendarPage() {
  const router = useRouter();

  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [events, setEvents] = useState<PlannedEvent[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ event_name: "", event_date: "", venue_id: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [alertModal, setAlertModal] = useState<{ title: string; message: string; type: "success" | "error" } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterVenue, setFilterVenue] = useState("all");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
          router.replace("/login");
          return;
        }
        const { data: userData, error: userError } = await (supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single() as any);

        if (userError || !userData) {
          router.replace("/dashboard");
          return;
        }
        const role = userData.role as string;
        if (!["admin", "exec", "manager", "supervisor3", "supervisor4"].includes(role)) {
          router.replace("/dashboard");
          return;
        }
        setUserRole(role);
        setIsAuthorized(true);
      } catch {
        router.replace("/login");
      } finally {
        setAuthChecking(false);
      }
    };
    checkAuth();
  }, [router]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/planned-events", {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!res.ok) throw new Error("Failed to load planned events");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err: any) {
      setError(err.message ?? "Error loading events");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVenues = useCallback(async () => {
    const { data } = await (supabase
      .from("venue_reference")
      .select("id, venue_name, city, state, full_address")
      .order("venue_name") as any);
    if (data) setVenues(data);
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;
    fetchEvents();
    fetchVenues();
  }, [isAuthorized, fetchEvents, fetchVenues]);

  const handleCreate = async () => {
    if (!form.event_name.trim() || !form.event_date || !form.venue_id) {
      setFormError("All fields are required.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/planned-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to create event");
      }
      setShowCreateModal(false);
      setForm({ event_name: "", event_date: "", venue_id: "" });
      await fetchEvents();
      setAlertModal({ title: "Event Created", message: "The planned event was added successfully.", type: "success" });
    } catch (err: any) {
      setFormError(err.message ?? "Failed to save event");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/planned-events?id=${deleteConfirmId}`, {
        method: "DELETE",
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to delete event");
      }
      setEvents((prev) => prev.filter((e) => e.id !== deleteConfirmId));
      setDeleteConfirmId(null);
      setAlertModal({ title: "Event Deleted", message: "The planned event was removed.", type: "success" });
    } catch (err: any) {
      setAlertModal({ title: "Error", message: err.message ?? "Failed to delete event", type: "error" });
    } finally {
      setDeleting(false);
    }
  };

  const filteredEvents = events.filter((ev) => {
    const matchesSearch =
      !searchQuery.trim() ||
      ev.event_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ev.venue.venue_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesVenue = filterVenue === "all" || ev.venue.id === filterVenue;
    const matchesPeriodStart = !periodStart || ev.event_date >= periodStart;
    const matchesPeriodEnd = !periodEnd || ev.event_date <= periodEnd;
    return matchesSearch && matchesVenue && matchesPeriodStart && matchesPeriodEnd;
  });

  const listEvents = selectedCalendarEventId
    ? filteredEvents.filter((e) => e.id === selectedCalendarEventId)
    : filteredEvents;

  const canDelete = userRole === "admin" || userRole === "exec" || userRole === "supervisor4";

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="apple-spinner" />
      </div>
    );
  }

  if (!isAuthorized) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {userRole !== "supervisor4" && (
              <Link href="/dashboard" className="apple-button apple-button-secondary flex items-center gap-2 text-sm py-2 px-4">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Dashboard
              </Link>
            )}
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Planning Calendar</h1>
              <p className="text-sm text-gray-500 mt-0.5">Manage and plan upcoming events</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {userRole === "supervisor4" && (
              <button
                onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}
                className="apple-button apple-button-secondary flex items-center gap-2 text-sm py-2 px-4"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Log Out
              </button>
            )}
            <button
              onClick={() => { setShowCreateModal(true); setFormError(""); }}
              className="apple-button apple-button-primary flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Event
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Error */}
        {!loading && error && (
          <div className="apple-alert apple-alert-error mb-6">{error}</div>
        )}

        {/* Calendar — always visible */}
        <div className="apple-card mb-6">
          <div className="apple-calendar-wrapper planned-calendar-wrapper">
            <EventCalendar
              events={filteredEvents.map((ev) => ({
                id: ev.id,
                title: `${ev.event_name} · ${ev.venue.venue_name}`,
                start: ev.event_date,
                allDay: true,
                color: selectedCalendarEventId && selectedCalendarEventId !== ev.id ? "#c4b5fd" : "#7c3aed",
              }))}
              onEventClick={(id) => setSelectedCalendarEventId((prev) => (prev === id ? null : id))}
            />
          </div>
        </div>

        {/* Filters — below calendar */}
        <div className="flex flex-col gap-3 mb-4">
          {/* Search — full width */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search events or venues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          {/* Venue + period — second row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={filterVenue}
              onChange={(e) => setFilterVenue(e.target.value)}
              className="apple-select text-sm w-full sm:w-48"
            >
              <option value="all">All Venues</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.venue_name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                title="Period start"
              />
              <span className="text-gray-400 text-sm">–</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                title="Period end"
              />
              {(periodStart || periodEnd) && (
                <button
                  onClick={() => { setPeriodStart(""); setPeriodEnd(""); }}
                  className="text-gray-400 hover:text-gray-600 text-sm px-2"
                  title="Clear period"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Event count + active calendar selection */}
        {!loading && !error && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {listEvents.length} {listEvents.length === 1 ? "event" : "events"}
              {(selectedCalendarEventId || filterVenue !== "all" || searchQuery || periodStart || periodEnd) ? " (filtered)" : ""}
            </p>
            {selectedCalendarEventId && (
              <button
                onClick={() => setSelectedCalendarEventId(null)}
                className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear selection
              </button>
            )}
          </div>
        )}

        {/* Loading spinner (cards area only) */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="apple-spinner" />
            <span className="ml-3 text-gray-500">Loading events...</span>
          </div>
        )}

        {/* Empty state below calendar */}
        {!loading && !error && listEvents.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-4">
            {selectedCalendarEventId ? "Selected event not found in current filters." : "No planned events yet. Click "}
            {!selectedCalendarEventId && <strong>New Event</strong>}
            {!selectedCalendarEventId && " to add one."}
          </p>
        )}

        {/* Events grid */}
        {!loading && !error && listEvents.length > 0 && (
          <div className="grid grid-cols-1 gap-4">
            {listEvents.map((ev) => (
              <div key={ev.id} className="apple-card flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{ev.event_name}</h3>
                    <p className="text-sm text-blue-600 font-medium mt-0.5">{ev.venue.venue_name}</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => setDeleteConfirmId(ev.id)}
                      className="apple-icon-button apple-icon-button-danger flex-shrink-0"
                      title="Delete event"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-gray-600">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {fmtDate(ev.event_date)}
                  </span>
                </div>

                {ev.venue.city && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {ev.venue.city}, {ev.venue.state}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="apple-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}>
          <div className="apple-modal max-w-lg">
            <div className="apple-modal-header">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">New Planned Event</h2>
                <p className="text-sm text-gray-500 mt-1">Fill in the event details below.</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="apple-close-button">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="apple-modal-body space-y-4">
              {formError && <div className="apple-alert apple-alert-error text-sm">{formError}</div>}

              <div>
                <label className="apple-label">Event Name</label>
                <input
                  type="text"
                  value={form.event_name}
                  onChange={(e) => setForm((f) => ({ ...f, event_name: e.target.value }))}
                  placeholder="e.g. Concert Night"
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="apple-label">Date</label>
                <input
                  type="date"
                  value={form.event_date}
                  onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
                  className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="apple-label">Venue</label>
                <select
                  value={form.venue_id}
                  onChange={(e) => setForm((f) => ({ ...f, venue_id: e.target.value }))}
                  className="apple-select text-sm"
                >
                  <option value="">Select a venue...</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.venue_name} — {v.city}, {v.state}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="apple-button apple-button-secondary flex-1"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={saving}
                  className={`apple-button flex-1 ${saving ? "apple-button-disabled" : "apple-button-primary"}`}
                >
                  {saving ? "Saving..." : "Create Event"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirmId && (
        <div className="apple-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirmId(null); }}>
          <div className="apple-modal max-w-sm">
            <div className="apple-modal-header">
              <h2 className="text-xl font-semibold text-gray-900">Delete Event</h2>
              <button onClick={() => setDeleteConfirmId(null)} className="apple-close-button">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="apple-modal-body">
              <p className="text-gray-600 text-sm mb-6">
                Are you sure you want to delete <strong>{events.find((e) => e.id === deleteConfirmId)?.event_name}</strong>? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmId(null)}
                  className="apple-button apple-button-secondary flex-1"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className={`apple-button flex-1 ${deleting ? "apple-button-disabled" : ""}`}
                  style={!deleting ? { background: "#dc2626", color: "white" } : undefined}
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertModal && (
        <div className="apple-modal-overlay">
          <div className="apple-modal max-w-sm">
            <div className="apple-modal-header">
              <h2 className="text-xl font-semibold text-gray-900">{alertModal.title}</h2>
            </div>
            <div className="apple-modal-body">
              <div className={`apple-alert ${alertModal.type === "success" ? "apple-alert-success" : "apple-alert-error"} mb-4`}>
                {alertModal.message}
              </div>
              <button onClick={() => setAlertModal(null)} className="apple-button apple-button-primary w-full">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
