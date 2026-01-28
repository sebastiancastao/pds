'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ResetState = 'loading' | 'success' | 'error' | 'missing-token';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ResetState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const runLinkHandler = useCallback(async () => {
    setStatus('loading');
    setErrorMessage('');

    try {
      const { data, error } = await supabase.auth.getSessionFromUrl({ storeSession: true });

      if (error) {
        throw error;
      }

      if (!data?.session) {
        throw new Error('Unable to verify the reset link. Please request a new one.');
      }

      setStatus('success');

      setTimeout(() => {
        router.replace('/password');
      }, 1800);
    } catch (err: any) {
      console.error('[RESET-PASSWORD] Link processing failed:', err);
      setErrorMessage(err?.message || 'Unable to process the password reset link.');
      setStatus('error');
    }
  }, [router]);

  const containsToken = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return /access_token=/.test(hash + search) || /token=/.test(hash + search);
  }, []);

  useEffect(() => {
    if (!containsToken) {
      setStatus('missing-token');
      return;
    }

    runLinkHandler();
  }, [containsToken, runLinkHandler]);

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center">
              <svg className="animate-spin h-10 w-10 text-primary-600" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  strokeWidth="4"
                  stroke="currentColor"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            </div>
            <p className="text-lg font-semibold text-gray-900">Processing your password reset link...</p>
            <p className="text-sm text-gray-500">This may take a few seconds.</p>
          </div>
        );
      case 'success':
        return (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Link verified!</h1>
            <p className="text-sm text-gray-500">
              You're signed in temporarily. Redirecting you to the password form so you can choose a new password.
            </p>
            <p className="text-xs text-gray-400">
              If you are not redirected automatically,{' '}
              <Link href="/password" className="text-primary-600 hover:text-primary-700 font-semibold">
                click here
              </Link>
              .
            </p>
          </div>
        );
      case 'missing-token':
        return (
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Reset token not found</h1>
            <p className="text-sm text-gray-500">
              The password reset link is missing the required token parameters. Please request a new reset link from your
              email.
            </p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/forgot-password"
                className="px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                Request new link
              </Link>
              <Link
                href="/login"
                className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to login
              </Link>
            </div>
          </div>
        );
      case 'error':
        return (
          <div className="space-y-4 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Unable to process reset</h1>
            <p className="text-sm text-gray-500">{errorMessage}</p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={runLinkHandler}
                className="px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                Try again
              </button>
              <Link
                href="/forgot-password"
                className="px-6 py-3 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
              >
                Request new link
              </Link>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8">
        <div className="space-y-6">{renderContent()}</div>
      </div>
    </div>
  );
}
