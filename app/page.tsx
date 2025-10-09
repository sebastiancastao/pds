'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuthAndMFA();
  }, []);

  const checkAuthAndMFA = async () => {
    console.log('[DEBUG] Home - Checking authentication and MFA status...');
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('[DEBUG] Home - No user found, showing public home page');
      setIsLoading(false);
      return;
    }

    console.log('[DEBUG] Home - User authenticated:', user.id);
    setUser(user);

    // Check if user has temporary password
    const { data: userData } = await (supabase
      .from('users')
      .select('is_temporary_password, must_change_password')
      .eq('id', user.id)
      .single() as any);

    if (userData?.is_temporary_password || userData?.must_change_password) {
      console.log('[DEBUG] Home - Temporary password detected, redirecting to /password');
      router.push('/password');
      return;
    }

    // Check if user has completed MFA verification for this session
    const mfaVerified = sessionStorage.getItem('mfa_verified');
    console.log('[DEBUG] Home - MFA verified in session:', mfaVerified);

    if (!mfaVerified) {
      console.log('[DEBUG] Home - MFA not verified for this session, redirecting to /verify-mfa');
      // Set checkpoint flag so user cannot navigate away from verify-mfa
      sessionStorage.setItem('mfa_checkpoint', 'true');
      router.push('/verify-mfa');
      return;
    }

    console.log('[DEBUG] Home - All checks passed, showing authenticated home page');
    setIsLoading(false);
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('mfa_verified');
    sessionStorage.removeItem('mfa_checkpoint');
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    // Show public home page for non-authenticated users
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              PDS Time Tracking System
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Secure, compliant employee time tracking and worker availability management
            </p>
          </div>

          {/* Login Button */}
          <div className="text-center mb-8">
            <Link href="/login" className="btn-primary inline-flex items-center gap-2 text-lg px-8 py-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Secure Login
            </Link>
          </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {/* PDS Vendor Division */}
          <div className="card hover:shadow-lg transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              PDS Vendor
            </h2>
            <p className="text-gray-600 mb-4">
              Primary staffing and event services division
            </p>
            <Link href="/vendor" className="btn-primary inline-block">
              Access Portal
            </Link>
          </div>

          {/* CWT Trailers Division */}
          <div className="card hover:shadow-lg transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              CWT Trailers
            </h2>
            <p className="text-gray-600 mb-4">
              Trailer rental division time tracking
            </p>
            <Link href="/trailers" className="btn-primary inline-block">
              Access Portal
            </Link>
          </div>
        </div>

        {/* System Modules */}
        <div className="card bg-white">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            System Features
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-semibold">1</span>
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold text-gray-900">Onboarding & Time Tracking</h3>
                  <p className="text-sm text-gray-600">Secure employee onboarding with QR/PIN clock in/out</p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-semibold">2</span>
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold text-gray-900">Event Staffing</h3>
                  <p className="text-sm text-gray-600">Create events and manage staff assignments</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-semibold">3</span>
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold text-gray-900">Global Calendar</h3>
                  <p className="text-sm text-gray-600">Real-time scheduling visibility across all venues</p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-primary-600 font-semibold">4</span>
                  </div>
                </div>
                <div className="ml-4">
                  <h3 className="font-semibold text-gray-900">Payroll Closeout</h3>
                  <p className="text-sm text-gray-600">Automated payroll calculations with ADP integration</p>
                </div>
              </div>
            </div>
          </div>
        </div>

          {/* Security Badge */}
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-2">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm font-medium text-green-800">SOC2 Compliant • FLSA Certified • PII Encrypted</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated home page
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Welcome to PDS
          </h1>
          <p className="text-xl text-gray-600 mb-4">
            You are logged in as: <strong>{user.email}</strong>
          </p>
          <button
            onClick={handleLogout}
            className="text-red-600 hover:text-red-700 font-medium"
          >
            Logout
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {/* PDS Vendor Division */}
          <div className="card hover:shadow-lg transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              PDS Vendor
            </h2>
            <p className="text-gray-600 mb-4">
              Primary staffing and event services division
            </p>
            <Link href="/vendor" className="btn-primary inline-block">
              Access Portal
            </Link>
          </div>

          {/* CWT Trailers Division */}
          <div className="card hover:shadow-lg transition-shadow">
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">
              CWT Trailers
            </h2>
            <p className="text-gray-600 mb-4">
              Trailer rental division time tracking
            </p>
            <Link href="/trailers" className="btn-primary inline-block">
              Access Portal
            </Link>
          </div>
        </div>

        <div className="card bg-white">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            Quick Actions
          </h2>
          <div className="space-y-3">
            <Link href="/register" className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <h3 className="font-semibold text-gray-900">Complete Profile</h3>
              <p className="text-sm text-gray-600">Update your personal information</p>
            </Link>
            <Link href="/mfa-setup" className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
              <h3 className="font-semibold text-gray-900">Security Settings</h3>
              <p className="text-sm text-gray-600">Manage MFA and security options</p>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
