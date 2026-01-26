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
      console.log('[DEBUG] Home - No user found, redirecting to login');
      router.push('/login');
      return;
    }

    console.log('[DEBUG] Home - User authenticated:', user.id);
    setUser(user);

    // Check if user has temporary password and get role
    const { data: userData } = await (supabase
      .from('users')
      .select('is_temporary_password, must_change_password, role')
      .eq('id', user.id)
      .single() as any);

    if (userData?.is_temporary_password || userData?.must_change_password) {
      const role = (userData?.role || '').toString().trim().toLowerCase();
      if (role === 'backgroundchecker') {
        console.log('[DEBUG] Home - Background Checker temp password, redirecting to /mfa-setup');
        router.push('/mfa-setup');
      } else {
        console.log('[DEBUG] Home - Temporary password detected, redirecting to /password');
        router.push('/password');
      }
      return;
    }

    // Background checker: if MFA not yet set up, force TOTP setup flow first
    try {
      const { data: profArr } = await (supabase
        .from('profiles')
        .select('mfa_enabled, mfa_secret')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1) as any);
      const profile = profArr?.[0] || null;
      const userRole = userData?.role;
      if (userRole === 'backgroundchecker' && (!profile?.mfa_secret || profile?.mfa_enabled !== true)) {
        console.log('[DEBUG] Home - Background Checker without MFA setup, redirecting to /mfa-setup');
        router.push('/mfa-setup');
        return;
      }
    } catch (e) {
      console.warn('[DEBUG] Home - MFA setup check failed, continuing to MFA verify check');
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

    // Role-based routing
    const userRole = userData?.role;
    console.log('[DEBUG] Home - User role:', userRole);

    if (userRole === 'manager') {
      console.log('[DEBUG] Home - Manager role detected, redirecting to /dashboard');
      router.push('/dashboard');
      return;
    }

    if (userRole === 'exec') {
      console.log('[DEBUG] Home - Exec role detected, redirecting to /global-calendar');
      router.push('/global-calendar');
      return;
    }

    if (userRole === 'hr') {
      console.log('[DEBUG] Home - HR role detected, redirecting to /hr-dashboard');
      router.push('/hr-dashboard');
      return;
    }

    if (userRole === 'worker') {
      console.log('[DEBUG] Home - Worker role detected, redirecting to /time-keeping');
      router.push('/time-keeping');
      return;
    }
    if (userRole === 'backgroundchecker') {
      console.log('[DEBUG] Home - Background Checker role detected, redirecting to /background-checks');
      router.push('/background-checks');
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
          <p className="text-gray-700 font-medium text-center keeping-apple">Loading...</p>
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
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-4 keeping-apple-tight">
            Welcome Back
          </h1>
          <p className="text-lg text-gray-600 mb-6 keeping-apple">
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
                <h3 className="text-xl font-bold text-gray-900 mb-2 keeping-apple">Events Dashboard</h3>
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
                <h3 className="text-xl font-bold text-gray-900 mb-2 keeping-apple">Admin Panel</h3>
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
                <h3 className="text-lg font-bold text-gray-900 mb-1 keeping-apple">Complete Profile</h3>
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
                <h3 className="text-lg font-bold text-gray-900 mb-1 keeping-apple">Security Settings</h3>
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
