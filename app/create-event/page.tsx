"use client";
import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
};

function CreateEventPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get("returnTo") || "dashboard";

  const [form, setForm] = useState({
    event_name: "",
    artist: "",
    venue: "",
    city: "",
    state: "",
    event_date: "",
    start_time: "",
    end_time: "",
    artist_share_percent: "",
    venue_share_percent: "",
    pds_share_percent: "",
    is_active: true
  });
  const [venues, setVenues] = useState<Venue[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  // User and session check: block if not authenticated, with detailed logs
  useEffect(() => {
    console.log('[DEBUG] CreateEvent - Checking user authentication...');
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        console.log('[DEBUG] CreateEvent - No user found, redirecting to /login');
        router.replace("/login");
      } else {
        console.log('[DEBUG] CreateEvent - User authenticated:', user.id, user.email);
        setIsAuthed(true);
        loadVenues();
      }
    });
  }, [router]);

  const loadVenues = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/venues-list', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (res.ok) {
        const data = await res.json();
        setVenues(data.venues || []);
      } else {
        console.log('[DEBUG] CreateEvent - Failed to load venues');
      }
    } catch (err: any) {
      console.log('[DEBUG] CreateEvent - Error loading venues:', err);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));
  };

  const handleVenueChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedVenue = venues.find(v => v.venue_name === e.target.value);
    if (selectedVenue) {
      setForm(prev => ({
        ...prev,
        venue: selectedVenue.venue_name,
        city: selectedVenue.city,
        state: selectedVenue.state
      }));
    } else {
      setForm(prev => ({
        ...prev,
        venue: "",
        city: "",
        state: ""
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);
    // Validation: required fields
    if (!form.event_name || !form.venue || !form.city || !form.state || !form.event_date || !form.start_time || !form.end_time) {
      setMessage("Please fill all required fields: Event Name, Venue, City, State, Event Date, Start Time, End Time");
      setSubmitting(false);
      return;
    }
    try {
      // Convert percentage values (50) to decimals (0.5) for backend
      const payload = {
        ...form,
        artist_share_percent: form.artist_share_percent !== "" ? Number(form.artist_share_percent) / 100 : undefined,
        venue_share_percent: form.venue_share_percent !== "" ? Number(form.venue_share_percent) / 100 : undefined,
        pds_share_percent: form.pds_share_percent !== "" ? Number(form.pds_share_percent) / 100 : undefined
      };
      console.log('[DEBUG] CreateEvent - Submitting event payload:', payload);
      // Attach Supabase access token so the API can authenticate the user server-side
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Event created successfully");
        setForm({
          event_name: "",
          artist: "",
          venue: "",
          city: "",
          state: "",
          event_date: "",
          start_time: "",
          end_time: "",
          artist_share_percent: "",
          venue_share_percent: "",
          pds_share_percent: "",
          is_active: true
        });
        setTimeout(() => {
          router.replace(`/${returnTo}`);
        }, 200);
      } else {
        setMessage(data.error || "Failed to create event");
        console.log('[DEBUG] CreateEvent - Error from API:', data.error);
      }
    } catch (err: any) {
      setMessage("Network error");
      console.log('[DEBUG] CreateEvent - Network error submitting event:', err);
    }
    setSubmitting(false);
  };

  // Render nothing if not authenticated yet (prevents FOUC)
  if (!isAuthed) {
    console.log('[DEBUG] CreateEvent - Not authenticated yet, no form rendered');
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 py-12 px-4">
      <div className="container mx-auto max-w-3xl">
        <div className="flex mb-8">
          <Link href={`/${returnTo}`}>
            <button className="group flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 font-medium py-2.5 px-5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 border border-slate-200">
              <span className="text-lg group-hover:-translate-x-1 transition-transform duration-200">&larr;</span>
              <span>Back to {returnTo === "global-calendar" ? "Global Calendar" : "Dashboard"}</span>
            </button>
          </Link>
        </div>

        {message && (
          <div className="mb-6 bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 text-emerald-800 px-6 py-4 rounded-xl relative shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="font-medium">{message}</span>
            </div>
            <button
              onClick={() => setMessage("")}
              className="absolute top-3 right-3 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100 rounded-lg p-1 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="bg-white/80 backdrop-blur-sm shadow-xl rounded-2xl border border-slate-200/50 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6">
            <h2 className="text-3xl font-bold text-white">Create New Event</h2>
            <p className="text-blue-100 mt-1">Fill in the details to schedule a new event</p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            {/* Event Details Section */}
            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-2">Event Name <span className="text-red-500">*</span></label>
                <input
                  name="event_name"
                  value={form.event_name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                  placeholder="Enter event name"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-2">Artist</label>
                <input
                  name="artist"
                  value={form.artist}
                  onChange={handleChange}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                  placeholder="Enter artist name (optional)"
                />
              </div>
            </div>

            {/* Venue Section */}
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Venue Information</h3>
              <div className="space-y-5">
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Venue <span className="text-red-500">*</span></label>
                  <select
                    name="venue"
                    value={form.venue}
                    onChange={handleVenueChange}
                    required
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300 bg-white"
                  >
                    <option value="">Select a venue...</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.venue_name}>
                        {venue.venue_name} - {venue.city}, {venue.state}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="text-sm font-semibold text-slate-700 block mb-2">City</label>
                    <input
                      name="city"
                      value={form.city}
                      readOnly
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed text-slate-600"
                      placeholder="Auto-filled"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-2">State</label>
                    <input
                      name="state"
                      value={form.state}
                      readOnly
                      className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl bg-slate-50 cursor-not-allowed uppercase text-slate-600"
                      placeholder="ST"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Date & Time Section */}
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Schedule</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Event Date <span className="text-red-500">*</span></label>
                  <input
                    name="event_date"
                    value={form.event_date}
                    onChange={handleChange}
                    required
                    type="date"
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Start Time <span className="text-red-500">*</span></label>
                  <input
                    name="start_time"
                    value={form.start_time}
                    onChange={handleChange}
                    required
                    type="time"
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">End Time <span className="text-red-500">*</span></label>
                  <input
                    name="end_time"
                    value={form.end_time}
                    onChange={handleChange}
                    required
                    type="time"
                    className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                  />
                </div>
              </div>
            </div>

            {/* Revenue Share Section */}
            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Revenue Share</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Artist Share %</label>
                  <div className="relative">
                    <input
                      name="artist_share_percent"
                      value={form.artist_share_percent}
                      onChange={handleChange}
                      type="number"
                      min="0"
                      max="100"
                      className="w-full px-4 py-3 pr-8 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                      placeholder="50"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">%</span>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">Venue Share %</label>
                  <div className="relative">
                    <input
                      name="venue_share_percent"
                      value={form.venue_share_percent}
                      onChange={handleChange}
                      type="number"
                      min="0"
                      max="100"
                      className="w-full px-4 py-3 pr-8 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                      placeholder="30"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">%</span>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700 block mb-2">PDS Share %</label>
                  <div className="relative">
                    <input
                      name="pds_share_percent"
                      value={form.pds_share_percent}
                      onChange={handleChange}
                      type="number"
                      min="0"
                      max="100"
                      className="w-full px-4 py-3 pr-8 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 outline-none hover:border-slate-300"
                      placeholder="20"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Status Section */}
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center gap-3 bg-blue-50 p-4 rounded-xl border border-blue-100">
                <input
                  id="is_active"
                  type="checkbox"
                  name="is_active"
                  checked={form.is_active}
                  onChange={handleChange}
                  className="h-5 w-5 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 border-slate-300 rounded transition-all cursor-pointer"
                />
                <label htmlFor="is_active" className="text-sm font-semibold text-slate-700 cursor-pointer select-none">
                  Mark event as active
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none mt-8"
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating Event...
                </span>
              ) : (
                "Create Event"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function CreateEventPage() {
  return (
    <Suspense
      fallback={(
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-600">
          Loading...
        </div>
      )}
    >
      <CreateEventPageInner />
    </Suspense>
  );
}
