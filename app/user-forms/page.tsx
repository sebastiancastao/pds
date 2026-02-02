'use client';

import { useEffect, useState } from 'react';
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
  created_at: string;
  forms_count: number;
  forms: FormEntry[];
}

export default function UserFormsPage() {
  const [users, setUsers] = useState<UserWithForms[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterHasForms, setFilterHasForms] = useState<'all' | 'with' | 'without'>('all');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [loadingForm, setLoadingForm] = useState<string | null>(null);
  const [downloadingUser, setDownloadingUser] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    loadUsers();
  }, []);

  const openForm = async (userId: string, formName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLoadingForm(`${userId}-${formName}`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/pdf-form-progress/admin-fetch?userId=${userId}&formName=${encodeURIComponent(formName)}`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      const data = await res.json();
      if (!res.ok || !data.found) {
        alert('Failed to load form');
        return;
      }

      // Convert base64 to blob and open in new tab
      const byteCharacters = atob(data.formData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      console.error('Error opening form:', err);
      alert('Failed to open form');
    } finally {
      setLoadingForm(null);
    }
  };

  const downloadAllForms = async (userId: string, userName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloadingUser(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/pdf-form-progress/user/${userId}?signatureSource=forms_signature`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.error || 'Failed to download forms');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${userName.replace(/\s+/g, '_')}_forms.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading forms:', err);
      alert('Failed to download forms');
    } finally {
      setDownloadingUser(null);
    }
  };

  const loadUsers = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/pdf-form-progress/all-users', {
        method: 'GET',
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
      console.error('[UserForms] Error:', e);
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (userId: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedUsers(new Set(filteredUsers.map((u) => u.user_id)));
  };

  const collapseAll = () => {
    setExpandedUsers(new Set());
  };

  const formatFormName = (formName: string) => {
    return formName
      .replace(/^[a-z]{2}-/, '') // Remove state prefix like "ca-"
      .replace(/-/g, ' ')
      .replace(/\.pdf$/i, '')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterHasForms === 'with' && user.forms_count === 0) return false;
    if (filterHasForms === 'without' && user.forms_count > 0) return false;

    return true;
  });

  const totalForms = users.reduce((sum, u) => sum + u.forms_count, 0);
  const usersWithForms = users.filter((u) => u.forms_count > 0).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading users and forms...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">User Form Progress</h1>
            <p className="mt-2 text-gray-600">View all users and their saved PDF form progress</p>
          </div>
          <button
            onClick={() => router.push('/hr-dashboard')}
            className="apple-button apple-button-secondary flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to Dashboard
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Users</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{users.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Users with Forms</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">{usersWithForms}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Form Entries</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{totalForms}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                Search Users
              </label>
              <input
                type="text"
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="filterForms" className="block text-sm font-medium text-gray-700 mb-1">
                Form Status
              </label>
              <select
                id="filterForms"
                value={filterHasForms}
                onChange={(e) => setFilterHasForms(e.target.value as 'all' | 'with' | 'without')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Users</option>
                <option value="with">With Forms</option>
                <option value="without">Without Forms</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={expandAll}
                className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-300 rounded-md hover:bg-blue-50"
              >
                Expand All
              </button>
              <button
                onClick={collapseAll}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Collapse All
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Users List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="divide-y divide-gray-200">
            {filteredUsers.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500">
                {searchTerm || filterHasForms !== 'all'
                  ? 'No users found matching your filters.'
                  : 'No users found.'}
              </div>
            ) : (
              filteredUsers.map((user) => {
                const isExpanded = expandedUsers.has(user.user_id);
                return (
                  <div key={user.user_id} className="border-b border-gray-100 last:border-b-0">
                    {/* User Row */}
                    <div
                      className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleExpand(user.user_id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-blue-600 font-semibold text-sm">
                              {user.full_name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
                          <div className="text-sm text-gray-500">{user.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {user.forms_count > 0 && (
                          <button
                            onClick={(e) => downloadAllForms(user.user_id, user.full_name, e)}
                            disabled={downloadingUser === user.user_id}
                            className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {downloadingUser === user.user_id ? (
                              <>
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Downloading...
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download All
                              </>
                            )}
                          </button>
                        )}
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          user.forms_count > 0
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {user.forms_count} {user.forms_count === 1 ? 'form' : 'forms'}
                        </span>
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* Expanded Forms List */}
                    {isExpanded && user.forms.length > 0 && (
                      <div className="px-6 pb-4 bg-gray-50">
                        <table className="min-w-full">
                          <thead>
                            <tr>
                              <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">Form Name</th>
                              <th className="text-left text-xs font-medium text-gray-500 uppercase py-2">Last Updated</th>
                              <th className="text-right text-xs font-medium text-gray-500 uppercase py-2">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {user.forms.map((form) => {
                              const isLoading = loadingForm === `${user.user_id}-${form.form_name}`;
                              return (
                                <tr key={form.id} className="hover:bg-gray-100">
                                  <td className="py-2 text-sm text-gray-900">
                                    {formatFormName(form.form_name)}
                                  </td>
                                  <td className="py-2 text-sm text-gray-500">
                                    {formatDate(form.updated_at)}
                                  </td>
                                  <td className="py-2 text-right">
                                    <button
                                      onClick={(e) => openForm(user.user_id, form.form_name, e)}
                                      disabled={isLoading}
                                      className="px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-300 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                                    >
                                      {isLoading ? (
                                        <>
                                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                          </svg>
                                          Opening...
                                        </>
                                      ) : (
                                        <>
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                          </svg>
                                          View
                                        </>
                                      )}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Empty forms message */}
                    {isExpanded && user.forms.length === 0 && (
                      <div className="px-6 pb-4 bg-gray-50">
                        <p className="text-sm text-gray-500 italic">No forms saved yet.</p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-6 text-sm text-gray-500 text-center">
          Showing {filteredUsers.length} of {users.length} users
        </div>
      </div>
    </div>
  );
}
