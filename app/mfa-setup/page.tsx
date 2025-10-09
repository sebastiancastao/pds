'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { verifyMFAToken } from '@/lib/auth';
import { AuthGuard } from '@/lib/auth-guard';

export default function MFASetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<'setup' | 'verify' | 'backup-codes' | 'success'>('setup');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(false);

  useEffect(() => {
    checkAuthAndMFA();
  }, []);

  const checkAuthAndMFA = async () => {
    console.log('[DEBUG] MFA Setup - Initializing MFA setup...');
    
    // AuthGuard handles authentication check, so we just get the user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('[DEBUG] MFA Setup - No user (AuthGuard should have caught this)');
      return;
    }

    setUserEmail(user.email || '');

    // Check if MFA secret already exists (user already scanned QR)
    console.log('[DEBUG] MFA Setup - Checking if MFA secret exists...');
    console.log('[DEBUG] MFA Setup - User ID:', user.id);
    
    // Use .limit(1) instead of .single() to handle duplicate profiles gracefully
    const { data: profileDataArray, error: profileError } = await (supabase
      .from('profiles')
      .select('mfa_enabled, mfa_secret')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1) as any);
    
    const profileData = profileDataArray?.[0] || null;

    console.log('[DEBUG] MFA Setup - Profile check:', {
      profileData,
      mfaEnabled: profileData?.mfa_enabled,
      hasMfaSecret: !!profileData?.mfa_secret,
      error: profileError?.message,
      rowCount: profileDataArray?.length || 0
    });

    // If user has mfa_secret, they've already scanned QR - redirect to verify
    if (profileData?.mfa_secret) {
      console.log('[DEBUG] MFA Setup - ✅ MFA SECRET EXISTS, redirecting to /verify-mfa');
      console.log('[DEBUG] MFA Setup - User already scanned QR code, should verify instead');
      router.push('/verify-mfa');
    } else {
      console.log('[DEBUG] MFA Setup - ❌ NO MFA SECRET - Generating new secret');
      console.log('[DEBUG] MFA Setup - User needs to scan QR code');
      // Generate MFA secret for first-time setup
      generateMFASecret();
    }
  };

  const generateMFASecret = async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Session expired. Please log in again.');
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
        setError(data.error || 'Failed to generate MFA setup. Please try again.');
        return;
      }

      setQrCodeUrl(data.qrCodeUrl);
      setSecret(data.secret);
    } catch (err: any) {
      console.error('MFA setup error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
          secret: secret
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Invalid verification code. Please try again.');
        setIsLoading(false);
        return;
      }

      // Success! Show backup codes
      setBackupCodes(data.backupCodes);
      setStep('backup-codes');
    } catch (err: any) {
      console.error('Verification error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const handleDownloadBackupCodes = () => {
    const text = `PDS Time Tracking - MFA Backup Codes
Generated: ${new Date().toLocaleString()}
Email: ${userEmail}

IMPORTANT: Store these codes in a secure location.
Each code can only be used once.

${backupCodes.map((code, idx) => `${idx + 1}. ${code}`).join('\n')}

Keep these codes safe and secure!
`;
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pds-backup-codes-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyBackupCodes = () => {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text);
    alert('Backup codes copied to clipboard!');
  };

  const handleComplete = () => {
    setStep('success');
    setTimeout(() => {
      router.push('/register');
    }, 2000);
  };

  if (isLoading && !qrCodeUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Setting up MFA...</p>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-8">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">MFA Setup Complete!</h2>
          <p className="text-gray-600 mb-6">
            Your account is now secured with multi-factor authentication. Redirecting to complete your profile...
          </p>
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
          <h2 className="text-white font-semibold text-xl mb-6">Why MFA?</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Enhanced Security</p>
                <p className="text-sm text-primary-100">Even if someone has your password, they can't access your account</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Compliance Required</p>
                <p className="text-sm text-primary-100">SOC2 and enterprise security standards mandate MFA</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Easy to Use</p>
                <p className="text-sm text-primary-100">Quick setup with any authenticator app</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Backup Codes</p>
                <p className="text-sm text-primary-100">Never get locked out with emergency backup codes</p>
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
                <span className="ml-2 text-sm font-medium">Scan QR</span>
              </div>
              <div className="w-12 h-0.5 bg-gray-300 mx-2"></div>
              <div className={`flex items-center ${step === 'verify' ? 'text-primary-600' : ['backup-codes', 'success'].includes(step) ? 'text-green-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'verify' ? 'bg-primary-100' : ['backup-codes', 'success'].includes(step) ? 'bg-green-100' : 'bg-gray-100'}`}>
                  {['backup-codes', 'success'].includes(step) ? '✓' : '2'}
                </div>
                <span className="ml-2 text-sm font-medium">Verify</span>
              </div>
              <div className="w-12 h-0.5 bg-gray-300 mx-2"></div>
              <div className={`flex items-center ${['backup-codes', 'success'].includes(step) ? 'text-primary-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${['backup-codes', 'success'].includes(step) ? 'bg-primary-100' : 'bg-gray-100'}`}>
                  3
                </div>
                <span className="ml-2 text-sm font-medium">Backup</span>
              </div>
            </div>

            {/* Step 1: Scan QR Code */}
            {step === 'setup' && (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">Scan QR Code</h2>
                  <p className="text-gray-600 mt-2">Use your authenticator app to scan this code</p>
                </div>

                {/* QR Code Display */}
                {qrCodeUrl && (
                  <div className="bg-white border-2 border-gray-200 rounded-lg p-6 mb-6">
                    <img src={qrCodeUrl} alt="MFA QR Code" className="w-full max-w-xs mx-auto" />
                  </div>
                )}

                {/* Manual Entry */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-gray-600 mb-2 font-medium">Can't scan? Enter this code manually:</p>
                  <code className="block bg-white border border-gray-300 rounded px-3 py-2 text-sm font-mono break-all">
                    {secret}
                  </code>
                </div>

                {/* Supported Apps */}
                <div className="mb-6">
                  <p className="text-sm text-gray-600 mb-2">Supported authenticator apps:</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">Google Authenticator</span>
                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">Microsoft Authenticator</span>
                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">Authy</span>
                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">1Password</span>
                  </div>
                </div>

                <button
                  onClick={() => setStep('verify')}
                  className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors"
                >
                  Continue to Verification
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
                  <h2 className="text-2xl font-bold text-gray-900">Verify Setup</h2>
                  <p className="text-gray-600 mt-2">Enter the 6-digit code from your authenticator app</p>
                </div>

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
                    className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Verifying...' : 'Verify and Continue'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep('setup')}
                    className="w-full text-gray-600 hover:text-gray-800 py-2 text-sm"
                  >
                    ← Back to QR Code
                  </button>
                </form>
              </>
            )}

            {/* Step 3: Backup Codes */}
            {step === 'backup-codes' && (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">Save Backup Codes</h2>
                  <p className="text-gray-600 mt-2">Store these codes in a safe place</p>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex gap-2">
                    <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium">Important!</p>
                      <p>Each code can only be used once. Save them in a secure location.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-300 rounded-lg p-4 mb-6">
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, idx) => (
                      <div key={idx} className="bg-white border border-gray-200 rounded px-3 py-2">
                        <code className="text-sm font-mono">{code}</code>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 mb-6">
                  <button
                    onClick={handleDownloadBackupCodes}
                    className="flex-1 bg-white border-2 border-primary-600 text-primary-600 py-3 px-4 rounded-lg font-semibold hover:bg-primary-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </button>
                  <button
                    onClick={handleCopyBackupCodes}
                    className="flex-1 bg-white border-2 border-primary-600 text-primary-600 py-3 px-4 rounded-lg font-semibold hover:bg-primary-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                </div>

                <button
                  onClick={handleComplete}
                  className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors"
                >
                  Complete Setup
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
    </AuthGuard>
  );
}

