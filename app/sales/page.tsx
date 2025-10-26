"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type EventItem = {
  id: string;
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
  // optional if your DB supports it:
  tax_rate_percent?: number | null;
};

export default function SalesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");

  const [event, setEvent] = useState<EventItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);

  const [ticketSales, setTicketSales] = useState<string>("");
  const [commissionPool, setCommissionPool] = useState<string>("");
  const [taxRate, setTaxRate] = useState<string>("0"); // %

  // User and session check
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        router.replace("/login");
      } else {
        setIsAuthed(true);
      }
    });
  }, [router]);

  // Load event
  useEffect(() => {
    if (!isAuthed || !eventId) return;
    loadEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, eventId]);

  const loadEvent = async () => {
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
        const ev: EventItem = data.event;
        setEvent(ev);
        setTicketSales(ev.ticket_sales?.toString() ?? "");
        setCommissionPool(ev.commission_pool?.toString() ?? "");
        // preload tax if available, otherwise 0
        setTaxRate(
          (ev.tax_rate_percent ?? 0).toString()
        );
      } else {
        setMessage("Failed to load event details");
      }
    } catch (err: any) {
      setMessage("Network error loading event");
      console.log("[DEBUG] Sales - Error loading event:", err);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");

    const payload = {
      ...event,
      ticket_sales: ticketSales !== "" ? Number(ticketSales) : null,
      commission_pool: commissionPool !== "" ? Number(commissionPool) : null,
      // send tax if your API supports it; safe if ignored
      tax_rate_percent:
        taxRate !== "" && !isNaN(Number(taxRate)) ? Number(taxRate) : 0,
    };

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
        body: JSON.stringify(payload),
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
      console.log("[DEBUG] Sales - Error updating:", err);
    }
    setSaving(false);
  };

  const clamp = (val: number, min: number, max: number) =>
    Math.min(Math.max(val, min), max);

  const calculateShares = () => {
    if (!event) return null;
    const grossSales = Number(ticketSales || 0);
    const taxPct = clamp(Number(taxRate || 0), 0, 100);

    const tax = grossSales * (taxPct / 100);
    const netSales = Math.max(grossSales - tax, 0);

    const artistShare = netSales * (event.artist_share_percent / 100);
    const venueShare = netSales * (event.venue_share_percent / 100);
    const pdsShare = netSales * (event.pds_share_percent / 100);

    return { grossSales, taxPct, tax, netSales, artistShare, venueShare, pdsShare };
  };

  if (!isAuthed) return null;

  if (!eventId) {
    return (
      <div className="container mx-auto max-w-4xl py-10 px-4">
        <div className="bg-red-100 border-red-400 text-red-700 px-6 py-3 rounded">
          Error: Event ID is required
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

  if (loading) {
    return (
      <div className="container mx-auto max-w-4xl py-10 px-4">
        <div className="text-center">Loading event details...</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="container mx-auto max-w-4xl py-10 px-4">
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
    event.artist_share_percent +
    event.venue_share_percent +
    event.pds_share_percent;

  return (
    <div className="container mx-auto max-w-4xl py-10 px-4">
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
            message.includes("success")
              ? "bg-green-100 border-green-400 text-green-700"
              : "bg-red-100 border-red-400 text-red-700"
          }`}
        >
          {message}
          <button
            onClick={() => setMessage("")}
            className="absolute top-2 right-2 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {percentTotal !== 100 && (
        <div className="mb-4 px-6 py-3 rounded bg-amber-100 text-amber-800">
          Heads up: your split percentages add up to {percentTotal}% (not 100%).
        </div>
      )}

      <div className="bg-white shadow-md rounded p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">{event.event_name}</h2>
          <div className="text-gray-600 mt-2">
            <p>
              <strong>Venue:</strong> {event.venue}
            </p>
            {event.artist && (
              <p>
                <strong>Artist:</strong> {event.artist}
              </p>
            )}
            <p>
              <strong>Date:</strong> {event.event_date} |{" "}
              {event.start_time?.slice(0, 5)} - {event.end_time?.slice(0, 5)}
            </p>
            {event.city && event.state && (
              <p>
                <strong>Location:</strong> {event.city}, {event.state}
              </p>
            )}
          </div>
        </div>

        <hr className="my-6" />

        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold mb-4">Sales Information</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="font-semibold block mb-2">
                  Gross Ticket Sales ($)
                </label>
                <input
                  type="number"
                  value={ticketSales}
                  onChange={(e) => setTicketSales(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-full p-3 border rounded focus:ring-2 focus:ring-purple-500 text-lg"
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
                  className="w-full p-3 border rounded focus:ring-2 focus:ring-purple-500 text-lg"
                />
              </div>

              <div>
                <label className="font-semibold block mb-2">
                  Commission Pool ($)
                </label>
                <input
                  type="number"
                  value={commissionPool}
                  onChange={(e) => setCommissionPool(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-full p-3 border rounded focus:ring-2 focus:ring-purple-500 text-lg"
                />
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="mt-4 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-6 rounded transition disabled:bg-gray-400"
            >
              {saving ? "Saving..." : "Save Sales Data"}
            </button>
          </div>

          {shares && (
            <>
              <hr className="my-6" />

              <div>
                <h3 className="text-xl font-semibold mb-4">Sales Summary</h3>

                <div className="bg-blue-50 rounded-lg p-4 space-y-3 mb-4">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Gross Sales</span>
                    <span className="text-lg font-bold">
                      ${shares.grossSales.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-red-600">
                    <span className="font-medium">Tax ({shares.taxPct}%)</span>
                    <span className="text-lg font-bold">
                      -${shares.tax.toFixed(2)}
                    </span>
                  </div>

                  <hr className="my-2 border-blue-200" />

                  <div className="flex justify-between items-center text-lg">
                    <span className="font-bold">Net Sales</span>
                    <span className="font-bold text-blue-600">
                      ${shares.netSales.toFixed(2)}
                    </span>
                  </div>
                </div>

                <h3 className="text-xl font-semibold mb-4">
                  Revenue Split (from Net Sales)
                </h3>

                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  {event.artist && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        Artist ({event.artist_share_percent}%)
                      </span>
                      <span className="text-lg font-bold">
                        ${shares.artistShare.toFixed(2)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between items-center">
                    <span className="font-medium">
                      Venue ({event.venue_share_percent}%)
                    </span>
                    <span className="text-lg font-bold">
                      ${shares.venueShare.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-medium">
                      PDS ({event.pds_share_percent}%)
                    </span>
                    <span className="text-lg font-bold">
                      ${shares.pdsShare.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
