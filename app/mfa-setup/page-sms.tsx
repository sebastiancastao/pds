// This is the NEW SMS-based MFA setup page
// Replace the content of app/mfa-setup/page.tsx with this

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';

export default function MFASetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'verify' | 'backup-codes' | 'success'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    checkAuthAndMFA();
  }, []);

  const checkAuthAndMFA = async () => {
    console.log('[DEBUG] SMS MFA Setup - Initializing...');
    
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      console.log('[DEBUG] SMS MFA Setup - No user');
      return;
    }

    setUserEmail(user.email || '');

    // Check if MFA is already enabled
    const { data: profileDataArray } = await (supabase
      .from('profiles')
      .select('mfa_enabled, mfa_secret')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1) as any);
    
    const profileData = profileDataArray?.[0] || null;

    if (profileData?.mfa_enabled === true) {
      console.log('[DEBUG] SMS MFA Setup - MFA already enabled, redirecting to home');
      router.push('/');
    }
  };

  const formatPhoneNumberDisplay = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 6) return `(${numbers.slice(0, 3)}) ${numbers.slice(3)}`;
    return `(${numbers.slice(0, 3)}) ${numbers.slice(3, 6)}-${numbers.slice(6, 10)}`;
  };

  const handlePhoneChange = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 10);
    setPhoneNumber(numbers);
    setError('');
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (phoneNumber.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
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

      const response = await fetch('/api/auth/mfa/setup-sms', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          action: 'send_code',
          phoneNumber,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Failed to send verification code. Please try again.');
        setIsLoading(false);
        return;
      }

      setCodeSent(true);
      setStep('verify');
      setIsLoading(false);
    } catch (err: any) {
      console.error('Send code error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (verificationCode.length !== 6) {
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

      const response = await fetch('/api/auth/mfa/setup-sms', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          action: 'verify_code',
          code: verificationCode,
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

  const handleResendCode = async () => {
    setError('');
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError('Session expired. Please log in again.');
        setIsLoading(false);
        return;
      }

      const response = await fetch('/api/auth/mfa/setup-sms', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          action: 'send_code',
          phoneNumber,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error || 'Failed to resend code.');
        setIsLoading(false);
        return;
      }

      setError('');
      setIsLoading(false);
      // Show success message briefly
      const successDiv = document.getElementById('resend-success');
      if (successDiv) {
        successDiv.classList.remove('hidden');
        setTimeout(() => {
          successDiv.classList.add('hidden');
        }, 3000);
      }
    } catch (err: any) {
      console.error('Resend code error:', err);
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
            Your phone number is now verified. Redirecting to complete your profile...
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
              Add your phone number for secure SMS verification
            </p>
          </div>
        </div>

        {/* SMS MFA Benefits */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Why SMS Verification?</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Simple & Convenient</p>
                <p className="text-sm text-primary-100">No extra apps needed - just your phone</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Instant Delivery</p>
                <p className="text-sm text-primary-100">Receive codes instantly via text message</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Compliance Required</p>
                <p className="text-sm text-primary-100">SOC2 and enterprise security standards</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Backup Codes</p>
                <p className="text-sm text-primary-100">Emergency access with backup codes</p>
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

      {/* Right Side - SMS MFA Setup */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Step Indicator */}
            <div className="flex items-center justify-center mb-8">
              <div className={`flex items-center ${step === 'phone' ? 'text-primary-600' : 'text-green-600'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'phone' ? 'bg-primary-100' : 'bg-green-100'}`}>
                  {step === 'phone' ? '1' : '✓'}
                </div>
                <span className="ml-2 text-sm font-medium">Phone</span>
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

            {/* Step 1: Enter Phone Number */}
            {step === 'phone' && (
              <>
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-900">Add Phone Number</h2>
                  <p className="text-gray-600 mt-2">We'll send you a verification code via SMS</p>
                </div>

                <form onSubmit={handleSendCode} className="space-y-5">
                  <div>
                    <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      id="phoneNumber"
                      value={formatPhoneNumberDisplay(phoneNumber)}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-lg"
                      placeholder="(555) 123-4567"
                      required
                      autoFocus
                    />
                    <p className="mt-2 text-sm text-gray-500">
                      Enter your 10-digit US phone number
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
                    disabled={isLoading || phoneNumber.length !== 10}
                    className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Sending Code...' : 'Send Verification Code'}
                  </button>
                </form>
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
                  <h2 className="text-2xl font-bold text-gray-900">Enter Verification Code</h2>
                  <p className="text-gray-600 mt-2">
                    We sent a code to {formatPhoneNumberDisplay(phoneNumber)}
                  </p>
                </div>

                <div id="resend-success" className="hidden bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-green-800 text-center">Code resent successfully!</p>
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
                    <p className="mt-2 text-sm text-gray-500 text-center">
                      Code expires in 10 minutes
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
                    className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Verifying...' : 'Verify Code'}
                  </button>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setStep('phone')}
                      className="text-sm text-gray-600 hover:text-gray-800"
                    >
                      ← Change Phone Number
                    </button>
                    <button
                      type="button"
                      onClick={handleResendCode}
                      disabled={isLoading}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium disabled:opacity-50"
                    >
                      Resend Code
                    </button>
                  </div>
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
                  <p className="text-gray-600 mt-2">Use these if you can't access your phone</p>
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

