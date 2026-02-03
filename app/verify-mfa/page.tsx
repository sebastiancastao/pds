'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

function VerifyMFAContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'email' | 'backup'>('totp');
  const [emailOnly, setEmailOnly] = useState(false);

  useEffect(() => {
    checkAuthAndInitialize();
  }, [router]);

  // Countdown timer for resend button
  useEffect(() => {
    if (codeSent && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setCanResend(true);
    }
  }, [countdown, codeSent]);

  const checkAuthAndInitialize = async () => {
    console.log('[DEBUG] Checking authentication status on verify-mfa page...');

    // Check if email-only mode is set (for background checkers)
    const emailOnlyFlag = sessionStorage.getItem('email_mfa_only');
    const isEmailOnly = emailOnlyFlag === 'true';
    if (isEmailOnly) {
      console.log('[DEBUG] Email-only MFA mode detected for background checker');
      setEmailOnly(true);
      setMfaMethod('email');
    }

    // Use getSession() instead of getUser() - more reliable immediately after login
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    console.log('[DEBUG] Session check result:', {
      hasSession: !!session,
      userId: session?.user?.id,
      error: sessionError?.message
    });

    if (!session) {
      console.log('[DEBUG] No session found on first attempt');
      
      // Wait a moment and retry once (session might need time to establish)
      console.log('[DEBUG] Retrying session check in 500ms...');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const { data: { session: retrySession } } = await supabase.auth.getSession();
      console.log('[DEBUG] Retry session check result:', {
        hasSession: !!retrySession,
        userId: retrySession?.user?.id
      });
      
      if (!retrySession) {
        console.log('[DEBUG] No session found after retry, redirecting to login');
        router.push('/login');
        return;
      }

      // CRITICAL: Check if user has temporary password BEFORE allowing MFA verification
      const { data: userData } = await (supabase
        .from('users')
        .select('is_temporary_password, must_change_password, role')
        .eq('id', retrySession.user.id)
        .single() as any);

      // BackgroundChecker with temporary password should go to MFA setup
      if ((userData?.is_temporary_password || userData?.must_change_password) && ((userData?.role || '').toString().trim().toLowerCase() === 'backgroundchecker')) {
        console.log('[DEBUG] Background Checker with temp password (retry flow) → /mfa-setup');
        router.replace('/mfa-setup');
        return;
      }

      if (userData?.is_temporary_password || userData?.must_change_password) {
        console.log('[DEBUG] ❌ User has temporary password - redirecting to /password');
        console.log('[DEBUG] User must change password BEFORE MFA verification');
        router.replace('/password');
        return;
      }
      
      console.log('[DEBUG] ✅ User authenticated (after retry), ready for MFA verification');
      setUserEmail(retrySession.user.email || '');
      
      // Set MFA checkpoint flag - user has reached MFA verification
      sessionStorage.setItem('mfa_checkpoint', 'true');
      
      // Don't automatically send email - user will choose method
      console.log('[DEBUG] ✅ User authenticated, ready for MFA verification');
      return;
    }

    // CRITICAL: Check if user has temporary password BEFORE allowing MFA verification
    const { data: userData } = await (supabase
      .from('users')
      .select('is_temporary_password, must_change_password, role')
      .eq('id', session.user.id)
      .single() as any);

    // BackgroundChecker with temporary password should go to MFA setup
    if ((userData?.is_temporary_password || userData?.must_change_password) && ((userData?.role || '').toString().trim().toLowerCase() === 'backgroundchecker')) {
      console.log('[DEBUG] Background Checker with temp password → /mfa-setup');
      router.replace('/mfa-setup');
      return;
    }

    console.log('[DEBUG] Temporary password check:', {
      is_temporary_password: userData?.is_temporary_password,
      must_change_password: userData?.must_change_password,
    });

    if (userData?.is_temporary_password || userData?.must_change_password) {
      console.log('[DEBUG] ❌ User has temporary password - redirecting to /password');
      console.log('[DEBUG] User must change password BEFORE MFA verification');
      router.replace('/password');
      return;
    }

    // Background Checker: if MFA not yet set up, redirect to /mfa-setup
    try {
      const { data: profArr } = await (supabase
        .from('profiles')
        .select('mfa_enabled, mfa_secret')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(1) as any);
      const profile = profArr?.[0] || null;
      if (userData?.role === 'backgroundchecker' && (!profile?.mfa_secret || profile?.mfa_enabled !== true)) {
        console.log('[VERIFY-MFA DEBUG] Background Checker missing MFA setup - Redirecting to /mfa-setup');
        router.replace('/mfa-setup');
        return;
      }
    } catch (e) {
      console.warn('[VERIFY-MFA DEBUG] MFA setup status check failed');
    }

    // User is authenticated and has no temporary password - ready for MFA
    console.log('[DEBUG] ✅ User authenticated, ready for MFA verification');
    setUserEmail(session.user.email || '');

    // Set MFA checkpoint flag - user has reached MFA verification
    sessionStorage.setItem('mfa_checkpoint', 'true');
    console.log('[DEBUG] MFA checkpoint set - user cannot access other pages until verified');

    // If email-only mode, automatically send email code
    if (isEmailOnly) {
      console.log('[DEBUG] Auto-sending email code for email-only mode');
      await sendVerificationEmail(session);
    }
  };

  const sendVerificationEmail = async (session: any = null) => {
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      // Get session if not provided
      if (!session) {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        session = currentSession;
      }
      
      if (!session) {
        setError('Session expired. Please log in again.');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/auth/mfa/send-login-code', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Failed to send verification email. Please try again.');
        setIsLoading(false);
        return;
      }

      setCodeSent(true);
      setCanResend(false);
      setCountdown(60);
      setSuccess(`Verification code sent to ${userEmail || 'your email'}`);
    } catch (err: any) {
      console.error('Email send error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate code based on method
    if (mfaMethod === 'totp' || mfaMethod === 'email') {
      if (!code || code.length !== 6) {
        setError('Please enter a valid 6-digit code');
        return;
      }
    } else if (mfaMethod === 'backup') {
      if (!code || code.length !== 8) {
        setError('Please enter a valid 8-character backup code');
        return;
      }
    }

    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Session expired. Please log in again.');
        setIsLoading(false);
        return;
      }

      let response;
      
      if (mfaMethod === 'email') {
        // Use email verification endpoint
        response = await fetch('/api/auth/mfa/verify-login-code', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ 
            code: code
          }),
        });
      } else {
        // Use TOTP or backup code verification endpoint
        response = await fetch('/api/auth/mfa/verify-login', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ 
            code: code,
            isBackupCode: mfaMethod === 'backup'
          }),
        });
      }

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Invalid code. Please try again.');
        setIsLoading(false);
        return;
      }

      // Success! Set MFA verification flag in session storage
      console.log('[DEBUG] MFA verified successfully, setting session flag');
      sessionStorage.setItem('mfa_verified', 'true');
      sessionStorage.removeItem('mfa_checkpoint');
      sessionStorage.removeItem('email_mfa_only');

      // Check if user has completed background check and get role (check database column)
      console.log('[VERIFY-MFA DEBUG] Fetching user data for background check status and role...');

      const { data: userData, error: userError } = await (supabase
        .from('users')
        .select('background_check_completed, role')
        .eq('id', session.user.id)
        .single() as any);

      if (userError) {
        console.error('[VERIFY-MFA DEBUG] Error fetching user data:', userError);
      }

      console.log('[VERIFY-MFA DEBUG] User data fetched:', userData);
      console.log('[VERIFY-MFA DEBUG] Background check status:', {
        hasCompletedBackgroundCheck: !!userData?.background_check_completed,
        rawValue: userData?.background_check_completed,
        role: userData?.role
      });

      // If user hasn't completed background check, redirect there
      // Background checker role: go straight to background-checks after MFA
      if (userData?.role === 'backgroundchecker') {
        console.log('[VERIFY-MFA DEBUG] Background Checker role - Redirecting to /background-checks');
        router.push('/background-checks');
        return;
      }
      // This applies to ALL users, not just new users
      const userRole = userData?.role; if (!userData?.background_check_completed && userRole !== 'backgroundchecker') {
        console.log('[VERIFY-MFA DEBUG] ⚠️ Background check NOT completed');
        console.log('[VERIFY-MFA DEBUG] 🔄 Redirecting to /background-checks-form');
        router.push('/background-checks-form');
      } else {
        console.log('[VERIFY-MFA DEBUG] ✅ Background check completed');
        sessionStorage.removeItem('new_user_onboarding'); // Clean up flag

        // Check if worker has pending onboarding redirect (from login)
        console.log('[VERIFY-MFA DEBUG] ===== CHECKING ONBOARDING REDIRECT =====');
        console.log('[VERIFY-MFA DEBUG] User role:', userRole);

        let pendingOnboardingRedirect = null;

        // For worker/vendor roles, check vendor_onboarding_status first
        if (userRole === 'worker' || userRole === 'vendor') {
          console.log('[VERIFY-MFA DEBUG] Worker/Vendor detected - checking onboarding status...');

          try {
            const onboardingResponse = await fetch('/api/auth/check-onboarding', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
              },
            });

            if (onboardingResponse.ok) {
              const onboardingResult = await onboardingResponse.json();
              console.log('[VERIFY-MFA DEBUG] Onboarding API response:', JSON.stringify(onboardingResult, null, 2));

              if (onboardingResult.hasOnboardingRecord && !onboardingResult.approved) {
                pendingOnboardingRedirect = '/onboarding-pending';
                console.log('[VERIFY-MFA DEBUG] Onboarding record exists but not approved - redirecting to pending page');
              } else if (onboardingResult.approved) {
                console.log('[VERIFY-MFA DEBUG] Onboarding approved - no redirect needed');
              } else {
                console.log('[VERIFY-MFA DEBUG] Onboarding not approved - determining last updated form');
                let localRedirect: string | null = null;
                try {
                  const stored = localStorage.getItem('onboarding_last_form');
                  if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed?.userId === session.user.id && typeof parsed?.path === 'string') {
                      if (parsed.path.startsWith('/payroll-packet-')) {
                        localRedirect = parsed.path;
                      }
                    }
                  }
                } catch (e) {
                  console.warn('[VERIFY-MFA DEBUG] Failed to read local onboarding redirect:', e);
                }

                if (localRedirect) {
                  pendingOnboardingRedirect = localRedirect;
                  console.log('[VERIFY-MFA DEBUG] Using local onboarding redirect:', pendingOnboardingRedirect);
                } else {
                  try {
                    const stageResponse = await fetch('/api/auth/check-onboarding-stage', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`
                      },
                    });
                    if (stageResponse.ok) {
                      const stageResult = await stageResponse.json();
                      if (stageResult.nextStage) {
                        pendingOnboardingRedirect = stageResult.nextStage;
                        console.log('[VERIFY-MFA DEBUG] Onboarding stage detected:', stageResult.nextStage);
                      }
                    }
                  } catch (stageError) {
                    console.error('[VERIFY-MFA DEBUG] Error checking onboarding stage:', stageError);
                  }
                }
              }
            }
          } catch (onboardingError) {
            console.error('[VERIFY-MFA DEBUG] ❌ Exception calling onboarding API:', onboardingError);
          }
        } else {
          console.log('[VERIFY-MFA DEBUG] ℹ️ User is not a worker, skipping onboarding check');
        }

        // Clean up sessionStorage regardless of redirect (may contain stale data)
        console.log('[VERIFY-MFA DEBUG] 🗑️ Cleaning up sessionStorage');
        sessionStorage.removeItem('pending_onboarding_redirect');

        if (pendingOnboardingRedirect && pendingOnboardingRedirect !== '/verify-mfa') {
          console.log('[VERIFY-MFA DEBUG] ========================================');
          console.log('[VERIFY-MFA DEBUG] 🎯 REDIRECTING TO:', pendingOnboardingRedirect);
          console.log('[VERIFY-MFA DEBUG] ========================================');
          router.push(pendingOnboardingRedirect);
          return;
        }

        console.log('[VERIFY-MFA DEBUG] No onboarding redirect needed - proceeding to role-based routing');

        // Role-based routing
        console.log('[VERIFY-MFA DEBUG] User role:', userRole);

        if (userRole === 'manager') {
          console.log('[VERIFY-MFA DEBUG] Manager role - Redirecting to /dashboard');
          router.push('/dashboard');
        } else if (userRole === 'exec') {
          console.log('[VERIFY-MFA DEBUG] Exec role - Redirecting to /global-calendar');
          router.push('/global-calendar');
        } else if (userRole === 'backgroundchecker') {
          console.log('[VERIFY-MFA DEBUG] Background Checker role - Redirecting to /background-checks');
          router.push('/background-checks');
        } else if (userRole === 'worker' || userRole === 'vendor') {
          console.log('[VERIFY-MFA DEBUG] Worker/Vendor role - Redirecting to /time-keeping');
          router.push('/time-keeping');
        } else {
          console.log('[VERIFY-MFA DEBUG] Other role - Redirecting to home page');
          router.push('/');
        }
      }
    } catch (err: any) {
      console.error('MFA verification error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    let processedValue;
    if (mfaMethod === 'backup') {
      // Allow alphanumeric for backup codes
      processedValue = value.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
    } else {
      // Only numeric for TOTP and email codes
      processedValue = value.replace(/\D/g, '').slice(0, 6);
    }
    setCode(processedValue);
    setError('');
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Security Information */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              Multi-Factor Authentication
            </h1>
            <p className="text-primary-100 text-lg">
              Verify your identity using your authenticator app, email code, or backup code
            </p>
          </div>
        </div>

        {/* Google Authenticator Download */}
        <div className="relative z-10 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <div className="flex items-center gap-4 mb-4">
              <img
                src="/googleAuthenticator.png"
                alt="Google Authenticator"
                className="w-16 h-16 rounded-lg bg-white p-2"
              />
              <div>
                <h3 className="text-white font-semibold text-lg">Get Google Authenticator</h3>
                <p className="text-primary-100 text-sm">Download on your mobile phone</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <a
                href="https://apps.apple.com/us/app/google-authenticator/id388497605"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                iOS
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
                </svg>
                Android
              </a>
            </div>
          </div>
        </div>

        {/* Security Features */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Authentication Options</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Authenticator App</p>
                <p className="text-sm text-primary-100">Primary method - 6-digit TOTP codes</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Email Backup</p>
                <p className="text-sm text-primary-100">Fallback method - codes sent to email</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Backup Codes</p>
                <p className="text-sm text-primary-100">Emergency access - 8-character codes</p>
              </div>
            </div>
          </div>
        </div>

        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }}></div>
        </div>
      </div>

      {/* Right Side - MFA Verification Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Back Button */}
          <div className="lg:hidden mb-6">
            <Link href="/login" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Login
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Multi-Factor Authentication</h2>
              <p className="text-gray-600 mt-2">
                {mfaMethod === 'totp' && 'Enter the 6-digit code from your authenticator app'}
                {mfaMethod === 'email' && 'Enter the 6-digit code sent to your email'}
                {mfaMethod === 'backup' && 'Enter your 8-character backup code'}
              </p>
            </div>

            {/* Success Message */}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2 mb-6">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-green-800">{success}</p>
              </div>
            )}

            {/* Method Selection */}
            <div className="mb-6">
              {emailOnly ? (
                // Email-only mode for background checkers
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div className="text-sm text-blue-800">
                      <p className="font-medium">Email Verification Required</p>
                      <p className="mt-1">Your account uses email-based authentication. Click the button below to receive your verification code.</p>
                    </div>
                  </div>
                  {!codeSent && (
                    <button
                      type="button"
                      onClick={() => sendVerificationEmail()}
                      disabled={isLoading}
                      className="mt-3 w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                    >
                      {isLoading ? 'Sending...' : 'Send Email Code'}
                    </button>
                  )}
                </div>
              ) : (
                // Standard method selection for other users
                <div className="flex space-x-2 mb-4">
                  <button
                    type="button"
                    onClick={() => {
                      setMfaMethod('totp');
                      setCode('');
                      setError('');
                    }}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                      mfaMethod === 'totp'
                        ? 'bg-gradient-to-br from-ios-blue to-ios-indigo text-white shadow-liquid-glow'
                        : 'liquid-card text-gray-900 hover:shadow-liquid'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      App
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMfaMethod('email');
                      setCode('');
                      setError('');
                      if (!codeSent) {
                        sendVerificationEmail();
                      }
                    }}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                      mfaMethod === 'email'
                        ? 'bg-gradient-to-br from-ios-blue to-ios-indigo text-white shadow-liquid-glow'
                        : 'liquid-card text-gray-900 hover:shadow-liquid'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Email
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMfaMethod('backup');
                      setCode('');
                      setError('');
                    }}
                    className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                      mfaMethod === 'backup'
                        ? 'bg-gradient-to-br from-ios-blue to-ios-indigo text-white shadow-liquid-glow'
                        : 'liquid-card text-gray-900 hover:shadow-liquid'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      Backup
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Email Display */}
            {mfaMethod === 'email' && userEmail && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">Sent to: <span className="font-mono">{userEmail}</span></p>
                  </div>
                </div>
              </div>
            )}

            {/* MFA Verification Form */}
            <form onSubmit={handleVerifyCode} className="space-y-5">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                  {mfaMethod === 'totp' && 'Authenticator Code'}
                  {mfaMethod === 'email' && 'Email Verification Code'}
                  {mfaMethod === 'backup' && 'Backup Code'}
                </label>
                <input
                  type="text"
                  id="code"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-center text-2xl keeping-widest font-mono"
                  placeholder={mfaMethod === 'backup' ? 'A1B2C3D4' : '000000'}
                  maxLength={mfaMethod === 'backup' ? 8 : 6}
                  required
                  autoFocus
                  autoComplete="off"
                  disabled={mfaMethod === 'email' && !codeSent}
                />
                <p className="mt-2 text-sm text-gray-500">
                  {mfaMethod === 'totp' && 'Enter the 6-digit code from your authenticator app'}
                  {mfaMethod === 'email' && (codeSent ? 'Check your email inbox for the code' : 'Click Email button to send code')}
                  {mfaMethod === 'backup' && 'Enter your 8-character backup code (each can only be used once)'}
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading || (mfaMethod === 'email' && !codeSent) ||
                         (mfaMethod === 'totp' && code.length !== 6) ||
                         (mfaMethod === 'email' && code.length !== 6) ||
                         (mfaMethod === 'backup' && code.length !== 8)}
                className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>Verify and Continue</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </>
                )}
              </button>

              {/* Resend Code - Only for Email Method */}
              {mfaMethod === 'email' && (
                <div className="text-center pt-4 border-t border-gray-200">
                  {canResend ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCode('');
                        sendVerificationEmail();
                      }}
                      className="text-sm text-ios-blue hover:text-ios-indigo font-semibold transition-colors"
                    >
                      Resend verification code
                    </button>
                  ) : codeSent ? (
                    <p className="text-sm text-gray-500">
                      Didn't receive the code? You can resend in <span className="font-medium">{countdown}s</span>
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500">
                      Click the Email button above to send a verification code
                    </p>
                  )}
                </div>
              )}
            </form>

            {/* Help Section */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-center text-sm text-gray-600">
                Having trouble?{' '}
                  Contact Support at portal@1pds.net
              
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyMFAPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="animate-spin h-8 w-8 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <p className="text-gray-600 font-medium">Loading verification page...</p>
          </div>
        </div>
      </div>
    }>
      <VerifyMFAContent />
    </Suspense>
  );
}

