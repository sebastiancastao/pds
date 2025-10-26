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
      <main className="min-h-screen flex items-center justify-center">
        <div className="liquid-card-compact p-8 animate-scale-in">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-transparent border-t-ios-blue mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium text-center tracking-apple">Loading...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    // Show public home page for non-authenticated users
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-5xl mx-auto w-full">
          {/* Hero Section */}
          <div className="text-center mb-16 animate-fade-in">
            <div className="inline-block mb-6">
              <div className="liquid-badge-blue text-base px-5 py-2">
                <svg className="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Powered by Modern Technology
              </div>
            </div>
            <h1 className="text-6xl md:text-7xl font-bold text-gray-900 mb-6 tracking-apple-tight">
              PDS Time Tracking
            </h1>
            <p className="text-xl md:text-2xl text-gray-600 mb-10 tracking-apple max-w-3xl mx-auto leading-relaxed">
              Secure, compliant employee time tracking and worker availability management
            </p>

            {/* Login Button */}
            <Link href="/login" className="liquid-btn-primary liquid-btn-lg inline-flex items-center gap-3 liquid-glow-blue">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Secure Login
            </Link>
          </div>

          {/* Division Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-12 animate-slide-up">
            {/* PDS Vendor Division */}
            <Link href="/vendor" className="liquid-card-blue p-8 group cursor-pointer">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-14 h-14 rounded-liquid bg-gradient-to-br from-ios-blue to-ios-indigo flex items-center justify-center shadow-liquid-glow">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2 tracking-apple">
                    PDS Vendor
                  </h2>
                  <p className="text-gray-600 mb-4 leading-relaxed">
                    Primary staffing and event services division
                  </p>
                  <div className="flex items-center text-ios-blue font-semibold text-sm group-hover:gap-2 gap-1 transition-all">
                    Access Portal
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>

            {/* CWT Trailers Division */}
            <Link href="/trailers" className="liquid-card-purple p-8 group cursor-pointer">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-14 h-14 rounded-liquid bg-gradient-to-br from-ios-purple to-ios-pink flex items-center justify-center shadow-liquid-glow-purple">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2 tracking-apple">
                    CWT Trailers
                  </h2>
                  <p className="text-gray-600 mb-4 leading-relaxed">
                    Trailer rental division time tracking
                  </p>
                  <div className="flex items-center text-ios-purple font-semibold text-sm group-hover:gap-2 gap-1 transition-all">
                    Access Portal
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          </div>

          {/* System Features */}
          <div className="liquid-card-spacious mb-12 animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <h2 className="text-3xl font-bold text-gray-900 mb-8 tracking-apple text-center">
              System Features
            </h2>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-liquid bg-gradient-to-br from-liquid-blue-400 to-liquid-blue-600 flex items-center justify-center shadow-liquid">
                      <span className="text-white font-bold text-lg">1</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-1 tracking-apple">Onboarding & Time Tracking</h3>
                    <p className="text-gray-600 leading-relaxed">Secure employee onboarding with QR/PIN clock in/out</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-liquid bg-gradient-to-br from-liquid-purple-400 to-liquid-purple-600 flex items-center justify-center shadow-liquid">
                      <span className="text-white font-bold text-lg">2</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-1 tracking-apple">Event Staffing</h3>
                    <p className="text-gray-600 leading-relaxed">Create events and manage staff assignments</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-liquid bg-gradient-to-br from-ios-teal to-ios-blue flex items-center justify-center shadow-liquid">
                      <span className="text-white font-bold text-lg">3</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-1 tracking-apple">Global Calendar</h3>
                    <p className="text-gray-600 leading-relaxed">Real-time scheduling visibility across all venues</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-liquid bg-gradient-to-br from-ios-orange to-ios-yellow flex items-center justify-center shadow-liquid">
                      <span className="text-white font-bold text-lg">4</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg mb-1 tracking-apple">Payroll Closeout</h3>
                    <p className="text-gray-600 leading-relaxed">Automated payroll calculations with ADP integration</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Security Badge */}
          <div className="text-center animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="liquid-badge-green text-base px-6 py-3 inline-flex items-center gap-3">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="font-semibold">SOC2 Compliant • FLSA Certified • PII Encrypted</span>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated home page
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-5xl mx-auto w-full">
        {/* Welcome Header */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="liquid-badge-blue text-sm px-4 py-2 mb-6 inline-block">
            <svg className="w-3 h-3 inline mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            Authenticated Session
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-4 tracking-apple-tight">
            Welcome Back
          </h1>
          <p className="text-lg text-gray-600 mb-6 tracking-apple">
            Logged in as <strong className="text-gray-900">{user.email}</strong>
          </p>
          <button
            onClick={handleLogout}
            className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid md:grid-cols-2 gap-6 animate-slide-up">
          {/* Events Dashboard */}
          <Link href="/dashboard" className="liquid-card-blue p-6 group cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-14 h-14 rounded-liquid bg-gradient-to-br from-ios-blue to-ios-indigo flex items-center justify-center shadow-liquid-glow">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2 tracking-apple">Events Dashboard</h3>
                <p className="text-gray-600 mb-3 leading-relaxed">Manage events, invitations, and teams</p>
                <div className="flex items-center text-ios-blue font-semibold text-sm group-hover:gap-2 gap-1 transition-all">
                  Open Dashboard
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </Link>

          {/* Admin Panel */}
          <Link href="/admin" className="liquid-card-purple p-6 group cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-14 h-14 rounded-liquid bg-gradient-to-br from-ios-purple to-ios-pink flex items-center justify-center shadow-liquid-glow-purple">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900 mb-2 tracking-apple">Admin Panel</h3>
                <p className="text-gray-600 mb-3 leading-relaxed">Background checks, user creation, and system management</p>
                <div className="flex items-center text-ios-purple font-semibold text-sm group-hover:gap-2 gap-1 transition-all">
                  Open Admin
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </Link>

          {/* Complete Profile */}
          <Link href="/register" className="liquid-card-default group cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-liquid bg-gradient-to-br from-ios-teal to-ios-blue flex items-center justify-center shadow-liquid">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 mb-1 tracking-apple">Complete Profile</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Update your personal information</p>
              </div>
              <svg className="w-5 h-5 text-gray-400 group-hover:text-gray-600 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>

          {/* Security Settings */}
          <Link href="/mfa-setup" className="liquid-card-default group cursor-pointer">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-liquid bg-gradient-to-br from-ios-orange to-ios-yellow flex items-center justify-center shadow-liquid">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-gray-900 mb-1 tracking-apple">Security Settings</h3>
                <p className="text-gray-600 text-sm leading-relaxed">Manage MFA and security options</p>
              </div>
              <svg className="w-5 h-5 text-gray-400 group-hover:text-gray-600 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
