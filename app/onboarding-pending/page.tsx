'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface SignatureAuditEntry {
  formName: string;
  normalizedFormName: string;
  displayName: string;
  signatureType: string | null;
  sourceForm: string;
  hasData: boolean;
  isDrawing: boolean;
  isValid: boolean;
  hasRealDrawing: boolean;
  reason: string;
}

const SIGNATURE_AUDIT_HEADER = 'x-signature-audit';

export default function OnboardingPendingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  const [submissionDate, setSubmissionDate] = useState<string | null>(null);
  const [userFirstName, setUserFirstName] = useState<string>('');
  const [userLastName, setUserLastName] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [requestingEdit, setRequestingEdit] = useState(false);
  const [editRequestSent, setEditRequestSent] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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
      setUserId(user.id || '');

      // Fetch user profile data from profiles table
      const { data: userProfile, error: profileError } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('user_id', user.id)
        .single() as { data: { first_name: string | null; last_name: string | null } | null; error: any };

      console.log('[Onboarding Pending] Profile fetch result:', { userProfile, profileError });

      if (userProfile && userProfile.first_name) {
        setUserFirstName(userProfile.first_name);
        setUserLastName(userProfile.last_name || '');
      } else {
        // Fallback: use email prefix as name if profile not accessible or first_name is empty
        const emailPrefix = user.email?.split('@')[0] || 'User';
        setUserFirstName(emailPrefix);
        setUserLastName('');
        console.log('[Onboarding Pending] Using email prefix as fallback name:', emailPrefix);
      }

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
          // Onboarding has been approved! Redirect to Time Keeping 
          console.log('[Onboarding Pending] Onboarding approved, redirecting to Time Keeping ');
          router.replace('/time-keeping');
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

  const handleRequestEditPermission = async () => {
    console.log('[Onboarding Pending] Request edit permission clicked:', { userEmail, userFirstName, userLastName, userId });

    if (!userEmail || !userFirstName || !userId) {
      alert('Missing user information. Please refresh the page and try again.');
      return;
    }

    setRequestingEdit(true);

    try {
      const response = await fetch('/api/onboarding/request-edit-permission', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userEmail,
          userFirstName,
          userLastName,
          userId,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setEditRequestSent(true);
        alert('Your edit request has been sent successfully! The admin will review your request and grant you permission to edit your submission.');
      } else {
        alert(`Failed to send edit request: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error requesting edit permission:', error);
      alert('An error occurred while sending your request. Please try again.');
    } finally {
      setRequestingEdit(false);
    }
  };

  const downloadFromUrl = (url: string, filename: string) => {
    try {
      const anchor = document.createElement('a');
      anchor.style.display = 'none';
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);

      requestAnimationFrame(() => {
        anchor.click();
        setTimeout(() => {
          if (anchor.parentNode) {
            document.body.removeChild(anchor);
          }
          window.URL.revokeObjectURL(url);
        }, 100);
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    try {
      const nav: any = typeof window !== 'undefined' ? window.navigator : null;
      if (nav?.msSaveOrOpenBlob) {
        nav.msSaveOrOpenBlob(blob, filename);
        return;
      }

      const url = window.URL.createObjectURL(blob);
      downloadFromUrl(url, filename);
    } catch (error) {
      console.error('Error downloading blob:', error);
      alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };


  const sanitizeFilename = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

  const ensurePdfExtension = (value: string) => {
    const sanitized = sanitizeFilename(value);
    return sanitized.toLowerCase().endsWith('.pdf') ? sanitized : `${sanitized}.pdf`;
  };

  const buildOnboardingFilename = (userName: string) => {
    const normalized = userName.replace(/\s+/g, '_').trim();
    return ensurePdfExtension(`${normalized || 'onboarding'}_Onboarding_Documents`);
  };

  const extractFilenameFromContentDisposition = (header?: string | null) => {
    if (!header) {
      return null;
    }

    const segments = header
      .split(';')
      .map((segment) => segment.trim())
      .filter(Boolean);

    const parseValue = (segment: string) => {
      const index = segment.indexOf('=');
      if (index === -1) {
        return '';
      }
      return segment.substring(index + 1).trim();
    };

    const filenameStarSegment = segments.find((segment) =>
      segment.toLowerCase().startsWith('filename*=')
    );
    if (filenameStarSegment) {
      let value = parseValue(filenameStarSegment);
      if (/^UTF-8''/i.test(value)) {
        value = value.replace(/^UTF-8''/i, '');
      }
      value = value.replace(/^"(.*)"$/, '$1');
      try {
        value = decodeURIComponent(value);
      } catch {
        // ignore decoding errors
      }
      return value ? sanitizeFilename(value) : null;
    }

    const filenameSegment = segments.find((segment) =>
      segment.toLowerCase().startsWith('filename=')
    );
    if (filenameSegment) {
      let value = parseValue(filenameSegment);
      value = value.replace(/^"(.*)"$/, '$1');
      return value ? sanitizeFilename(value) : null;
    }

    return null;
  };

  const handleDownloadPdf = async () => {
    if (!userId) {
      alert('Unable to determine your account right now. Please refresh and try again.');
      return;
    }

    if (isDownloading) {
      alert('Another download is in progress. Please wait before starting a new one.');
      return;
    }

    setIsDownloading(true);

    const fallbackNameParts = [userFirstName, userLastName].filter(Boolean);
    const fallbackName = (fallbackNameParts.join(' ') || userEmail || 'onboarding_user').trim();
    const fallbackFilename = buildOnboardingFilename(fallbackName);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log('[PDF Download] Request timed out after 5 minutes');
        controller.abort();
      }, 300000); // 5 minutes

      const startTime = Date.now();
      const elapsedSeconds = () => ((Date.now() - startTime) / 1000).toFixed(2);

      const response = await fetch(`/api/pdf-form-progress/user/${userId}?signatureSource=forms_signature`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      const fetchTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[PDF Download] Response received in ${fetchTime}s, status:`, response.status);

      if (!response.ok) {
        const text = await response.text();
        let message = 'Failed to download onboarding documents';
        try {
          const parsed = JSON.parse(text);
          message = parsed.error || message;
        } catch {
          if (text) {
            message = text;
          }
        }
        throw new Error(message);
      }

      console.log('[PDF Download] Reading response data...');
      console.log('[PDF Download] Content-Type:', response.headers.get('Content-Type'));
      const contentLength = response.headers.get('Content-Length');
      console.log(
        '[PDF Download] Content-Length:',
        contentLength,
        contentLength ? `(${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB)` : ''
      );

      let blob: Blob;
      try {
        console.log('[PDF Download] Reading as ArrayBuffer...');
        const arrayBuffer = await response.arrayBuffer();
        console.log(
          '[PDF Download] ArrayBuffer size:',
          arrayBuffer.byteLength,
          'bytes',
          `(${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`
        );
        blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      } catch (dataError) {
        console.error('[PDF Download] Error reading response data:', dataError);
        throw new Error(
          `Failed to read PDF data: ${dataError instanceof Error ? dataError.message : 'Unknown error'}. The PDF might be too large for your browser to handle.`
        );
      }

      if (!blob || blob.size === 0) {
        throw new Error('Received empty PDF file');
      }

      console.log(
        '[PDF Download] PDF blob created, size:',
        blob.size,
        'bytes',
        `(${(blob.size / 1024 / 1024).toFixed(2)} MB)`
      );

      const auditHeaderValue =
        response.headers.get(SIGNATURE_AUDIT_HEADER) ||
        response.headers.get(SIGNATURE_AUDIT_HEADER.toUpperCase());
      if (auditHeaderValue) {
        try {
          const decodedAudit = atob(auditHeaderValue);
          const parsedAudit = JSON.parse(decodedAudit) as SignatureAuditEntry[];
          if (Array.isArray(parsedAudit)) {
            console.log('[PDF Download] Signature audit entries parsed:', parsedAudit.length);
          }
        } catch (auditError) {
          console.error('[PDF Download] Failed to decode signature audit header:', auditError);
        }
      }

      const contentDisposition =
        response.headers.get('Content-Disposition') ??
        response.headers.get('content-disposition');
      const headerFilename = extractFilenameFromContentDisposition(contentDisposition);
      let filename = ensurePdfExtension(headerFilename || fallbackFilename);

      if (contentDisposition) {
        console.log('[PDF Download] Content-Disposition:', contentDisposition);

        const filenameMatch =
          contentDisposition.match(/filename\s*=\s*"([^"]+)"/i) ||
          contentDisposition.match(/filename\s*=\s*([^;\s]+)/i);

        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].trim();
          console.log('[PDF Download] Extracted filename:', filename);
        }
      }

      if (!filename.toLowerCase().endsWith('.pdf')) {
        console.warn('[PDF Download] Filename missing .pdf extension, adding it:', filename);
        filename = `${filename}.pdf`;
      }

      downloadBlob(blob, filename);
      console.log(`[PDF_DOWNLOAD] Download completed in ${elapsedSeconds()}s`);
      alert('Your onboarding documents are downloading. This may take a few moments for large submissions.');
    } catch (err: any) {
      console.error('Error downloading PDF:', err);
      if (err?.name === 'AbortError') {
        alert('Download timed out after 5 minutes. Please try again or contact support if the issue persists.');
      } else {
        alert(`Failed to download onboarding documents: ${err?.message || 'Unknown error'}`);
      }
    } finally {
      setIsDownloading(false);
    }
  };

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
                Once approved, you can access the Time Keeping system
              </li>
            </ul>
          </div>

          {/* Edit Request Section */}
          {editRequestSent ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
              <div className="flex items-center">
                <svg className="w-6 h-6 text-green-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-green-900">Edit Request Sent</h3>
                  <p className="text-sm text-green-700 mt-1">
                    Your request has been sent to the admin. You will be notified when permission is granted.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-6 mb-6">
              <h3 className="text-sm font-semibold text-purple-900 mb-2">
                Need to make changes?
              </h3>
              <p className="text-sm text-purple-700 mb-4">
                If you need to edit your submission, you can request permission from the admin.
              </p>
              <button
                onClick={handleRequestEditPermission}
                disabled={requestingEdit}
                className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
              >
                {requestingEdit ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Sending Request...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Request Editing Permission
                  </>
                )}
              </button>
            </div>
          )}

          <div className="mb-6">
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="w-full bg-white border border-gray-200 text-gray-900 hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg py-3 px-4 transition duration-150 flex items-center justify-center gap-2"
            >
              {isDownloading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  Preparing download...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download my onboarding documents
                </>
              )}
            </button>
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
              <a href="mailto:portal@1pds.net" className="text-blue-600 hover:text-blue-700 font-medium">
                portal@1pds.net
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
