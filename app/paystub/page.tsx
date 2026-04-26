'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

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
  reimbursement_amount: number;
  total_pay: number;
  final_pay: number;
  base_rate: number;
  created_at: string;
}

interface StandaloneReimbursement {
  id: string;
  approved_amount: number;
  approved_pay_date: string;
  description: string;
  purchase_date: string;
  created_at: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const normalized = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return value;
}

function formatMoney(amount: number | null | undefined): string {
  return `$${Number(amount || 0).toFixed(2)}`;
}

export default function PaystubPage() {
  const router = useRouter();
  const [paystubs, setPaystubs] = useState<PaystubEntry[]>([]);
  const [standaloneReimbursements, setStandaloneReimbursements] = useState<StandaloneReimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPaystub, setSelectedPaystub] = useState<PaystubEntry | null>(null);
  const [userInfo, setUserInfo] = useState<{ firstName: string; lastName: string; email: string } | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    void loadPayData();
    void loadUserInfo();
  }, []);

  const groupedStandaloneReimbursements = useMemo(() => {
    return standaloneReimbursements.reduce<Record<string, StandaloneReimbursement[]>>((groups, reimbursement) => {
      const key = reimbursement.approved_pay_date || 'No pay date';
      if (!groups[key]) groups[key] = [];
      groups[key].push(reimbursement);
      return groups;
    }, {});
  }, [standaloneReimbursements]);

  const totalStandaloneReimbursements = useMemo(
    () => standaloneReimbursements.reduce((sum, reimbursement) => sum + Number(reimbursement.approved_amount || 0), 0),
    [standaloneReimbursements]
  );

  const totalEarnings = useMemo(
    () => paystubs.reduce((sum, paystub) => sum + Number(paystub.final_pay || 0), 0) + totalStandaloneReimbursements,
    [paystubs, totalStandaloneReimbursements]
  );

  const totalHours = useMemo(
    () =>
      paystubs.reduce(
        (sum, paystub) =>
          sum +
          Number(paystub.regular_hours || 0) +
          Number(paystub.overtime_hours || 0) +
          Number(paystub.doubletime_hours || 0),
        0
      ),
    [paystubs]
  );

  async function loadUserInfo() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
  }

  async function loadPayData(nextStartDate = startDate, nextEndDate = endDate) {
    setLoading(true);
    setError('');
    setSelectedPaystub(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        router.push('/login');
        return;
      }

      const params = new URLSearchParams();
      if (nextStartDate) params.append('start_date', nextStartDate);
      if (nextEndDate) params.append('end_date', nextEndDate);

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
      setPaystubs(Array.isArray(data.paystubs) ? data.paystubs : []);
      setStandaloneReimbursements(
        Array.isArray(data.standalone_reimbursements) ? data.standalone_reimbursements : []
      );
    } catch (err: any) {
      console.error('Error loading pay data:', err);
      setError(err.message || 'Failed to load paystubs');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const hasAnyPayItems = paystubs.length > 0 || standaloneReimbursements.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-7xl py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">My Paystubs</h1>
              {userInfo && (
                <p className="text-lg text-gray-600">
                  {userInfo.firstName} {userInfo.lastName}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/reimbursements">
                <button className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors">
                  Reimbursements
                </button>
              </Link>
              <Link href="/dashboard">
                <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  Back to Dashboard
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
                <p className="text-2xl font-bold text-gray-900">{formatMoney(totalEarnings)}</p>
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
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Standalone Reimbursements</p>
                <p className="text-2xl font-bold text-gray-900">{standaloneReimbursements.length}</p>
              </div>
            </div>
          </div>
        </div>

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
                onClick={() => void loadPayData()}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Apply Filter'}
              </button>
              {(startDate || endDate) && (
                <button
                  onClick={() => {
                    const nextStartDate = '';
                    const nextEndDate = '';
                    setStartDate(nextStartDate);
                    setEndDate(nextEndDate);
                    void loadPayData(nextStartDate, nextEndDate);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading paystubs...</p>
          </div>
        ) : !hasAnyPayItems ? (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center border border-gray-100">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Pay Items Found</h3>
            <p className="text-gray-600">You do not have paystubs or approved reimbursements in this date range.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Event Paystubs</h2>
                  <p className="text-sm text-gray-500">Event-based pay with adjustments and approved event reimbursements.</p>
                </div>
              </div>

              {paystubs.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-lg p-8 text-center border border-gray-100">
                  <p className="text-gray-600">No event paystubs in this date range.</p>
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
                                {formatMoney(paystub.final_pay)}
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
                                {(Number(paystub.regular_hours || 0) + Number(paystub.overtime_hours || 0) + Number(paystub.doubletime_hours || 0)).toFixed(1)} hrs
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

                        {selectedPaystub?.id === paystub.id && (
                          <div className="mt-6 pt-6 border-t border-gray-200">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-3">Hours Breakdown</h4>
                                <div className="space-y-2">
                                  {paystub.regular_hours > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Regular Hours ({paystub.regular_hours.toFixed(2)} hrs)</span>
                                      <span className="font-medium text-gray-900">{formatMoney(paystub.regular_pay)}</span>
                                    </div>
                                  )}
                                  {paystub.overtime_hours > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Overtime (1.5x) ({paystub.overtime_hours.toFixed(2)} hrs)</span>
                                      <span className="font-medium text-gray-900">{formatMoney(paystub.overtime_pay)}</span>
                                    </div>
                                  )}
                                  {paystub.doubletime_hours > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Doubletime (2x) ({paystub.doubletime_hours.toFixed(2)} hrs)</span>
                                      <span className="font-medium text-gray-900">{formatMoney(paystub.doubletime_pay)}</span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-3">Additional Earnings</h4>
                                <div className="space-y-2">
                                  {paystub.commissions > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Commissions</span>
                                      <span className="font-medium text-purple-600">{formatMoney(paystub.commissions)}</span>
                                    </div>
                                  )}
                                  {paystub.tips > 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Tips</span>
                                      <span className="font-medium text-orange-600">{formatMoney(paystub.tips)}</span>
                                    </div>
                                  )}
                                  {paystub.adjustment_amount !== 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Adjustments</span>
                                      <span className={`font-medium ${paystub.adjustment_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {paystub.adjustment_amount >= 0 ? '+' : ''}{formatMoney(paystub.adjustment_amount)}
                                      </span>
                                    </div>
                                  )}
                                  {paystub.reimbursement_amount !== 0 && (
                                    <div className="flex justify-between text-sm">
                                      <span className="text-gray-600">Reimbursements</span>
                                      <span className="font-medium text-emerald-600">
                                        +{formatMoney(paystub.reimbursement_amount)}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-gray-200">
                              <div className="flex justify-between items-center">
                                <div>
                                  <p className="text-sm text-gray-600">Base Rate</p>
                                  <p className="text-lg font-semibold text-gray-900">{formatMoney(paystub.base_rate)}/hr</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm text-gray-600 mb-1">Total Payment</p>
                                  <p className="text-3xl font-bold text-green-600">{formatMoney(paystub.final_pay)}</p>
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
            </section>

            <section>
              <div className="mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Standalone Reimbursements</h2>
                <p className="text-sm text-gray-500">Approved reimbursements that payroll assigned directly to a pay date.</p>
              </div>

              {standaloneReimbursements.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-lg p-8 text-center border border-gray-100">
                  <p className="text-gray-600">No standalone reimbursements in this date range.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedStandaloneReimbursements).map(([payDate, entries]) => (
                    <div key={payDate} className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                      <div className="border-b border-gray-100 bg-emerald-50 px-6 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Pay Date</p>
                            <h3 className="text-xl font-bold text-gray-900 mt-1">{formatDate(payDate)}</h3>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-gray-500">Group Total</p>
                            <p className="text-2xl font-bold text-emerald-700">
                              {formatMoney(entries.reduce((sum, entry) => sum + Number(entry.approved_amount || 0), 0))}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {entries.map((entry) => (
                          <div key={entry.id} className="px-6 py-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-base font-semibold text-gray-900">{formatMoney(entry.approved_amount)}</p>
                                <p className="mt-1 text-sm text-gray-600">{entry.description}</p>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                                  <span>Purchase: {formatDate(entry.purchase_date)}</span>
                                  <span>Approved Pay Date: {formatDate(entry.approved_pay_date)}</span>
                                </div>
                              </div>
                              <div className="text-sm text-gray-500">
                                Recorded {new Date(entry.created_at).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
