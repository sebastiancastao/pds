'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { validatePassword } from '@/lib/auth';

type RecoveryState = 'loading' | 'ready' | 'success' | 'error' | 'missing-token';

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  code?: string;
};

const parsePayload = (hash: string, search: string): TokenPayload => {
  const raw = [hash, search].filter(Boolean).join('&');
  const params = new URLSearchParams(raw);

  return {
    access_token: params.get('access_token') || undefined,
    refresh_token: params.get('refresh_token') || undefined,
    code: params.get('code') || undefined,
  };
};

export default function RecoverPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<RecoveryState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<ReturnType<typeof validatePassword> | null>(null);

  const [tokenString, setTokenString] = useState('');
  const [tokensReady, setTokensReady] = useState(false);

  const payload = useMemo(() => {
    const hash = tokenString.startsWith('#') ? tokenString.slice(1) : tokenString;
    return parsePayload(hash, '');
  }, [tokenString]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const search = window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search;
    setTokenString([hash, search].filter(Boolean).join('&'));
    setTokensReady(true);
  }, []);

  const establishSession = useCallback(async () => {
    setStatus('loading');
    setErrorMessage('');

    try {
      // Support both PKCE (`code`) and implicit (`access_token`) recovery links.
      if (payload.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(payload.code);
        if (error) throw error;
      } else if (payload.access_token) {
        const { error } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token ?? payload.access_token,
        });
        if (error) throw error;
      } else {
        // If tokens are missing (e.g. user refreshed after we cleaned the URL),
        // fall back to an existing persisted session.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setStatus('missing-token');
          return;
        }
      }

      // Clear any stale MFA flags from previous sessions; this page must be reachable.
      sessionStorage.removeItem('mfa_checkpoint');
      sessionStorage.removeItem('mfa_verified');

      setStatus('ready');

      // Remove token params from URL (prevents accidental reuse on refresh).
      router.replace('/recover-password');
    } catch (err: any) {
      console.error('[RECOVER-PASSWORD] Failed to establish session:', err);
      setErrorMessage(err?.message || 'Unable to validate the password reset link. Please request a new link.');
      setStatus('error');
    }
  }, [payload.access_token, payload.code, payload.refresh_token, router]);

  useEffect(() => {
    if (!tokensReady) return;
    establishSession();
  }, [tokensReady, establishSession]);

  const handleNewPasswordChange = (value: string) => {
    setNewPassword(value);
    setErrorMessage('');
    if (value.length === 0) setPasswordStrength(null);
    else setPasswordStrength(validatePassword(value));
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!newPassword || !confirmPassword) {
      setErrorMessage('Please fill in all fields.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    const validation = validatePassword(newPassword);
    setPasswordStrength(validation);
    if (!validation.isValid) {
      setErrorMessage('Password does not meet security requirements.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error('Session missing. Please request a new password reset link.');
      }

      // 1) Update password in Supabase Auth using the recovery session.
      const { error: updateAuthError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateAuthError) throw updateAuthError;

      // 2) Update DB flags / audit server-side (non-auth concerns).
      const res = await fetch('/api/auth/recover-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) {
        console.warn('[RECOVER-PASSWORD] DB flag update failed (non-fatal):', data?.error);
      }

      setStatus('success');

      // Sign out to force a clean login with the new password (and MFA as applicable).
      try {
        await supabase.auth.signOut();
      } finally {
        setTimeout(() => router.replace('/login'), 1500);
      }
    } catch (err: any) {
      console.error('[RECOVER-PASSWORD] Password update failed:', err);
      setErrorMessage(err?.message || 'Unable to update password. Please request a new reset link and try again.');
      setStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 text-center space-y-4">
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-10 w-10 text-primary-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4" stroke="currentColor" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-gray-900">Validating your reset link...</p>
          <p className="text-sm text-gray-500">This may take a few seconds.</p>
        </div>
      </div>
    );
  }

  if (status === 'missing-token') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Reset token not found</h1>
          <p className="text-sm text-gray-500">
            This password reset link is missing required parameters. Please request a new reset link.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/forgot-password" className="px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors">
              Request new link
            </Link>
            <Link href="/login" className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Password updated</h1>
          <p className="text-sm text-gray-500">Redirecting you to login...</p>
          <Link href="/login" className="text-primary-600 hover:text-primary-700 font-semibold">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  // status: ready or error -> show form (error shows banner)
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
          <p className="text-sm text-gray-500 mt-2">Choose a strong password to secure your account.</p>
        </div>

        {errorMessage && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-900">
            {errorMessage}
          </div>
        )}

        <form onSubmit={submitNewPassword} className="space-y-5">
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
              New Password
            </label>
            <div className="relative">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => handleNewPasswordChange(e.target.value)}
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder="Enter a new password"
                required
                disabled={isSaving}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showNewPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            {passwordStrength && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        passwordStrength.strength === 'very-strong' ? 'bg-green-600 w-full' :
                        passwordStrength.strength === 'strong' ? 'bg-green-500 w-3/4' :
                        passwordStrength.strength === 'medium' ? 'bg-yellow-500 w-1/2' :
                        'bg-red-500 w-1/4'
                      }`}
                    />
                  </div>
                  <span className={`text-xs font-medium ${
                    passwordStrength.strength === 'very-strong' ? 'text-green-600' :
                    passwordStrength.strength === 'strong' ? 'text-green-500' :
                    passwordStrength.strength === 'medium' ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {passwordStrength.strength.toUpperCase().replace('-', ' ')}
                  </span>
                </div>
                {passwordStrength.errors.length > 0 && (
                  <ul className="text-xs text-red-600 space-y-1 mt-2">
                    {passwordStrength.errors.map((err, idx) => (
                      <li key={idx} className="flex items-start gap-1">
                        <span>*</span>
                        <span>{err}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setErrorMessage('');
                }}
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                placeholder="Confirm your new password"
                required
                disabled={isSaving}
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

          <button
            type="submit"
            disabled={isSaving || (passwordStrength !== null && !passwordStrength.isValid)}
            className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Updating...' : 'Update Password'}
          </button>

          <div className="text-center">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-700">
              Back to login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
