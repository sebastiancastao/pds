"use client";
import React, { useState, useEffect } from "react";
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
  commission_pool: number | null;
  required_staff: number | null;
  confirmed_staff: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // optional if present in your DB/API
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

type TabType = 'edit' | 'sales' | 'merchandise' | 'team';

export default function EventDashboardPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.id as string;
  const initialTab = (searchParams.get('tab') as TabType) || 'edit';

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [event, setEvent] = useState<EventItem | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  const [ticketSales, setTicketSales] = useState<string>("");
  const [ticketCount, setTicketCount] = useState<string>("");
  const [commissionPool, setCommissionPool] = useState<string>("");
  const [taxRate, setTaxRate] = useState<string>("0"); // %
  const [merchandiseUnits, setMerchandiseUnits] = useState<string>("");
  const [merchandiseValue, setMerchandiseValue] = useState<string>("");

  // Team state
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

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
    is_active: true
  });

  // User and session check
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        router.replace("/login");
      } else {
        setIsAuthed(true);
        loadVenues();
        loadEvent();
      }
    });
  }, [router, eventId]);

  // Load team when team tab is active
  useEffect(() => {
    if (activeTab === 'team' && eventId) {
      loadTeam();
    }
  }, [activeTab, eventId]);


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
      }
    } catch (err: any) {
      console.log('[DEBUG] Error loading venues:', err);
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
          artist_share_percent: eventData.artist_share_percent || 0,
          venue_share_percent: eventData.venue_share_percent || 0,
          pds_share_percent: eventData.pds_share_percent || 0,
          commission_pool: eventData.commission_pool || null,
          required_staff: eventData.required_staff || null,
          confirmed_staff: eventData.confirmed_staff || null,
          is_active: eventData.is_active !== undefined ? eventData.is_active : true
        });
        setTicketSales(eventData.ticket_sales?.toString() || "");
        setTicketCount(eventData.ticket_count?.toString() || "");
        setCommissionPool(eventData.commission_pool?.toString() || "");
        setTaxRate((eventData.tax_rate_percent ?? 0).toString());
        setMerchandiseUnits(eventData.merchandise_units?.toString() || "");
        setMerchandiseValue(eventData.merchandise_value?.toString() || "");
      } else {
        setMessage("Failed to load event details");
      }
    } catch (err: any) {
      setMessage("Network error loading event");
    }
    setLoading(false);
  };

  const loadTeam = async () => {
    if (!eventId) return;

    setLoadingTeam(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}/team`, {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data.team || []);
      } else {
        console.error('Failed to load team members');
      }
    } catch (err: any) {
      console.error('Error loading team:', err);
    }
    setLoadingTeam(false);
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

    if (!form.event_name || !form.venue || !form.city || !form.state || !form.event_date || !form.start_time || !form.end_time) {
      setMessage("Please fill all required fields");
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
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          ...event,
          ticket_sales: ticketSales !== "" ? Number(ticketSales) : null,
          ticket_count: ticketCount !== "" ? Number(ticketCount) : null,
          commission_pool: commissionPool !== "" ? Number(commissionPool) : null,
          tax_rate_percent: taxRate !== "" ? Number(taxRate) : 0
        })
      });

      const data = await res.json();
      if (res.ok) {
        setMessage("Sales data updated successfully");
        setEvent(data.event);
      } else {
        setMessage(data.error || "Failed to update sales data");
      }
    } catch (err: any) {
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
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          ...event,
          merchandise_units: merchandiseUnits !== "" ? Number(merchandiseUnits) : null,
          merchandise_value: merchandiseValue !== "" ? Number(merchandiseValue) : null
        })
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

  // Now uses Net Sales (Gross - Tax) for splits
  const calculateShares = () => {
    if (!event || ticketSales === "") return null;

    const grossSales = Number(ticketSales) || 0;
    const taxPct = clamp(Number(taxRate || 0), 0, 100);
    const tax = grossSales * (taxPct / 100);
    const netSales = Math.max(grossSales - tax, 0);

    const artistShare = netSales * (event.artist_share_percent / 100);
    const venueShare = netSales * (event.venue_share_percent / 100);
    const pdsShare = netSales * (event.pds_share_percent / 100);

    return {
      grossSales,
      taxPct,
      tax,
      netSales,
      artistShare,
      venueShare,
      pdsShare
    };
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
        <div className="bg-red-100 border-red-400 text-red-700 px-6 py-3 rounded">
          Event not found
        </div>
        <div className="mt-4">
          <Link href="/dashboard">
            <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
              &larr; Back to Dashboard
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const shares = calculateShares();
  const percentTotal =
    (event.artist_share_percent || 0) +
    (event.venue_share_percent || 0) +
    (event.pds_share_percent || 0);

  return (
    <div className="container mx-auto max-w-6xl py-10 px-4">
      <div className="flex mb-6">
        <Link href="/dashboard">
          <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
            &larr; Back to Dashboard
          </button>
        </Link>
      </div>

      {message && (
        <div className={`mb-4 px-6 py-3 rounded relative ${
          message.includes('success')
            ? 'bg-green-100 border-green-400 text-green-700'
            : 'bg-red-100 border-red-400 text-red-700'
        }`}>
          {message}
          <button onClick={() => setMessage("")} className="absolute top-2 right-2 font-bold">×</button>
        </div>
      )}

      {percentTotal !== 100 && (
        <div className="mb-4 px-6 py-3 rounded bg-amber-100 text-amber-800">
          Heads up: your split percentages add up to {percentTotal}% (not 100%).
        </div>
      )}

      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {/* Event Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
          <h1 className="text-3xl font-bold">{event.event_name}</h1>
          <div className="mt-2 text-blue-100">
            <p><strong>Venue:</strong> {event.venue} ({event.city}, {event.state})</p>
            {event.artist && <p><strong>Artist:</strong> {event.artist}</p>}
            <p><strong>Date:</strong> {event.event_date} | {event.start_time?.slice(0,5)} - {event.end_time?.slice(0,5)}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b">
          <nav className="flex">
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'edit'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Edit Event
            </button>
            <button
              onClick={() => setActiveTab('sales')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'sales'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Sales
            </button>
            <button
              onClick={() => setActiveTab('merchandise')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'merchandise'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Merchandise
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`px-6 py-3 font-semibold border-b-2 transition ${
                activeTab === 'team'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              Team
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {/* Edit Tab */}
          {activeTab === 'edit' && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* ... unchanged edit form ... */}
              {/* (Keeping your original edit form content exactly as you had it) */}
              {/* START original edit form */}
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
                  <label className="font-semibold block mb-1">Ticket Sales</label>
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
              {/* END original edit form */}
            </form>
          )}

          {/* Sales Tab */}
          {activeTab === 'sales' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-4">Sales Information</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold block mb-2">Ticket Sales ($)</label>
                    <input
                      type="number"
                      value={ticketSales}
                      onChange={(e) => setTicketSales(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Number of Tickets/People</label>
                    <input
                      type="number"
                      value={ticketCount}
                      onChange={(e) => setTicketCount(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Tax Rate (%)</label>
                    <input
                      type="number"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      placeholder="0"
                      step="0.01"
                      min="0"
                      max="100"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Commission Pool ($)</label>
                    <input
                      type="number"
                      value={commissionPool}
                      onChange={(e) => setCommissionPool(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveSales}
                  disabled={submitting}
                  className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded transition disabled:bg-gray-400"
                >
                  {submitting ? "Saving..." : "Save Sales Data"}
                </button>
              </div>

              {shares && (
                <>
                  <hr className="my-6" />

                  {/* Sales Summary */}
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Sales Summary</h3>
                    <div className="bg-blue-50 rounded-lg p-4 space-y-3 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Gross Sales</span>
                        <span className="text-lg font-bold">${shares.grossSales.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center text-red-600">
                        <span className="font-medium">Tax ({shares.taxPct}%)</span>
                        <span className="text-lg font-bold">-${shares.tax.toFixed(2)}</span>
                      </div>

                      <hr className="my-2 border-blue-200" />

                      <div className="flex justify-between items-center text-lg">
                        <span className="font-bold">Net Sales</span>
                        <span className="font-bold text-blue-600">${shares.netSales.toFixed(2)}</span>
                      </div>

                      {ticketCount && Number(ticketCount) > 0 && (
                        <div className="flex justify-between items-center text-green-700 bg-green-50 p-2 rounded mt-2">
                          <span className="font-medium">Value per Person</span>
                          <span className="text-lg font-bold">${(shares.grossSales / Number(ticketCount)).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Revenue Split from Net Sales */}
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Revenue Split (from Net Sales)</h3>

                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      {event.artist && (
                        <div className="flex justify-between items-center">
                          <span className="font-medium">Artist ({event.artist_share_percent}%)</span>
                          <span className="text-lg font-bold">${shares.artistShare.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="flex justify-between items-center">
                        <span className="font-medium">Venue ({event.venue_share_percent}%)</span>
                        <span className="text-lg font-bold">${shares.venueShare.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="font-medium">PDS ({event.pds_share_percent}%)</span>
                        <span className="text-lg font-bold">${shares.pdsShare.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Merchandise Tab */}
          {activeTab === 'merchandise' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-4">Merchandise Information</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="font-semibold block mb-2">Merchandise Units Sold</label>
                    <input
                      type="number"
                      value={merchandiseUnits}
                      onChange={(e) => setMerchandiseUnits(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Merchandise Total Value ($)</label>
                    <input
                      type="number"
                      value={merchandiseValue}
                      onChange={(e) => setMerchandiseValue(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Ticket Sales (# of People/Tickets)</label>
                    <input
                      type="number"
                      value={ticketCount}
                      onChange={(e) => setTicketCount(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full p-3 border rounded focus:ring-2 focus:ring-blue-500 text-lg"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveMerchandise}
                  disabled={submitting}
                  className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded transition disabled:bg-gray-400"
                >
                  {submitting ? "Saving..." : "Save Merchandise Data"}
                </button>
              </div>

              {merchandiseValue && ticketSales && Number(merchandiseValue) > 0 && Number(ticketSales) > 0 && (
                <>
                  <hr className="my-6" />

                  {/* Merchandise Summary */}
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Merchandise Summary</h3>
                    <div className="bg-purple-50 rounded-lg p-4 space-y-3 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Total Merchandise Value</span>
                        <span className="text-lg font-bold">${Number(merchandiseValue).toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="font-medium">Total Ticket Sales</span>
                        <span className="text-lg font-bold">${Number(ticketSales).toFixed(2)}</span>
                      </div>

                      <hr className="my-2 border-purple-200" />

                      <div className="flex justify-between items-center text-lg">
                        <span className="font-bold">Merchandise Value per Ticket Sale Dollar</span>
                        <span className="font-bold text-purple-600">
                          ${(Number(merchandiseValue) / Number(ticketSales)).toFixed(2)}
                        </span>
                      </div>

                      {ticketCount && Number(ticketCount) > 0 && (
                        <div className="flex justify-between items-center text-green-700 bg-green-50 p-2 rounded mt-2">
                          <span className="font-medium">Merchandise Value per Person</span>
                          <span className="text-lg font-bold">
                            ${(Number(merchandiseValue) / Number(ticketCount)).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Team Tab */}
          {activeTab === 'team' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Event Team</h2>
                <button
                  onClick={loadTeam}
                  disabled={loadingTeam}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition disabled:bg-gray-400"
                >
                  {loadingTeam ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              {loadingTeam ? (
                <div className="text-center py-12">
                  <div className="inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <p className="mt-4 text-gray-600">Loading team members...</p>
                </div>
              ) : teamMembers.length === 0 ? (
                <div className="bg-gray-50 rounded-lg p-8 text-center">
                  <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <p className="text-gray-600 text-lg font-medium">No team members assigned yet</p>
                  <p className="text-gray-500 text-sm mt-2">Create a team from the dashboard to invite vendors</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Team Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-blue-600 mb-1">Total Invited</div>
                      <div className="text-2xl font-bold text-blue-900">{teamMembers.length}</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-green-600 mb-1">Confirmed</div>
                      <div className="text-2xl font-bold text-green-900">
                        {teamMembers.filter(m => m.status === 'confirmed').length}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-amber-600 mb-1">Pending</div>
                      <div className="text-2xl font-bold text-amber-900">
                        {teamMembers.filter(m => m.status === 'pending_confirmation').length}
                      </div>
                    </div>
                  </div>

                  {/* Team Members List */}
                  <div className="bg-white border rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Vendor
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Email
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Phone
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Invited On
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {teamMembers.map((member: any) => {
                          console.log('🔍 Team member data:', member);

                          const profile = member.users?.profiles;
                          const firstName = profile?.first_name || 'N/A';
                          const lastName = profile?.last_name || '';
                          const email = member.users?.email || 'N/A';
                          const phone = profile?.phone || 'N/A';

                          // Get profile photo URL (converted by API)
                          const profilePhotoUrl = profile?.profile_photo_url || null;

                          let statusBadge = '';
                          let statusColor = '';

                          switch (member.status) {
                            case 'confirmed':
                              statusBadge = 'Confirmed';
                              statusColor = 'bg-green-100 text-green-800';
                              break;
                            case 'declined':
                              statusBadge = 'Declined';
                              statusColor = 'bg-red-100 text-red-800';
                              break;
                            case 'pending_confirmation':
                              statusBadge = 'Pending';
                              statusColor = 'bg-amber-100 text-amber-800';
                              break;
                            case 'assigned':
                              statusBadge = 'Assigned';
                              statusColor = 'bg-blue-100 text-blue-800';
                              break;
                            default:
                              statusBadge = member.status || 'Unknown';
                              statusColor = 'bg-gray-100 text-gray-800';
                          }

                          return (
                            <tr key={member.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="flex-shrink-0 h-10 w-10">
                                    {profilePhotoUrl ? (
                                      <img
                                        src={profilePhotoUrl}
                                        alt={`${firstName} ${lastName}`}
                                        className="h-10 w-10 rounded-full object-cover"
                                        onError={(e) => {
                                          // Fallback to initials if image fails to load
                                          const target = e.target as HTMLImageElement;
                                          target.style.display = 'none';
                                          if (target.nextSibling) {
                                            (target.nextSibling as HTMLElement).style.display = 'flex';
                                          }
                                        }}
                                      />
                                    ) : null}
                                    <div
                                      className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold"
                                      style={{ display: profilePhotoUrl ? 'none' : 'flex' }}
                                    >
                                      {firstName.charAt(0)}{lastName.charAt(0)}
                                    </div>
                                  </div>
                                  <div className="ml-4">
                                    <div className="text-sm font-medium text-gray-900">
                                      {firstName} {lastName}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{email}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{phone}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}`}>
                                  {statusBadge}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {new Date(member.created_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric'
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
