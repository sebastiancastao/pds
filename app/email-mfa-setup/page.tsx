'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';

export default function EmailMFASetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<'info' | 'verify' | 'success'>('info');
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    checkAuthAndInit();
  }, []);

  // Countdown timer for resend button
  useEffect(() => {
    if (codeSent && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      setCanResend(true);
    }
  }, [countdown, codeSent]);

  // Redirect after success
  useEffect(() => {
    if (step === 'success') {
      const timer = setTimeout(() => {
        router.push('/background-checks');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step, router]);

  const checkAuthAndInit = async () => {
    console.log('[EMAIL MFA SETUP] Initializing email MFA setup...');

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.log('[EMAIL MFA SETUP] No user found');
      router.push('/login');
      return;
    }

    setUserEmail(user.email || '');

    // Check if user is background checker
    const { data: userData } = await (supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single() as any);

    const userRole = (userData?.role || '').toString().trim().toLowerCase();

    if (userRole !== 'backgroundchecker' && userRole !== 'background-checker') {
      console.log('[EMAIL MFA SETUP] Not a background checker, redirecting to regular MFA setup');
      router.push('/mfa-setup');
      return;
    }

    // Check if MFA is already enabled
    const { data: profileData } = await (supabase
      .from('profiles')
      .select('mfa_enabled')
      .eq('user_id', user.id)
      .single() as any);

    if (profileData?.mfa_enabled === true) {
      console.log('[EMAIL MFA SETUP] MFA already enabled, redirecting to background-checks');
      router.push('/background-checks');
    }
  };

  const handleSendCode = async () => {
    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

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
      setSuccess(`Verification code sent to ${userEmail}`);
      setStep('verify');
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

    if (!verificationCode || verificationCode.length !== 6) {
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

      // First verify the email code
      const verifyResponse = await fetch('/api/auth/mfa/verify-login-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          code: verificationCode
        }),
      });

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok || verifyData.error) {
        setError(verifyData.error || 'Invalid code. Please try again.');
        setIsLoading(false);
        return;
      }

      // Enable MFA for this user (email-only mode)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          mfa_enabled: true,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', session.user.id);

      if (updateError) {
        console.error('Failed to enable MFA:', updateError);
        setError('Failed to enable MFA. Please try again.');
        setIsLoading(false);
        return;
      }

      // Success
      sessionStorage.setItem('mfa_verified', 'true');
      sessionStorage.removeItem('mfa_checkpoint');
      setStep('success');
    } catch (err: any) {
      console.error('Verification error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-8">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Email MFA Enabled Successfully!</h2>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold text-blue-800 mb-2">What happens next?</h3>
            <p className="text-sm text-blue-700">
              Every time you log in, you'll receive a 6-digit verification code at <span className="font-mono font-semibold">{userEmail}</span>.
              Enter this code to complete your login.
            </p>
          </div>

          <p className="text-gray-600 mb-6">
            Your account is now secured with email-based multi-factor authentication.
          </p>

          <div className="animate-pulse text-sm text-gray-500">
            Redirecting to Background Checks in 3 seconds...
          </div>
        </div>
      </div>
    );
  }

  return (
    <AuthGuard requireMFA={false} allowTemporaryPassword={true} onboardingOnly={true}>
      <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
        {/* Left Side - Information */}
        <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
          <div className="relative z-10">
            <div className="mt-16">
              <h1 className="text-4xl font-bold text-white mb-4">
                Email-Based Authentication
              </h1>
              <p className="text-primary-100 text-lg">
                Secure your account with email verification codes
              </p>
            </div>
          </div>

          {/* Email MFA Benefits */}
          <div className="relative z-10 space-y-4">
            <h2 className="text-white font-semibold text-xl mb-6">Why Email MFA?</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">Simple & Convenient</p>
                  <p className="text-sm text-primary-100">No need to install additional apps</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">Secure Access</p>
                  <p className="text-sm text-primary-100">Codes sent directly to your email</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">Easy Verification</p>
                  <p className="text-sm text-primary-100">Just check your email and enter the code</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">Account Protection</p>
                  <p className="text-sm text-primary-100">Prevents unauthorized access to your account</p>
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

        {/* Right Side - Email MFA Setup */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
              {/* Info Step */}
              {step === 'info' && (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Setup Email MFA</h2>
                    <p className="text-gray-600 mt-2">Secure your account with email verification</p>
                  </div>

                  {/* Email Display */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <div className="text-sm text-blue-800">
                        <p className="font-medium mb-1">Verification codes will be sent to:</p>
                        <p className="font-mono text-blue-900">{userEmail}</p>
                      </div>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-700 mb-3">How it works:</h3>
                    <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                      <li>Click "Send Verification Code" below</li>
                      <li>Check your email inbox for a 6-digit code</li>
                      <li>Enter the code to complete setup</li>
                      <li>You'll receive a code each time you log in</li>
                    </ol>
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 mb-4">
                      <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-red-800">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleSendCode}
                    disabled={isLoading}
                    className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Sending Code...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span>Send Verification Code</span>
                      </>
                    )}
                  </button>
                </>
              )}

              {/* Verify Step */}
              {step === 'verify' && (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Enter Verification Code</h2>
                    <p className="text-gray-600 mt-2">Check your email for the 6-digit code</p>
                  </div>

                  {success && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2 mb-6">
                      <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm text-green-800">{success}</p>
                    </div>
                  )}

                  <form onSubmit={handleVerifyCode} className="space-y-5">
                    <div>
                      <label htmlFor="verificationCode" className="block text-sm font-medium text-gray-700 mb-2">
                        Verification Code
                      </label>
                      <input
                        type="text"
                        id="verificationCode"
                        value={verificationCode}
                        onChange={(e) => {
                          const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setVerificationCode(value);
                          setError('');
                        }}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-center text-2xl tracking-widest font-mono"
                        placeholder="000000"
                        maxLength={6}
                        required
                        autoFocus
                      />
                      <p className="mt-2 text-sm text-gray-500">
                        Enter the 6-digit code sent to {userEmail}
                      </p>
                    </div>

                    {error && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                        <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        <p className="text-sm text-red-800">{error}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading || verificationCode.length !== 6}
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
                          <span>Verify and Enable MFA</span>
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
                            setVerificationCode('');
                            handleSendCode();
                          }}
                          className="text-sm text-ios-blue hover:text-ios-indigo font-semibold transition-colors"
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
