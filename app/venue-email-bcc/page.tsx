"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
};

type BccEntry = {
  id: string;
  venue_id: string;
  user_id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  created_at: string;
};

type User = {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
};

export default function VenueEmailBccPage() {
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [bccEntries, setBccEntries] = useState<BccEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const getToken = async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          window.location.href = "/login";
          return;
        }

        // Role check
        const { data: userData } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single() as { data: { role: string } | null; error: unknown };

        if (!userData || !["exec", "admin"].includes(userData.role)) {
          alert("Access denied. This page is for executives only.");
          window.location.href = "/dashboard";
          return;
        }

        // Load venues
        const venuesRes = await fetch("/api/venues", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (venuesRes.ok) {
          const venuesData = await venuesRes.json();
          setVenues(venuesData.venues || []);
        }

      } catch (err) {
        console.error("Init error:", err);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  // Refresh the managers list every time the add modal opens so newly
  // promoted managers always appear without requiring a page reload.
  useEffect(() => {
    if (!showAddModal) return;

    const fetchUsers = async () => {
      try {
        const t = await getToken();
        const res = await fetch("/api/users/managers", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${t}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAllUsers(data.managers || []);
        }
      } catch (err) {
        console.error("Error refreshing managers:", err);
      }
    };

    fetchUsers();
  }, [showAddModal]);

  // Load BCC entries whenever selected venue changes
  useEffect(() => {
    if (!selectedVenueId) {
      setBccEntries([]);
      return;
    }

    const loadEntries = async () => {
      setLoadingEntries(true);
      try {
        const t = await getToken();
        const res = await fetch(
          `/api/venue-email-bcc?venue_id=${selectedVenueId}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${t}` } }
        );
        if (res.ok) {
          const data = await res.json();
          setBccEntries(data.entries || []);
        }
      } catch (err) {
        console.error("Error loading BCC entries:", err);
      } finally {
        setLoadingEntries(false);
      }
    };

    loadEntries();
  }, [selectedVenueId]);

  const handleAdd = async () => {
    if (!selectedUserId || !selectedVenueId) return;
    setAdding(true);
    try {
      const t = await getToken();
      const res = await fetch("/api/venue-email-bcc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify({
          venue_id: selectedVenueId,
          user_id: selectedUserId,
        }),
      });

      if (res.ok) {
        // Reload entries
        const entriesRes = await fetch(
          `/api/venue-email-bcc?venue_id=${selectedVenueId}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${t}` } }
        );
        if (entriesRes.ok) {
          const data = await entriesRes.json();
          setBccEntries(data.entries || []);
        }
        setShowAddModal(false);
        setSelectedUserId("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to add BCC recipient");
      }
    } catch (err) {
      console.error("Error adding BCC entry:", err);
      alert("Failed to add BCC recipient");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (entryId: string) => {
    if (!confirm("Remove this person from the BCC list for this venue?")) return;
    setRemoving(entryId);
    try {
      const t = await getToken();
      const res = await fetch(`/api/venue-email-bcc?id=${entryId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        setBccEntries((prev) => prev.filter((e) => e.id !== entryId));
      } else {
        const err = await res.json();
        alert(err.error || "Failed to remove BCC recipient");
      }
    } catch (err) {
      console.error("Error removing BCC entry:", err);
      alert("Failed to remove BCC recipient");
    } finally {
      setRemoving(null);
    }
  };

  const selectedVenue = venues.find((v) => v.id === selectedVenueId);

  // Filter out users already in the BCC list
  const existingUserIds = new Set(bccEntries.map((e) => e.user_id));
  const availableUsers = allUsers.filter((u) => !existingUserIds.has(u.id));

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="apple-spinner mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-4xl py-10 px-6">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-gray-900 tracking-tight">
              Venue Email BCC Settings
            </h1>
            <p className="text-gray-600 mt-1">
              Configure which managers are automatically BCC&apos;d on
              event-dashboard emails for each venue.
            </p>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <Link href="/venue-management">
              <button className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm border border-gray-200">
                ← Venue Management
              </button>
            </Link>
          </div>
        </div>

        {/* Venue selector */}
        <div className="apple-card p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Venue
          </label>
          <select
            value={selectedVenueId}
            onChange={(e) => setSelectedVenueId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">-- Choose a venue --</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.venue_name} — {v.city}, {v.state}
              </option>
            ))}
          </select>
        </div>

        {/* BCC list for selected venue */}
        {selectedVenueId && (
          <div className="apple-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  BCC Recipients
                </h2>
                {selectedVenue && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    {selectedVenue.venue_name} &mdash; {selectedVenue.city},{" "}
                    {selectedVenue.state}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setSelectedUserId("");
                  setShowAddModal(true);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
              >
                + Add Recipient
              </button>
            </div>

            {loadingEntries ? (
              <div className="py-8 text-center text-gray-500 text-sm">
                Loading&hellip;
              </div>
            ) : bccEntries.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-gray-400 text-sm">
                  No BCC recipients configured for this venue.
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  Add a manager to be automatically BCC&apos;d on all
                  event-dashboard emails for this venue.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {bccEntries.map((entry) => {
                  const fullName =
                    [entry.first_name, entry.last_name]
                      .filter(Boolean)
                      .join(" ") || "—";
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {fullName}
                        </p>
                        <p className="text-xs text-gray-500">{entry.email}</p>
                        <span className="inline-block mt-0.5 px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs capitalize">
                          {entry.role}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemove(entry.id)}
                        disabled={removing === entry.id}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {removing === entry.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {bccEntries.length > 0 && (
              <p className="mt-4 text-xs text-gray-400 border-t border-gray-100 pt-4">
                These recipients will be automatically BCC&apos;d on location
                assignment emails and vendor invitation emails sent from the
                event dashboard for events at this venue.
              </p>
            )}
          </div>
        )}

        {!selectedVenueId && (
          <div className="text-center py-16 text-gray-400 text-sm">
            Select a venue above to view and manage its BCC settings.
          </div>
        )}
      </div>

      {/* Add Recipient Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Add BCC Recipient
            </h3>
            <p className="text-sm text-gray-500 mb-5">
              Select a manager to BCC on all event emails for{" "}
              <strong>{selectedVenue?.venue_name}</strong>.
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-1">
              Manager / User
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5 bg-white"
            >
              <option value="">-- Select a person --</option>
              {availableUsers.map((u) => {
                const name =
                  [u.first_name, u.last_name].filter(Boolean).join(" ") ||
                  u.email;
                return (
                  <option key={u.id} value={u.id}>
                    {name} ({u.email}) — {u.role}
                  </option>
                );
              })}
            </select>

            {availableUsers.length === 0 && (
              <p className="text-xs text-gray-400 mb-4">
                All available managers are already in the BCC list for this
                venue.
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedUserId("");
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!selectedUserId || adding}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add to BCC"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
