'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface StateRate {
  id?: number;
  state_code: string;
  state_name: string;
  base_rate: number;
  overtime_enabled: boolean;
  overtime_rate: number;
  doubletime_enabled: boolean;
  doubletime_rate: number;
  tax_rate: number;
  effective_date: string;
  updated_at?: string;
}

const DEFAULT_RATES: StateRate[] = [
  {
    state_code: 'CA',
    state_name: 'California',
    base_rate: 17.28,
    overtime_enabled: true,
    overtime_rate: 1.5,
    doubletime_enabled: true,
    doubletime_rate: 2.0,
    tax_rate: 0,
    effective_date: new Date().toISOString().split('T')[0],
  },
  {
    state_code: 'NY',
    state_name: 'New York',
    base_rate: 17.00,
    overtime_enabled: true,
    overtime_rate: 1.5,
    doubletime_enabled: false,
    doubletime_rate: 0,
    tax_rate: 0,
    effective_date: new Date().toISOString().split('T')[0],
  },
  {
    state_code: 'AZ',
    state_name: 'Arizona',
    base_rate: 14.70,
    overtime_enabled: true,
    overtime_rate: 1.5,
    doubletime_enabled: false,
    doubletime_rate: 0,
    tax_rate: 0,
    effective_date: new Date().toISOString().split('T')[0],
  },
  {
    state_code: 'WI',
    state_name: 'Wisconsin',
    base_rate: 15.00,
    overtime_enabled: true,
    overtime_rate: 1.5,
    doubletime_enabled: false,
    doubletime_rate: 0,
    tax_rate: 0,
    effective_date: new Date().toISOString().split('T')[0],
  },
];

export default function RatesPage() {
  const router = useRouter();
  const [rates, setRates] = useState<StateRate[]>(DEFAULT_RATES);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('[RATES] Session error:', sessionError);
          router.replace('/login');
          return;
        }

        if (!session) {
          console.error('[RATES] No session found');
          router.replace('/login');
          return;
        }

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single();

        if (userError || !userData) {
          console.error('[RATES] User error:', userError);
          router.replace('/login');
          return;
        }

        if (userData.role !== 'exec') {
          console.error('[RATES] Access denied - user role:', userData.role);
          alert('Access Denied: Only executives can access the rates management page.');
          router.replace('/dashboard');
          return;
        }

        console.log('[RATES] Auth successful, role:', userData.role);
        setUserRole(userData.role);
        setIsAuthorized(true);

        // Load rates after successful auth
        await loadRates();
      } catch (err) {
        console.error('[RATES] Auth error:', err);
        router.replace('/login');
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  const loadRates = async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      console.log('[RATES] Loading rates with session:', !!session);

      if (!session) {
        console.error('[RATES] No session found');
        setMessage('Error: No active session. Please log in again.');
        return;
      }

      const res = await fetch('/api/rates', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      console.log('[RATES] API response status:', res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('[RATES] Loaded rates:', data.rates?.length || 0);
        if (data.rates && data.rates.length > 0) {
          setRates(data.rates);
        }
      } else {
        const errorData = await res.json();
        console.error('[RATES] API error:', errorData);
        setMessage(`Error: ${errorData.error || 'Failed to load rates'}`);
      }
    } catch (error: any) {
      console.error('[RATES] Error loading rates:', error);
      setMessage(`Error: ${error.message || 'Failed to load rates'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/rates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ rates }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage('Rates saved successfully!');
        setTimeout(() => setMessage(''), 3000);
        loadRates();
      } else {
        setMessage(`Error: ${data.error || 'Failed to save rates'}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateRate = (index: number, field: keyof StateRate, value: any) => {
    const newRates = [...rates];
    newRates[index] = { ...newRates[index], [field]: value };
    setRates(newRates);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Checking authorization...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Loading rates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => router.back()}
              className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">State Rates Management</h1>
          <p className="text-gray-600">
            Configure base rates, overtime, doubletime, and tax rates for each state
          </p>
          <div className="mt-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Executive Access Only
            </span>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.includes('Error')
              ? 'bg-red-50 border border-red-200 text-red-800'
              : 'bg-green-50 border border-green-200 text-green-800'
          }`}>
            {message}
          </div>
        )}

        {/* Rates Table */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    State
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Base Rate ($/hr)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Overtime
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Doubletime
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Tax Rate (%)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Effective Date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {rates.map((rate, index) => (
                  <tr key={rate.state_code} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-bold text-sm">{rate.state_code}</span>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{rate.state_name}</div>
                          <div className="text-xs text-gray-500">{rate.state_code}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="number"
                        step="0.01"
                        value={rate.base_rate}
                        onChange={(e) => updateRate(index, 'base_rate', parseFloat(e.target.value))}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rate.overtime_enabled}
                          onChange={(e) => updateRate(index, 'overtime_enabled', e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        {rate.overtime_enabled && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              value={rate.overtime_rate}
                              onChange={(e) => updateRate(index, 'overtime_rate', parseFloat(e.target.value))}
                              className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-sm text-gray-600">x</span>
                            <span className="text-xs text-gray-500">
                              (${(rate.base_rate * rate.overtime_rate).toFixed(2)}/hr)
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rate.doubletime_enabled}
                          onChange={(e) => updateRate(index, 'doubletime_enabled', e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        {rate.doubletime_enabled && (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              value={rate.doubletime_rate}
                              onChange={(e) => updateRate(index, 'doubletime_rate', parseFloat(e.target.value))}
                              className="w-16 px-2 py-1 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-sm text-gray-600">x</span>
                            <span className="text-xs text-gray-500">
                              (${(rate.base_rate * rate.doubletime_rate).toFixed(2)}/hr)
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={rate.tax_rate}
                          onChange={(e) => updateRate(index, 'tax_rate', parseFloat(e.target.value))}
                          className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="0"
                        />
                        <span className="text-sm text-gray-600">%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="date"
                        value={rate.effective_date}
                        onChange={(e) => updateRate(index, 'effective_date', e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Information Boxes */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Overtime Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-blue-600 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-blue-900 mb-2">Overtime Calculation</h3>
                <p className="text-sm text-blue-800 mb-2">
                  Overtime applies to hours worked between 8-12 hours per day.
                </p>
                <p className="text-sm text-blue-800">
                  <strong>Formula:</strong> Base Rate × Overtime Multiplier
                </p>
                <p className="text-xs text-blue-700 mt-2">
                  Example: $17.28 × 1.5 = $25.92/hr
                </p>
              </div>
            </div>
          </div>

          {/* Doubletime Info */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-purple-600 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-purple-900 mb-2">Doubletime Calculation</h3>
                <p className="text-sm text-purple-800 mb-2">
                  Doubletime applies to hours worked beyond 12 hours per day.
                </p>
                <p className="text-sm text-purple-800">
                  <strong>Formula:</strong> Base Rate × Doubletime Multiplier
                </p>
                <p className="text-xs text-purple-700 mt-2">
                  Example: $17.28 × 2.0 = $34.56/hr
                </p>
              </div>
            </div>
          </div>

          {/* Tax Rate Info */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-green-900 mb-2">Tax Rate</h3>
                <p className="text-sm text-green-800 mb-2">
                  Enter tax rate as a percentage (0-100).
                </p>
                <p className="text-sm text-green-800">
                  <strong>Format:</strong> Enter 5 for 5%, not 0.05
                </p>
                <p className="text-xs text-green-700 mt-2">
                  Example: Enter "8.5" for 8.5% tax rate
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-8 flex justify-end gap-4">
          <button
            onClick={() => router.back()}
            className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save Rates
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
