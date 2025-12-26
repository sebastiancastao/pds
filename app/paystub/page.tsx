'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

interface PaystubEntry {
  id: string;
  event_id: string;
  event_name: string;
  event_date: string;
  venue: string;
  regular_hours: number;
  regular_pay: number;
  overtime_hours: number;
  overtime_pay: number;
  doubletime_hours: number;
  doubletime_pay: number;
  commissions: number;
  tips: number;
  adjustment_amount: number;
  total_pay: number;
  final_pay: number;
  base_rate: number;
  created_at: string;
}

export default function PaystubPage() {
  const router = useRouter();
  const [paystubs, setPaystubs] = useState<PaystubEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPaystub, setSelectedPaystub] = useState<PaystubEntry | null>(null);
  const [userInfo, setUserInfo] = useState<{ firstName: string; lastName: string; email: string } | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    loadPaystubs();
    loadUserInfo();
  }, []);

  const loadUserInfo = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .single();

      if (profileData) {
        setUserInfo({
          firstName: (profileData as any).first_name || '',
          lastName: (profileData as any).last_name || '',
          email: session.user.email || '',
        });
      }
    } catch (err) {
      console.error('Error loading user info:', err);
    }
  };

  const loadPaystubs = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }

      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);

      const response = await fetch(`/api/my-paystubs${params.toString() ? `?${params.toString()}` : ''}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load paystubs');
      }

      const data = await response.json();
      setPaystubs(data.paystubs || []);
    } catch (err: any) {
      console.error('Error loading paystubs:', err);
      setError(err.message || 'Failed to load paystubs');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const totalEarnings = paystubs.reduce((sum, p) => sum + (p.final_pay || 0), 0);
  const totalHours = paystubs.reduce((sum, p) => sum + (p.regular_hours || 0) + (p.overtime_hours || 0) + (p.doubletime_hours || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-7xl py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">My Paystubs</h1>
              {userInfo && (
                <p className="text-lg text-gray-600">
                  {userInfo.firstName} {userInfo.lastName}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Link href="/dashboard">
                <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  ← Back to Dashboard
                </button>
              </Link>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Earnings</p>
                <p className="text-2xl font-bold text-gray-900">${totalEarnings.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Hours</p>
                <p className="text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Paystubs</p>
                <p className="text-2xl font-bold text-gray-900">{paystubs.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8 border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filter by Date</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={loadPaystubs}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Apply Filter'}
              </button>
              {(startDate || endDate) && (
                <button
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setTimeout(loadPaystubs, 0);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Paystubs List */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading paystubs...</p>
          </div>
        ) : paystubs.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center border border-gray-100">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Paystubs Found</h3>
            <p className="text-gray-600">You don't have any paystubs yet. Check back after working an event.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {paystubs.map((paystub) => (
              <div
                key={paystub.id}
                className="bg-white rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition-shadow cursor-pointer"
                onClick={() => setSelectedPaystub(selectedPaystub?.id === paystub.id ? null : paystub)}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-xl font-bold text-gray-900">{paystub.event_name}</h3>
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          ${paystub.final_pay.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          {new Date(paystub.event_date).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {paystub.venue}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {((paystub.regular_hours || 0) + (paystub.overtime_hours || 0) + (paystub.doubletime_hours || 0)).toFixed(1)} hrs
                        </span>
                      </div>
                    </div>
                    <svg
                      className={`w-6 h-6 text-gray-400 transition-transform ${selectedPaystub?.id === paystub.id ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Expanded Details */}
                  {selectedPaystub?.id === paystub.id && (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Hours Breakdown */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Hours Breakdown</h4>
                          <div className="space-y-2">
                            {paystub.regular_hours > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Regular Hours ({paystub.regular_hours.toFixed(2)} hrs)</span>
                                <span className="font-medium text-gray-900">${paystub.regular_pay.toFixed(2)}</span>
                              </div>
                            )}
                            {paystub.overtime_hours > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Overtime (1.5x) ({paystub.overtime_hours.toFixed(2)} hrs)</span>
                                <span className="font-medium text-gray-900">${paystub.overtime_pay.toFixed(2)}</span>
                              </div>
                            )}
                            {paystub.doubletime_hours > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Doubletime (2x) ({paystub.doubletime_hours.toFixed(2)} hrs)</span>
                                <span className="font-medium text-gray-900">${paystub.doubletime_pay.toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Additional Earnings */}
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-3">Additional Earnings</h4>
                          <div className="space-y-2">
                            {paystub.commissions > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Commissions</span>
                                <span className="font-medium text-purple-600">${paystub.commissions.toFixed(2)}</span>
                              </div>
                            )}
                            {paystub.tips > 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Tips</span>
                                <span className="font-medium text-orange-600">${paystub.tips.toFixed(2)}</span>
                              </div>
                            )}
                            {paystub.adjustment_amount !== 0 && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Adjustments</span>
                                <span className={`font-medium ${paystub.adjustment_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                  {paystub.adjustment_amount >= 0 ? '+' : ''}${paystub.adjustment_amount.toFixed(2)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Total */}
                      <div className="mt-6 pt-4 border-t border-gray-200">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm text-gray-600">Base Rate</p>
                            <p className="text-lg font-semibold text-gray-900">${paystub.base_rate.toFixed(2)}/hr</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-600 mb-1">Total Payment</p>
                            <p className="text-3xl font-bold text-green-600">${paystub.final_pay.toFixed(2)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
