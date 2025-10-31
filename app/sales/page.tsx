"use client";
import React, { useState, useEffect, Suspense } from "react";
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

type User = {
  id: string;
  email: string;
  role: string;
  division: string;
  is_active: boolean;
  profiles: {
    first_name: string;
    last_name: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    profile_photo_url?: string | null;
  };
  region_id: string | null;
};

function SalesContent() {
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

  // Region filtering state
  const [users, setUsers] = useState<User[]>([]);
  const [regions, setRegions] = useState<Array<{id: string; name: string}>>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>("all");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string>("");

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

  // Load regions and users
  useEffect(() => {
    if (!isAuthed) return;
    loadRegions();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

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

  const loadRegions = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/regions', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (res.ok) {
        const data = await res.json();
        setRegions(data.regions || []);
      }
    } catch (err) {
      console.error('Failed to load regions:', err);
    }
  };

  const loadUsers = async (regionFilter: string = 'all') => {
    setLoadingUsers(true);
    setUsersError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const params = new URLSearchParams();
      if (regionFilter && regionFilter !== 'all') {
        params.append('region_id', regionFilter);
      }

      const url = `/api/employees${params.toString() ? `?${params.toString()}` : ''}`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load users');
      }

      setUsers(data.employees || []);
    } catch (err: any) {
      console.error('Error loading users:', err);
      setUsersError(err.message || 'Failed to load users');
    }
    setLoadingUsers(false);
  };

  const handleRegionChange = async (newRegion: string) => {
    setSelectedRegion(newRegion);
    await loadUsers(newRegion);
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
                  Gross Total Collected ($)
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
                  Commission Pool (%)
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

          <hr className="my-6" />

          {/* Users/Employees Section with Region Filter */}
          <div>
            <h3 className="text-xl font-semibold mb-4">Employees/Workers</h3>

            {/* Region Filter */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Filter by Region
                {regions.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    ({regions.length} {regions.length === 1 ? 'region' : 'regions'} available)
                  </span>
                )}
              </label>
              <select
                value={selectedRegion}
                onChange={(e) => handleRegionChange(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
              >
                <option value="all">🌎 All Regions (Show All Workers)</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    📍 {region.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs text-gray-500">
                  {selectedRegion === 'all'
                    ? 'Showing workers from all geographic regions'
                    : 'Showing workers only from selected region'
                  }
                </p>
                {selectedRegion !== 'all' && (
                  <button
                    onClick={() => handleRegionChange('all')}
                    className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            </div>

            {/* Filter Status Banner */}
            {selectedRegion !== 'all' && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2.5 flex items-center justify-between mb-4">
                <div className="flex items-center text-sm text-purple-800">
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  <span className="font-medium">Region Filter Active:</span>
                  <span className="ml-1">{regions.find(r => r.id === selectedRegion)?.name || 'Selected Region'}</span>
                  <span className="ml-2 text-purple-600">• {users.length} {users.length === 1 ? 'worker' : 'workers'} found</span>
                </div>
                <button
                  onClick={() => handleRegionChange('all')}
                  className="text-xs text-purple-700 hover:text-purple-900 font-medium flex items-center"
                >
                  <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Clear Filter
                </button>
              </div>
            )}

            {/* Loading State */}
            {loadingUsers && (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                <p className="text-gray-600 mt-3">Loading workers...</p>
              </div>
            )}

            {/* Error State */}
            {usersError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {usersError}
              </div>
            )}

            {/* Empty State */}
            {!loadingUsers && !usersError && users.length === 0 && (
              <div className="bg-gray-50 rounded-lg p-8 text-center">
                <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-gray-500 text-lg font-medium">No workers found</p>
                <p className="text-gray-400 text-sm mt-1">
                  {selectedRegion !== 'all' ? 'Try selecting a different region' : 'No workers in the system yet'}
                </p>
              </div>
            )}

            {/* Users List */}
            {!loadingUsers && !usersError && users.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm text-gray-600 mb-3">
                  Showing {users.length} {users.length === 1 ? 'worker' : 'workers'}
                </div>
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="bg-gray-50 hover:bg-gray-100 rounded-lg p-4 transition-colors border border-gray-200"
                  >
                    <div className="flex items-start gap-4">
                      {user.profiles.profile_photo_url ? (
                        <img
                          src={user.profiles.profile_photo_url}
                          alt={`${user.profiles.first_name} ${user.profiles.last_name}`}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                          {user.profiles.first_name?.charAt(0)}{user.profiles.last_name?.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold text-gray-900">
                            {user.profiles.first_name} {user.profiles.last_name}
                          </div>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                            user.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="text-gray-600 text-sm mb-1">
                          {user.email}
                          {user.profiles.phone && (
                            <>
                              <span className="mx-2 text-gray-400">•</span>
                              {user.profiles.phone}
                            </>
                          )}
                        </div>
                        {user.profiles.city && user.profiles.state && (
                          <div className="flex items-center text-xs text-gray-500">
                            <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            </svg>
                            {user.profiles.city}, {user.profiles.state}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<div className="container mx-auto max-w-4xl py-10 px-4"><div className="text-center">Loading...</div></div>}>
      <SalesContent />
    </Suspense>
  );
}
