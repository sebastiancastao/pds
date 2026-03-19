"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  email: string;
  role: string;
  division: string | null;
  is_active: boolean;
  first_name: string;
  last_name: string;
};

type TeamAssignment = {
  assignment_id: string;
  manager_id: string;
  member_id: string;
  assigned_at: string;
  notes: string | null;
  member: User | null;
};

type Venue = {
  id: string;
  venue_name: string;
  city: string;
  state: string;
};

type UserRoleRow = Pick<User, "role">;

const AVAILABLE_ROLES = [
  { value: "employee", label: "Employee" },
  { value: "worker", label: "Worker" },
  { value: "supervisor", label: "Supervisor" },
  { value: "supervisor2", label: "Supervisor 2 (Read-Only)" },
  { value: "supervisor3", label: "Supervisor 3" },
  { value: "manager", label: "Manager" },
  { value: "finance", label: "Finance" },
  { value: "exec", label: "Exec" },
  { value: "hr", label: "HR" },
  { value: "backgroundchecker", label: "Background Checker" },
];

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  employee: { bg: "#e0f2fe", text: "#0369a1" },
  worker: { bg: "#f3f4f6", text: "#374151" },
  supervisor: { bg: "#fef3c7", text: "#92400e" },
  supervisor2: { bg: "#fef9c3", text: "#854d0e" },
  supervisor3: { bg: "#ffedd5", text: "#9a3412" },
  manager: { bg: "#dbeafe", text: "#1d4ed8" },
  finance: { bg: "#dcfce7", text: "#15803d" },
  exec: { bg: "#ede9fe", text: "#6d28d9" },
  hr: { bg: "#ccfbf1", text: "#0d9488" },
  backgroundchecker: { bg: "#fed7aa", text: "#c2410c" },
  admin: { bg: "#fce7f3", text: "#be185d" },
};

export default function RoleManagementPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // --- Role Assignment State ---
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  // --- Team Assignment State ---
  const [activeTab, setActiveTab] = useState<"roles" | "teams" | "sup3venues">("roles");
  const [managers, setManagers] = useState<User[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [teamMembers, setTeamMembers] = useState<TeamAssignment[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamSuccess, setTeamSuccess] = useState("");
  const [addMemberId, setAddMemberId] = useState<string>("");
  const [addingMember, setAddingMember] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // --- Supervisor 3 Venue State ---
  const [supervisor3Users, setSupervisor3Users] = useState<User[]>([]);
  const [selectedSup3Id, setSelectedSup3Id] = useState<string>("");
  const [sup3VenueAssignments, setSup3VenueAssignments] = useState<any[]>([]);
  const [allVenues, setAllVenues] = useState<Venue[]>([]);
  const [sup3Loading, setSup3Loading] = useState(false);
  const [sup3Error, setSup3Error] = useState("");
  const [sup3Success, setSup3Success] = useState("");
  const [addVenueId, setAddVenueId] = useState<string>("");
  const [addingVenue, setAddingVenue] = useState(false);
  const [removingSup3VenueId, setRemovingSup3VenueId] = useState<string | null>(null);

  // --- Supervisor 3 Team State ---
  const [sup3TeamMembers, setSup3TeamMembers] = useState<TeamAssignment[]>([]);
  const [sup3TeamLoading, setSup3TeamLoading] = useState(false);
  const [sup3TeamError, setSup3TeamError] = useState("");
  const [sup3TeamSuccess, setSup3TeamSuccess] = useState("");
  const [addSup3MemberId, setAddSup3MemberId] = useState<string>("");
  const [addingSup3Member, setAddingSup3Member] = useState(false);
  const [removingSup3TeamId, setRemovingSup3TeamId] = useState<string | null>(null);

  // --- Supervisor 3 Team Venue Assignment State ---
  const [expandedSup3MemberId, setExpandedSup3MemberId] = useState<string | null>(null);
  const [sup3MemberVenues, setSup3MemberVenues] = useState<Record<string, any[]>>({});
  const [addVenueToMemberVenueId, setAddVenueToMemberVenueId] = useState<string>("");
  const [addingVenueToMember, setAddingVenueToMember] = useState(false);
  const [removingVenueAssignmentId, setRemovingVenueAssignmentId] = useState<string | null>(null);

  // Check authorization
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

        setCurrentUserId(session.user.id);

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single<UserRoleRow>();

        const userRole = userData?.role ?? "";

        if (userError || !userRole || !['exec', 'admin'].includes(userRole)) {
          alert('Unauthorized: Admin/Exec access required');
          router.push('/dashboard');
          return;
        }

        setIsAuthorized(true);
      } catch (err) {
        console.error('[ROLE-MANAGEMENT] Auth error:', err);
        router.push('/login');
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  // Load users
  useEffect(() => {
    if (isAuthorized) {
      loadUsers();
    }
  }, [isAuthorized]);

  // Poll for fresh data every 30 seconds
  useEffect(() => {
    if (!isAuthorized) return;
    const interval = setInterval(() => { loadUsers(); }, 30000);
    return () => clearInterval(interval);
  }, [isAuthorized]);

  // Derive supervisor3 users from users list
  useEffect(() => {
    setSupervisor3Users(users.filter(u => u.role === 'supervisor3'));
  }, [users]);

  // Load managers live from API when teams tab is opened
  useEffect(() => {
    if (activeTab === 'teams' && isAuthorized) {
      loadManagers();
    }
  }, [activeTab, isAuthorized]);

  // Load team when manager changes
  useEffect(() => {
    if (selectedManagerId) {
      loadTeamMembers(selectedManagerId);
    } else {
      setTeamMembers([]);
    }
  }, [selectedManagerId]);

  // Load all venues and refresh data whenever sup3venues tab is opened
  useEffect(() => {
    if (activeTab === 'sup3venues' && isAuthorized) {
      loadAllVenues();
      loadUsers();
      if (selectedSup3Id) {
        loadSup3Venues(selectedSup3Id);
        loadSup3TeamMembers(selectedSup3Id);
      }
    }
  }, [activeTab, isAuthorized]);

  // Load supervisor3 venue assignments and team when a supervisor3 user is selected
  useEffect(() => {
    if (selectedSup3Id) {
      loadSup3Venues(selectedSup3Id);
      loadSup3TeamMembers(selectedSup3Id);
    } else {
      setSup3VenueAssignments([]);
      setSup3TeamMembers([]);
    }
  }, [selectedSup3Id]);

  const filteredUsers = useMemo(() => {
    let result = users;

    if (roleFilter !== "all") {
      result = result.filter(u => u.role === roleFilter);
    }

    if (searchTerm.trim() !== "") {
      const term = searchTerm.toLowerCase();
      result = result.filter(u =>
        u.first_name.toLowerCase().includes(term) ||
        u.last_name.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term)
      );
    }

    return result;
  }, [searchTerm, roleFilter, users]);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('No session found');
    return session.access_token;
  };

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/users/role-management-list?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');

      setUsers(data.users || []);
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error loading users:', err);
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadManagers = async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/users/managers', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load managers');
      setManagers((data.managers || []).map((m: any) => ({
        ...m,
        division: null,
        is_active: true,
      })));
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error loading managers:', err);
    }
  };

  // --- Role Assignment ---
  const handleRoleChange = async (userId: string, newRole: string, userName: string, currentRole: string) => {
    if (userId === currentUserId) {
      alert("You cannot change your own role.");
      return;
    }
    if (newRole === currentRole) return;

    const confirmed = confirm(
      `Are you sure you want to change ${userName}'s role from "${currentRole}" to "${newRole}"?`
    );
    if (!confirmed) return;

    setUpdatingUserId(userId);
    setError("");
    setSuccessMessage("");

    try {
      const token = await getToken();
      const res = await fetch("/api/users/update-role", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId, newRole }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update role");

      const persistedRole = data?.user?.role || newRole;
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: persistedRole } : u));
      setSuccessMessage(`${userName}'s role updated to ${persistedRole}`);
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err: any) {
      console.error("[ROLE-MANAGEMENT] Error:", err);
      setError(err.message || "Failed to update role");
    } finally {
      setUpdatingUserId(null);
    }
  };

  // --- Team Assignment ---
  const loadTeamMembers = async (managerId: string) => {
    setTeamLoading(true);
    setTeamError("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/manager-teams?manager_id=${managerId}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load team');

      setTeamMembers(data.teamMembers || []);
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error loading team:', err);
      setTeamError(err.message || 'Failed to load team');
    } finally {
      setTeamLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedManagerId || !addMemberId) return;

    setAddingMember(true);
    setTeamError("");
    setTeamSuccess("");

    try {
      const token = await getToken();
      const res = await fetch("/api/manager-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ managerId: selectedManagerId, memberId: addMemberId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign member");

      setTeamSuccess("Member assigned to team");
      setTimeout(() => setTeamSuccess(""), 4000);
      setAddMemberId("");
      loadTeamMembers(selectedManagerId);
    } catch (err: any) {
      console.error("[ROLE-MANAGEMENT] Error adding member:", err);
      setTeamError(err.message || "Failed to assign member");
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (assignmentId: string, memberName: string) => {
    const confirmed = confirm(`Remove ${memberName} from this manager's team?`);
    if (!confirmed) return;

    setRemovingId(assignmentId);
    setTeamError("");
    setTeamSuccess("");

    try {
      const token = await getToken();
      const res = await fetch("/api/manager-teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignmentId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove member");

      setTeamMembers(prev => prev.filter(t => t.assignment_id !== assignmentId));
      setTeamSuccess("Member removed from team");
      setTimeout(() => setTeamSuccess(""), 4000);
    } catch (err: any) {
      console.error("[ROLE-MANAGEMENT] Error removing member:", err);
      setTeamError(err.message || "Failed to remove member");
    } finally {
      setRemovingId(null);
    }
  };

  // --- Supervisor 3 Venue Assignment ---
  const loadAllVenues = async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/venues', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load venues');
      setAllVenues(data.venues || []);
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error loading venues:', err);
    }
  };

  const loadSup3Venues = async (sup3Id: string) => {
    setSup3Loading(true);
    setSup3Error("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/venue-managers?manager_id=${sup3Id}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load venue assignments');
      setSup3VenueAssignments(data.assignments || []);
    } catch (err: any) {
      setSup3Error(err.message || 'Failed to load venue assignments');
    } finally {
      setSup3Loading(false);
    }
  };

  const loadSup3TeamMembers = async (sup3Id: string) => {
    setSup3TeamLoading(true);
    setSup3TeamError("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/manager-teams?manager_id=${sup3Id}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load team');
      const members: TeamAssignment[] = data.teamMembers || [];
      setSup3TeamMembers(members);
      // Pre-load venues for all team members
      await Promise.all(
        members
          .filter((tm) => tm.member)
          .map((tm) => loadSup3MemberVenues(sup3Id, tm.member!.id))
      );
    } catch (err: any) {
      setSup3TeamError(err.message || 'Failed to load team');
    } finally {
      setSup3TeamLoading(false);
    }
  };

  const handleAddSup3Member = async () => {
    if (!selectedSup3Id || !addSup3MemberId) return;
    setAddingSup3Member(true);
    setSup3TeamError("");
    setSup3TeamSuccess("");
    try {
      const token = await getToken();
      const res = await fetch("/api/manager-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ managerId: selectedSup3Id, memberId: addSup3MemberId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign member");
      setSup3TeamSuccess("Supervisor assigned to team");
      setTimeout(() => setSup3TeamSuccess(""), 4000);
      setAddSup3MemberId("");
      loadSup3TeamMembers(selectedSup3Id);
    } catch (err: any) {
      setSup3TeamError(err.message || "Failed to assign member");
    } finally {
      setAddingSup3Member(false);
    }
  };

  const handleRemoveSup3Member = async (assignmentId: string, memberName: string) => {
    const confirmed = confirm(`Remove ${memberName} from this Supervisor 3's team?`);
    if (!confirmed) return;
    setRemovingSup3TeamId(assignmentId);
    setSup3TeamError("");
    setSup3TeamSuccess("");
    try {
      const token = await getToken();
      const res = await fetch("/api/manager-teams", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assignmentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove member");
      setSup3TeamMembers(prev => prev.filter(t => t.assignment_id !== assignmentId));
      setSup3TeamSuccess("Supervisor removed from team");
      setTimeout(() => setSup3TeamSuccess(""), 4000);
    } catch (err: any) {
      setSup3TeamError(err.message || "Failed to remove member");
    } finally {
      setRemovingSup3TeamId(null);
    }
  };

  // --- Supervisor 3 Team Venue functions ---
  const loadSup3MemberVenues = async (supervisor3Id: string, supervisorId: string) => {
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/supervisor3-team-venues?supervisor3_id=${supervisor3Id}&supervisor_id=${supervisorId}`,
        { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load venues');
      setSup3MemberVenues(prev => ({ ...prev, [supervisorId]: data.assignments || [] }));
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error loading member venues:', err);
    }
  };

  const handleToggleMemberVenues = (supervisor3Id: string, supervisorId: string) => {
    if (expandedSup3MemberId === supervisorId) {
      setExpandedSup3MemberId(null);
    } else {
      setExpandedSup3MemberId(supervisorId);
      setAddVenueToMemberVenueId("");
      loadSup3MemberVenues(supervisor3Id, supervisorId);
    }
  };

  const handleAddVenueToMember = async (supervisor3Id: string, supervisorId: string) => {
    if (!addVenueToMemberVenueId) return;
    setAddingVenueToMember(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/supervisor3-team-venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          supervisor3_id: supervisor3Id,
          supervisor_id: supervisorId,
          venue_id: addVenueToMemberVenueId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign venue');
      setAddVenueToMemberVenueId("");
      loadSup3MemberVenues(supervisor3Id, supervisorId);
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error adding venue to member:', err);
      setSup3TeamError(err.message || 'Failed to assign venue');
    } finally {
      setAddingVenueToMember(false);
    }
  };

  const handleRemoveVenueFromMember = async (
    assignmentId: string,
    supervisor3Id: string,
    supervisorId: string
  ) => {
    setRemovingVenueAssignmentId(assignmentId);
    try {
      const token = await getToken();
      const res = await fetch(`/api/supervisor3-team-venues?id=${assignmentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove venue');
      setSup3MemberVenues(prev => ({
        ...prev,
        [supervisorId]: (prev[supervisorId] || []).filter((a: any) => a.id !== assignmentId),
      }));
    } catch (err: any) {
      console.error('[ROLE-MANAGEMENT] Error removing venue from member:', err);
      setSup3TeamError(err.message || 'Failed to remove venue');
    } finally {
      setRemovingVenueAssignmentId(null);
    }
  };

  const handleAddVenueToSup3 = async () => {
    if (!selectedSup3Id || !addVenueId) return;
    setAddingVenue(true);
    setSup3Error("");
    setSup3Success("");
    try {
      const token = await getToken();
      const res = await fetch('/api/venue-managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venue_id: addVenueId, manager_id: selectedSup3Id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to assign venue');
      setSup3Success("Venue assigned successfully");
      setTimeout(() => setSup3Success(""), 4000);
      setAddVenueId("");
      loadSup3Venues(selectedSup3Id);
    } catch (err: any) {
      setSup3Error(err.message || 'Failed to assign venue');
    } finally {
      setAddingVenue(false);
    }
  };

  const handleRemoveSup3Venue = async (assignmentId: string, venueName: string) => {
    const confirmed = confirm(`Remove access to "${venueName}"?`);
    if (!confirmed) return;
    setRemovingSup3VenueId(assignmentId);
    setSup3Error("");
    setSup3Success("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/venue-managers?id=${assignmentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove venue');
      setSup3VenueAssignments(prev => prev.filter((a: any) => a.id !== assignmentId));
      setSup3Success("Venue removed successfully");
      setTimeout(() => setSup3Success(""), 4000);
    } catch (err: any) {
      setSup3Error(err.message || 'Failed to remove venue');
    } finally {
      setRemovingSup3VenueId(null);
    }
  };

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem('mfa_verified');
      sessionStorage.removeItem('mfa_checkpoint');
      await supabase.auth.signOut();
    } finally {
      router.push('/login');
    }
  };

  const getRoleColors = (role: string) => {
    return ROLE_COLORS[role] || { bg: "#f3f4f6", text: "#374151" };
  };

  const uniqueRoles = Array.from(new Set(users.map(u => u.role))).sort();

  // Users available to add (not already on the selected manager's team, and not the manager themselves)
  const currentMemberIds = new Set(teamMembers.map(t => t.member_id));
  const availableMembers = users.filter(u =>
    u.id !== selectedManagerId && !currentMemberIds.has(u.id)
  );

  // Venues not yet assigned to the selected supervisor3
  const assignedVenueIds = new Set(sup3VenueAssignments.map((a: any) => a.venue_id));
  const availableVenuesForSup3 = allVenues.filter(v => !assignedVenueIds.has(v.id));

  // Supervisors not yet on the selected supervisor3's team
  const sup3CurrentMemberIds = new Set(sup3TeamMembers.map(t => t.member_id));
  const availableSupervisorsForSup3 = users.filter(u =>
    u.role === 'supervisor' &&
    u.id !== selectedSup3Id &&
    !sup3CurrentMemberIds.has(u.id)
  );

  // Venues from the supervisor3's pool not yet assigned to the expanded team member
  const expandedMemberAssignedVenueIds = new Set(
    (sup3MemberVenues[expandedSup3MemberId ?? ''] || []).map((a: any) => a.venue_id)
  );
  const venuesAvailableForMember = sup3VenueAssignments
    .filter((a: any) => a.venue && !expandedMemberAssignedVenueIds.has(a.venue_id))
    .map((a: any) => a.venue);

  if (authChecking) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Checking authorization...</p>
      </div>
    );
  }

  if (!isAuthorized) return null;

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>Role Management</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link href="/user-management" style={{ padding: '0.5rem 1rem', backgroundColor: '#6366f1', color: 'white', borderRadius: '0.375rem', textDecoration: 'none', fontWeight: '500' }}>
            User Management
          </Link>
          <Link href="/global-calendar" style={{ padding: '0.5rem 1rem', backgroundColor: '#3b82f6', color: 'white', borderRadius: '0.375rem', textDecoration: 'none', fontWeight: '500' }}>
            Back to Calendar
          </Link>
          <button onClick={handleLogout} style={{ padding: '0.5rem 1rem', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: '500' }}>
            Logout
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
        <button
          onClick={() => setActiveTab("roles")}
          style={{
            padding: '0.75rem 1.5rem',
            fontWeight: '600',
            fontSize: '1rem',
            border: 'none',
            borderBottom: activeTab === "roles" ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === "roles" ? '#3b82f6' : '#6b7280',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            marginBottom: '-2px',
          }}
        >
          Assign Roles
        </button>
        <button
          onClick={() => setActiveTab("teams")}
          style={{
            padding: '0.75rem 1.5rem',
            fontWeight: '600',
            fontSize: '1rem',
            border: 'none',
            borderBottom: activeTab === "teams" ? '2px solid #3b82f6' : '2px solid transparent',
            color: activeTab === "teams" ? '#3b82f6' : '#6b7280',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            marginBottom: '-2px',
          }}
        >
          Manager Teams
        </button>
        <button
          onClick={() => setActiveTab("sup3venues")}
          style={{
            padding: '0.75rem 1.5rem',
            fontWeight: '600',
            fontSize: '1rem',
            border: 'none',
            borderBottom: activeTab === "sup3venues" ? '2px solid #ea580c' : '2px solid transparent',
            color: activeTab === "sup3venues" ? '#ea580c' : '#6b7280',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            marginBottom: '-2px',
          }}
        >
          Supervisor 3 Venues
        </button>
      </div>

      {/* ========== ROLES TAB ========== */}
      {activeTab === "roles" && (
        <>
          {/* Search and Filter Row */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ flex: 1, padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem' }}
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{ padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', minWidth: '180px', cursor: 'pointer' }}
            >
              <option value="all">All Roles</option>
              {uniqueRoles.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <button
              onClick={loadUsers}
              disabled={loading}
              style={{ padding: '0.75rem 1rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer', backgroundColor: 'white', opacity: loading ? 0.6 : 1 }}
              title="Refresh users"
            >
              ↻
            </button>
          </div>

          {/* Messages */}
          {successMessage && (
            <div style={{ padding: '1rem', backgroundColor: '#dcfce7', color: '#15803d', borderRadius: '0.375rem', marginBottom: '1.5rem', fontWeight: '500' }}>
              {successMessage}
            </div>
          )}
          {error && (
            <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
              {error}
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem' }}><p>Loading users...</p></div>
          )}

          {/* Users Table */}
          {!loading && (
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Email</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Current Role</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Division</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Change Role</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                        {searchTerm || roleFilter !== "all" ? 'No users found matching your filters' : 'No users found'}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const colors = getRoleColors(user.role);
                      const isSelf = user.id === currentUserId;
                      const isUpdating = updatingUserId === user.id;
                      const isDisabled = isSelf || isUpdating;

                      return (
                        <tr key={user.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '0.75rem' }}>
                            {user.first_name} {user.last_name}
                            {isSelf && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' }}>(You)</span>}
                          </td>
                          <td style={{ padding: '0.75rem', color: '#4b5563' }}>{user.email}</td>
                          <td style={{ padding: '0.75rem' }}>
                            <span style={{ padding: '0.25rem 0.5rem', backgroundColor: colors.bg, color: colors.text, borderRadius: '0.25rem', fontSize: '0.875rem', fontWeight: '500' }}>
                              {user.role}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem', color: '#4b5563' }}>{user.division || '—'}</td>
                          <td style={{ padding: '0.75rem' }}>
                            <select
                              value={user.role}
                              onChange={(e) => handleRoleChange(user.id, e.target.value, `${user.first_name} ${user.last_name}`, user.role)}
                              onWheel={(e) => e.currentTarget.blur()}
                              disabled={isDisabled}
                              style={{
                                padding: '0.375rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem',
                                cursor: isDisabled ? 'not-allowed' : 'pointer', opacity: isDisabled ? 0.5 : 1,
                                backgroundColor: isUpdating ? '#f3f4f6' : 'white',
                              }}
                            >
                              {AVAILABLE_ROLES.map(r => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                              {!AVAILABLE_ROLES.find(r => r.value === user.role) && (
                                <option value={user.role}>{user.role}</option>
                              )}
                            </select>
                            {isUpdating && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#6b7280' }}>Updating...</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && filteredUsers.length > 0 && (
            <div style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
              Showing {filteredUsers.length} of {users.length} users
            </div>
          )}
        </>
      )}

      {/* ========== TEAMS TAB ========== */}
      {activeTab === "teams" && (
        <>
          {/* Manager Selector */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
              Select a Manager / Exec / Supervisor 3
            </label>
            <select
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
              style={{ width: '100%', maxWidth: '400px', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', cursor: 'pointer' }}
            >
              <option value="">-- Select a manager --</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({m.role})
                </option>
              ))}
            </select>
          </div>

          {selectedManagerId && (
            <>
              {/* Add Member */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                    Add Member to Team
                  </label>
                  <select
                    value={addMemberId}
                    onChange={(e) => setAddMemberId(e.target.value)}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', cursor: 'pointer' }}
                  >
                    <option value="">-- Select a user to add --</option>
                    {availableMembers.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.first_name} {u.last_name} — {u.role}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleAddMember}
                  disabled={!addMemberId || addingMember}
                  style={{
                    padding: '0.75rem 1.5rem', backgroundColor: !addMemberId || addingMember ? '#9ca3af' : '#10b981',
                    color: 'white', border: 'none', borderRadius: '0.375rem', cursor: !addMemberId || addingMember ? 'not-allowed' : 'pointer',
                    fontWeight: '600', fontSize: '1rem', whiteSpace: 'nowrap',
                  }}
                >
                  {addingMember ? 'Adding...' : 'Add to Team'}
                </button>
              </div>

              {/* Messages */}
              {teamSuccess && (
                <div style={{ padding: '1rem', backgroundColor: '#dcfce7', color: '#15803d', borderRadius: '0.375rem', marginBottom: '1.5rem', fontWeight: '500' }}>
                  {teamSuccess}
                </div>
              )}
              {teamError && (
                <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
                  {teamError}
                </div>
              )}

              {teamLoading && (
                <div style={{ textAlign: 'center', padding: '2rem' }}><p>Loading team...</p></div>
              )}

              {/* Team Members Table */}
              {!teamLoading && (
                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Email</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Role</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Assigned</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamMembers.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                            No team members assigned to this manager yet
                          </td>
                        </tr>
                      ) : (
                        teamMembers.map((tm) => {
                          const m = tm.member;
                          if (!m) return null;
                          const colors = getRoleColors(m.role);
                          const isRemoving = removingId === tm.assignment_id;

                          return (
                            <tr key={tm.assignment_id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td style={{ padding: '0.75rem' }}>{m.first_name} {m.last_name}</td>
                              <td style={{ padding: '0.75rem', color: '#4b5563' }}>{m.email}</td>
                              <td style={{ padding: '0.75rem' }}>
                                <span style={{ padding: '0.25rem 0.5rem', backgroundColor: colors.bg, color: colors.text, borderRadius: '0.25rem', fontSize: '0.875rem', fontWeight: '500' }}>
                                  {m.role}
                                </span>
                              </td>
                              <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.875rem' }}>
                                {new Date(tm.assigned_at).toLocaleDateString()}
                              </td>
                              <td style={{ padding: '0.75rem' }}>
                                <button
                                  onClick={() => handleRemoveMember(tm.assignment_id, `${m.first_name} ${m.last_name}`)}
                                  disabled={isRemoving}
                                  style={{
                                    padding: '0.375rem 0.75rem', backgroundColor: isRemoving ? '#9ca3af' : '#ef4444',
                                    color: 'white', border: 'none', borderRadius: '0.375rem',
                                    cursor: isRemoving ? 'not-allowed' : 'pointer', fontWeight: '500', fontSize: '0.875rem',
                                  }}
                                >
                                  {isRemoving ? 'Removing...' : 'Remove'}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {!teamLoading && teamMembers.length > 0 && (
                <div style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
                  {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''} on this team
                </div>
              )}
            </>
          )}

          {!selectedManagerId && (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
              <p style={{ fontSize: '1.125rem' }}>Select a manager above to view and manage their team</p>
            </div>
          )}
        </>
      )}

      {/* ========== SUPERVISOR 3 VENUES TAB ========== */}
      {activeTab === "sup3venues" && (
        <>
          <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '0.5rem', color: '#9a3412', fontSize: '0.875rem' }}>
            Supervisor 3 users are assigned to specific venues. They can see and manage events only at those venues.
          </div>

          {/* Supervisor 3 Selector */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
              Select a Supervisor 3
            </label>
            <select
              value={selectedSup3Id}
              onChange={(e) => setSelectedSup3Id(e.target.value)}
              style={{ width: '100%', maxWidth: '400px', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', cursor: 'pointer' }}
            >
              <option value="">-- Select a Supervisor 3 --</option>
              {supervisor3Users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>
            {supervisor3Users.length === 0 && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#9ca3af' }}>
                No Supervisor 3 users found. Assign the role first in the Assign Roles tab.
              </p>
            )}
          </div>

          {selectedSup3Id && (
            <>
              {/* Add Venue */}
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                    Assign Venue
                  </label>
                  <select
                    value={addVenueId}
                    onChange={(e) => setAddVenueId(e.target.value)}
                    style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', cursor: 'pointer' }}
                  >
                    <option value="">-- Select a venue --</option>
                    {availableVenuesForSup3.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.venue_name} — {v.city}, {v.state}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleAddVenueToSup3}
                  disabled={!addVenueId || addingVenue}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: !addVenueId || addingVenue ? '#9ca3af' : '#ea580c',
                    color: 'white', border: 'none', borderRadius: '0.375rem',
                    cursor: !addVenueId || addingVenue ? 'not-allowed' : 'pointer',
                    fontWeight: '600', fontSize: '1rem', whiteSpace: 'nowrap',
                  }}
                >
                  {addingVenue ? 'Assigning...' : 'Assign Venue'}
                </button>
              </div>

              {/* Messages */}
              {sup3Success && (
                <div style={{ padding: '1rem', backgroundColor: '#dcfce7', color: '#15803d', borderRadius: '0.375rem', marginBottom: '1.5rem', fontWeight: '500' }}>
                  {sup3Success}
                </div>
              )}
              {sup3Error && (
                <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
                  {sup3Error}
                </div>
              )}

              {sup3Loading && (
                <div style={{ textAlign: 'center', padding: '2rem' }}><p>Loading venue assignments...</p></div>
              )}

              {/* Assigned Venues Table */}
              {!sup3Loading && (
                <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f9fafb' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Venue</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>City</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>State</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Assigned</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sup3VenueAssignments.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                            No venues assigned to this Supervisor 3 yet
                          </td>
                        </tr>
                      ) : (
                        sup3VenueAssignments.map((a: any) => {
                          const venue = a.venue;
                          const isRemoving = removingSup3VenueId === a.id;
                          return (
                            <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td style={{ padding: '0.75rem', fontWeight: '500' }}>{venue?.venue_name || '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#4b5563' }}>{venue?.city || '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#4b5563' }}>{venue?.state || '—'}</td>
                              <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.875rem' }}>
                                {new Date(a.assigned_at).toLocaleDateString()}
                              </td>
                              <td style={{ padding: '0.75rem' }}>
                                <button
                                  onClick={() => handleRemoveSup3Venue(a.id, venue?.venue_name || 'this venue')}
                                  disabled={isRemoving}
                                  style={{
                                    padding: '0.375rem 0.75rem',
                                    backgroundColor: isRemoving ? '#9ca3af' : '#ef4444',
                                    color: 'white', border: 'none', borderRadius: '0.375rem',
                                    cursor: isRemoving ? 'not-allowed' : 'pointer',
                                    fontWeight: '500', fontSize: '0.875rem',
                                  }}
                                >
                                  {isRemoving ? 'Removing...' : 'Remove'}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {!sup3Loading && sup3VenueAssignments.length > 0 && (
                <div style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
                  {sup3VenueAssignments.length} venue{sup3VenueAssignments.length !== 1 ? 's' : ''} assigned
                </div>
              )}

              {/* ---- Team Members ---- */}
              <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: '700', marginBottom: '0.25rem' }}>Team Members</h3>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.25rem' }}>
                  Supervisors on this team will only see venues assigned to this Supervisor 3.
                </p>

                {/* Add member row */}
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem', border: '1px solid #e5e7eb' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontWeight: '600', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151' }}>
                      Add Supervisor to Team
                    </label>
                    <select
                      value={addSup3MemberId}
                      onChange={(e) => setAddSup3MemberId(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '1rem', cursor: 'pointer' }}
                    >
                      <option value="">-- Select a supervisor --</option>
                      {availableSupervisorsForSup3.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.first_name} {u.last_name} — {u.email}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleAddSup3Member}
                    disabled={!addSup3MemberId || addingSup3Member}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: !addSup3MemberId || addingSup3Member ? '#9ca3af' : '#ea580c',
                      color: 'white', border: 'none', borderRadius: '0.375rem',
                      cursor: !addSup3MemberId || addingSup3Member ? 'not-allowed' : 'pointer',
                      fontWeight: '600', fontSize: '1rem', whiteSpace: 'nowrap',
                    }}
                  >
                    {addingSup3Member ? 'Adding...' : 'Add to Team'}
                  </button>
                </div>

                {/* Messages */}
                {sup3TeamSuccess && (
                  <div style={{ padding: '1rem', backgroundColor: '#dcfce7', color: '#15803d', borderRadius: '0.375rem', marginBottom: '1.5rem', fontWeight: '500' }}>
                    {sup3TeamSuccess}
                  </div>
                )}
                {sup3TeamError && (
                  <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '0.375rem', marginBottom: '1.5rem' }}>
                    {sup3TeamError}
                  </div>
                )}

                {sup3TeamLoading && (
                  <div style={{ textAlign: 'center', padding: '2rem' }}><p>Loading team...</p></div>
                )}

                {/* Team members table */}
                {!sup3TeamLoading && (
                  <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f9fafb' }}>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Name</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Email</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Role</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Assigned</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Venues</th>
                          <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sup3TeamMembers.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                              No supervisors assigned to this team yet
                            </td>
                          </tr>
                        ) : (
                          sup3TeamMembers.map((tm) => {
                            const m = tm.member;
                            if (!m) return null;
                            const colors = getRoleColors(m.role);
                            const isRemoving = removingSup3TeamId === tm.assignment_id;
                            const isExpanded = expandedSup3MemberId === m.id;
                            const memberVenues = sup3MemberVenues[m.id] || [];
                            return (
                              <React.Fragment key={tm.assignment_id}>
                                <tr style={{ borderBottom: isExpanded ? 'none' : '1px solid #e5e7eb' }}>
                                  <td style={{ padding: '0.75rem' }}>{m.first_name} {m.last_name}</td>
                                  <td style={{ padding: '0.75rem', color: '#4b5563' }}>{m.email}</td>
                                  <td style={{ padding: '0.75rem' }}>
                                    <span style={{ padding: '0.25rem 0.5rem', backgroundColor: colors.bg, color: colors.text, borderRadius: '0.25rem', fontSize: '0.875rem', fontWeight: '500' }}>
                                      {m.role}
                                    </span>
                                  </td>
                                  <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.875rem' }}>
                                    {new Date(tm.assigned_at).toLocaleDateString()}
                                  </td>
                                  <td style={{ padding: '0.75rem' }}>
                                    {memberVenues.length === 0 ? (
                                      <span style={{ fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic' }}>All venues</span>
                                    ) : (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                                        {memberVenues.map((a: any) => (
                                          <span
                                            key={a.id}
                                            style={{ padding: '0.125rem 0.5rem', backgroundColor: '#ffedd5', color: '#9a3412', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: '500', whiteSpace: 'nowrap' }}
                                          >
                                            {a.venue?.venue_name || a.venue_id}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ padding: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <button
                                      onClick={() => handleToggleMemberVenues(selectedSup3Id, m.id)}
                                      style={{
                                        padding: '0.375rem 0.75rem',
                                        backgroundColor: isExpanded ? '#f97316' : '#ea580c',
                                        color: 'white', border: 'none', borderRadius: '0.375rem',
                                        cursor: 'pointer', fontWeight: '500', fontSize: '0.875rem',
                                      }}
                                    >
                                      {isExpanded ? 'Hide Venues' : 'Manage Venues'}
                                    </button>
                                    <button
                                      onClick={() => handleRemoveSup3Member(tm.assignment_id, `${m.first_name} ${m.last_name}`)}
                                      disabled={isRemoving}
                                      style={{
                                        padding: '0.375rem 0.75rem',
                                        backgroundColor: isRemoving ? '#9ca3af' : '#ef4444',
                                        color: 'white', border: 'none', borderRadius: '0.375rem',
                                        cursor: isRemoving ? 'not-allowed' : 'pointer',
                                        fontWeight: '500', fontSize: '0.875rem',
                                      }}
                                    >
                                      {isRemoving ? 'Removing...' : 'Remove'}
                                    </button>
                                  </td>
                                </tr>

                                {/* Expandable venue assignment row */}
                                {isExpanded && (
                                  <tr key={`${tm.assignment_id}-venues`} style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: '#fff7ed' }}>
                                    <td colSpan={6} style={{ padding: '1rem 1.5rem' }}>
                                      <div style={{ marginBottom: '0.75rem', fontWeight: '600', fontSize: '0.875rem', color: '#9a3412' }}>
                                        Assigned Venues for {m.first_name} {m.last_name}
                                      </div>

                                      {/* Add venue row */}
                                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                                        <select
                                          value={addVenueToMemberVenueId}
                                          onChange={(e) => setAddVenueToMemberVenueId(e.target.value)}
                                          style={{ flex: 1, maxWidth: '360px', padding: '0.5rem 0.75rem', border: '1px solid #fed7aa', borderRadius: '0.375rem', fontSize: '0.875rem', cursor: 'pointer' }}
                                        >
                                          <option value="">— Select a venue to assign —</option>
                                          {venuesAvailableForMember.map((v: any) => (
                                            <option key={v.id} value={v.id}>
                                              {v.venue_name} — {v.city}, {v.state}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          onClick={() => handleAddVenueToMember(selectedSup3Id, m.id)}
                                          disabled={!addVenueToMemberVenueId || addingVenueToMember}
                                          style={{
                                            padding: '0.5rem 1rem',
                                            backgroundColor: !addVenueToMemberVenueId || addingVenueToMember ? '#9ca3af' : '#ea580c',
                                            color: 'white', border: 'none', borderRadius: '0.375rem',
                                            cursor: !addVenueToMemberVenueId || addingVenueToMember ? 'not-allowed' : 'pointer',
                                            fontWeight: '600', fontSize: '0.875rem', whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {addingVenueToMember ? 'Adding...' : 'Assign Venue'}
                                        </button>
                                      </div>

                                      {/* Current venue list */}
                                      {memberVenues.length === 0 ? (
                                        <p style={{ fontSize: '0.875rem', color: '#6b7280', fontStyle: 'italic' }}>
                                          No venues assigned yet — this supervisor inherits all of Supervisor 3&apos;s venues until specific venues are assigned.
                                        </p>
                                      ) : (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                          {memberVenues.map((a: any) => (
                                            <span
                                              key={a.id}
                                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.625rem', backgroundColor: '#ffedd5', color: '#9a3412', borderRadius: '9999px', fontSize: '0.8125rem', fontWeight: '500' }}
                                            >
                                              {a.venue?.venue_name || a.venue_id}
                                              <button
                                                onClick={() => handleRemoveVenueFromMember(a.id, selectedSup3Id, m.id)}
                                                disabled={removingVenueAssignmentId === a.id}
                                                style={{ background: 'none', border: 'none', cursor: removingVenueAssignmentId === a.id ? 'not-allowed' : 'pointer', color: '#c2410c', fontWeight: '700', fontSize: '0.9rem', lineHeight: 1, padding: '0 2px' }}
                                                title="Remove venue"
                                              >
                                                ×
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {!sup3TeamLoading && sup3TeamMembers.length > 0 && (
                  <div style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
                    {sup3TeamMembers.length} supervisor{sup3TeamMembers.length !== 1 ? 's' : ''} on this team
                  </div>
                )}
              </div>
            </>
          )}

          {!selectedSup3Id && supervisor3Users.length > 0 && (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af' }}>
              <p style={{ fontSize: '1.125rem' }}>Select a Supervisor 3 above to manage their venue assignments</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
