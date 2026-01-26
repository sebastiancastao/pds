'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';

export default function MFASetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<'setup' | 'verify' | 'success'>('setup');
  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    checkAuthAndMFA();
  }, []);

  // Handle redirect after MFA setup success
  useEffect(() => {
    const doRedirect = async () => {
      if (step === 'success' && backupCodes.length > 0) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            router.push('/');
            return;
          }
          const { data: userRow } = await (supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single() as any);
          const role = (userRow?.role || '').toString().trim().toLowerCase();
          if (role === 'backgroundchecker') {
            router.push('/background-checks');
          } else if (role === 'hr') {
            router.push('/hr-dashboard');
          } else if (role === 'exec') {
            router.push('/global-calendar');
          } else if (role === 'worker') {
            router.push('/register');
          } else {
            router.push('/');
          }
        } catch {
          router.push('/');
        }
      }
    };
    doRedirect();
  }, [step, backupCodes, router]);

  const checkAuthAndMFA = async () => {
    console.log('[DEBUG] MFA Setup - Initializing TOTP MFA setup...');
    
    // AuthGuard handles authentication check, so we just get the user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('[DEBUG] MFA Setup - No user (AuthGuard should have caught this)');
      return;
    }

    setUserEmail(user.email || '');

    // Check if MFA is already enabled
    console.log('[DEBUG] MFA Setup - Checking if MFA is already enabled...');
    console.log('[DEBUG] MFA Setup - User ID:', user.id);
    
    const { data: profileDataArray } = await (supabase
      .from('profiles')
      .select('mfa_enabled, mfa_secret')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1) as any);
    
    const profileData = profileDataArray?.[0] || null;

    console.log('[DEBUG] MFA Setup - Profile check:', {
      mfaEnabled: profileData?.mfa_enabled,
      mfaSecret: !!profileData?.mfa_secret,
    });

    // If MFA is already FULLY enabled with TOTP secret, redirect to home
    if (profileData?.mfa_enabled === true && profileData?.mfa_secret) {
      console.log('[DEBUG] MFA Setup - ✅ MFA ALREADY ENABLED WITH TOTP, redirecting to home');
      router.push('/');
    } else {
      console.log('[DEBUG] MFA Setup - MFA not enabled or no TOTP secret, ready to set up');
    }
  };

  const generateTOTPSecret = async () => {
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

      const response = await fetch('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Failed to generate MFA secret. Please try again.');
        setIsLoading(false);
        return;
      }

      setMfaSecret(data.secret);
      setQrCodeUrl(data.qrCodeUrl);
      setSuccess('QR code generated successfully');
      setStep('verify');
    } catch (err: any) {
      console.error('TOTP setup error:', err);
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

      const response = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          code: verificationCode,
          secret: mfaSecret
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Invalid verification code. Please try again.');
        setIsLoading(false);
        return;
      }

      // Success! MFA is now enabled, show backup codes
      setBackupCodes(data.backupCodes);
      setStep('success');
    } catch (err: any) {
      console.error('Verification error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  if (isLoading && step === 'setup') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Preparing MFA setup...</p>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-8">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">MFA Enabled Successfully!</h2>

          <p className="text-gray-600 mb-6">
            Your account is now secured with authenticator app-based MFA. Redirecting to complete your profile...
          </p>

          <div className="animate-pulse text-sm text-gray-500">
            Redirecting in 3 seconds...
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
              Secure Your Account
            </h1>
            <p className="text-primary-100 text-lg">
              Multi-factor authentication adds an extra layer of security to your account
            </p>
          </div>
        </div>

        {/* MFA Benefits */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Why Authenticator Apps?</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Maximum Security</p>
                <p className="text-sm text-primary-100">Time-based codes that change every 30 seconds</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Works Offline</p>
                <p className="text-sm text-primary-100">No internet connection required for codes</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Industry Standard</p>
                <p className="text-sm text-primary-100">Used by banks, tech companies, and government</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Backup Options</p>
                <p className="text-sm text-primary-100">Email codes and backup codes available as fallback</p>
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

      {/* Right Side - MFA Setup */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Step Indicator */}
            <div className="flex items-center justify-center mb-8">
              <div className={`flex items-center ${step === 'setup' ? 'text-primary-600' : 'text-green-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'setup' ? 'bg-primary-100' : 'bg-green-100'}`}>
                  {step === 'setup' ? '1' : '✓'}
                </div>
                <span className="ml-2 text-sm font-medium">Scan QR Code</span>
              </div>
              <div className="w-16 h-0.5 bg-gray-300 mx-2"></div>
              <div className={`flex items-center ${step === 'verify' ? 'text-primary-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'verify' ? 'bg-primary-100' : 'bg-gray-100'}`}>
                  2
                </div>
                <span className="ml-2 text-sm font-medium">Verify Code</span>
              </div>
            </div>

            {/* Step 1: Generate QR Code */}
            {step === 'setup' && (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">Setup Authenticator App</h2>
                  <p className="text-gray-600 mt-2">Scan the QR code with your authenticator app</p>
                </div>

                {/* Google Authenticator Download */}
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-4">
                    <img
                      src="/googleAuthenticator.png"
                      alt="Google Authenticator"
                      className="w-12 h-12 rounded-lg"
                    />
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-gray-900 mb-1">Download Google Authenticator</h3>
                      <p className="text-xs text-gray-600 mb-3">Install on your mobile phone before continuing</p>
                      <div className="grid grid-cols-2 gap-2">
                        <a
                          href="https://apps.apple.com/us/app/google-authenticator/id388497605"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg transition-colors text-xs font-medium"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                          </svg>
                          iOS
                        </a>
                        <a
                          href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg transition-colors text-xs font-medium"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
                          </svg>
                          Android
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Instructions */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Setup Instructions:</h3>
                  <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                    <li>Download Google Authenticator on your mobile phone using the links above</li>
                    <li>Open the app and tap "Add account" or the "+" button</li>
                    <li>Click "Generate QR Code" below, then scan it with the app</li>
                    <li>Enter the 6-digit code from your app to verify</li>
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
                  onClick={generateTOTPSecret}
                  disabled={isLoading}
                  className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Generating QR Code...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      <span>Generate QR Code</span>
                    </>
                  )}
                </button>
              </>
            )}

            {/* Step 2: Verify Code */}
            {step === 'verify' && (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">Scan QR Code & Verify</h2>
                  <p className="text-gray-600 mt-2">Scan the QR code with your authenticator app, then enter the 6-digit code</p>
                </div>

                {/* QR Code Display */}
                {qrCodeUrl && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6 text-center">
                    <div className="flex flex-col items-center space-y-4">
                      <div className="bg-white p-4 rounded-lg shadow-sm">
                        <img 
                          src={qrCodeUrl} 
                          alt="MFA QR Code" 
                          className="w-48 h-48 mx-auto"
                        />
                      </div>
                      <div className="text-sm text-gray-600 max-w-sm">
                        <p className="font-medium mb-2">Can't scan the QR code?</p>
                        <div className="bg-gray-100 p-3 rounded font-mono text-xs break-all">
                          {mfaSecret}
                        </div>
                        <p className="text-xs mt-2">Enter this code manually in your authenticator app</p>
                      </div>
                    </div>
                  </div>
                )}

                {success && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2 mb-4">
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
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-center text-2xl keeping-widest font-mono"
                      placeholder="000000"
                      maxLength={6}
                      required
                      autoFocus
                    />
                    <p className="mt-2 text-sm text-gray-500">
                      Enter the 6-digit code from your authenticator app
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

                  <div className="text-center pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-500">
                      Having trouble? Make sure your authenticator app is synced and try entering the code again.
                    </p>
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
