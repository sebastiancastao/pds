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

  useEffect(() => {
    checkAuthAndSendCode();
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

  const checkAuthAndSendCode = async () => {
    console.log('[DEBUG] Checking authentication status on verify-mfa page...');
    
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
        .select('is_temporary_password, must_change_password')
        .eq('id', retrySession.user.id)
        .single() as any);

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
      
      // Automatically send email code
      sendVerificationEmail(retrySession);
      return;
    }

    // CRITICAL: Check if user has temporary password BEFORE allowing MFA verification
    const { data: userData } = await (supabase
      .from('users')
      .select('is_temporary_password, must_change_password')
      .eq('id', session.user.id)
      .single() as any);

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

    // User is authenticated and has no temporary password - ready for MFA
    console.log('[DEBUG] ✅ User authenticated, ready for MFA verification');
    setUserEmail(session.user.email || '');
    
    // Set MFA checkpoint flag - user has reached MFA verification
    sessionStorage.setItem('mfa_checkpoint', 'true');
    console.log('[DEBUG] MFA checkpoint set - user cannot access other pages until verified');
    
    // Automatically send email code
    sendVerificationEmail(session);
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

    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Session expired. Please log in again.');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/auth/mfa/verify-login-code', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          code: code
        }),
      });

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
      
      // Redirect to home
      router.push('/');
    } catch (err: any) {
      console.error('MFA verification error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const handleCodeChange = (value: string) => {
    const numericValue = value.replace(/\D/g, '').slice(0, 6);
    setCode(numericValue);
    setError('');
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Security Information */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              Email Verification
            </h1>
            <p className="text-primary-100 text-lg">
              Enter the verification code sent to your email to continue
            </p>
          </div>
        </div>

        {/* Security Features */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Security Benefits</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Protected Access</p>
                <p className="text-sm text-primary-100">Your account is secured with email verification</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Time-Limited Codes</p>
                <p className="text-sm text-primary-100">Codes expire after 10 minutes for security</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Easy Access</p>
                <p className="text-sm text-primary-100">Check your email on any device</p>
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
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Email Verification</h2>
              <p className="text-gray-600 mt-2">
                Enter the 6-digit code sent to your email
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

            {/* Email Display */}
            {userEmail && (
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
                  Verification Code
                </label>
                <input
                  type="text"
                  id="code"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-center text-2xl tracking-widest font-mono"
                  placeholder="000000"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="off"
                  disabled={!codeSent}
                />
                <p className="mt-2 text-sm text-gray-500">
                  {codeSent ? 'Check your email inbox for the code' : 'Sending verification code...'}
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
                disabled={isLoading || !codeSent || code.length !== 6}
                className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

              {/* Resend Code */}
              <div className="text-center pt-4 border-t border-gray-200">
                {canResend ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCode('');
                      sendVerificationEmail();
                    }}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Resend verification code
                  </button>
                ) : codeSent ? (
                  <p className="text-sm text-gray-500">
                    Didn't receive the code? You can resend in <span className="font-medium">{countdown}s</span>
                  </p>
                ) : null}
              </div>
            </form>

            {/* Help Section */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-center text-sm text-gray-600">
                Having trouble?{' '}
                <a href="#" className="text-primary-600 hover:text-primary-700 font-medium">
                  Contact Support
                </a>
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
