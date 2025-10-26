"use client";
import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Vendor = {
  id: string;
  email: string;
  role: string;
  division: string;
  is_active: boolean;
  distance: number;
  profiles: {
    first_name: string;
    last_name: string;
    phone: string | null;
    city: string;
    state: string;
    latitude: number;
    longitude: number;
  };
};

function InviteVendorsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const venue = searchParams.get("venue");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [venueInfo, setVenueInfo] = useState<{name: string, city: string, state: string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set());

  // User and session check
  useEffect(() => {
    console.log('[DEBUG] InviteVendors - Checking user authentication...');
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        console.log('[DEBUG] InviteVendors - No user found, redirecting to /login');
        router.replace("/login");
      } else {
        console.log('[DEBUG] InviteVendors - User authenticated:', user.id, user.email);
        setIsAuthed(true);
      }
    });
  }, [router]);

  // Load vendors
  useEffect(() => {
    if (!isAuthed || !venue) return;
    loadVendors();
  }, [isAuthed, venue]);

  const loadVendors = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/vendors?venue=${encodeURIComponent(venue!)}`, {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (res.ok) {
        const data = await res.json();
        setVendors(data.vendors || []);
        setVenueInfo(data.venue || null);
      } else {
        setMessage("Failed to load vendors");
      }
    } catch (err: any) {
      setMessage("Network error loading vendors");
      console.log('[DEBUG] InviteVendors - Error loading vendors:', err);
    }
    setLoading(false);
  };

  const toggleVendorSelection = (vendorId: string) => {
    const newSelection = new Set(selectedVendors);
    if (newSelection.has(vendorId)) {
      newSelection.delete(vendorId);
    } else {
      newSelection.add(vendorId);
    }
    setSelectedVendors(newSelection);
  };

  const handleSelectAll = () => {
    if (selectedVendors.size === vendors.length) {
      setSelectedVendors(new Set());
    } else {
      setSelectedVendors(new Set(vendors.map(v => v.id)));
    }
  };

  const handleInvite = async () => {
    if (selectedVendors.size === 0) {
      setMessage("Please select at least one vendor to invite");
      return;
    }

    // TODO: Implement invite logic (e.g., create event_staff records, send notifications)
    setMessage(`Successfully invited ${selectedVendors.size} vendor(s)`);
    console.log('[DEBUG] InviteVendors - Inviting vendors:', Array.from(selectedVendors));

    // For now, just show success and redirect back
    setTimeout(() => {
      if (eventId) {
        router.push(`/edit-event/${eventId}`);
      } else {
        router.push("/dashboard");
      }
    }, 1500);
  };

  // Render nothing if not authenticated yet
  if (!isAuthed) {
    console.log('[DEBUG] InviteVendors - Not authenticated yet, no page rendered');
    return null;
  }

  if (!venue) {
    return (
      <div className="container mx-auto max-w-4xl py-10 px-4">
        <div className="bg-red-100 border-red-400 text-red-700 px-6 py-3 rounded">
          Error: Venue parameter is required
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

  return (
    <div className="container mx-auto max-w-6xl py-10 px-4">
      <div className="flex mb-6 justify-between items-center">
        <Link href={eventId ? `/edit-event/${eventId}` : "/dashboard"}>
          <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
            &larr; Back
          </button>
        </Link>
        {vendors.length > 0 && (
          <button
            onClick={handleInvite}
            disabled={selectedVendors.size === 0}
            className={`font-semibold py-2 px-6 rounded-md transition ${
              selectedVendors.size === 0
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            Invite Selected ({selectedVendors.size})
          </button>
        )}
      </div>

      {message && (
        <div className="mb-4 bg-green-100 border-green-400 text-green-700 px-6 py-3 rounded relative">
          {message}
          <button onClick={() => setMessage("")} className="absolute top-2 right-2 text-green-700 font-bold">×</button>
        </div>
      )}

      <div className="bg-white shadow-md rounded p-6">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Invite Vendors</h2>
          <p className="text-gray-600 mt-2">
            {venueInfo ? (
              <>Showing vendors within 100 miles of <strong>{venueInfo.name}</strong> ({venueInfo.city}, {venueInfo.state})</>
            ) : (
              <>Showing vendors for {venue}</>
            )}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-8">Loading vendors...</div>
        ) : vendors.length === 0 ? (
          <div className="text-center py-8 text-gray-600">
            No vendors found within 100 miles of {venueInfo?.name || venue}
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between border-b pb-3">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedVendors.size === vendors.length}
                  onChange={handleSelectAll}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-3"
                />
                <span className="font-semibold text-gray-700">
                  Select All ({vendors.length} vendors)
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {vendors.map((vendor) => (
                <div
                  key={vendor.id}
                  className="flex items-center border rounded-lg p-4 hover:bg-gray-50 transition cursor-pointer"
                  onClick={() => toggleVendorSelection(vendor.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedVendors.has(vendor.id)}
                    onChange={() => toggleVendorSelection(vendor.id)}
                    className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-4"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-lg">
                        {vendor.profiles.first_name} {vendor.profiles.last_name}
                      </div>
                      <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-semibold">
                        {vendor.distance} mi
                      </div>
                    </div>
                    <div className="text-gray-600 text-sm mt-1">
                      {vendor.email}
                      {vendor.profiles.phone && ` • ${vendor.profiles.phone}`}
                    </div>
                    <div className="text-gray-500 text-xs mt-1">
                      {vendor.profiles.city}, {vendor.profiles.state} • Division: {vendor.division} • Role: {vendor.role}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function InviteVendorsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto max-w-6xl py-10 px-4"><div className="text-center">Loading...</div></div>}>
      <InviteVendorsContent />
    </Suspense>
  );
}
