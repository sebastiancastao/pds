'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface OnboardingStatus {
  id: string;
  onboarding_completed: boolean;
  completed_date: string | null;
  notes: string | null;
  updated_at: string;
}

interface FormProgress {
  form_name: string;
  updated_at: string;
  position: number;
  display_name: string;
}

interface User {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  phone: string | null;
  created_at: string;
  is_temporary_password: boolean;
  must_change_password: boolean;
  has_temporary_password: boolean;
  onboarding_completed_user_table: boolean;
  onboarding_status: OnboardingStatus | null;
  background_check_completed: boolean;
  has_submitted_pdf: boolean;
  pdf_submitted_at: string | null;
  pdf_latest_update?: string | null;
  pdf_downloaded: boolean;
  pdf_downloaded_at: string | null;
  latest_form_progress: FormProgress | null;
  forms_completed: number;
  total_forms: number;
  completed_forms: string[];
}

export default function OnboardingPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [filterPassword, setFilterPassword] = useState<'all' | 'temporary' | 'permanent'>('all');
  const [filterForm, setFilterForm] = useState<string>('all');
  const [showOnlyWithProgress, setShowOnlyWithProgress] = useState(false);

  // Current user's role (from users table)
  const [myRole, setMyRole] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    Promise.all([loadCurrentUserRole(), loadUsers()]).finally(() => setLoading(false));
  }, []);

  const loadCurrentUserRole = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setMyRole(null);
        return;
      }

      const { data, error } = await (supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single() as any);

      if (error) {
        console.error('[Onboarding] Role fetch error:', error);
        setMyRole(null);
        return;
      }

      const role = (data?.role ?? '').trim().toLowerCase();
      setMyRole(role || null);
    } catch (e) {
      console.error('[Onboarding] Role fetch exception:', e);
      setMyRole(null);
    }
  };

  const loadUsers = async () => {
    setError(null);
    try {
      const { data: { session} } = await supabase.auth.getSession();
      const res = await fetch('/api/onboarding', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403) {
          const roleMsg = data.currentRole ? ` Your current role: ${data.currentRole}` : '';
          setError(`Access denied. Admin privileges required.${roleMsg}`);
        } else if (res.status === 401) {
          setError('Please log in to continue.');
        } else if (res.status === 500) {
          setError(`Server error: ${data.error || 'Unknown error'}. Details: ${data.details || 'None'}`);
        } else {
          throw new Error(data.error || 'Failed to load users');
        }
        return;
      }

      setUsers(data.users || []);
    } catch (e: any) {
      console.error('[Onboarding] Error:', e);
      setError(e.message || 'Failed to load users');
    }
  };

  const fetchUsers = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/onboarding', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setUsers(data.users || []);
    } catch (e: any) {
      console.error('Error fetching users:', e);
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckboxChange = async (userId: string, isChecked: boolean) => {
    try {
      setUpdating(userId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          profile_id: userId,
          onboarding_completed: isChecked,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update onboarding status');

      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, onboarding_status: data.onboarding_status } : u
        )
      );
    } catch (err: any) {
      console.error('Error updating onboarding:', err);
      setError(err.message || 'Failed to update onboarding status. Please try again.');
      fetchUsers();
    } finally {
      setUpdating(null);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const nav: any = typeof window !== 'undefined' ? window.navigator : null;
    if (nav?.msSaveOrOpenBlob) {
      nav.msSaveOrOpenBlob(blob, filename);
      return;
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  };

  const handleExportToExcel = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/onboarding/export', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to export data');
      }

      const blob = await response.blob();
      const date = new Date().toISOString().split('T')[0];
      downloadBlob(blob, `onboarding_report_${date}.xlsx`);
    } catch (err: any) {
      console.error('Error exporting to Excel:', err);
      alert(`Failed to export data: ${err.message}`);
    }
  };

  const handleDownloadPDF = async (userId: string, userName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/pdf-form-progress/user/${userId}?signatureSource=form_signatures`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download PDF');
      }

      // Get the merged PDF blob
      const blob = await response.blob();

      // Extract filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${userName.replace(/\s+/g, '_')}_Onboarding_Documents.pdf`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Download the merged PDF
      downloadBlob(blob, filename);

      // Update the user's download status in local state
      setUsers(prev =>
        prev.map(u =>
          u.user_id === userId
            ? { ...u, pdf_downloaded: true, pdf_downloaded_at: new Date().toISOString() }
            : u
        )
      );

      alert(`Successfully downloaded onboarding documents for ${userName}`);
    } catch (err: any) {
      console.error('Error downloading PDF:', err);
      alert(`Failed to download PDF: ${err.message}`);
    }
  };

  const filteredUsers = users
    .filter(user => {
      const matchesSearch =
        user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (filterStatus === 'completed') {
        if (!user.onboarding_status?.onboarding_completed) return false;
      } else if (filterStatus === 'pending') {
        if (user.onboarding_status?.onboarding_completed) return false;
      }

      if (filterPassword === 'temporary') {
        if (!user.has_temporary_password) return false;
      } else if (filterPassword === 'permanent') {
        if (user.has_temporary_password) return false;
      }

      if (filterForm === 'no_progress') {
        if (user.latest_form_progress) return false;
      } else if (filterForm !== 'all') {
        if (!user.latest_form_progress || user.latest_form_progress.form_name !== filterForm) return false;
      }

      // Filter to show only users with progress (must have form progress with position > 0)
      if (showOnlyWithProgress) {
        if (!user.latest_form_progress || user.latest_form_progress.position === 0) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Sort by PDF submission status
      const aSubmittedPDF = a.has_submitted_pdf ?? false;
      const bSubmittedPDF = b.has_submitted_pdf ?? false;

      // If one submitted PDF and one didn't, PDF submitted goes first
      if (aSubmittedPDF && !bSubmittedPDF) return -1;
      if (!aSubmittedPDF && bSubmittedPDF) return 1;

      // Both submitted PDF: sort by pdf_submitted_at (newest first)
      if (aSubmittedPDF && bSubmittedPDF) {
        const aDate = a.pdf_submitted_at;
        const bDate = b.pdf_submitted_at;

        if (aDate && bDate) {
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        }
        // If one has date and other doesn't, prioritize the one with date
        if (aDate && !bDate) return -1;
        if (!aDate && bDate) return 1;
        // If neither has date, sort by pdf_latest_update or created_at
        const aTime = a.pdf_latest_update || a.created_at;
        const bTime = b.pdf_latest_update || b.created_at;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      }

      // Both haven't submitted PDF: sort by creation date (newest first)
      if (!aSubmittedPDF && !bSubmittedPDF) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }

      return 0;
    });

  const completedCount = users.filter(u => u.onboarding_status?.onboarding_completed).length;
  const pendingCount = users.length - completedCount;
  const temporaryPasswordCount = users.filter(u => u.has_temporary_password).length;
  const backgroundCompletedCount = users.filter(u => u.background_check_completed).length;
  const pdfSubmittedCount = users.filter(u => u.has_submitted_pdf).length;

  // Get unique form names for the filter dropdown
  const uniqueFormNames = Array.from(
    new Set(
      users
        .filter(u => u.latest_form_progress?.form_name)
        .map(u => u.latest_form_progress!.form_name)
    )
  ).sort();

  // Allow editing only for HR or Exec
  const canEditOnboarding = (myRole?.trim().toLowerCase() === 'hr') || (myRole?.trim().toLowerCase() === 'exec');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading users...</p>
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
            <h1 className="text-3xl font-bold text-gray-900">Onboarding Status</h1>
            <p className="mt-2 text-gray-600">Track and manage onboarding progress for all users</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleExportToExcel}
              className="apple-button apple-button-primary flex items-center gap-2"
              title="Export to Excel"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export to Excel
            </button>
            {(myRole === 'hr' || myRole === 'exec') && (
              <button
                onClick={() => router.push('/hr-dashboard')}
                className="apple-button apple-button-secondary flex items-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Back to Dashboard
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Users</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{users.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Onboarding Completed</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{completedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Onboarding Pending</div>
            <div className="mt-2 text-3xl font-semibold text-orange-600">{pendingCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">PDF Submitted</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">{pdfSubmittedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Temporary Password</div>
            <div className="mt-2 text-3xl font-semibold text-red-600">{temporaryPasswordCount}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <label htmlFor="filterStatus" className="block text-sm font-medium text-gray-700 mb-1">
                Onboarding Status
              </label>
              <select
                id="filterStatus"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'completed' | 'pending')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label htmlFor="filterPassword" className="block text-sm font-medium text-gray-700 mb-1">
                Password Status
              </label>
              <select
                id="filterPassword"
                value={filterPassword}
                onChange={(e) => setFilterPassword(e.target.value as 'all' | 'temporary' | 'permanent')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Passwords</option>
                <option value="temporary">Temporary</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>
            <div>
              <label htmlFor="filterForm" className="block text-sm font-medium text-gray-700 mb-1">
                Form Progress
              </label>
              <select
                id="filterForm"
                value={filterForm}
                onChange={(e) => setFilterForm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Forms</option>
                <option value="no_progress">No Progress</option>
                {uniqueFormNames.map((formName) => (
                  <option key={formName} value={formName}>
                    {formName.replace(/_/g, ' ').replace(/\.pdf$/i, '')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center">
            <input
              type="checkbox"
              id="showOnlyWithProgress"
              checked={showOnlyWithProgress}
              onChange={(e) => setShowOnlyWithProgress(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer"
            />
            <label htmlFor="showOnlyWithProgress" className="ml-2 text-sm text-gray-700 cursor-pointer">
              Show only users with form progress
            </label>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Form Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Onboarding Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF Submitted</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {searchTerm || filterStatus !== 'all'
                        ? 'No users found matching your filters.'
                        : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{user.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="min-w-[180px]">
                          {user.latest_form_progress ? (
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-gray-700">
                                  Step {user.latest_form_progress.position}/{user.total_forms}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {Math.round((user.latest_form_progress.position / user.total_forms) * 100)}%
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${
                                    user.latest_form_progress.position === user.total_forms
                                      ? 'bg-green-500'
                                      : 'bg-indigo-500'
                                  }`}
                                  style={{ width: `${(user.latest_form_progress.position / user.total_forms) * 100}%` }}
                                />
                              </div>
                              <div className="text-xs text-gray-600 mt-1 truncate" title={user.latest_form_progress.display_name}>
                                {user.latest_form_progress.display_name}
                              </div>
                              <div className="text-xs text-gray-400">
                                {new Date(user.latest_form_progress.updated_at).toLocaleDateString()}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-gray-500">
                                  Not started
                                </span>
                                <span className="text-xs text-gray-400">
                                  0%
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div className="h-2 rounded-full bg-gray-300" style={{ width: '0%' }} />
                              </div>
                              <div className="text-xs text-gray-400 mt-1">
                                No forms completed
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.has_temporary_password ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                            Temporary
                          </span>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                            Permanent
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.onboarding_status?.onboarding_completed ? (
                          <div>
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              Completed
                            </span>
                            {user.onboarding_status.completed_date && (
                              <div className="text-xs text-gray-500 mt-1">
                                {new Date(user.onboarding_status.completed_date).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.has_submitted_pdf ? (
                          <div>
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                              Yes
                            </span>
                            {user.pdf_submitted_at && (
                              <div className="text-xs text-gray-500 mt-1">
                                {new Date(user.pdf_submitted_at).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                            No
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-2">
                          {/* SHOW CHECKBOX ONLY FOR HR/EXEC */}
                          {canEditOnboarding && (
                            <input
                              type="checkbox"
                              checked={user.onboarding_status?.onboarding_completed || false}
                              onChange={(e) => handleCheckboxChange(user.id, e.target.checked)}
                              disabled={updating === user.id}
                              className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              title={user.onboarding_status?.onboarding_completed
                                ? 'Onboarding completed'
                                : 'Mark onboarding as completed'}
                            />
                          )}

                          {/* Show download button if user has submitted PDF */}
                          {user.has_submitted_pdf && (
                            <button
                              onClick={() => handleDownloadPDF(user.user_id, user.full_name)}
                              className={`px-2 py-1 text-xs font-medium rounded border ${
                                user.pdf_downloaded
                                  ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-50 border-purple-300 bg-purple-50'
                                  : 'text-green-600 hover:text-green-800 hover:bg-green-50 border-green-300'
                              }`}
                              title={user.pdf_downloaded ? 'Downloaded - Click to download again' : 'Download onboarding documents'}
                            >
                              {user.pdf_downloaded ? 'Downloaded ✓' : 'Download Docs'}
                            </button>
                          )}
                        </div>
                        {updating === user.id && (
                          <div className="mt-1 text-xs text-gray-500">Updating...</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
