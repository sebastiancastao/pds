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
  background_check: BackgroundCheck | null;
  has_submitted_pdf: boolean;
  pdf_submitted_at: string | null;
}

export default function BackgroundChecksPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [filterPassword, setFilterPassword] = useState<'all' | 'temporary' | 'permanent'>('all');
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState<string>('');

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
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single();

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

  const handleViewPDF = async (userId: string, vendorName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/background-checks/pdf?user_id=${userId}`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to load PDF');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err: any) {
      console.error('Error viewing PDF:', err);
      alert(`Failed to view PDF: ${err.message}`);
    }
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
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `background_check_${vendorName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading PDF:', err);
      alert(`Failed to download PDF: ${err.message}`);
    }
  };

  // Download the saved Waiver PDF directly from DB JSON endpoint
  const handleDownloadWaiver = async (userId: string, vendorName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/background-waiver/save', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      const json = await res.json();
      if (!res.ok || !(json?.data?.waiver_pdf_data || json?.data?.pdf_data)) {
        throw new Error(json?.error || 'Waiver PDF not found');
      }
      // Convert base64 to Blob and download
      const b64 = (json.data.waiver_pdf_data || json.data.pdf_data) as string;
      const byteChars = atob(b64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Background_Check_Waiver_${vendorName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading Waiver:', err);
      alert(`Failed to download Waiver: ${err.message}`);
    }
  };

  // Download Disclosure using rendered PDF endpoint (with signature if present)
  const handleDownloadDisclosure = async (userId: string, vendorName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/background-checks/pdf?user_id=${userId}`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download Disclosure');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Background_Check_Disclosure_${vendorName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error downloading Disclosure:', err);
      alert(`Failed to download Disclosure: ${err.message}`);
    }
  };

  const handleDownloadBoth = async (userId: string, vendorName: string) => {
    // Fire sequentially to avoid popup blockers
    await handleDownloadWaiver(userId, vendorName);
    await handleDownloadDisclosure(userId, vendorName);
  };

  const handleEditNotes = (vendorId: string, currentNotes: string | null) => {
    setEditingNotes(vendorId);
    setNotesValue(currentNotes || '');
  };

  const handleSaveNotes = async (vendorId: string) => {
    try {
      setUpdating(vendorId);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();

      const vendor = vendors.find(v => v.id === vendorId);
      if (!vendor) return;

      const response = await fetch('/api/background-checks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          profile_id: vendorId,
          background_check_completed: vendor.background_check?.background_check_completed || false,
          notes: notesValue.trim() || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update notes');

      setVendors(prev =>
        prev.map(v => (v.id === vendorId ? { ...v, background_check: data.background_check } : v))
      );

      setEditingNotes(null);
      setNotesValue('');
    } catch (err: any) {
      console.error('Error updating notes:', err);
      setError(err.message || 'Failed to update notes. Please try again.');
    } finally {
      setUpdating(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingNotes(null);
    setNotesValue('');
  };

  const filteredVendors = vendors.filter(vendor => {
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Background Check</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Completed Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PDF Submitted</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
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
                        <div className="text-sm text-gray-500">{vendor.phone || 'N/A'}</div>
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
                        <div className="text-sm text-gray-500">
                          {vendor.background_check?.completed_date
                            ? new Date(vendor.background_check.completed_date).toLocaleDateString()
                            : 'N/A'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {vendor.has_submitted_pdf ? (
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
                      <td className="px-6 py-4">
                        {editingNotes === vendor.id ? (
                          <div className="flex items-center gap-2">
                            <textarea
                              value={notesValue}
                              onChange={(e) => setNotesValue(e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              rows={2}
                              placeholder="Add notes..."
                              disabled={updating === vendor.id}
                            />
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleSaveNotes(vendor.id)}
                                disabled={updating === vendor.id}
                                className="px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded disabled:bg-gray-400"
                                title="Save"
                              >
                                ✓
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                disabled={updating === vendor.id}
                                className="px-2 py-1 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded disabled:bg-gray-400"
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => handleEditNotes(vendor.id, vendor.background_check?.notes || null)}
                            className="cursor-pointer hover:bg-gray-50 p-2 rounded min-h-[40px]"
                            title="Click to edit notes"
                          >
                            {vendor.background_check?.notes ? (
                              <div className="text-sm text-gray-700">{vendor.background_check.notes}</div>
                            ) : (
                              <div className="text-sm text-gray-400 italic">Click to add notes...</div>
                            )}
                          </div>
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

                          {/* Keep PDF actions visible for any role */}
                          {vendor.has_submitted_pdf && (
                            <div className="flex gap-1 flex-wrap justify-center">
                              <button
                                onClick={() => handleDownloadPDF(vendor.user_id, vendor.full_name)}
                                className="px-2 py-1 text-xs font-medium text-green-600 hover:text-green-800 hover:bg-green-50 rounded border border-green-300"
                                title="Download Documents"
                              >
                                Download Documents
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
