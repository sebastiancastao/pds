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
  commission_pool: number | null; // expects fraction like 0.04 for 4%
  required_staff: number | null;
  confirmed_staff: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
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

type TabType = "edit" | "sales" | "merchandise" | "team" | "timesheet" | "hr";

export default function EventDashboardPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const eventId = params.id as string;
  const initialTab = (searchParams.get("tab") as TabType) || "edit";

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [event, setEvent] = useState<EventItem | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  const [ticketSales, setTicketSales] = useState<string>("");
  const [ticketCount, setTicketCount] = useState<string>("");
  const [commissionPool, setCommissionPool] = useState<string>(""); // fraction like 0.04
  const [taxRate, setTaxRate] = useState<string>("0");
  const [tips, setTips] = useState<string>("");

  const [merchandiseUnits, setMerchandiseUnits] = useState<string>("");
  const [merchandiseValue, setMerchandiseValue] = useState<string>("");

  // Detailed merchandise breakdown
  const [apparelGross, setApparelGross] = useState<string>("");
  const [apparelTaxRate, setApparelTaxRate] = useState<string>("0");
  const [apparelCCFeeRate, setApparelCCFeeRate] = useState<string>("0");
  const [otherGross, setOtherGross] = useState<string>("");
  const [otherTaxRate, setOtherTaxRate] = useState<string>("0");
  const [otherCCFeeRate, setOtherCCFeeRate] = useState<string>("0");
  const [musicGross, setMusicGross] = useState<string>("");
  const [musicTaxRate, setMusicTaxRate] = useState<string>("0");
  const [musicCCFeeRate, setMusicCCFeeRate] = useState<string>("0");

  // Split percentages for merchandise
  const [apparelArtistPercent, setApparelArtistPercent] = useState<string>("80");
  const [otherArtistPercent, setOtherArtistPercent] = useState<string>("80");
  const [musicArtistPercent, setMusicArtistPercent] = useState<string>("90");

  // Team & Timesheet
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [timesheetTotals, setTimesheetTotals] = useState<Record<string, number>>({});
  const [timesheetSpans, setTimesheetSpans] = useState<
    Record<
      string,
      {
        firstIn: string | null;
        lastOut: string | null;
        firstMealStart: string | null;
        lastMealEnd: string | null;
        secondMealStart: string | null;
        secondMealEnd: string | null;
      }
    >
  >({});

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
    is_active: true,
  });

  // Auth / bootstrap
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, eventId]);

  // Load team & timesheet when needed
  useEffect(() => {
    if ((activeTab === "team" || activeTab === "timesheet" || activeTab === "hr") && eventId) {
      loadTeam();
      loadTimesheetTotals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, eventId]);

  const loadVenues = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/venues-list", {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setVenues(data.venues || []);
      }
    } catch (err: any) {
      console.log("[DEBUG] Error loading venues:", err);
    }
  };

  const loadEvent = async () => {
    if (!eventId) return;

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
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
          is_active: eventData.is_active !== undefined ? eventData.is_active : true,
        });
        setTicketSales(eventData.ticket_sales?.toString() || "");
        setTicketCount(eventData.ticket_count?.toString() || "");
        setCommissionPool(eventData.commission_pool?.toString() || "");
        setTaxRate((eventData.tax_rate_percent ?? 0).toString());
        setTips((eventData as any).tips?.toString() || "");
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
      const url = `/api/events/${eventId}/team`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data.team || []);
      } else {
        const errorText = await res.text();
        console.error("Failed to load team members:", { errorText });
      }
    } catch (err: any) {
      console.error("Error loading team:", err);
    }
    setLoadingTeam(false);
  };

  const loadTimesheetTotals = async () => {
    if (!eventId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const url = `/api/events/${eventId}/timesheet`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setTimesheetTotals(data.totals || {});
        setTimesheetSpans(data.spans || {});
      } else {
        const errorText = await res.text();
        console.error("Failed to load timesheet:", { errorText });
      }
    } catch (err) {
      console.error("Exception in loadTimesheetTotals:", err);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]:
        type === "checkbox"
          ? checked
          : type === "number"
          ? value === ""
            ? null
            : Number(value)
          : value,
    }));
  };

  const handleVenueChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedVenue = venues.find((v) => v.venue_name === e.target.value);
    if (selectedVenue) {
      setForm((prev) => ({
        ...prev,
        venue: selectedVenue.venue_name,
        city: selectedVenue.city,
        state: selectedVenue.state,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        venue: "",
        city: "",
        state: "",
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    if (
      !form.event_name ||
      !form.venue ||
      !form.city ||
      !form.state ||
      !form.event_date ||
      !form.start_time ||
      !form.end_time
    ) {
      setMessage("Please fill all required fields");
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        ...form,
        artist_share_percent: form.artist_share_percent || 0,
        venue_share_percent: form.venue_share_percent || 0,
        pds_share_percent: form.pds_share_percent || 0,
      };

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify(payload),
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
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          ...event,
          ticket_sales: ticketSales !== "" ? Number(ticketSales) : null,
          ticket_count: ticketCount !== "" ? Number(ticketCount) : null,
          commission_pool: commissionPool !== "" ? Number(commissionPool) : null, // fraction (0.04)
          tax_rate_percent: taxRate !== "" ? Number(taxRate) : 0,
          tips: tips !== "" ? Number(tips) : null,
        }),
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
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          ...event,
          merchandise_units: merchandiseUnits !== "" ? Number(merchandiseUnits) : null,
          merchandise_value: merchandiseValue !== "" ? Number(merchandiseValue) : null,
        }),
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

  // Sales calc (vertical)
  const calculateShares = () => {
    if (!event || ticketSales === "") return null;

    const grossCollected = Number(ticketSales) || 0; // total collected
    const tipsNum = Number(tips) || 0;
    const taxPct = clamp(Number(taxRate || 0), 0, 100);

    const totalSales = Math.max(grossCollected - tipsNum, 0); // Total collected − Tips
    const tax = totalSales * (taxPct / 100);
    const netSales = Math.max(totalSales - tax, 0);

    const artistShare = netSales * (event.artist_share_percent / 100);
    const venueShare = netSales * (event.venue_share_percent / 100);
    const pdsShare = netSales * (event.pds_share_percent / 100);

    return { grossCollected, tipsNum, totalSales, taxPct, tax, netSales, artistShare, venueShare, pdsShare };
  };

  // Helper to format ISO -> "HH:mm" for inputs
  const isoToHHMM = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
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
        <div className="bg-red-100 border-red-400 text-red-700 px-6 py-3 rounded">Event not found</div>
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
        <div
          className={`mb-4 px-6 py-3 rounded relative ${
            message.toLowerCase().includes("success")
              ? "bg-green-100 border-green-400 text-green-700"
              : "bg-red-100 border-red-400 text-red-700"
          }`}
        >
          {message}
          <button onClick={() => setMessage("")} className="absolute top-2 right-2 font-bold">
            ×
          </button>
        </div>
      )}

      {percentTotal !== 100 && (
        <div className="mb-4 px-6 py-3 rounded bg-amber-100 text-amber-800">
          Heads up: your split percentages add up to {percentTotal}% (not 100%).
        </div>
      )}

      <div className="bg-white shadow-md rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
          <h1 className="text-3xl font-bold">{event.event_name}</h1>
          <div className="mt-2 text-blue-100">
            <p>
              <strong>Venue:</strong> {event.venue} ({event.city}, {event.state})
            </p>
            {event.artist && (
              <p>
                <strong>Artist:</strong> {event.artist}
              </p>
            )}
            <p>
              <strong>Date:</strong> {event.event_date} | {event.start_time?.slice(0, 5)} -{" "}
              {event.end_time?.slice(0, 5)}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b">
          <nav className="flex">
            {[
              ["edit", "Edit Event"],
              ["sales", "Sales"],
              ["merchandise", "Merchandise"],
              ["team", "Team"],
              ["timesheet", "TimeSheet"],
              ["hr", "Payment"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as TabType)}
                className={`px-6 py-3 font-semibold border-b-2 transition ${
                  activeTab === (key as TabType)
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-600 hover:text-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* EDIT TAB */}
          {activeTab === "edit" && (
            <form onSubmit={handleSubmit} className="space-y-6">
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
                  <p className="text-xs text-gray-500 mt-1">Enter as fraction (e.g., 0.04 for 4%).</p>
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
                <label htmlFor="is_active" className="font-semibold">
                  Is Active
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded transition"
                disabled={submitting}
              >
                {submitting ? "Updating..." : "Update Event"}
              </button>
            </form>
          )}

          {/* SALES TAB */}
          {activeTab === "sales" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-4">Sales Information</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold block mb-2">Total Collected ($)</label>
                    <input
                      type="number"
                      value={ticketSales}
                      onChange={(e) => setTicketSales(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="liquid-input w-full p-3 text-lg"
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
                      className="liquid-input w-full p-3 text-lg"
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
                      className="liquid-input w-full p-3 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Tips ($)</label>
                    <input
                      type="number"
                      value={tips}
                      onChange={(e) => setTips(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="liquid-input w-full p-3 text-lg"
                    />
                  </div>

                  <div>
                    <label className="font-semibold block mb-2">Commission Pool (%)</label>
                    <input
                      type="number"
                      value={commissionPool}
                      onChange={(e) => setCommissionPool(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="liquid-input w-full p-3 text-lg"
                    />
                    <p className="text-xs text-gray-500 mt-1">Enter as fraction (e.g., 0.04 for 4%).</p>
                  </div>

                  {/* Commission ($) */}
                  <div>
                    <label className="font-semibold block mb-2">Commission ($)</label>
                    <input
                      type="number"
                      value={(() => {
                        const s = calculateShares();
                        if (!s) return "";
                        const pool = Number(commissionPool || event?.commission_pool || 0) || 0;
                        const commissionAmount = s.netSales * pool;
                        return commissionAmount.toFixed(2);
                      })()}
                      readOnly
                      className="liquid-input w-full p-3 text-lg bg-gray-100 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Auto: Net Sales × Commission Pool (fraction)
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleSaveSales}
                  disabled={submitting}
                  className="liquid-btn-primary mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    <div className="liquid-card-blue p-6 space-y-3 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-900">Total collected</span>
                        <span className="text-xl font-bold text-gray-900">
                          ${shares.grossCollected.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-900">− Tips</span>
                        <span className="text-xl font-bold">−${shares.tipsNum.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-900">= Total Sales</span>
                        <span className="text-xl font-bold text-gray-900">
                          ${shares.totalSales.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-red-600">
                        <span className="font-semibold">− Tax ({shares.taxPct}%)</span>
                        <span className="text-xl font-bold">−${shares.tax.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center border-t pt-2 text-xl">
                        <span className="font-bold text-gray-900">= Net Sales</span>
                        <span className="font-bold text-ios-blue">${shares.netSales.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Per Person */}
                  {ticketCount && Number(ticketCount) > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Per Person Metrics</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="liquid-card-compact p-6 text-center">
                          <div className="text-sm font-semibold text-gray-600 mb-2">$ / Head (Total)</div>
                          <div className="text-3xl font-bold text-ios-blue tracking-apple-tight">
                            {(shares.grossCollected / Number(ticketCount)).toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">Based on Total collected</div>
                        </div>

                        <div className="liquid-card-compact p-6 text-center">
                          <div className="text-sm font-semibold text-gray-600 mb-2">Avg $ (Total Sales)</div>
                          <div className="text-3xl font-bold text-ios-purple tracking-apple-tight">
                            {(shares.totalSales / Number(ticketCount)).toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">After tips removed</div>
                        </div>

                        <div className="liquid-card-compact p-6 text-center">
                          <div className="text-sm font-semibold text-gray-600 mb-2">Avg $ (Net)</div>
                          <div className="text-3xl font-bold text-ios-teal tracking-apple-tight">
                            {(shares.netSales / Number(ticketCount)).toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">After tax removed</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Split */}
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

          {/* MERCH TAB */}
          {activeTab === "merchandise" && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold mb-6">Merchandise Settlement</h2>

              <div className="bg-gray-50 p-6 rounded-lg space-y-4">
                <h3 className="text-lg font-semibold mb-4">Enter Sales Data</h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Apparel */}
                  <div className="bg-white p-4 rounded border">
                    <h4 className="font-bold text-gray-700 mb-3">Apparel</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium block mb-1">Gross Sales ($)</label>
                        <input
                          type="number"
                          value={apparelGross}
                          onChange={(e) => setApparelGross(e.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-sm font-medium block mb-1">Sales Tax (%)</label>
                          <input
                            type="number"
                            value={apparelTaxRate}
                            onChange={(e) => setApparelTaxRate(e.target.value)}
                            placeholder="0"
                            step="0.01"
                            min="0"
                            max="100"
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium block mb-1">CC Fee (%)</label>
                          <input
                            type="number"
                            value={apparelCCFeeRate}
                            onChange={(e) => setApparelCCFeeRate(e.target.value)}
                            placeholder="0"
                            step="0.01"
                            min="0"
                            max="100"
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-1">Artist Share (%)</label>
                        <input
                          type="number"
                          value={apparelArtistPercent}
                          onChange={(e) => setApparelArtistPercent(e.target.value)}
                          placeholder="80"
                          step="1"
                          min="0"
                          max="100"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Other */}
                  <div className="bg-white p-4 rounded border">
                    <h4 className="font-bold text-gray-700 mb-3">Other</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium block mb-1">Gross Sales ($)</label>
                        <input
                          type="number"
                          value={otherGross}
                          onChange={(e) => setOtherGross(e.target.value)}
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-sm font-medium block mb-1">Sales Tax (%)</label>
                          <input
                            type="number"
                            value={otherTaxRate}
                            onChange={(e) => setOtherTaxRate(e.target.value)}
                            placeholder="0"
                            step="0.01"
                            min="0"
                            max="100"
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium block mb-1">CC Fee (%)</label>
                          <input
                            type="number"
                            value={otherCCFeeRate}
                            onChange={(e) => setOtherCCFeeRate(e.target.value)}
                            placeholder="0"
                            step="0.01"
                            min="0"
                            max="100"
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-1">Artist Share (%)</label>
                        <input
                          type="number"
                          value={otherArtistPercent}
                          onChange={(e) => setOtherArtistPercent(e.target.value)}
                          placeholder="80"
                          step="1"
                          min="0"
                          max="100"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Music */}
                <div className="bg-white p-4 rounded border max-w-md">
                  <h4 className="font-bold text-gray-700 mb-3">Music Sales</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium block mb-1">Gross Sales ($)</label>
                      <input
                        type="number"
                        value={musicGross}
                        onChange={(e) => setMusicGross(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-sm font-medium block mb-1">Sales Tax (%)</label>
                        <input
                          type="number"
                          value={musicTaxRate}
                          onChange={(e) => setMusicTaxRate(e.target.value)}
                          placeholder="0"
                          step="0.01"
                          min="0"
                          max="100"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium block mb-1">CC Fee (%)</label>
                        <input
                          type="number"
                          value={musicCCFeeRate}
                          onChange={(e) => setMusicCCFeeRate(e.target.value)}
                          placeholder="0"
                          step="0.01"
                          min="0"
                          max="100"
                          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1">Artist Share (%)</label>
                      <input
                        type="number"
                        value={musicArtistPercent}
                        onChange={(e) => setMusicArtistPercent(e.target.value)}
                        placeholder="90"
                        step="1"
                        min="0"
                        max="100"
                        className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveMerchandise}
                    disabled={submitting}
                    className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded transition disabled:bg-gray-400"
                  >
                    {submitting ? "Saving..." : "Calculate Settlement"}
                  </button>
                </div>
              </div>

              {/* Settlement Summary */}
              {(() => {
                const appGross = Number(apparelGross) || 0;
                const appTax = (appGross * (Number(apparelTaxRate) || 0)) / 100;
                const appCC = (appGross * (Number(apparelCCFeeRate) || 0)) / 100;
                const appAdjusted = appGross - appTax - appCC;

                const othGross = Number(otherGross) || 0;
                const othTax = (othGross * (Number(otherTaxRate) || 0)) / 100;
                const othCC = (othGross * (Number(otherCCFeeRate) || 0)) / 100;
                const othAdjusted = othGross - othTax - othCC;

                const merchGross = appGross + othGross;
                const merchTax = appTax + othTax;
                const merchCC = appCC + othCC;
                const merchAdjusted = appAdjusted + othAdjusted;

                const musGross = Number(musicGross) || 0;
                const musTax = (musGross * (Number(musicTaxRate) || 0)) / 100;
                const musCC = (musGross * (Number(musicCCFeeRate) || 0)) / 100;
                const musAdjusted = musGross - musTax - musCC;

                const totalGross = merchGross + musGross;
                const totalTax = merchTax + musTax;
                const totalCC = merchCC + musCC;
                const totalAdjusted = merchAdjusted + musAdjusted;

                const appArtistPct = Number(apparelArtistPercent) || 0;
                const othArtistPct = Number(otherArtistPercent) || 0;
                const musArtistPct = Number(musicArtistPercent) || 0;

                const appArtistCut = (appAdjusted * appArtistPct) / 100;
                const appVenueCut = (appAdjusted * (100 - appArtistPct)) / 100;

                const othArtistCut = (othAdjusted * othArtistPct) / 100;
                const othVenueCut = (othAdjusted * (100 - othArtistPct)) / 100;

                const musArtistCut = (musAdjusted * musArtistPct) / 100;
                const musVenueCut = (musAdjusted * (100 - musArtistPct)) / 100;

                const totalArtist = appArtistCut + othArtistCut + musArtistCut;
                const totalVenue = appVenueCut + othVenueCut + musVenueCut;

                const hasData = appGross > 0 || othGross > 0 || musGross > 0;

                return hasData ? (
                  <>
                    <hr className="my-6" />

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Merchandise Sales */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Merchandise Sales</h3>
                        <div className="bg-white border border-gray-200 rounded-b p-4 space-y-3">
                          <div className="grid grid-cols-3 gap-2 text-sm font-semibold border-b pb-2">
                            <div>Category</div>
                            <div className="text-right">Apparel</div>
                            <div className="text-right">Other</div>
                            <div className="col-span-3 border-b pt-2"></div>
                            <div>Total</div>
                            <div className="text-right">${appGross.toFixed(2)}</div>
                            <div className="text-right">${othGross.toFixed(2)}</div>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Gross Sales</span>
                              <span className="font-bold">${merchGross.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Sales Tax</span>
                              <span>- ${merchTax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Fee: credit card</span>
                              <span>- ${merchCC.toFixed(2)}</span>
                            </div>
                            <hr />
                            <div className="flex justify-between font-bold text-base">
                              <span>Adjusted Gross</span>
                              <span className="text-green-600">${merchAdjusted.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Music Sales */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Music Sales</h3>
                        <div className="bg-white border border-gray-200 rounded-b p-4 space-y-3">
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Total</span>
                              <span className="font-bold">${musGross.toFixed(2)}</span>
                            </div>
                          </div>

                          <div className="space-y-2 text-sm pt-6">
                            <div className="flex justify-between">
                              <span className="font-medium">Gross Sales</span>
                              <span className="font-bold">${musGross.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Sales Tax</span>
                              <span>- ${musTax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Fee: credit card</span>
                              <span>- ${musCC.toFixed(2)}</span>
                            </div>
                            <hr />
                            <div className="flex justify-between font-bold text-base">
                              <span>Adjusted Gross</span>
                              <span className="text-green-600">${musAdjusted.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Total Sales */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Total Sales</h3>
                        <div className="bg-white border border-gray-200 rounded-b p-4 space-y-3">
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="font-medium">Total</span>
                              <span className="font-bold">${totalGross.toFixed(2)}</span>
                            </div>
                          </div>

                          <div className="space-y-2 text-sm pt-6">
                            <div className="flex justify-between">
                              <span className="font-medium">Gross Sales</span>
                              <span className="font-bold">${totalGross.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Sales Tax</span>
                              <span>- ${totalTax.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-red-600">
                              <span>Fee: credit card</span>
                              <span>- ${totalCC.toFixed(2)}</span>
                            </div>
                            <hr />
                            <div className="flex justify-between font-bold text-base">
                              <span>Adjusted Gross</span>
                              <span className="text-green-600">${totalAdjusted.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Settlement Bar */}
                    <div className="bg-gray-700 text-white p-4 rounded flex justify-between items-center mt-4">
                      <span className="text-xl font-bold">Settlement</span>
                      <div className="flex gap-8">
                        <div>
                          <span className="text-sm opacity-80">Total Due Artist: </span>
                          <span className="text-2xl font-bold">${totalArtist.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-sm opacity-80">Total Due Venue: </span>
                          <span className="text-2xl font-bold">${totalVenue.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                      {/* Artist */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Artist</h3>
                        <div className="bg-white border border-gray-200 rounded-b overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left p-3 font-medium">Category</th>
                                <th className="text-right p-3 font-medium">Cuts</th>
                                <th className="text-right p-3 font-medium">Fees</th>
                                <th className="text-right p-3 font-medium">Taxes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              <tr>
                                <td className="p-3">Apparel ({appArtistPct}%)</td>
                                <td className="text-right p-3">${appArtistCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                              <tr>
                                <td className="p-3">Other ({othArtistPct}%)</td>
                                <td className="text-right p-3">${othArtistCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                              <tr className="font-semibold bg-gray-50">
                                <td className="p-3">Merch Subtotal</td>
                                <td className="text-right p-3">
                                  ${(appArtistCut + othArtistCut).toFixed(2)}
                                </td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                              <tr>
                                <td className="p-3">Music ({musArtistPct}%)</td>
                                <td className="text-right p-3">${musArtistCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">$0.00</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Venue */}
                      <div>
                        <h3 className="text-lg font-bold bg-gray-200 p-3 rounded-t">Venue</h3>
                        <div className="bg-white border border-gray-200 rounded-b overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left p-3 font-medium">Category</th>
                                <th className="text-right p-3 font-medium">Cuts</th>
                                <th className="text-right p-3 font-medium">Fees</th>
                                <th className="text-right p-3 font-medium">Taxes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              <tr>
                                <td className="p-3">Apparel ({100 - appArtistPct}%)</td>
                                <td className="text-right p-3">${appVenueCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${appTax.toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td className="p-3">Other ({100 - othArtistPct}%)</td>
                                <td className="text-right p-3">${othVenueCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${othTax.toFixed(2)}</td>
                              </tr>
                              <tr className="font-semibold bg-gray-50">
                                <td className="p-3">Merch Subtotal</td>
                                <td className="text-right p-3">
                                  ${(appVenueCut + othVenueCut).toFixed(2)}
                                </td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${(appTax + othTax).toFixed(2)}</td>
                              </tr>
                              <tr>
                                <td className="p-3">Music ({100 - musArtistPct}%)</td>
                                <td className="text-right p-3">${musVenueCut.toFixed(2)}</td>
                                <td className="text-right p-3">$0.00</td>
                                <td className="text-right p-3">${musTax.toFixed(2)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null;
              })()}
            </div>
          )}

          {/* TEAM TAB */}
          {activeTab === "team" && (
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
                  <p className="text-gray-600 text-lg font-medium">No team members assigned yet</p>
                  <p className="text-gray-500 text-sm mt-2">Create a team from the dashboard to invite vendors</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-blue-600 mb-1">Total Invited</div>
                      <div className="text-2xl font-bold text-blue-900">{teamMembers.length}</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-green-600 mb-1">Confirmed</div>
                      <div className="text-2xl font-bold text-green-900">
                        {teamMembers.filter((m) => m.status === "confirmed").length}
                      </div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-amber-600 mb-1">Pending</div>
                      <div className="text-2xl font-bold text-amber-900">
                        {teamMembers.filter((m) => m.status === "pending_confirmation").length}
                      </div>
                    </div>
                  </div>

                  {/* List */}
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
                          const profile = member.users?.profiles;
                          const firstName = profile?.first_name || "N/A";
                          const lastName = profile?.last_name || "";
                          const email = member.users?.email || "N/A";
                          const phone = profile?.phone || "N/A";

                          let statusBadge = "";
                          let statusColor = "";
                          switch (member.status) {
                            case "confirmed":
                              statusBadge = "Confirmed";
                              statusColor = "bg-green-100 text-green-800";
                              break;
                            case "declined":
                              statusBadge = "Declined";
                              statusColor = "bg-red-100 text-red-800";
                              break;
                            case "pending_confirmation":
                              statusBadge = "Pending";
                              statusColor = "bg-amber-100 text-amber-800";
                              break;
                            case "assigned":
                              statusBadge = "Assigned";
                              statusColor = "bg-blue-100 text-blue-800";
                              break;
                            default:
                              statusBadge = member.status || "Unknown";
                              statusColor = "bg-gray-100 text-gray-800";
                          }

                          return (
                            <tr key={member.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">
                                  {firstName} {lastName}
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{email}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="text-sm text-gray-900">{phone}</div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span
                                  className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusColor}`}
                                >
                                  {statusBadge}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {new Date(member.created_at).toLocaleDateString("en-US", {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
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

          {/* TIMESHEET TAB */}
          {activeTab === "timesheet" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">TimeSheet</h2>
                <div className="text-sm text-gray-500">
                  Event window: {event?.start_time?.slice(0, 5)} – {event?.end_time?.slice(0, 5)}
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-sm text-blue-700 font-medium">Members</div>
                  <div className="text-2xl font-bold text-blue-900">{teamMembers.length}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-sm text-green-700 font-medium">Total Hours (decimal)</div>
                  <div className="text-2xl font-bold text-green-900">
                    {(() => {
                      const totalMs = teamMembers.reduce((acc: number, m: any) => {
                        const uid = (m.user_id || m.users?.id || "").toString();
                        return acc + (timesheetTotals[uid] || 0);
                      }, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);
                      return totalHours.toFixed(2);
                    })()}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white border rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Staff
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Clock In
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Clock Out
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 1 Start
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 1 End
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 2 Start
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Meal 2 End
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Hours
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {teamMembers.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500 text-sm">
                          No time entries yet
                        </td>
                      </tr>
                    ) : (
                      teamMembers.map((m: any) => {
                        const profile = m.users?.profiles;
                        const firstName = profile?.first_name || "N/A";
                        const lastName = profile?.last_name || "";
                        const uid = (m.user_id || m.vendor_id || m.users?.id || "").toString();

                        const span = timesheetSpans[uid] || {
                          firstIn: null,
                          lastOut: null,
                          firstMealStart: null,
                          lastMealEnd: null,
                          secondMealStart: null,
                          secondMealEnd: null,
                        };
                        const firstClockIn = isoToHHMM(span.firstIn);
                        const lastClockOut = isoToHHMM(span.lastOut);
                        const firstMealStart = isoToHHMM(span.firstMealStart);
                        const lastMealEnd = isoToHHMM(span.lastMealEnd);
                        const secondMealStart = isoToHHMM(span.secondMealStart);
                        const secondMealEnd = isoToHHMM(span.secondMealEnd);

                        const totalMs = timesheetTotals[uid] || 0;
                        const hours = (totalMs / (1000 * 60 * 60)).toFixed(2);

                        return (
                          <tr key={m.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="font-medium text-sm text-gray-900">
                                {firstName} {lastName}
                              </div>
                              <div className="text-xs text-gray-500">{m.users?.email || "N/A"}</div>
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={firstClockIn}
                                readOnly
                                className="border rounded px-2 py-1 text-sm bg-gray-100 cursor-not-allowed w-28"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={lastClockOut}
                                readOnly
                                className="border rounded px-2 py-1 text-sm bg-gray-100 cursor-not-allowed w-28"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={firstMealStart}
                                readOnly
                                placeholder="--:--"
                                className="border rounded px-2 py-1 text-sm bg-gray-100 cursor-not-allowed w-28"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={lastMealEnd}
                                readOnly
                                placeholder="--:--"
                                className="border rounded px-2 py-1 text-sm bg-gray-100 cursor-not-allowed w-28"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={secondMealStart}
                                readOnly
                                placeholder="--:--"
                                className="border rounded px-2 py-1 text-sm bg-gray-100 cursor-not-allowed w-28"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                value={secondMealEnd}
                                readOnly
                                placeholder="--:--"
                                className="border rounded px-2 py-1 text-sm bg-gray-100 cursor-not-allowed w-28"
                              />
                            </td>
                            <td className="px-3 py-3 text-sm font-medium whitespace-nowrap">{hours}</td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button className="text-blue-600 hover:text-blue-700 font-medium text-xs mr-2">
                                Save
                              </button>
                              <button className="text-gray-600 hover:text-gray-700 font-medium text-xs">
                                Clock In/Out
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* HR TAB */}
          {activeTab === "hr" && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold mb-6">HR Management</h2>

              {/* Quick Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-blue-600">Staff Assigned</div>
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-blue-900">{event?.confirmed_staff || 0}</div>
                  <div className="text-xs text-blue-600 mt-1">of {event?.required_staff || 0} required</div>
                </div>

                <div className="bg-green-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-green-600">Hours Worked</div>
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-green-900">
                    {(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = (totalMs / (1000 * 60 * 60)).toFixed(1);
                      return totalHours;
                    })()}
                  </div>
                  <div className="text-xs text-green-600 mt-1">total hours</div>
                </div>

                <div className="bg-purple-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-purple-600">Team Total Payment</div>
                    <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-purple-900">
                    ${(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);
                      const hourlyRate = 25; // Default rate
                      const totalPayment = totalHours * hourlyRate;
                      return totalPayment.toFixed(2);
                    })()}
                  </div>
                  <div className="text-xs text-purple-600 mt-1">based on actual hours</div>
                </div>

                <div className="bg-orange-50 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-orange-600">Attendance</div>
                    <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-orange-900">0%</div>
                  <div className="text-xs text-orange-600 mt-1">checked in</div>
                </div>
              </div>

              {/* Staff Schedule with Commission & Tips columns */}
              <div className="bg-white border rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Staff Schedule</h3>

                <div className="mb-4 flex gap-4">
                  <input
                    type="text"
                    placeholder="Search staff..."
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <select className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                    <option value="">All Roles</option>
                    <option value="vendor">Vendor</option>
                    <option value="cwt">CWT</option>
                  </select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left p-4 font-semibold text-gray-700">Employee</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Regular Hours</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Regular Pay</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Overtime Hours</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Overtime Pay</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Double time Hours</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Double time Pay</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Commissions</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Tips</th>
                        <th className="text-right p-4 font-semibold text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {teamMembers.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="p-8 text-center text-gray-500">
                            No staff scheduled yet
                          </td>
                        </tr>
                      ) : (
                        teamMembers.map((member: any) => {
                          const profile = member.users?.profiles;
                          const firstName = profile?.first_name || "N/A";
                          const lastName = profile?.last_name || "";
                          const uid = (member.user_id || member.vendor_id || member.users?.id || "").toString();

                          // Worked hours for member & all
                          const totalMs = timesheetTotals[uid] || 0;
                          const actualHours = totalMs / (1000 * 60 * 60);
                          const totalHoursAll =
                            Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0) /
                            (1000 * 60 * 60);

                          // Rates
                          const baseRate = 17.28;
                          const overtimeRate = baseRate * 1.5;
                          const doubletimeRate = baseRate * 2;

                          // Split hours into regular/OT/DT
                          const regularHours = Math.min(actualHours, 8);
                          const overtimeHours = Math.max(Math.min(actualHours, 12) - 8, 0);
                          const doubletimeHours = Math.max(actualHours - 12, 0);

                          const regularPay = regularHours * baseRate;
                          const overtimePay = overtimeHours * overtimeRate;
                          const doubletimePay = doubletimeHours * doubletimeRate;

                          // Commission pool (Net Sales × pool fraction)
                          const sharesData = calculateShares();
                          const netSales = sharesData?.netSales || 0;

                          // Prefer current input value; fallback to event.commission_pool
                          const poolPercent =
                            Number(commissionPool || event?.commission_pool || 0) || 0; // fraction 0.04

                          const totalCommissionPool = netSales * poolPercent;

                          // Pro-rate by hours (member_hours / total_hours_all)
                          const proratedCommission =
                            totalHoursAll > 0 ? (totalCommissionPool * actualHours) / totalHoursAll : 0;

                          // Tips prorated by hours (same method)
                          const totalTips = Number(tips) || 0;
                          const proratedTips =
                            totalHoursAll > 0 ? (totalTips * actualHours) / totalHoursAll : 0;

                          return (
                            <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold">
                                    {firstName.charAt(0)}
                                    {lastName.charAt(0)}
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-900">
                                      {firstName} {lastName}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {member.users?.email || "N/A"}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="p-4">
                                <div className="font-medium text-gray-900">
                                  {regularHours > 0 ? `${regularHours.toFixed(2)}h` : "0h"}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">actual worked</div>
                              </td>

                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600 mt-1">
                                  ${regularPay.toFixed(2)}
                                </div>
                              </td>

                              <td className="p-4">
                                <div className="font-medium text-gray-900">
                                  {overtimeHours > 0 ? `${overtimeHours.toFixed(2)}h` : "0h"}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">actual worked</div>
                              </td>

                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600 mt-1">
                                  ${overtimePay.toFixed(2)}
                                </div>
                              </td>

                              <td className="p-4">
                                <div className="font-medium text-gray-900">
                                  {doubletimeHours > 0 ? `${doubletimeHours.toFixed(2)}h` : "0h"}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">actual worked</div>
                              </td>

                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600 mt-1">
                                  ${doubletimePay.toFixed(2)}
                                </div>
                              </td>

                              {/* Commission prorated */}
                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600 mt-1">
                                  ${proratedCommission.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-gray-500">
                                  Pool {(poolPercent * 100).toFixed(2)}% on Net
                                </div>
                              </td>

                              {/* Tips prorated */}
                              <td className="p-4">
                                <div className="text-sm font-medium text-green-600 mt-1">
                                  ${proratedTips.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-gray-500">Prorated by hours</div>
                              </td>

                              <td className="p-4 text-right">
                                <button className="text-blue-600 hover:text-blue-700 font-medium text-sm mr-3">
                                  Edit
                                </button>
                                <button className="text-red-600 hover:text-red-700 font-medium text-sm">
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Payroll Summary */
              
              }
              <div className="bg-white border rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Payroll Summary</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Base Pay</span>
                    <span className="font-semibold text-gray-900"> ${(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);
                      const hourlyRate = 25; // Default rate
                      const totalPayment = totalHours * hourlyRate;
                      return totalPayment.toFixed(2);
                    })()}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Overtime</span>
                    <span className="font-semibold text-gray-900">$0.00</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Tips</span>
                    <span className="font-semibold text-gray-900">${tips || "0.00"}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-gray-600">Deductions</span>
                    <span className="font-semibold text-gray-900">$0.00</span>
                  </div>
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-lg font-bold text-gray-900">Total Payroll</span>
                    <span className="text-2xl font-bold text-green-600">{(() => {
                      const totalMs = Object.values(timesheetTotals).reduce((sum, ms) => sum + ms, 0);
                      const totalHours = totalMs / (1000 * 60 * 60);
                      const hourlyRate = 25; // Default rate
                      const totalPayment = totalHours * hourlyRate;
                      return totalPayment.toFixed(2)+tips;
                    })()}</span>
                  </div>
                  <button className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold transition">
                    Process Payroll
                  </button>
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="bg-white border rounded-lg p-6">
                <h3 className="text-xl font-semibold mb-4">Performance Metrics</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <div className="text-sm text-gray-600 mb-2">Attendance Rate</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: "0%" }}></div>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">0%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-2">On-Time Rate</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: "0%" }}></div>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">0%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-600 mb-2">Customer Rating</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-500 rounded-full" style={{ width: "0%" }}></div>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">0.0</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* END tabs */}
        </div>
      </div>
    </div>
  );
}
