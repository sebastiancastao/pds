'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, isValidEmail } from '@/lib/supabase';
import { logAuditEvent } from '@/lib/audit';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Pre-login check
      console.log('DEBUG Step 1: Pre-login check for', email.toLowerCase().trim());
      
      const preLoginResponse = await fetch('/api/auth/pre-login-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      const preLoginData = await preLoginResponse.json();

      if (!preLoginData.canProceed) {
        setError(preLoginData.message || 'Cannot proceed with login');
        setIsLoading(false);
        return;
      }

      const userId = preLoginData.userId || null;

      // Step 2: Supabase auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });

      if (authError) {
        if (userId) {
          const newFailedAttempts = (preLoginData.failedAttempts || 0) + 1;
          const shouldLock = newFailedAttempts >= 5;

          await fetch('/api/auth/update-login-attempts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, increment: true, shouldLock }),
          });

          setError(shouldLock 
            ? 'Account locked for 15 minutes.'
            : `Invalid credentials. ${5 - newFailedAttempts} attempt(s) left.`
          );

          await logAuditEvent({
            userId,
            action: 'login_failed',
            resourceType: 'user',
            success: false,
            metadata: { email, failedAttempts: newFailedAttempts, locked: shouldLock }
          });
        } else {
          setError('Invalid email or password');
          await logAuditEvent({
            userId: null,
            action: 'login_failed_unknown_user',
            resourceType: 'user',
            success: false,
            metadata: { email }
          });
        }
        setIsLoading(false);
        return;
      }

      if (!authData.user) {
        setError('Authentication failed. Please try again.');
        setIsLoading(false);
        return;
      }

      // Step 3: Reset failed attempts
      await fetch('/api/auth/update-login-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: authData.user.id, reset: true }),
      });

      // Step 4: Re-fetch user data including background check status
      console.log('[LOGIN DEBUG] Fetching user data for:', authData.user.id);

      const { data: currentUserData, error: fetchError } = await (supabase
        .from('users')
        .select('is_temporary_password, must_change_password, background_check_completed, role')
        .eq('id', authData.user.id)
        .single() as any);

      if (fetchError) {
        console.error('[LOGIN DEBUG] ❌ Error fetching user from database:', fetchError);
        console.error('[LOGIN DEBUG] Error details:', {
          message: fetchError.message,
          code: fetchError.code,
          hint: fetchError.hint,
          details: fetchError.details
        });
      } else if (!currentUserData) {
        console.error('[LOGIN DEBUG] ❌ User data is NULL - user may not exist in users table');
        console.error('[LOGIN DEBUG] User ID:', authData.user.id);
      } else {
        console.log('[LOGIN DEBUG] ✅ User data fetched successfully:', currentUserData);
      }

      // Step 4a: Check vendor background check status for workers
      const userRole = (currentUserData?.role || '').toString().trim().toLowerCase();
      console.log('[LOGIN DEBUG] User role:', userRole);

      if (userRole === 'backgroundchecker' || userRole === 'background-checker') {
        console.log('[LOGIN DEBUG] Background Checker detected');

        // Check if they have MFA enabled (email MFA only for background checkers)
        const { data: profileData } = await (supabase
          .from('profiles')
          .select('mfa_enabled, mfa_secret')
          .eq('user_id', authData.user.id)
          .single() as any);

        if (!profileData?.mfa_enabled) {
          console.log('[LOGIN DEBUG] Background Checker - MFA not enabled → redirecting to /email-mfa-setup');
          sessionStorage.removeItem('mfa_checkpoint');
          sessionStorage.removeItem('mfa_verified');
          sessionStorage.removeItem('pending_onboarding_redirect');
          router.replace('/email-mfa-setup');
          return;
        }

        console.log('[LOGIN DEBUG] Background Checker - MFA enabled → redirecting to /verify-mfa (email only)');
        sessionStorage.setItem('mfa_checkpoint', 'true');
        sessionStorage.setItem('email_mfa_only', 'true');
        router.replace('/verify-mfa');
        return;
      }

      if (userRole === 'worker' || userRole === 'vendor') {
        console.log('[LOGIN DEBUG] 🔍 Checking vendor_background_checks for worker/vendor...');

        // Use server-side API to bypass RLS issues
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        try {
          const bgCheckResponse = await fetch('/api/auth/check-background', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentSession?.access_token}`
            },
          });

          const bgCheckResult = await bgCheckResponse.json();

          console.log('[LOGIN DEBUG] Background check API result:', bgCheckResult);

          if (!bgCheckResponse.ok) {
            console.error('[LOGIN DEBUG] ❌ Background check API error:', bgCheckResult);
            setError('Unable to verify background check status.\n\nPlease try again or contact your administrator.');
            setIsLoading(false);
            return;
          }

          if (!bgCheckResult.approved) {
            console.log('[LOGIN DEBUG] ❌ vendor_background_checks.background_check_completed = false');

            // Check users.background_check_completed to see if they submitted forms
            if (currentUserData?.background_check_completed === true) {
              // User submitted forms (users.background_check_completed = true)
              // but vendor hasn't approved yet (vendor_background_checks.background_check_completed = false)
              // → Block login
              console.log('[LOGIN DEBUG] 🚫 Blocking login - users.background_check_completed = true but vendor not approved');

              // Sign out the user
              await supabase.auth.signOut();

              setError('Your background check is pending approval.\n\nPlease wait until your background check has been approved by an administrator before logging in.\n\nYou will receive an email notification once approved.');
              setIsLoading(false);
              return;
            }

            // users.background_check_completed = false → User hasn't submitted forms yet
            // Allow login to fill them out
            console.log('[LOGIN DEBUG] ✅ users.background_check_completed = false - allowing login to fill forms');
          } else {
            console.log('[LOGIN DEBUG] ✅ vendor_background_checks.background_check_completed = true - approved');
          }

          // Check if onboarding is completed - store redirect path but DON'T redirect yet
          // UNIVERSAL RULE: All users with permanent passwords MUST go through MFA first
          if (!bgCheckResult.onboardingCompleted && bgCheckResult.onboardingRedirect) {
            console.log('[LOGIN DEBUG] ⚠️ Onboarding not completed');
            console.log('[LOGIN DEBUG] Storing onboarding redirect:', bgCheckResult.onboardingRedirect);
            console.log('[LOGIN DEBUG] User will complete MFA first, then be redirected to onboarding');

            // Store the onboarding redirect path for after MFA
            sessionStorage.setItem('pending_onboarding_redirect', bgCheckResult.onboardingRedirect);
          } else {
            console.log('[LOGIN DEBUG] ✅ Onboarding completed');
          }

          console.log('[LOGIN DEBUG] Worker will now proceed through standard login flow (password check → MFA)');
        } catch (apiError) {
          console.error('[LOGIN DEBUG] ❌ Failed to check background status:', apiError);
          setError('Unable to verify background check status.\n\nPlease try again or contact your administrator.');
          setIsLoading(false);
          return;
        }
      }

      // Check if the column exists and log its exact value
      console.log('[LOGIN DEBUG] 🔍 Checking background_check_completed column...');
      console.log('[LOGIN DEBUG] currentUserData object:', currentUserData);
      console.log('[LOGIN DEBUG] background_check_completed RAW VALUE:', currentUserData?.background_check_completed);
      console.log('[LOGIN DEBUG] background_check_completed TYPE:', typeof currentUserData?.background_check_completed);
      console.log('[LOGIN DEBUG] background_check_completed === true:', currentUserData?.background_check_completed === true);
      console.log('[LOGIN DEBUG] background_check_completed === false:', currentUserData?.background_check_completed === false);
      console.log('[LOGIN DEBUG] background_check_completed === null:', currentUserData?.background_check_completed === null);
      console.log('[LOGIN DEBUG] background_check_completed === undefined:', currentUserData?.background_check_completed === undefined);

      if (currentUserData && typeof currentUserData.background_check_completed === 'undefined') {
        console.error('[LOGIN DEBUG] 🚨 CRITICAL: background_check_completed column does NOT exist in users table!');
        console.error('[LOGIN DEBUG] You MUST run migration 023 to add this column!');
        console.error('[LOGIN DEBUG] See: database/migrations/023_add_background_check_completed_to_users.sql');
      }

      const isTemporaryPassword = preLoginData?.isTemporaryPassword ?? currentUserData?.is_temporary_password ?? false;
      const mustChangePassword = currentUserData?.must_change_password ?? false;
      const backgroundCheckCompleted = currentUserData?.background_check_completed ?? false;

      console.log('[LOGIN DEBUG] 📊 Computed values after defaults:');
      console.log('[LOGIN DEBUG] - isTemporaryPassword:', isTemporaryPassword, '(type:', typeof isTemporaryPassword, ')');
      console.log('[LOGIN DEBUG] - mustChangePassword:', mustChangePassword, '(type:', typeof mustChangePassword, ')');
      console.log('[LOGIN DEBUG] - backgroundCheckCompleted:', backgroundCheckCompleted, '(type:', typeof backgroundCheckCompleted, ')');
      console.log('[LOGIN DEBUG] - role:', userRole);

      console.log('[LOGIN DEBUG] User status after login:', {
        userId: authData.user.id,
        email: authData.user.email,
        isTemporaryPassword,
        mustChangePassword,
        backgroundCheckCompleted,
        rawData: currentUserData
      });

      console.log('[LOGIN DEBUG] 🔍 REDIRECT LOGIC:');
      console.log('[LOGIN DEBUG] - If background_check_completed = FALSE → /background-checks-form');
      console.log('[LOGIN DEBUG] - If background_check_completed = TRUE + temp password → /password');
      console.log('[LOGIN DEBUG] - If background_check_completed = TRUE + permanent password → /verify-mfa');

      // Step 1: Check if background check is completed (users table)
      if (backgroundCheckCompleted === false || backgroundCheckCompleted === null || backgroundCheckCompleted === undefined) {
        // HR, Exec, and Finance users should NOT be redirected to background-checks-form
        // They don't need to complete background checks
        if (userRole === 'hr' || userRole === 'exec' || userRole === 'finance') {
          console.log('[LOGIN DEBUG] ⚠️ User is HR/Exec/Finance - skipping background check requirement');
          console.log('[LOGIN DEBUG] Setting backgroundCheckCompleted to true for login flow');
          // Continue with normal flow as if background check is completed
        } else {
          // users.background_check_completed = false → User hasn't submitted forms yet
          // Allow them to fill out background check forms
          console.log('[LOGIN DEBUG] ❌ users.background_check_completed = FALSE (value:', backgroundCheckCompleted, ')');
          console.log('[LOGIN DEBUG] ✅ Allowing login to fill out background check forms');
          console.log('[LOGIN DEBUG] 🔄 Redirecting to /background-checks-form');

          sessionStorage.setItem('mfa_verified', 'true');
          sessionStorage.setItem('background_check_required', 'true');

          router.replace('/background-checks-form');
          return;
        }
      }

      // users.background_check_completed = true → User has submitted forms
      // For workers/vendors, we already checked vendor_background_checks earlier
      // Continue with normal flow
      console.log('[LOGIN DEBUG] ✅ users.background_check_completed = TRUE - user has submitted forms');

      // Step 2: Background check completed, check if user needs to change password
      if (isTemporaryPassword || mustChangePassword) {
        // User has temporary password → go to /password
        console.log('[LOGIN DEBUG] ⚠️ User has temporary password or must change password');
        console.log('[LOGIN DEBUG] 🔄 Redirecting to /password');

        sessionStorage.setItem('requires_password_change', 'true');
        sessionStorage.removeItem('mfa_checkpoint');
        sessionStorage.removeItem('mfa_verified');

        router.replace('/password');
        return;
      }

      // Step 3: Background check completed AND permanent password → proceed to MFA
      // UNIVERSAL RULE: All users (including workers with completed onboarding) MUST go through MFA
      console.log('[LOGIN DEBUG] ✅ background_check_completed = TRUE + permanent password');
      console.log('[LOGIN DEBUG] 🔄 Proceeding to MFA verification (REQUIRED FOR ALL USERS)');

      // Step 5: Log success
      await logAuditEvent({
        userId: authData.user!.id,
        action: 'login_success',
        resourceType: 'user',
        success: true,
        metadata: { email, temporaryPassword: isTemporaryPassword }
      });

      // Step 6: Verify session
      await new Promise(resolve => setTimeout(resolve, 100));
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session error. Please try again.');
        setIsLoading(false);
        return;
      }

      // === MFA CHECK: 1:1 PROFILE WITH .single() ===
      console.log('MFA [DEBUG] Checking MFA status for user:', authData.user!.id);

      let mfaProfile: { mfa_secret?: string | null; mfa_enabled?: boolean } | null;
      try {
        const { data, error } = await (supabase
          .from('profiles')
          .select('mfa_secret, mfa_enabled')
          .eq('user_id', authData.user!.id)
          .single() as any); // Enforces exactly one row

        if (error) throw error;
        mfaProfile = data;

        console.log('MFA [DEBUG] Profile fetched:', {
          hasSecret: !!mfaProfile?.mfa_secret,
          mfaEnabled: mfaProfile?.mfa_enabled,
        });
      } catch (error: any) {
        console.error('MFA [ERROR] Failed to fetch profile:', error.message);
        if (error.message.includes('row not found')) {
          console.log('MFA [INFO] No profile → /mfa-setup');
        } else if (error.message.includes('more than one row')) {
          console.warn('MFA [WARN] Multiple profiles → data issue');
        }
        router.replace('/verify-mfa');
        return;
      }

      // Require BOTH secret AND enabled
      if (!mfaProfile?.mfa_secret || !mfaProfile?.mfa_enabled) {
        console.log('MFA [INFO] MFA not fully enabled → /mfa-setup');
        router.replace('/verify-mfa');
      } else {
        console.log('MFA [INFO] MFA fully enabled → /verify-mfa');
        sessionStorage.setItem('mfa_checkpoint', 'true');
        router.replace('/verify-mfa');
      }

    } catch (err: any) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  // === JSX REMAINS UNCHANGED (only logic fixed above) ===
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              PDS Time keepingSystem
            </h1>
            <p className="text-primary-100 text-lg">
              Secure, compliant employee time keepingand workforce management
            </p>
          </div>
        </div>

        {/* Security Features */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Security Features</h2>
          <div className="space-y-3">
            {['End-to-End Encryption', 'Secure Authentication', 'SOC2 Compliant', 'Audit Trail', 'Account Protection'].map((feature, i) => (
              <div key={i} className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">{feature}</p>
                  <p className="text-sm text-primary-100">
                    {feature === 'End-to-End Encryption' && 'AES-256 encryption at rest, TLS 1.2+ in transit'}
                    {feature === 'Secure Authentication' && 'Password-based login with account protection'}
                    {feature === 'SOC2 Compliant' && 'Enterprise-grade security standards'}
                    {feature === 'Audit Trail' && 'Immutable logs for all access attempts'}
                    {feature === 'Account Protection' && 'Automatic lockout after 5 failed attempts'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }}></div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-6">
            <Link href="/" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Home
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Secure Login</h2>
              <p className="text-gray-600 mt-2">Access your PDS portal</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email & Password */}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@pds.com"
                className="w-full px-4 py-3 border rounded-lg"
                required
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 border rounded-lg pr-12"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>

              <div className="flex justify-between text-sm">
                <label className="flex items-center">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="mr-2" />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-primary-600">Forgot?</Link>
              </div>

              {error && (
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 text-sm text-red-900 whitespace-pre-line">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>

            

            <div className="mt-4 text-center text-xs text-gray-500">
              Secured by TLS 1.2+ encryption
            </div>
          </div>

          
        </div>
      </div>
    </div>
  );
}
