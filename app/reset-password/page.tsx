'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validating, setValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);

  // Password strength indicators
  const [passwordStrength, setPasswordStrength] = useState({
    hasLength: false,
    hasUpper: false,
    hasLower: false,
    hasNumber: false,
    hasSpecial: false
  });

  useEffect(() => {
    // Check if there's a valid recovery token and exchange it for a session
    const checkToken = async () => {
      try {
        // First, check if we have URL parameters with token
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
        const type = hashParams.get('type') || searchParams.get('type');

        console.log('[RESET PASSWORD] URL params:', {
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          type
        });

        if (accessToken && type === 'recovery') {
          console.log('[RESET PASSWORD] Recovery token found, exchanging for session...');

          // Exchange the token for a session
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || ''
          });

          if (sessionError) {
            console.error('[RESET PASSWORD] Session exchange error:', sessionError);
            setError('Invalid or expired reset link. Please request a new one.');
            setIsValidToken(false);
          } else if (sessionData.session) {
            console.log('[RESET PASSWORD] ✅ Session created successfully');
            setIsValidToken(true);
          } else {
            console.error('[RESET PASSWORD] No session created');
            setError('Invalid or expired reset link. Please request a new one.');
            setIsValidToken(false);
          }
        } else {
          // Check if there's already an existing session
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error) {
            console.error('[RESET PASSWORD] Session error:', error);
            setError('Invalid or expired reset link. Please request a new one.');
            setIsValidToken(false);
          } else if (session) {
            console.log('[RESET PASSWORD] Existing valid session found');
            setIsValidToken(true);
          } else {
            console.log('[RESET PASSWORD] No valid token or session found');
            setError('Invalid or expired reset link. Please request a new one.');
            setIsValidToken(false);
          }
        }
      } catch (err) {
        console.error('[RESET PASSWORD] Token validation error:', err);
        setError('Failed to validate reset link.');
        setIsValidToken(false);
      } finally {
        setValidating(false);
      }
    };

    checkToken();
  }, [searchParams]);

  useEffect(() => {
    // Update password strength indicators
    setPasswordStrength({
      hasLength: password.length >= 8,
      hasUpper: /[A-Z]/.test(password),
      hasLower: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password)
    });
  }, [password]);

  const isPasswordValid = () => {
    return Object.values(passwordStrength).every(v => v === true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Please enter and confirm your new password');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!isPasswordValid()) {
      setError('Password does not meet security requirements');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[RESET PASSWORD] Updating password...');

      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      });

      if (updateError) {
        console.error('[RESET PASSWORD] Update error:', updateError);
        setError(updateError.message || 'Failed to reset password. Please try again.');
        setIsLoading(false);
        return;
      }

      console.log('[RESET PASSWORD] ✅ Password updated successfully');
      setSuccess(true);

      // Sign out to force fresh login with new password
      await supabase.auth.signOut();

      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push('/login');
      }, 2000);

    } catch (err: any) {
      console.error('[RESET PASSWORD] Unexpected error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Validating reset link...</p>
        </div>
      </div>
    );
  }

  if (!isValidToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Invalid Reset Link</h2>
              <p className="text-gray-600">{error}</p>
            </div>

            <div className="space-y-3">
              <Link href="/forgot-password" className="block">
                <button className="liquid-btn-primary w-full">
                  Request New Reset Link
                </button>
              </Link>
              <Link href="/login" className="block text-center">
                <button className="text-primary-600 hover:text-primary-700 font-medium">
                  Back to Login
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <Link href="/login" className="text-white hover:text-primary-100 transition-colors">
            ← Back to Login
          </Link>
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              Create New Password
            </h1>
            <p className="text-primary-100 text-lg">
              Choose a strong, unique password for your account
            </p>
          </div>
        </div>

        {/* Password Requirements */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Password Requirements</h2>
          <div className="space-y-3">
            {[
              'At least 8 characters long',
              'One uppercase letter (A-Z)',
              'One lowercase letter (a-z)',
              'One number (0-9)',
              'One special character (!@#$%^&*)'
            ].map((req, i) => (
              <div key={i} className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <p className="font-medium">{req}</p>
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

      {/* Right Side - Reset Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-6">
            <Link href="/login" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Login
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Reset Password</h2>
              <p className="text-gray-600 mt-2">Create a new password for your account</p>
            </div>

            {!success ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* New Password */}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all pr-12"
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {/* Password Strength Indicators */}
                {password && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-700 mb-2">Password Requirements:</p>
                    {[
                      { key: 'hasLength', label: 'At least 8 characters' },
                      { key: 'hasUpper', label: 'Uppercase letter' },
                      { key: 'hasLower', label: 'Lowercase letter' },
                      { key: 'hasNumber', label: 'Number' },
                      { key: 'hasSpecial', label: 'Special character' }
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        {passwordStrength[key as keyof typeof passwordStrength] ? (
                          <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                        )}
                        <span className={passwordStrength[key as keyof typeof passwordStrength] ? 'text-green-700' : 'text-gray-600'}>
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Confirm Password */}
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all pr-12"
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 text-sm text-red-900">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !isPasswordValid() || password !== confirmPassword}
                  className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Resetting...
                    </span>
                  ) : (
                    'Reset Password'
                  )}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6 text-center">
                  <svg className="w-16 h-16 text-green-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-green-900 mb-2">Password Reset Successfully!</h3>
                  <p className="text-sm text-green-800">Redirecting you to login...</p>
                </div>
              </div>
            )}
          </div>

          
        </div>
      </div>
    </div>
  );
}
