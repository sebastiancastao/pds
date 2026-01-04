'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function OnboardingPendingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  const [submissionDate, setSubmissionDate] = useState<string | null>(null);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/login');
        return;
      }

      setUserEmail(user.email || '');

      // Check onboarding status via API (bypasses RLS)
      const { data: { session } } = await supabase.auth.getSession();

      const onboardingResponse = await fetch('/api/auth/check-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
      });

      if (onboardingResponse.ok) {
        const onboardingResult = await onboardingResponse.json();

        // Set submission date from API response
        if (onboardingResult.pdfSubmittedAt) {
          setSubmissionDate(onboardingResult.pdfSubmittedAt);
        }

        if (onboardingResult.approved) {
          // Onboarding has been approved! Redirect to time tracking
          console.log('[Onboarding Pending] Onboarding approved, redirecting to time tracking');
          router.replace('/time-tracking');
          return;
        }

        if (!onboardingResult.hasSubmittedPDF) {
          // No submission means they haven't submitted yet
          // Redirect them to the onboarding form
          router.replace('/payroll-packet-ca/employee-information');
          return;
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('[Onboarding Pending] Error checking status:', error);
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleCheckAgain = () => {
    setLoading(true);
    checkOnboardingStatus();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking onboarding status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-gray-900 text-center mb-4">
            Onboarding Pending Approval
          </h1>

          {/* Message */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 mb-6">
            <p className="text-gray-700 text-center leading-relaxed">
              Thank you for submitting your onboarding documents! Your submission is currently under review by our HR team.
            </p>
          </div>

          {/* Status Details */}
          <div className="space-y-4 mb-8">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-600">Email</span>
              <span className="text-sm text-gray-900">{userEmail}</span>
            </div>

            {submissionDate && (
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-gray-600">Submitted On</span>
                <span className="text-sm text-gray-900">
                  {new Date(submissionDate).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                  })}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium text-gray-600">Status</span>
              <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">
                Pending Review
              </span>
            </div>
          </div>

          {/* Information */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              What happens next?
            </h2>
            <ul className="space-y-2 text-sm text-blue-900">
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Our HR team will review your onboarding documents
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                You will receive an email notification once your onboarding is approved
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Once approved, you can access the time tracking system
              </li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleCheckAgain}
              className="flex-1 apple-button apple-button-primary flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Check Status Again
            </button>

            <button
              onClick={handleSignOut}
              className="flex-1 apple-button apple-button-secondary flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>

          {/* Contact Info */}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-600">
              Questions? Contact HR at{' '}
              <a href="mailto:hr@pds.com" className="text-blue-600 hover:text-blue-700 font-medium">
                portal@1pds.com
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
