"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
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

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
};

export default function EditEventPage() {
  const router = useRouter();
  const params = useParams();
  const eventId = params.id as string;

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
    is_active: true
  });

  const [venues, setVenues] = useState<Venue[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  // User and session check
  useEffect(() => {
    console.log('[DEBUG] EditEvent - Checking user authentication...');
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        console.log('[DEBUG] EditEvent - No user found, redirecting to /login');
        router.replace("/login");
      } else {
        console.log('[DEBUG] EditEvent - User authenticated:', user.id, user.email);
        setIsAuthed(true);
        loadVenues();
        loadEvent();
      }
    });
  }, [router, eventId]);

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
        console.log('[DEBUG] EditEvent - Failed to load venues');
      }
    } catch (err: any) {
      console.log('[DEBUG] EditEvent - Error loading venues:', err);
    }
  };

  const loadEvent = async () => {
    if (!eventId) return;
    
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      
      if (res.ok) {
        const data = await res.json();
        const event = data.event;
        setForm({
          event_name: event.event_name || "",
          artist: event.artist || "",
          venue: event.venue || "",
          city: event.city || "",
          state: event.state || "",
          event_date: event.event_date || "",
          start_time: event.start_time || "",
          end_time: event.end_time || "",
          ticket_sales: event.ticket_sales || null,
          artist_share_percent: event.artist_share_percent || 0,
          venue_share_percent: event.venue_share_percent || 0,
          pds_share_percent: event.pds_share_percent || 0,
          commission_pool: event.commission_pool || null,
          required_staff: event.required_staff || null,
          confirmed_staff: event.confirmed_staff || null,
          is_active: event.is_active !== undefined ? event.is_active : true
        });
      } else {
        setMessage("Failed to load event details");
      }
    } catch (err: any) {
      setMessage("Network error loading event");
      console.log('[DEBUG] EditEvent - Error loading event:', err);
    }
    setLoading(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : (type === "number" ? (value === "" ? null : Number(value)) : value)
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
        artist_share_percent: form.artist_share_percent || 0,
        venue_share_percent: form.venue_share_percent || 0,
        pds_share_percent: form.pds_share_percent || 0
      };

      console.log('[DEBUG] EditEvent - Submitting event update:', payload);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setMessage("Event updated successfully");
        setTimeout(() => {
          router.replace("/dashboard");
        }, 1500);
      } else {
        setMessage(data.error || "Failed to update event");
        console.log('[DEBUG] EditEvent - Error from API:', data.error);
      }
    } catch (err: any) {
      setMessage("Network error");
      console.log('[DEBUG] EditEvent - Network error updating event:', err);
    }
    setSubmitting(false);
  };

  // Render nothing if not authenticated yet or still loading
  if (!isAuthed || loading) {
    console.log('[DEBUG] EditEvent - Not ready yet, no form rendered');
    return (
      <div className="container mx-auto max-w-2xl py-10 px-4">
        <div className="text-center">Loading event details...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl py-10 px-4">
      <div className="flex mb-6">
        <Link href="/dashboard">
          <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">&larr; Back to Dashboard</button>
        </Link>
      </div>

      {message && (
        <div className="mb-4 bg-green-100 border-green-400 text-green-700 px-6 py-3 rounded relative">
          {message}
          <button onClick={() => setMessage("")} className="absolute top-2 right-2 text-green-700 font-bold">×</button>
        </div>
      )}

      <div className="bg-white shadow-md rounded p-6">
        <h2 className="text-2xl font-bold mb-6">Edit Event</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Basic Event Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold block mb-1">Event Name *</label>
              <input 
                name="event_name" 
                value={form.event_name} 
                onChange={handleChange} 
                required 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Artist</label>
              <input 
                name="artist" 
                value={form.artist || ""} 
                onChange={handleChange} 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
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
            <div>
              <label className="font-semibold block mb-1">City (Auto-filled)</label>
              <input
                name="city"
                value={form.city || ""}
                readOnly
                className="w-full p-2 border rounded bg-gray-100 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">State (Auto-filled)</label>
              <input
                name="state"
                value={form.state || ""}
                readOnly
                className="w-full p-2 border rounded bg-gray-100 cursor-not-allowed uppercase"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Event Date *</label>
              <input 
                name="event_date" 
                value={form.event_date} 
                onChange={handleChange} 
                required 
                type="date" 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
          </div>

          {/* Time Information */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="font-semibold block mb-1">Start Time *</label>
              <input 
                name="start_time" 
                value={form.start_time} 
                onChange={handleChange} 
                required 
                type="time" 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">End Time *</label>
              <input 
                name="end_time" 
                value={form.end_time} 
                onChange={handleChange} 
                required 
                type="time" 
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Total Collected</label>
              <input 
                name="ticket_sales" 
                value={form.ticket_sales || ""} 
                onChange={handleChange} 
                type="number" 
                min="0"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
          </div>

          {/* Financial Information */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="font-semibold block mb-1">Artist Share %</label>
              <input 
                name="artist_share_percent" 
                value={form.artist_share_percent} 
                onChange={handleChange} 
                type="number" 
                step="0.01" 
                min="0" 
                max="100"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Venue Share %</label>
              <input 
                name="venue_share_percent" 
                value={form.venue_share_percent} 
                onChange={handleChange} 
                type="number" 
                step="0.01" 
                min="0" 
                max="100"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">PDS Share %</label>
              <input 
                name="pds_share_percent" 
                value={form.pds_share_percent} 
                onChange={handleChange} 
                type="number" 
                step="0.01" 
                min="0" 
                max="100"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Commission Pool</label>
              <input 
                name="commission_pool" 
                value={form.commission_pool || ""} 
                onChange={handleChange} 
                type="number" 
                step="0.01" 
                min="0"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
          </div>

          {/* Staff Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold block mb-1">Required Staff</label>
              <input 
                name="required_staff" 
                value={form.required_staff || ""} 
                onChange={handleChange} 
                type="number" 
                min="0"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">Confirmed Staff</label>
              <input 
                name="confirmed_staff" 
                value={form.confirmed_staff || ""} 
                onChange={handleChange} 
                type="number" 
                min="0"
                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500" 
              />
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2">
            <input 
              id="is_active" 
              type="checkbox" 
              name="is_active" 
              checked={form.is_active} 
              onChange={handleChange} 
              className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded" 
            />
            <label htmlFor="is_active" className="font-semibold">Is Active</label>
          </div>

          <button 
            type="submit" 
            className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded transition" 
            disabled={submitting}
          >
            {submitting ? "Updating..." : "Update Event"}
          </button>
        </form>
      </div>
    </div>
  );
}



