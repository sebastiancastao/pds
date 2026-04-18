"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getVenueAbbreviation } from "@/lib/utils";
import "./invitation-styles.css";

type DayAvailability = {
  date: string;       // YYYY-MM-DD
  available: boolean;
  allDay?: boolean;   // true = available all day (default when checked)
  startTime?: string; // HH:MM — only when allDay is false
  endTime?: string;   // HH:MM — only when allDay is false
};

type InvitationEvent = {
  id: string;
  eventName: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  startTime: string | null;
  endTime: string | null;
};

type InvitationDetails = {
  id: string;
  type?: "single" | "bulk";
  eventName?: string | null;
  eventDate?: string | null;
  venue?: string | null;
  status?: string;
  expiresAt?: string;
  startDate?: string | null;
  endDate?: string | null;
  durationWeeks?: number | null;
  regionId?: string | null;
  regionName?: string | null;
};

type InvitationPayload = {
  invitation?: InvitationDetails;
  availability?: DayAvailability[] | null;
  notes?: string;
  regionEventsByDate?: Record<string, InvitationEvent[]>;
};

const DEFAULT_DAY_COUNT = 42;

const normalizeDateKey = (value: string | null | undefined): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const buildDateRange = (
  startDate?: string | null,
  endDate?: string | null
): DayAvailability[] => {
  const normalizedStart = normalizeDateKey(startDate);
  const normalizedEnd = normalizeDateKey(endDate);
  const start = normalizedStart ? new Date(`${normalizedStart}T00:00:00`) : new Date();
  const end = normalizedEnd ? new Date(`${normalizedEnd}T00:00:00`) : new Date(start);

  if (!normalizedEnd) {
    end.setDate(start.getDate() + (DEFAULT_DAY_COUNT - 1));
  }

  if (end < start) {
    end.setTime(start.getTime());
  }

  const days: DayAvailability[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push({
      date: cursor.toISOString().slice(0, 10),
      available: false,
      allDay: true,
    });
  }

  return days;
};

const formatDisplayTime = (value: string | null | undefined): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw.length === 5 ? `${raw}:00` : raw;
  const parsed = new Date(`1970-01-01T${normalized}`);

  if (Number.isNaN(parsed.getTime())) {
    return raw.slice(0, 5) || raw;
  }

  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function InvitationPage() {
  const params = useParams();
  const token = params?.token as string | undefined;

  const [days, setDays] = useState<DayAvailability[]>([]);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [eventsByDate, setEventsByDate] = useState<Record<string, InvitationEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const initial = buildDateRange();
    setDays(initial);
    setInvitation(null);
    setEventsByDate({});

    fetch(`/api/invitations/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          let errorMessage = "Unable to load invitation details.";
          try {
            const errorPayload = await res.json();
            if (typeof errorPayload?.error === "string" && errorPayload.error.trim()) {
              errorMessage = errorPayload.error.trim();
            }
          } catch {}
          throw new Error(errorMessage);
        }
        const data: InvitationPayload = await res.json();
        const invitationDetails = data.invitation || null;
        const nextDays = buildDateRange(
          invitationDetails?.startDate,
          invitationDetails?.endDate
        );
        const existing: DayAvailability[] = data.availability || [];
        const map = new Map(existing.map(e => [e.date, e]));
        const merged = nextDays.map(d => {
          const saved = map.get(d.date);
          if (!saved) return d;
          // Normalise: if available and allDay is undefined treat as allDay
          return {
            ...d,
            ...saved,
            allDay: saved.allDay !== false,
          };
        });
        setInvitation(invitationDetails);
        setEventsByDate(data.regionEventsByDate || {});
        setDays(merged);
      })
      .catch((error: any) => {
        setMessage(error?.message || "Unable to load invitation details.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  const toggleDay = (idx: number) => {
    setDays(prev => {
      const copy = [...prev];
      const wasAvailable = copy[idx].available;
      copy[idx] = {
        ...copy[idx],
        available: !wasAvailable,
        // When turning a day on, default to all-day
        allDay: !wasAvailable ? true : copy[idx].allDay,
      };
      return copy;
    });
  };

  const toggleAllDay = (idx: number) => {
    setDays(prev => {
      const copy = [...prev];
      const currentAllDay = copy[idx].allDay !== false;
      copy[idx] = {
        ...copy[idx],
        allDay: !currentAllDay,
        // Pre-fill sensible defaults when switching to partial-day
        startTime: !currentAllDay ? undefined : (copy[idx].startTime || "09:00"),
        endTime:   !currentAllDay ? undefined : (copy[idx].endTime   || "17:00"),
      };
      return copy;
    });
  };

  const setDayTime = (idx: number, field: "startTime" | "endTime", value: string) => {
    setDays(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: value };
      return copy;
    });
  };

  const handleSave = async () => {
    if (!token) return setMessage("Invalid invitation link.");
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: days })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setShowSuccessModal(true);
    } catch (err: any) {
      setMessage(err?.message || "Error saving availability.");
      setTimeout(() => setMessage(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  const availableCount = days.filter(d => d.available).length;
  const partialCount   = days.filter(d => d.available && d.allDay === false).length;
  const totalRegionEvents = Object.values(eventsByDate).reduce(
    (count, eventList) => count + eventList.length,
    0
  );
  const eventDayCount = Object.keys(eventsByDate).length;

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="apple-card max-w-md w-full text-center py-12">
          <svg className="mx-auto h-16 w-16 text-red-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Invalid Invitation</h2>
          <p className="text-gray-600">This invitation link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-5xl py-12 px-6">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-5xl font-semibold text-gray-900 mb-3 keeping-tight">Your Availability</h1>
          <p className="text-lg text-gray-600 font-normal">
            Check a day if you're available. Each date shows the events scheduled in your region during this invitation window.
          </p>
        </div>

        {/* Error Message */}
        {message && (
          <div className="apple-alert apple-alert-error mb-6">{message}</div>
        )}

        {loading ? (
          <div className="apple-card">
            <div className="flex items-center justify-center py-16">
              <div className="apple-spinner"></div>
              <span className="ml-3 text-gray-600">Loading availability...</span>
            </div>
          </div>
        ) : (
          <>
            {invitation && (
              <div className="apple-card mb-8">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-wide text-blue-600">
                      {invitation.type === "bulk" ? "Regional Invitation" : "Invitation"}
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold text-gray-900">
                      {invitation.regionName
                        ? `${invitation.regionName} events`
                        : "Events in your area"}
                    </h2>
                    <p className="mt-2 text-sm text-gray-600">
                      {invitation.startDate && invitation.endDate
                        ? `${new Date(`${invitation.startDate}T00:00:00`).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })} to ${new Date(`${invitation.endDate}T00:00:00`).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}`
                        : `${days.length} days available`}
                    </p>
                    {invitation.eventName && (
                      <p className="mt-2 text-sm text-gray-500">
                        Related event: {invitation.eventName}
                        {invitation.venue ? ` | ${invitation.venue}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    <div className="font-semibold">
                      {totalRegionEvents} event{totalRegionEvents !== 1 ? "s" : ""}
                    </div>
                    <div className="mt-1 text-blue-700">
                      across {eventDayCount} day{eventDayCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4 mb-8">
              <button
                onClick={() => setDays(prev => prev.map(d => ({ ...d, available: true, allDay: true })))}
                className="group relative inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/40 hover:from-green-600 hover:to-green-700 transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <svg className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Select All Days
              </button>

              <button
                onClick={() => setDays(prev => prev.map(d => ({ ...d, available: false, allDay: true, startTime: undefined, endTime: undefined })))}
                className="group relative inline-flex items-center px-6 py-3 bg-white text-gray-700 font-semibold rounded-xl border-2 border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <svg className="w-5 h-5 mr-2 text-gray-500 group-hover:text-red-500 group-hover:scale-110 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear All
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {days.map((d, i) => {
                const dt = new Date(d.date + "T00:00:00");
                const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
                const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const isToday = d.date === new Date().toISOString().slice(0, 10);
                const isPartial = d.available && d.allDay === false;
                const dayEvents = eventsByDate[d.date] || [];

                return (
                  <div
                    key={d.date}
                    className={`invitation-day-card ${d.available ? (isPartial ? 'partial' : 'available') : ''} ${isToday ? 'today' : ''}`}
                  >
                    {/* Day header row */}
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-semibold text-gray-900 text-lg">{dayName}</div>
                        <div className="text-sm text-gray-500">
                          {dateStr}
                          {isToday && <span className="ml-2 text-blue-600 font-medium">• Today</span>}
                        </div>
                      </div>
                      <label className="invitation-checkbox-wrapper">
                        <input
                          type="checkbox"
                          checked={d.available}
                          onChange={() => toggleDay(i)}
                          className="invitation-checkbox"
                          aria-label={`Available on ${d.date}`}
                        />
                        <span className="checkmark"></span>
                      </label>
                    </div>

                    {dayEvents.length > 0 && (
                      <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                          {dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""} in your region
                        </div>
                        <div className="space-y-2">
                          {dayEvents.map((event) => {
                            const timeLabel = [
                              formatDisplayTime(event.startTime),
                              formatDisplayTime(event.endTime),
                            ]
                              .filter(Boolean)
                              .join(" - ");
                            const locationLabel = [event.venue, event.city, event.state]
                              .filter(Boolean)
                              .join(", ");

                            return (
                              <div
                                key={event.id}
                                className="rounded-lg border border-blue-100 bg-white/90 px-3 py-2"
                              >
                                <div className="text-sm font-semibold text-gray-900">
                                  {event.eventName || "Event"}
                                  {event.venue && (
                                    <span className="ml-1 text-xs font-medium text-blue-600">
                                      ({getVenueAbbreviation(event.venue)})
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                  {[timeLabel, locationLabel].filter(Boolean).join(" | ")}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Time section — shown only when day is checked */}
                    {d.available && (
                      <div className="invitation-time-section">
                        {/* All Day pill toggle — driven by React state */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleAllDay(i)}
                            aria-pressed={d.allDay !== false}
                            className="flex items-center gap-2 focus:outline-none"
                          >
                            {/* Track */}
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                width: 36,
                                height: 20,
                                borderRadius: 9999,
                                padding: 2,
                                backgroundColor: d.allDay !== false ? '#007AFF' : '#d1d5db',
                                transition: 'background-color 0.2s ease',
                                flexShrink: 0,
                              }}
                            >
                              {/* Thumb */}
                              <span
                                style={{
                                  display: 'block',
                                  width: 16,
                                  height: 16,
                                  borderRadius: '50%',
                                  backgroundColor: 'white',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                  transform: d.allDay !== false ? 'translateX(16px)' : 'translateX(0)',
                                  transition: 'transform 0.2s ease',
                                }}
                              />
                            </span>
                            <span className="text-sm font-medium text-gray-700 select-none">
                              All Day
                            </span>
                          </button>
                        </div>

                        {/* Time pickers — shown when NOT all day */}
                        {d.allDay === false && (
                          <div className="invitation-time-row">
                            <div className="invitation-time-field">
                              <label className="invitation-time-label">From</label>
                              <input
                                type="time"
                                value={d.startTime || "09:00"}
                                onChange={e => setDayTime(i, "startTime", e.target.value)}
                                className="invitation-time-input"
                              />
                            </div>
                            <span className="invitation-time-separator">–</span>
                            <div className="invitation-time-field">
                              <label className="invitation-time-label">To</label>
                              <input
                                type="time"
                                value={d.endTime || "17:00"}
                                onChange={e => setDayTime(i, "endTime", e.target.value)}
                                className="invitation-time-input"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Summary Card */}
            <div className="apple-info-banner mb-8">
              <svg className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-gray-700">
                <span className="font-semibold">{availableCount} day{availableCount !== 1 ? 's' : ''}</span> selected out of {days.length}
                {partialCount > 0 && (
                  <span className="ml-2 text-amber-600">
                    ({partialCount} partial-day{partialCount !== 1 ? 's' : ''})
                  </span>
                )}
                {totalRegionEvents > 0 && (
                  <span className="ml-2 text-blue-700">
                    {totalRegionEvents} regional event{totalRegionEvents !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-center">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`group relative inline-flex items-center px-12 py-4 text-lg font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl shadow-blue-500/40 transform transition-all duration-200 ${
                  saving
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:shadow-2xl hover:shadow-blue-500/50 hover:from-blue-700 hover:to-blue-800 hover:scale-105'
                }`}
              >
                {saving ? (
                  <>
                    <div className="apple-spinner-small mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Submit Availability
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
          onClick={() => setShowSuccessModal(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 transform animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="mx-auto w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/50 animate-bounce-once">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h2 className="text-3xl font-bold text-gray-900 mb-3">Success!</h2>
              <p className="text-lg text-gray-600 mb-2">Your availability has been saved.</p>
              <p className="text-sm text-gray-500 mb-8">
                You selected{" "}
                <span className="font-semibold text-green-600">
                  {availableCount} day{availableCount !== 1 ? 's' : ''}
                </span>
                {partialCount > 0 && (
                  <span> ({partialCount} with custom hours)</span>
                )}
                . Thank you!
              </p>

              <button
                onClick={() => setShowSuccessModal(false)}
                className="group w-full inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/40 hover:from-green-600 hover:to-green-700 transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <svg className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
