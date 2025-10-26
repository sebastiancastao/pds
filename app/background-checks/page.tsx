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
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  is_temporary_password: boolean;
  must_change_password: boolean;
  has_temporary_password: boolean;
  background_check: BackgroundCheck | null;
}

export default function BackgroundChecksPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [filterPassword, setFilterPassword] = useState<'all' | 'temporary' | 'permanent'>('all');
  const router = useRouter();

  useEffect(() => {
    loadVendors();
  }, []);

  const loadVendors = async () => {
    setError(null);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      console.log('[Background Checks] Session check:', { hasSession: !!session, hasToken: !!session?.access_token });

      const res = await fetch('/api/background-checks', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      console.log('[Background Checks] API response:', res.status);

      const data = await res.json();

      if (!res.ok) {
        console.error('[Background Checks] API Error:', {
          status: res.status,
          data: data
        });

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
      console.log('[Background Checks] Successfully loaded', data.vendors?.length || 0, 'vendors');
    } catch (e: any) {
      console.error('[Background Checks] Error:', e);
      setError(e.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
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

      if (!res.ok) {
        throw new Error(data.error || 'Failed to load vendors');
      }

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

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update background check status');
      }

      // Update the vendors list with the new background check data
      setVendors(prevVendors =>
        prevVendors.map(vendor =>
          vendor.id === vendorId
            ? { ...vendor, background_check: data.background_check }
            : vendor
        )
      );
    } catch (err: any) {
      console.error('Error updating background check:', err);
      setError(err.message || 'Failed to update background check status. Please try again.');
      // Revert the checkbox by refetching
      fetchVendors();
    } finally {
      setUpdating(null);
    }
  };

  const filteredVendors = vendors.filter(vendor => {
    const matchesSearch = vendor.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vendor.email.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    // Filter by background check status
    if (filterStatus === 'completed') {
      if (!vendor.background_check?.background_check_completed) return false;
    } else if (filterStatus === 'pending') {
      if (vendor.background_check?.background_check_completed) return false;
    }

    // Filter by password status
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
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Vendor Background Checks</h1>
          <p className="mt-2 text-gray-600">Track and manage background check status for all vendors</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm font-medium text-gray-500">Total Vendors</div>
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
            <div className="text-sm font-medium text-gray-500">Temporary Password</div>
            <div className="mt-2 text-3xl font-semibold text-red-600">{temporaryPasswordCount}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                Search Vendors
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
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phone
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Password Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Background Check
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Completed Date
                  </th>
                  <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Background Check
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredVendors.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      {searchTerm || filterStatus !== 'all'
                        ? 'No vendors found matching your filters.'
                        : 'No vendors found.'}
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
                      <td className="px-6 py-4 whitespace-nowrap text-center">
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
          Showing {filteredVendors.length} of {vendors.length} vendors
        </div>
      </div>
    </div>
  );
}
