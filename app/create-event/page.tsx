"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
};

export default function CreateEventPage() {
  const router = useRouter();
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
      const payload = {
        ...form,
        artist_share_percent: form.artist_share_percent !== "" ? Number(form.artist_share_percent) : undefined,
        venue_share_percent: form.venue_share_percent !== "" ? Number(form.venue_share_percent) : undefined,
        pds_share_percent: form.pds_share_percent !== "" ? Number(form.pds_share_percent) : undefined
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
          router.replace("/dashboard");
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
    <div className="container mx-auto max-w-2xl py-10 px-4">
      <div className="flex mb-6">
        <Link href="/dashboard">
          <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md mr-2">&larr; Back to Dashboard</button>
        </Link>
      </div>
      {message && (
        <div className="mb-4 bg-green-100 border-green-400 text-green-700 px-6 py-3 rounded relative">
          {message}
          <button onClick={() => setMessage("")} className="absolute top-2 right-2 text-green-700 font-bold">×</button>
        </div>
      )}
      <div className="bg-white shadow-md rounded p-6">
        <h2 className="text-2xl font-bold mb-6">Create New Event</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="font-semibold block mb-1">Event Name *</label>
            <input name="event_name" value={form.event_name} onChange={handleChange} required className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="font-semibold block mb-1">Artist</label>
            <input name="artist" value={form.artist} onChange={handleChange} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="font-semibold block mb-1">Venue *</label>
            <select
              name="venue"
              value={form.venue}
              onChange={handleVenueChange}
              required
              className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a venue...</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.venue_name}>
                  {venue.venue_name} - {venue.city}, {venue.state}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-4">
            <div className="w-2/3">
              <label className="font-semibold block mb-1">City (Auto-filled)</label>
              <input name="city" value={form.city} readOnly className="w-full p-2 border rounded bg-gray-100 cursor-not-allowed" />
            </div>
            <div className="w-1/3">
              <label className="font-semibold block mb-1">State (Auto-filled)</label>
              <input name="state" value={form.state} readOnly className="w-full p-2 border rounded bg-gray-100 cursor-not-allowed uppercase" />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-1/2">
              <label className="font-semibold block mb-1">Event Date *</label>
              <input name="event_date" value={form.event_date} onChange={handleChange} required type="date" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="w-1/2">
              <label className="font-semibold block mb-1">Start Time *</label>
              <input name="start_time" value={form.start_time} onChange={handleChange} required type="time" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="w-1/2">
              <label className="font-semibold block mb-1">End Time *</label>
              <input name="end_time" value={form.end_time} onChange={handleChange} required type="time" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-1/3">
              <label className="font-semibold block mb-1">Artist Share %</label>
              <input name="artist_share_percent" value={form.artist_share_percent} onChange={handleChange} type="number" step="0.01" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="w-1/3">
              <label className="font-semibold block mb-1">Venue Share %</label>
              <input name="venue_share_percent" value={form.venue_share_percent} onChange={handleChange} type="number" step="0.01" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="w-1/3">
              <label className="font-semibold block mb-1">PDS Share %</label>
              <input name="pds_share_percent" value={form.pds_share_percent} onChange={handleChange} type="number" step="0.01" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input id="is_active" type="checkbox" name="is_active" checked={form.is_active} onChange={handleChange} className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" />
            <label htmlFor="is_active" className="font-semibold">Is Active</label>
          </div>
          <button type="submit" className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded transition" disabled={submitting}>
            {submitting ? "Creating..." : "Create Event"}
          </button>
        </form>
      </div>
    </div>
  );
}
