"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { safeDecrypt } from "@/lib/encryption";
import * as XLSX from 'xlsx';

type User = {
  // User fields
  id: string;
  email: string;
  role: string;
  division: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  failed_login_attempts: number;
  account_locked_until: string | null;
  is_temporary_password: boolean;
  must_change_password: boolean;
  password_expires_at: string | null;
  last_password_change: string | null;
  background_check_completed: boolean;
  background_check_completed_at: string | null;
  // Profile fields
  first_name: string;
  last_name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  mfa_enabled: boolean;
  onboarding_status: string | null;
  onboarding_completed_at: string | null;
  latitude: number | null;
  longitude: number | null;
  profile_created_at: string;
  profile_updated_at: string;
  // Computed fields
  has_download_records: boolean;
  has_vendor_onboarding_record: boolean;
  vendor_onboarding_completed: boolean | null;
};

type UserRoleRow = Pick<User, "role">;

export default function UserManagementPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [resettingDownloads, setResettingDownloads] = useState<string | null>(null);
  const [resettingOnboarding, setResettingOnboarding] = useState<string | null>(null);

  // Check authorization
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

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
        console.error('[USER-MANAGEMENT] Auth error:', err);
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

  // Filter users based on search term
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setFilteredUsers(users);
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = users.filter(user =>
        user.first_name.toLowerCase().includes(term) ||
        user.last_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        user.role.toLowerCase().includes(term)
      );
      setFilteredUsers(filtered);
    }
  }, [searchTerm, users]);

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/all', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load users');
      }

      setUsers(data.users || []);
    } catch (err: any) {
      console.error('[USER-MANAGEMENT] Error loading users:', err);
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const toggleBackgroundCheckStatus = async (userId: string, currentStatus: boolean) => {
    setUpdatingUser(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const newStatus = !currentStatus;
      const res = await fetch('/api/users/toggle-background-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId, status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update background check status');
      }

      // Update local state
      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === userId
            ? { ...user, background_check_completed: newStatus }
            : user
        )
      );
    } catch (err: any) {
      console.error('[USER-MANAGEMENT] Error toggling background check:', err);
      alert(err.message || 'Failed to update background check status');
    } finally {
      setUpdatingUser(null);
    }
  };

  const resetDownloads = async (userId: string) => {
    if (!confirm('Are you sure you want to reset the PDF download records for this user? This will allow the background check PDF to be downloaded again.')) {
      return;
    }

    setResettingDownloads(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/reset-downloads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset download records');
      }

      alert(`Successfully reset download records! ${data.recordsDeleted || 0} record(s) deleted.`);

      // Update local state to remove the download records flag
      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === userId
            ? { ...user, has_download_records: false }
            : user
        )
      );
    } catch (err: any) {
      console.error('[USER-MANAGEMENT] Error resetting downloads:', err);
      alert(err.message || 'Failed to reset download records');
    } finally {
      setResettingDownloads(null);
    }
  };

  const resetOnboarding = async (userId: string) => {
    if (!confirm('Are you sure you want to open onboarding for this user? This will delete their onboarding submission record and allow them to re-edit their forms.')) {
      return;
    }

    setResettingOnboarding(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/reset-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset onboarding');
      }

      alert('Successfully opened onboarding for editing!');

      // Update local state to remove the onboarding record flag
      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === userId
            ? { ...user, has_vendor_onboarding_record: false, vendor_onboarding_completed: null }
            : user
        )
      );
    } catch (err: any) {
      console.error('[USER-MANAGEMENT] Error resetting onboarding:', err);
      alert(err.message || 'Failed to reset onboarding');
    } finally {
      setResettingOnboarding(null);
    }
  };

  const exportToExcel = () => {
    if (filteredUsers.length === 0) {
      alert('No users to export');
      return;
    }

    // Prepare data for Excel with all fields
    const data = filteredUsers.map(user => ({
      // Basic Info
      'ID': user.id,
      'Email': user.email,
      'First Name': user.first_name,
      'Last Name': user.last_name,
      'Phone': user.phone || '',
      'Address': user.address || '',
      'City': user.city || '',
      'State': user.state || '',
      'Zip Code': user.zip_code || '',

      // Account Info
      'Role': user.role,
      'Division': user.division || '',
      'Is Active': user.is_active ? 'Yes' : 'No',
      'Account Created': user.created_at ? new Date(user.created_at).toLocaleString() : '',
      'Account Updated': user.updated_at ? new Date(user.updated_at).toLocaleString() : '',
      'Last Login': user.last_login ? new Date(user.last_login).toLocaleString() : '',

      // Security Info
      'Failed Login Attempts': user.failed_login_attempts,
      'Account Locked Until': user.account_locked_until ? new Date(user.account_locked_until).toLocaleString() : '',
      'Is Temporary Password': user.is_temporary_password ? 'Yes' : 'No',
      'Must Change Password': user.must_change_password ? 'Yes' : 'No',
      'Password Expires At': user.password_expires_at ? new Date(user.password_expires_at).toLocaleString() : '',
      'Last Password Change': user.last_password_change ? new Date(user.last_password_change).toLocaleString() : '',
      'MFA Enabled': user.mfa_enabled ? 'Yes' : 'No',

      // Onboarding & Background Check
      'Onboarding Status': user.onboarding_status || '',
      'Onboarding Completed': user.onboarding_completed_at ? new Date(user.onboarding_completed_at).toLocaleString() : '',
      'Background Check Completed': user.background_check_completed ? 'Yes' : 'No',
      'Background Check Completed At': user.background_check_completed_at ? new Date(user.background_check_completed_at).toLocaleString() : '',
      'Has Download Records': user.has_download_records ? 'Yes' : 'No',

      // Location
      'Latitude': user.latitude || '',
      'Longitude': user.longitude || '',

      // Profile Timestamps
      'Profile Created': user.profile_created_at ? new Date(user.profile_created_at).toLocaleString() : '',
      'Profile Updated': user.profile_updated_at ? new Date(user.profile_updated_at).toLocaleString() : '',
    }));

    // Create a new workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');

    // Set column widths for better readability
    const columnWidths = [
      { wch: 36 }, // ID
      { wch: 30 }, // Email
      { wch: 20 }, // First Name
      { wch: 20 }, // Last Name
      { wch: 15 }, // Phone
      { wch: 30 }, // Address
      { wch: 15 }, // City
      { wch: 8 },  // State
      { wch: 10 }, // Zip Code
      { wch: 15 }, // Role
      { wch: 15 }, // Division
      { wch: 10 }, // Is Active
      { wch: 20 }, // Account Created
      { wch: 20 }, // Account Updated
      { wch: 20 }, // Last Login
      { wch: 10 }, // Failed Login Attempts
      { wch: 20 }, // Account Locked Until
      { wch: 15 }, // Is Temporary Password
      { wch: 15 }, // Must Change Password
      { wch: 20 }, // Password Expires At
      { wch: 20 }, // Last Password Change
      { wch: 12 }, // MFA Enabled
      { wch: 15 }, // Onboarding Status
      { wch: 20 }, // Onboarding Completed
      { wch: 15 }, // Background Check Completed
      { wch: 25 }, // Background Check Completed At
      { wch: 15 }, // Has Download Records
      { wch: 12 }, // Latitude
      { wch: 12 }, // Longitude
      { wch: 20 }, // Profile Created
      { wch: 20 }, // Profile Updated
    ];
    worksheet['!cols'] = columnWidths;

    // Generate Excel file and trigger download
    const fileName = `users_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
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

  if (authChecking) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Checking authorization...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>User Management</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={exportToExcel}
            disabled={loading || filteredUsers.length === 0}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: loading || filteredUsers.length === 0 ? 'not-allowed' : 'pointer',
              fontWeight: '500',
              opacity: loading || filteredUsers.length === 0 ? 0.5 : 1
            }}
          >
            Export to Excel
          </button>
          <Link
            href="/reset-user-password"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#f59e0b',
              color: 'white',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            Reset User Password
          </Link>
          <Link
            href="/admin-email"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#6366f1',
              color: 'white',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            Email Sender
          </Link>
          <Link
            href="/global-calendar"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            Back to Calendar
          </Link>
          <button
            onClick={handleLogout}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Search by name, email, or role..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '1rem'
          }}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fee2e2',
          color: '#dc2626',
          borderRadius: '0.375rem',
          marginBottom: '1.5rem'
        }}>
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Loading users...</p>
        </div>
      )}

      {/* Users Table */}
      {!loading && (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Name
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Email
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Role
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Background Check Status
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Onboarding Status
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                    {searchTerm ? 'No users found matching your search' : 'No users found'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.75rem' }}>
                      {user.first_name} {user.last_name}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {user.email}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        backgroundColor: '#e0e7ff',
                        color: '#3730a3',
                        borderRadius: '0.25rem',
                        fontSize: '0.875rem',
                        fontWeight: '500'
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        backgroundColor: user.background_check_completed ? '#dcfce7' : '#fef3c7',
                        color: user.background_check_completed ? '#15803d' : '#92400e',
                        borderRadius: '0.25rem',
                        fontSize: '0.875rem',
                        fontWeight: '500'
                      }}>
                        {user.background_check_completed ? 'Completed' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {user.has_vendor_onboarding_record ? (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: user.vendor_onboarding_completed ? '#dcfce7' : '#fef3c7',
                          color: user.vendor_onboarding_completed ? '#15803d' : '#92400e',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          fontWeight: '500'
                        }}>
                          {user.vendor_onboarding_completed ? 'Approved' : 'Pending Approval'}
                        </span>
                      ) : (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: '#f3f4f6',
                          color: '#6b7280',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          fontWeight: '500'
                        }}>
                          Not Submitted
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => toggleBackgroundCheckStatus(user.id, user.background_check_completed)}
                          disabled={updatingUser === user.id}
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: user.background_check_completed ? '#f59e0b' : '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.375rem',
                            cursor: updatingUser === user.id ? 'not-allowed' : 'pointer',
                            fontWeight: '500',
                            fontSize: '0.875rem',
                            opacity: updatingUser === user.id ? 0.5 : 1
                          }}
                        >
                          {updatingUser === user.id
                            ? 'Updating...'
                            : user.background_check_completed
                            ? 'Open for Editing'
                            : 'Close for Editing'}
                        </button>
                        {user.has_download_records && (
                          <button
                            onClick={() => resetDownloads(user.id)}
                            disabled={resettingDownloads === user.id}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.375rem',
                              cursor: resettingDownloads === user.id ? 'not-allowed' : 'pointer',
                              fontWeight: '500',
                              fontSize: '0.875rem',
                              opacity: resettingDownloads === user.id ? 0.5 : 1
                            }}
                          >
                            {resettingDownloads === user.id ? 'Resetting...' : 'Reset Downloaded'}
                          </button>
                        )}
                        {user.has_vendor_onboarding_record && (
                          <button
                            onClick={() => resetOnboarding(user.id)}
                            disabled={resettingOnboarding === user.id}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#8b5cf6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.375rem',
                              cursor: resettingOnboarding === user.id ? 'not-allowed' : 'pointer',
                              fontWeight: '500',
                              fontSize: '0.875rem',
                              opacity: resettingOnboarding === user.id ? 0.5 : 1
                            }}
                          >
                            {resettingOnboarding === user.id ? 'Opening...' : 'Open Onboarding'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Results Count */}
      {!loading && filteredUsers.length > 0 && (
        <div style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
          Showing {filteredUsers.length} of {users.length} users
        </div>
      )}
    </div>
  );
}
