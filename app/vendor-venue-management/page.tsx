'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Venue = {
  id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
};

type Vendor = {
  id: string;
  email: string;
  role: string | null;
  division: string | null;
  is_active: boolean;
  manual_override: boolean;
  first_name: string;
  last_name: string;
  full_name: string;
};

type AssignedByUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
};

type VendorVenueAssignment = {
  id: string;
  vendor_id: string;
  venue_id: string;
  assigned_at: string | null;
  created_at: string | null;
  venue: Venue | null;
  vendor: {
    id: string;
    email: string;
    role: string | null;
    division: string | null;
    is_active: boolean;
    first_name: string;
    last_name: string;
  } | null;
  assigned_by_user: AssignedByUser | null;
};

type AssignmentsPayload = {
  vendors: Vendor[];
  venues: Venue[];
  assignments: VendorVenueAssignment[];
};

export default function VendorVenueManagementPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingAssignmentId, setDeletingAssignmentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [assignments, setAssignments] = useState<VendorVenueAssignment[]>([]);

  const [vendorSearchQuery, setVendorSearchQuery] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVenueId, setSelectedVenueId] = useState('');

  const getVendorDisplayName = useCallback((vendor: Vendor | null | undefined) => {
    if (!vendor) return 'Unknown vendor';
    const fullName = `${vendor.first_name || ''} ${vendor.last_name || ''}`.trim();
    return fullName || vendor.email || 'Unknown vendor';
  }, []);

  const getAssignmentVendorDisplayName = useCallback(
    (assignment: VendorVenueAssignment) => {
      const assignmentVendor = assignment.vendor;
      if (!assignmentVendor) {
        const fallbackVendor = vendors.find((vendor) => vendor.id === assignment.vendor_id);
        return getVendorDisplayName(fallbackVendor);
      }

      const fullName = `${assignmentVendor.first_name || ''} ${assignmentVendor.last_name || ''}`.trim();
      return fullName || assignmentVendor.email || 'Unknown vendor';
    },
    [vendors, getVendorDisplayName]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = '/login';
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (userError || !userData) {
        throw new Error('Unable to verify user role');
      }

      const role = String((userData as any).role || '').toLowerCase();
      setUserRole(role || null);

      if (role !== 'exec' && role !== 'admin') {
        alert('Access denied. This page is for executives and admins only.');
        window.location.href = '/dashboard';
        return;
      }

      const response = await fetch('/api/vendor-venue-assignments', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = (await response.json()) as AssignmentsPayload & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load vendor venue assignments');
      }

      setVendors(payload.vendors || []);
      setVenues(payload.venues || []);
      setAssignments(payload.assignments || []);
    } catch (err: any) {
      console.error('[VENDOR_VENUE_MANAGEMENT] load error:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const assignmentsByVendor = useMemo(() => {
    const map = new Map<string, VendorVenueAssignment[]>();
    assignments.forEach((assignment) => {
      const current = map.get(assignment.vendor_id) || [];
      current.push(assignment);
      map.set(assignment.vendor_id, current);
    });

    map.forEach((vendorAssignments, vendorId) => {
      map.set(
        vendorId,
        vendorAssignments.sort((a, b) => {
          const aName = a.venue?.venue_name || '';
          const bName = b.venue?.venue_name || '';
          return aName.localeCompare(bName);
        })
      );
    });

    return map;
  }, [assignments]);

  const filteredVendors = useMemo(() => {
    const query = vendorSearchQuery.trim().toLowerCase();
    if (!query) return vendors;

    return vendors.filter((vendor) => {
      const fullName = `${vendor.first_name || ''} ${vendor.last_name || ''}`.trim().toLowerCase();
      return (
        fullName.includes(query) ||
        vendor.email.toLowerCase().includes(query) ||
        (vendor.division || '').toLowerCase().includes(query)
      );
    });
  }, [vendors, vendorSearchQuery]);

  const availableVenuesForSelection = useMemo(() => {
    if (!selectedVendorId) return venues;
    const assignedVenueIds = new Set(
      (assignmentsByVendor.get(selectedVendorId) || []).map((assignment) => assignment.venue_id)
    );

    return venues.filter((venue) => !assignedVenueIds.has(venue.id));
  }, [venues, selectedVendorId, assignmentsByVendor]);

  const openAssignModal = (vendorId?: string) => {
    if (vendorId) setSelectedVendorId(vendorId);
    if (!vendorId) setSelectedVendorId('');
    setSelectedVenueId('');
    setError('');
    setSuccessMessage('');
    setShowAssignModal(true);
  };

  const closeAssignModal = () => {
    setShowAssignModal(false);
    setSelectedVendorId('');
    setSelectedVenueId('');
  };

  const handleAssignVenue = async () => {
    if (!selectedVendorId || !selectedVenueId) {
      setError('Please select both a vendor and a venue.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = '/login';
        return;
      }

      const response = await fetch('/api/vendor-venue-assignments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          vendor_id: selectedVendorId,
          venue_id: selectedVenueId,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to assign venue');
      }

      setSuccessMessage('Venue assigned successfully.');
      closeAssignModal();
      await loadData();
    } catch (err: any) {
      console.error('[VENDOR_VENUE_MANAGEMENT] assign error:', err);
      setError(err.message || 'Failed to assign venue');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAssignment = async (assignment: VendorVenueAssignment) => {
    if (!confirm(`Remove ${assignment.venue?.venue_name || 'this venue'} from ${getAssignmentVendorDisplayName(assignment)}?`)) {
      return;
    }

    setDeletingAssignmentId(assignment.id);
    setError('');
    setSuccessMessage('');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        window.location.href = '/login';
        return;
      }

      const response = await fetch(`/api/vendor-venue-assignments?id=${assignment.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove assignment');
      }

      setAssignments((prev) => prev.filter((row) => row.id !== assignment.id));
      setSuccessMessage('Assignment removed successfully.');
    } catch (err: any) {
      console.error('[VENDOR_VENUE_MANAGEMENT] remove error:', err);
      setError(err.message || 'Failed to remove assignment');
    } finally {
      setDeletingAssignmentId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-600">Loading vendor venue management...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">
              Vendor Venue Assignments
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mt-1">
              Assign allowed venues to vendor-division users.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Vendors without assignments are auto-assigned to their closest venue by coordinates.
              Any manual edit locks that vendor out of future distance auto-assignment.
            </p>
            {userRole && (
              <p className="text-xs text-gray-500 mt-2">
                Signed in role: <span className="font-medium uppercase">{userRole}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={() => openAssignModal()}
              className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              + Assign Venue
            </button>
            <Link
              href="/venue-management"
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors text-center"
            >
              Back to Venue Management
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 text-sm">
            {successMessage}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                Search Vendors
              </label>
              <input
                type="search"
                value={vendorSearchQuery}
                onChange={(event) => setVendorSearchQuery(event.target.value)}
                placeholder="Search by name, email, or division..."
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Active Vendors</p>
              <p className="text-xl font-semibold text-gray-900">{vendors.length}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Assignments</p>
              <p className="text-xl font-semibold text-gray-900">{assignments.length}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
          {filteredVendors.map((vendor) => {
            const vendorAssignments = assignmentsByVendor.get(vendor.id) || [];

            return (
              <div
                key={vendor.id}
                className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 truncate">
                      {getVendorDisplayName(vendor)}
                    </h2>
                    <p className="text-sm text-gray-600 truncate">{vendor.email}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-blue-100 text-blue-800">
                        {vendor.division || 'no division'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                          vendor.manual_override
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {vendor.manual_override ? 'Manual override' : 'Auto-distance'}
                      </span>
                      {vendor.role && (
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700">
                          {vendor.role}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => openAssignModal(vendor.id)}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors whitespace-nowrap"
                  >
                    + Assign
                  </button>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Assigned Venues ({vendorAssignments.length})
                    </h3>
                  </div>

                  {vendorAssignments.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">No venues assigned</p>
                  ) : (
                    <div className="space-y-2.5">
                      {vendorAssignments.map((assignment) => (
                        <div
                          key={assignment.id}
                          className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {assignment.venue?.venue_name || 'Unknown venue'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {assignment.venue?.city || ''}{assignment.venue?.city && assignment.venue?.state ? ', ' : ''}
                              {assignment.venue?.state || ''}
                            </p>
                          </div>
                          <button
                            onClick={() => handleRemoveAssignment(assignment)}
                            disabled={deletingAssignmentId === assignment.id}
                            className={`text-xs font-semibold ${
                              deletingAssignmentId === assignment.id
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-red-600 hover:text-red-700'
                            }`}
                          >
                            {deletingAssignmentId === assignment.id ? 'Removing...' : 'Unassign'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredVendors.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-10 text-center">
            <p className="text-base text-gray-500">No vendors match the current search.</p>
          </div>
        )}

        {showAssignModal && (
          <div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeAssignModal}
          >
            <div
              className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="text-xl font-semibold text-gray-900">Assign Venue to Vendor</h3>
              <p className="text-sm text-gray-600 mt-1 mb-5">
                Choose a vendor and a venue to create an assignment.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Vendor</label>
                  <select
                    value={selectedVendorId}
                    onChange={(event) => {
                      setSelectedVendorId(event.target.value);
                      setSelectedVenueId('');
                    }}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select a vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>
                        {getVendorDisplayName(vendor)} ({vendor.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Venue</label>
                  <select
                    value={selectedVenueId}
                    onChange={(event) => setSelectedVenueId(event.target.value)}
                    disabled={!selectedVendorId || availableVenuesForSelection.length === 0}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="">
                      {!selectedVendorId
                        ? 'Select a vendor first'
                        : availableVenuesForSelection.length === 0
                        ? 'No unassigned venues left'
                        : 'Select a venue'}
                    </option>
                    {availableVenuesForSelection.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.venue_name}
                        {venue.city || venue.state
                          ? ` (${venue.city || ''}${venue.city && venue.state ? ', ' : ''}${venue.state || ''})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
                <button
                  onClick={closeAssignModal}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignVenue}
                  disabled={
                    saving || !selectedVendorId || !selectedVenueId || availableVenuesForSelection.length === 0
                  }
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    saving || !selectedVendorId || !selectedVenueId || availableVenuesForSelection.length === 0
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {saving ? 'Assigning...' : 'Assign Venue'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
