"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type LatestFormEdit = {
  userId: string;
  formId: string;
  formDisplayName: string;
  action: string;
  editedAt: string | null;
  editorUserId: string | null;
  editorName: string | null;
  editorEmail: string | null;
  editorRole: string | null;
};

type DirectoryUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
};

type UserRoleRow = { role: string };

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatActionLabel(action?: string | null) {
  if (!action) return "";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export default function InsightsPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [recentFormEdits, setRecentFormEdits] = useState<LatestFormEdit[]>([]);

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

        const userRole = (userData?.role ?? "").toString().trim().toLowerCase();

        if (userError || !userRole || !['exec', 'admin', 'hr', 'hr_admin'].includes(userRole)) {
          alert('Unauthorized: HR/Admin/Exec access required');
          router.push('/dashboard');
          return;
        }

        setIsAuthorized(true);
      } catch (err) {
        console.error('[INSIGHTS] Auth error:', err);
        router.push('/login');
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      loadInsights();
    }
  }, [isAuthorized]);

  const loadInsights = async () => {
    setLoading(true);
    setError("");
    setAuditError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const [usersResponse, editsResponse] = await Promise.all([
        fetch('/api/users/all', {
          method: 'GET',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch('/api/hr/employees/form-edits', {
          method: 'GET',
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);

      let usersData: any = null;
      let editsData: any = null;
      try { usersData = await usersResponse.json(); } catch { usersData = null; }
      try { editsData = await editsResponse.json(); } catch { editsData = null; }

      if (usersResponse.ok) {
        setUsers(usersData?.users || []);
      } else {
        setUsers([]);
      }

      if (editsResponse.ok) {
        setRecentFormEdits(editsData?.recentEdits || []);
      } else {
        setRecentFormEdits([]);
        setAuditError(editsData?.error || 'Failed to load HR form edit history');
      }
    } catch (err: any) {
      console.error('[INSIGHTS] Error loading insights:', err);
      setRecentFormEdits([]);
      setError(err.message || 'Failed to load insights');
    } finally {
      setLoading(false);
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

  const userDisplayNameById = new Map(
    users.map((user) => [
      user.id,
      `${user.first_name} ${user.last_name}`.trim() || user.email || user.id,
    ])
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>Insights</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Link
            href="/hr/employees"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#2563eb',
              color: 'white',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            Employees
          </Link>
          <Link
            href="/hr-dashboard"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#6366f1',
              color: 'white',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            Back to HR Dashboard
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

      {auditError && !error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          borderRadius: '0.375rem',
          marginBottom: '1.5rem'
        }}>
          {auditError}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Loading insights...</p>
        </div>
      )}

      {!loading && (
        <div style={{
          marginBottom: '1.5rem',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: '1rem',
          backgroundColor: 'white'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem'
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', color: '#111827' }}>
                Recent HR Form Edits
              </h2>
              <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                Latest form edits saved from the HR employee pages.
              </p>
            </div>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              {recentFormEdits.length} recent record{recentFormEdits.length === 1 ? '' : 's'}
            </span>
          </div>

          {recentFormEdits.length === 0 ? (
            <p style={{ margin: 0, color: '#6b7280' }}>No HR form edits recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      Employee
                    </th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      Form
                    </th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      Edited By
                    </th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      When
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentFormEdits.map((edit, index) => (
                    <tr key={`${edit.userId}-${edit.formId}-${edit.editedAt}-${index}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                        {userDisplayNameById.get(edit.userId) || edit.userId}
                      </td>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: '600', color: '#111827' }}>{edit.formDisplayName}</div>
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{formatActionLabel(edit.action)}</div>
                      </td>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: '500', color: '#111827' }}>
                          {edit.editorName || edit.editorEmail || 'Unknown'}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                          {edit.editorRole || edit.editorEmail || edit.editorUserId || '-'}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top', color: '#374151' }}>
                        {formatDateTime(edit.editedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
