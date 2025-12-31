'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface BackgroundCheck {
  id: string;
  background_check_completed: boolean;
  completed_date: string | null;
  notes: string | null;
  updated_at: string;
}

interface Vendor {
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
  background_check_completed_user_table: boolean;
  background_check: BackgroundCheck | null;
  has_submitted_pdf: boolean;
  pdf_submitted_at: string | null;
  pdf_downloaded: boolean;
  pdf_downloaded_at: string | null;
}

export default function BackgroundChecksPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [filterPassword, setFilterPassword] = useState<'all' | 'temporary' | 'permanent'>('all');

  // NEW: current user's role (from users table)
  const [myRole, setMyRole] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    Promise.all([loadCurrentUserRole(), loadVendors()]).finally(() => setLoading(false));
  }, []);

  const loadCurrentUserRole = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setMyRole(null);
        return;
      }

      // Adjust table/column names if yours differ
      const { data, error } = await (supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single() as any);

      if (error) {
        console.error('[Background Checks] Role fetch error:', error);
        setMyRole(null);
        return;
      }

      const role = (data?.role ?? '').trim().toLowerCase();
      setMyRole(role || null);
    } catch (e) {
      console.error('[Background Checks] Role fetch exception:', e);
      setMyRole(null);
    }
  };

  const loadVendors = async () => {
    setError(null);
    try {
      const { data: { session} } = await supabase.auth.getSession();
      const res = await fetch('/api/background-checks', {
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
          throw new Error(data.error || 'Failed to load vendors');
        }
        return;
      }

      setVendors(data.vendors || []);
    } catch (e: any) {
      console.error('[Background Checks] Error:', e);
      setError(e.message || 'Failed to load vendors');
    }
  };

  const fetchVendors = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/background-checks', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load vendors');
      setVendors(data.vendors || []);
    } catch (e: any) {
      console.error('Error fetching vendors:', e);
      setError(e.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckboxChange = async (vendorId: string, isChecked: boolean) => {
    try {
      setUpdating(vendorId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch('/api/background-checks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          profile_id: vendorId,
          background_check_completed: isChecked,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update background check status');

      setVendors(prev =>
        prev.map(v =>
          v.id === vendorId ? { ...v, background_check: data.background_check } : v
        )
      );
    } catch (err: any) {
      console.error('Error updating background check:', err);
      setError(err.message || 'Failed to update background check status. Please try again.');
      fetchVendors();
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

    // Give the browser a tick to start the download before revoking.
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadPDF = async (userId: string, vendorName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/background-checks/pdf?user_id=${userId}`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download PDF');
      }
      const blob = await response.blob();
      downloadBlob(blob, `background_check_${vendorName.replace(/\s+/g, '_')}.pdf`);

      // Update the vendor's download status in local state
      setVendors(prev =>
        prev.map(v =>
          v.user_id === userId
            ? { ...v, pdf_downloaded: true, pdf_downloaded_at: new Date().toISOString() }
            : v
        )
      );
    } catch (err: any) {
      console.error('Error downloading PDF:', err);
      alert(`Failed to download PDF: ${err.message}`);
    }
  };

  const handleExportToExcel = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/background-checks/export', {
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
      downloadBlob(blob, `background_checks_report_${date}.xlsx`);
    } catch (err: any) {
      console.error('Error exporting to Excel:', err);
      alert(`Failed to export data: ${err.message}`);
    }
  };

  const filteredVendors = vendors
    .filter(vendor => {
      const matchesSearch =
        vendor.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vendor.email.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (filterStatus === 'completed') {
        if (!vendor.background_check?.background_check_completed) return false;
      } else if (filterStatus === 'pending') {
        if (vendor.background_check?.background_check_completed) return false;
      }

      if (filterPassword === 'temporary') {
        if (!vendor.has_temporary_password) return false;
      } else if (filterPassword === 'permanent') {
        if (vendor.has_temporary_password) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const aHasSubmitted = a.has_submitted_pdf && a.background_check_completed_user_table && a.pdf_submitted_at;
      const bHasSubmitted = b.has_submitted_pdf && b.background_check_completed_user_table && b.pdf_submitted_at;

      // Vendors who have submitted come first
      if (aHasSubmitted && !bHasSubmitted) return -1;
      if (!aHasSubmitted && bHasSubmitted) return 1;

      // Among vendors who have submitted, sort by date: newest first
      if (aHasSubmitted && bHasSubmitted) {
        return new Date(b.pdf_submitted_at!).getTime() - new Date(a.pdf_submitted_at!).getTime();
      }

      // For vendors who haven't submitted, maintain original order
      return 0;
    });

  const completedCount = vendors.filter(v => v.background_check?.background_check_completed).length;
  const pendingCount = vendors.length - completedCount;
  const temporaryPasswordCount = vendors.filter(v => v.has_temporary_password).length;
  const pdfSubmittedCount = vendors.filter(v => v.has_submitted_pdf).length;

  // Allow editing only for HR or Exec
  const canEditChecks = (myRole?.trim().toLowerCase() === 'hr') || (myRole?.trim().toLowerCase() === 'exec');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading vendors...</p>
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
            <h1 className="text-3xl font-bold text-gray-900">Background Checks</h1>
            <p className="mt-2 text-gray-600">Track and manage background check status for all users</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Users</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{vendors.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Background Completed</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{completedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Background Pending</div>
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
              <label htmlFor="filterStatus" className="block text-sm font-medium text-gray-700 mb-1">
                Background Check
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
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Vendors Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Background Check</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF Submitted</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {searchTerm || filterStatus !== 'all'
                        ? 'No users found matching your filters.'
                        : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  filteredVendors.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{vendor.full_name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">{vendor.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800 capitalize">
                          {vendor.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {vendor.has_temporary_password ? (
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
                        {vendor.background_check?.background_check_completed ? (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                            Completed
                          </span>
                        ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {vendor.has_submitted_pdf && vendor.background_check_completed_user_table ? (
                          <div>
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                              Yes
                            </span>
                            {vendor.pdf_submitted_at && (
                              <div className="text-xs text-gray-500 mt-1">
                                {new Date(vendor.pdf_submitted_at).toLocaleDateString()}
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
                          {canEditChecks && (
                            <input
                              type="checkbox"
                              checked={vendor.background_check?.background_check_completed || false}
                              onChange={(e) => handleCheckboxChange(vendor.id, e.target.checked)}
                              disabled={updating === vendor.id}
                              className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                              title={vendor.background_check?.background_check_completed
                                ? 'Background check completed'
                                : 'Mark background check as completed'}
                            />
                          )}

                          {/* Keep PDF actions visible for any role, but only when background check is completed in users table */}
                          {vendor.has_submitted_pdf && vendor.background_check_completed_user_table && (
                            <div className="flex gap-1 flex-wrap justify-center">
                              <button
                                onClick={() => handleDownloadPDF(vendor.user_id, vendor.full_name)}
                                className={`px-2 py-1 text-xs font-medium rounded border ${
                                  vendor.pdf_downloaded
                                    ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-50 border-purple-300 bg-purple-50'
                                    : 'text-green-600 hover:text-green-800 hover:bg-green-50 border-green-300'
                                }`}
                                title={vendor.pdf_downloaded ? 'Downloaded - Click to download again' : 'Download Documents'}
                              >
                                {vendor.pdf_downloaded ? 'Downloaded ✓' : 'Download Documents'}
                              </button>
                            </div>
                          )}
                        </div>
                        {updating === vendor.id && (
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
          Showing {filteredVendors.length} of {vendors.length} users
        </div>
      </div>
    </div>
  );
}
