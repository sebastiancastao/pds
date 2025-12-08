"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
  full_address: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Manager = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
};

type UserRoleRow = { role: string | null };

type VenueAssignment = {
  id: string;
  venue_id: string;
  manager_id: string;
  is_active: boolean;
  notes: string | null;
  assigned_at: string;
  venue: Venue;
  manager: Manager;
};

export default function VenueManagementPage() {
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [assignments, setAssignments] = useState<VenueAssignment[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Create venue modal state
  const [showCreateVenue, setShowCreateVenue] = useState(false);
  const [newVenue, setNewVenue] = useState({
    venue_name: "",
    city: "",
    state: "",
    full_address: "",
  });

  // Assign manager modal state
  const [showAssignManager, setShowAssignManager] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);

  // Edit venue modal state
  const [showEditVenue, setShowEditVenue] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          window.location.href = "/login";
          return;
        }

        // Get user role
        const { data: userData } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single();

        const role = (userData as UserRoleRow | null)?.role ?? null;
        setUserRole(role);

        // Only exec/admin can access
        if (role !== "exec" && role !== "admin") {
          alert("Access denied. This page is for executives only.");
          window.location.href = "/dashboard";
          return;
        }

        // Load venues
        const venuesRes = await fetch("/api/venues");
        if (venuesRes.ok) {
          const venuesData = await venuesRes.json();
          setVenues(venuesData.venues || []);
        }

        // Load managers
        const managersRes = await fetch("/api/users/managers", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (managersRes.ok) {
          const managersData = await managersRes.json();
          console.log("Managers loaded:", managersData.managers?.length || 0, managersData.managers);
          setManagers(managersData.managers || []);
        } else {
          console.error("Error loading managers:", await managersRes.text());
        }

        // Load assignments
        const assignmentsRes = await fetch("/api/venue-managers", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (assignmentsRes.ok) {
          const assignmentsData = await assignmentsRes.json();
          setAssignments(assignmentsData.assignments || []);
        }
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Create venue
  const handleCreateVenue = async () => {
    if (!newVenue.venue_name || !newVenue.city || !newVenue.state) {
      alert("Please fill in all required fields");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch("/api/venues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(newVenue),
      });

      if (response.ok) {
        const result = await response.json();
        setVenues([...venues, result.venue]);
        setShowCreateVenue(false);
        setNewVenue({ venue_name: "", city: "", state: "", full_address: "" });
        alert("Venue created successfully!");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to create venue");
      }
    } catch (error) {
      console.error("Error creating venue:", error);
      alert("Failed to create venue");
    }
  };

  // Assign manager to venue
  const handleAssignManager = async () => {
    if (!selectedVenueId || !selectedManagerId) {
      alert("Please select both a venue and a manager");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch("/api/venue-managers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          venue_id: selectedVenueId,
          manager_id: selectedManagerId,
        }),
      });

      if (response.ok) {
        // Reload assignments
        const assignmentsRes = await fetch("/api/venue-managers", {
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        });

        if (assignmentsRes.ok) {
          const assignmentsData = await assignmentsRes.json();
          setAssignments(assignmentsData.assignments || []);
        }

        setShowAssignManager(false);
        setSelectedVenueId(null);
        setSelectedManagerId(null);
        alert("Manager assigned successfully!");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to assign manager");
      }
    } catch (error) {
      console.error("Error assigning manager:", error);
      alert("Failed to assign manager");
    }
  };

  // Remove assignment
  const handleRemoveAssignment = async (assignmentId: string) => {
    if (!confirm("Are you sure you want to remove this assignment?")) {
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`/api/venue-managers?id=${assignmentId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (response.ok) {
        setAssignments(assignments.filter(a => a.id !== assignmentId));
        alert("Assignment removed successfully!");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to remove assignment");
      }
    } catch (error) {
      console.error("Error removing assignment:", error);
      alert("Failed to remove assignment");
    }
  };

  // Get assignments for a venue
  const getVenueAssignments = (venueId: string) => {
    return assignments.filter(a => a.venue_id === venueId && a.is_active);
  };

  // Edit venue
  const handleEditVenue = async () => {
    if (!editingVenue || !editingVenue.venue_name || !editingVenue.city || !editingVenue.state) {
      alert("Please fill in all required fields");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch("/api/venues", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          id: editingVenue.id,
          venue_name: editingVenue.venue_name,
          city: editingVenue.city,
          state: editingVenue.state,
          full_address: editingVenue.full_address,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setVenues(venues.map(v => v.id === editingVenue.id ? result.venue : v));
        setShowEditVenue(false);
        setEditingVenue(null);
        alert("Venue updated successfully!");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to update venue");
      }
    } catch (error) {
      console.error("Error updating venue:", error);
      alert("Failed to update venue");
    }
  };

  // Delete venue
  const handleDeleteVenue = async (venueId: string, venueName: string) => {
    if (!confirm(`Are you sure you want to delete "${venueName}"? This will also remove all manager assignments for this venue.`)) {
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(`/api/venues?id=${venueId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });

      if (response.ok) {
        setVenues(venues.filter(v => v.id !== venueId));
        setAssignments(assignments.filter(a => a.venue_id !== venueId));
        alert("Venue deleted successfully!");
      } else {
        const error = await response.json();
        alert(error.error || "Failed to delete venue");
      }
    } catch (error) {
      console.error("Error deleting venue:", error);
      alert("Failed to delete venue");
    }
  };

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
      <div className="container mx-auto max-w-7xl py-10 px-6">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-gray-900 tracking-tight">
              Venue Management
            </h1>
            <p className="text-gray-600 mt-1">
              Manage venues and assign managers
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateVenue(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              + Create Venue
            </button>
            <Link href="/global-calendar">
              <button className="apple-button apple-button-secondary">
                ← Back to Calendar
              </button>
            </Link>
          </div>
        </div>

        {/* Venues Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {venues.map((venue) => {
            const venueAssignments = getVenueAssignments(venue.id);

            return (
              <div
                key={venue.id}
                className="apple-card p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900">{venue.venue_name}</h3>
                    <p className="text-sm text-gray-600">
                      {venue.city}, {venue.state}
                    </p>
                    {venue.full_address && (
                      <p className="text-xs text-gray-500 mt-1">{venue.full_address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingVenue(venue);
                        setShowEditVenue(true);
                      }}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Edit venue"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteVenue(venue.id, venue.venue_name)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Delete venue"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button
                      onClick={() => {
                        setSelectedVenueId(venue.id);
                        setShowAssignManager(true);
                      }}
                      className="px-3 py-1 bg-green-500 text-white rounded text-xs font-medium hover:bg-green-600 transition-colors ml-2"
                    >
                      + Assign
                    </button>
                  </div>
                </div>

                {/* Assigned Managers */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                    Assigned Managers ({venueAssignments.length})
                  </h4>
                  {venueAssignments.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No managers assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {venueAssignments.map((assignment) => {
                        if (!assignment.manager) return null;
                        return (
                          <div
                            key={assignment.id}
                            className="flex items-center justify-between bg-gray-50 rounded-lg p-2"
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {assignment.manager.first_name} {assignment.manager.last_name}
                              </p>
                              <p className="text-xs text-gray-500">{assignment.manager.email}</p>
                            </div>
                            <button
                              onClick={() => handleRemoveAssignment(assignment.id)}
                              className="text-red-600 hover:text-red-700 text-xs font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {venues.length === 0 && (
          <div className="text-center py-16">
            <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <p className="text-gray-500 font-medium">No venues yet</p>
            <p className="text-sm text-gray-400 mt-1">Create your first venue to get started</p>
          </div>
        )}

        {/* Create Venue Modal */}
        {showCreateVenue && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Create New Venue</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Venue Name *
                  </label>
                  <input
                    type="text"
                    value={newVenue.venue_name}
                    onChange={(e) => setNewVenue({ ...newVenue, venue_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Kia Forum"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    value={newVenue.city}
                    onChange={(e) => setNewVenue({ ...newVenue, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Los Angeles"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    value={newVenue.state}
                    onChange={(e) => setNewVenue({ ...newVenue, state: e.target.value.toUpperCase().slice(0, 2) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="CA"
                    maxLength={2}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Address (Optional)
                  </label>
                  <input
                    type="text"
                    value={newVenue.full_address}
                    onChange={(e) => setNewVenue({ ...newVenue, full_address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="3900 W Manchester Blvd, Inglewood, CA 90305"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowCreateVenue(false);
                    setNewVenue({ venue_name: "", city: "", state: "", full_address: "" });
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateVenue}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Create Venue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Venue Modal */}
        {showEditVenue && editingVenue && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Edit Venue</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Venue Name *
                  </label>
                  <input
                    type="text"
                    value={editingVenue.venue_name}
                    onChange={(e) => setEditingVenue({ ...editingVenue, venue_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Kia Forum"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    value={editingVenue.city}
                    onChange={(e) => setEditingVenue({ ...editingVenue, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Los Angeles"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    value={editingVenue.state}
                    onChange={(e) => setEditingVenue({ ...editingVenue, state: e.target.value.toUpperCase().slice(0, 2) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="CA"
                    maxLength={2}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Address (Optional)
                  </label>
                  <input
                    type="text"
                    value={editingVenue.full_address || ""}
                    onChange={(e) => setEditingVenue({ ...editingVenue, full_address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="3900 W Manchester Blvd, Inglewood, CA 90305"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowEditVenue(false);
                    setEditingVenue(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditVenue}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Assign Manager Modal */}
        {showAssignManager && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Assign Manager to Venue</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Venue
                  </label>
                  <select
                    value={selectedVenueId || ""}
                    onChange={(e) => setSelectedVenueId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a venue</option>
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.venue_name} ({venue.city}, {venue.state})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Manager
                  </label>
                  <select
                    value={selectedManagerId || ""}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a manager</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.first_name} {manager.last_name} ({manager.email})
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowAssignManager(false);
                    setSelectedVenueId(null);
                    setSelectedManagerId(null);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignManager}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                >
                  Assign Manager
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
