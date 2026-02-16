"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

type UserRoleRow = Pick<User, "role">;

const AVAILABLE_ROLES = [
  { value: "worker", label: "Worker" },
  { value: "supervisor", label: "Supervisor" },
  { value: "supervisor2", label: "Supervisor 2 (Read-Only)" },
  { value: "manager", label: "Manager" },
  { value: "finance", label: "Finance" },
  { value: "exec", label: "Exec" },
  { value: "hr", label: "HR" },
  { value: "backgroundchecker", label: "Background Checker" },
];

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  worker: { bg: "#f3f4f6", text: "#374151" },
  supervisor: { bg: "#fef3c7", text: "#92400e" },
  supervisor2: { bg: "#fef9c3", text: "#854d0e" },
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
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  // --- Team Assignment State ---
  const [activeTab, setActiveTab] = useState<"roles" | "teams">("roles");
  const [managers, setManagers] = useState<User[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<string>("");
  const [teamMembers, setTeamMembers] = useState<TeamAssignment[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamSuccess, setTeamSuccess] = useState("");
  const [addMemberId, setAddMemberId] = useState<string>("");
  const [addingMember, setAddingMember] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

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

  // Derive managers from users list
  useEffect(() => {
    const mgrs = users.filter(u => ['manager', 'exec'].includes(u.role));
    setManagers(mgrs);
  }, [users]);

  // Load team when manager changes
  useEffect(() => {
    if (selectedManagerId) {
      loadTeamMembers(selectedManagerId);
    } else {
      setTeamMembers([]);
    }
  }, [selectedManagerId]);

  // Filter users based on search term and role filter
  useEffect(() => {
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

    setFilteredUsers(result);
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
      const res = await fetch('/api/users/role-management-list', {
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

      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      setSuccessMessage(`${userName}'s role updated to ${newRole}`);
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
              Select a Manager / Exec
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
                    {availableMembers.map(u => {
                      const rc = getRoleColors(u.role);
                      return (
                        <option key={u.id} value={u.id}>
                          {u.first_name} {u.last_name} — {u.role}
                        </option>
                      );
                    })}
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
    </div>
  );
}
