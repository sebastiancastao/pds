'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface FormEntry {
  id: string;
  form_name: string;
  updated_at: string;
}

interface UserWithForms {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  state: string;
  created_at: string;
  forms_count: number;
  forms: FormEntry[];
}

export default function CustomFormsReportPage() {
  const [users, setUsers] = useState<UserWithForms[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterForms, setFilterForms] = useState<'all' | 'with' | 'without'>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterState, setFilterState] = useState<string>('all');
  const router = useRouter();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/pdf-form-progress/all-users', {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          setError(`Access denied. Admin privileges required.${data.currentRole ? ` Your role: ${data.currentRole}` : ''}`);
        } else if (res.status === 401) {
          setError('Please log in to continue.');
        } else {
          throw new Error(data.error || 'Failed to load users');
        }
        return;
      }
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/pdf-form-progress/export', {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `custom_forms_report_${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const formatFormName = (formName: string) =>
    formName
      .replace(/^[a-z]{2}-/, '')
      .replace(/-/g, ' ')
      .replace(/\.pdf$/i, '')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString();

  const uniqueRoles = useMemo(
    () => Array.from(new Set(users.map((u) => u.role).filter(Boolean))),
    [users]
  );
  const uniqueStates = useMemo(
    () => Array.from(new Set(users.map((u) => u.state).filter(Boolean))).sort(),
    [users]
  );

  // All unique form names across all users, sorted alphabetically
  const allFormNames = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      for (const f of u.forms) {
        set.add(formatFormName(f.form_name));
      }
    }
    return Array.from(set).sort();
  }, [users]);

  // Build a lookup: userId -> { formName -> updated_at }
  const formLookup = useMemo(() => {
    const map: Record<string, Record<string, string>> = {};
    for (const u of users) {
      map[u.user_id] = {};
      for (const f of u.forms) {
        map[u.user_id][formatFormName(f.form_name)] = f.updated_at;
      }
    }
    return map;
  }, [users]);

  const filteredUsers = useMemo(() => users.filter((user) => {
    const matchesSearch =
      user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
    if (!matchesSearch) return false;
    if (filterForms === 'with' && user.forms_count === 0) return false;
    if (filterForms === 'without' && user.forms_count > 0) return false;
    if (filterRole !== 'all' && user.role !== filterRole) return false;
    if (filterState !== 'all' && user.state !== filterState) return false;
    return true;
  }), [users, searchTerm, filterForms, filterRole, filterState]);

  const totalForms = users.reduce((sum, u) => sum + u.forms_count, 0);
  const usersWithForms = users.filter((u) => u.forms_count > 0).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading report data...</p>
        </div>
      </div>
    );
  }

  const fixedColCount = 4; // Name, Email, Role, State
  const totalColCount = fixedColCount + allFormNames.length;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-full mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap max-w-7xl mx-auto">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Custom Forms Report</h1>
            <p className="mt-2 text-gray-600">Each column is a form — cells show the submission date</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportReport}
              disabled={exporting || !!error}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {exporting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export to Excel
                </>
              )}
            </button>
            <button
              onClick={() => router.push('/hr-dashboard')}
              className="apple-button apple-button-secondary flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 max-w-7xl mx-auto">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Total Users</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{users.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Users with Forms</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">{usersWithForms}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Total Submissions</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{totalForms}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Unique Forms</div>
            <div className="mt-2 text-3xl font-semibold text-purple-600">{allFormNames.length}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6 p-4 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Name or email..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label htmlFor="filterForms" className="block text-sm font-medium text-gray-700 mb-1">Form Status</label>
              <select
                id="filterForms"
                value={filterForms}
                onChange={(e) => setFilterForms(e.target.value as 'all' | 'with' | 'without')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">All Users</option>
                <option value="with">With Forms</option>
                <option value="without">Without Forms</option>
              </select>
            </div>
            <div>
              <label htmlFor="filterRole" className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                id="filterRole"
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">All Roles</option>
                {uniqueRoles.map((r) => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filterState" className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <select
                id="filterState"
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="all">All States</option>
                {uniqueStates.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Pivot Table */}
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="divide-y divide-gray-200" style={{ minWidth: '100%', tableLayout: 'auto' }}>
            <thead className="bg-gray-50">
              <tr>
                {/* Fixed columns */}
                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap border-r border-gray-200">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  State
                </th>
                {/* One column per form */}
                {allFormNames.map((name) => (
                  <th
                    key={name}
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    title={name}
                  >
                    <div className="max-w-[140px] truncate mx-auto">{name}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={totalColCount} className="px-6 py-12 text-center text-gray-500">
                    {searchTerm || filterForms !== 'all' || filterRole !== 'all' || filterState !== 'all'
                      ? 'No users match the current filters.'
                      : 'No users found.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const userForms = formLookup[user.user_id] || {};
                  return (
                    <tr key={user.user_id} className="hover:bg-gray-50">
                      {/* User cell — sticky */}
                      <td className="sticky left-0 z-10 bg-white hover:bg-gray-50 px-4 py-3 border-r border-gray-200 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-blue-600 font-semibold text-xs">
                              {user.full_name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
                            <div className="text-xs text-gray-500">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-full capitalize">
                          {user.role || 'N/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {user.state ? (
                          <span className="px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">
                            {user.state}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      {/* One cell per form */}
                      {allFormNames.map((name) => {
                        const submittedAt = userForms[name];
                        return (
                          <td key={name} className="px-4 py-3 text-center whitespace-nowrap">
                            {submittedAt ? (
                              <span className="inline-flex flex-col items-center gap-0.5">
                                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-xs text-gray-500">{formatDate(submittedAt)}</span>
                              </span>
                            ) : (
                              <span className="text-gray-200 text-lg leading-none">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500 max-w-7xl mx-auto">
          <span>Showing {filteredUsers.length} of {users.length} users</span>
          <span className="text-xs text-gray-400">Export includes all users regardless of filters</span>
        </div>
      </div>
    </div>
  );
}
