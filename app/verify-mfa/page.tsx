'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function VerifyMFAPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');

  useEffect(() => {
    // Set MFA checkpoint flag - user has reached MFA verification
    // This prevents accessing any other page without verifying MFA
    sessionStorage.setItem('mfa_checkpoint', 'true');
    console.log('[DEBUG] MFA checkpoint set - user cannot access other pages until verified');
    
    // Check if user is authenticated using session (more reliable after login)
    const checkAuth = async () => {
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
        
        console.log('[DEBUG] ✅ User authenticated (after retry), ready for MFA verification');
        console.log('[DEBUG] User ID:', retrySession.user.id);
        console.log('[DEBUG] User Email:', retrySession.user.email);
        return;
      }

      // User is authenticated and on verify-mfa page
      console.log('[DEBUG] ✅ User authenticated, ready for MFA verification');
      console.log('[DEBUG] User ID:', session.user.id);
      console.log('[DEBUG] User Email:', session.user.email);
    };

    checkAuth();
  }, [router]);

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const codeToVerify = useBackupCode ? backupCode : code;

    if (!codeToVerify) {
      setError('Please enter a code');
      return;
    }

    if (!useBackupCode && codeToVerify.length !== 6) {
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

      const response = await fetch('/api/auth/mfa/verify-login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          code: codeToVerify,
          isBackupCode: useBackupCode
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

  const handleBackupCodeChange = (value: string) => {
    const alphanumericValue = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setBackupCode(alphanumericValue);
    setError('');
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Security Information */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              Two-Factor Authentication
            </h1>
            <p className="text-primary-100 text-lg">
              Enter the code from your authenticator app to continue
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
                <p className="text-sm text-primary-100">Your account is secured with two-factor authentication</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Time-Based Codes</p>
                <p className="text-sm text-primary-100">Codes change every 30 seconds for maximum security</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Emergency Access</p>
                <p className="text-sm text-primary-100">Use backup codes if you don't have your device</p>
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
              <h2 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h2>
              <p className="text-gray-600 mt-2">
                {useBackupCode 
                  ? 'Enter one of your backup codes'
                  : 'Enter the code from your authenticator app'
                }
              </p>
            </div>

            {/* MFA Verification Form */}
            <form onSubmit={handleVerifyCode} className="space-y-5">
              {!useBackupCode ? (
                // Regular MFA Code Input
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
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Open your authenticator app to get the code
                  </p>
                </div>
              ) : (
                // Backup Code Input
                <div>
                  <label htmlFor="backupCode" className="block text-sm font-medium text-gray-700 mb-2">
                    Backup Code
                  </label>
                  <input
                    type="text"
                    id="backupCode"
                    value={backupCode}
                    onChange={(e) => handleBackupCodeChange(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-center text-xl tracking-wider font-mono"
                    placeholder="A1B2C3D4"
                    maxLength={8}
                    required
                    autoFocus
                    autoComplete="off"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Each backup code can only be used once
                  </p>
                </div>
              )}

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
                disabled={isLoading || (!useBackupCode && code.length !== 6) || (useBackupCode && backupCode.length !== 8)}
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

              {/* Toggle Backup Code */}
              <div className="text-center pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setUseBackupCode(!useBackupCode);
                    setCode('');
                    setBackupCode('');
                    setError('');
                  }}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  {useBackupCode ? '← Use authenticator code instead' : 'Use backup code instead →'}
                </button>
              </div>
            </form>

            {/* Help Section */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-center text-sm text-gray-600">
                Lost your device?{' '}
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

