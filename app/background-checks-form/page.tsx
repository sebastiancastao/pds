'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const PDFFormEditor = dynamic(() => import('@/app/components/PDFFormEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-sm text-gray-500">
      Loading PDF editor…
    </div>
  ),
});

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type FormDefinition = {
  id: 'background-waiver' | 'background-disclosure' | 'background-addon';
  title: string;
  description: string;
  endpoint: string;
  column: 'waiver_pdf_data' | 'disclosure_pdf_data' | 'addon_pdf_data';
  requiresSignature?: boolean;
};

const BACKGROUND_FORMS: FormDefinition[] = [
  {
    id: 'background-waiver',
    title: 'Background Waiver (Form 2)',
    description: 'Authority for background screening and employment history release.',
    endpoint: '/api/background-waiver',
    column: 'waiver_pdf_data',
    requiresSignature: true,
  },
  {
    id: 'background-disclosure',
    title: 'Disclosure & Authorization (Form 1)',
    description: 'Discloses the background check scope and authorizes the report.',
    endpoint: '/api/background-disclosure',
    column: 'disclosure_pdf_data',
    requiresSignature: true,
  },
  {
    id: 'background-addon',
    title: 'Background Check Add-On (Form 3)',
    description: 'Additional information requested by the background screening partner.',
    endpoint: '/api/background-addon',
    column: 'addon_pdf_data',
    requiresSignature: false,
  },
];

const formMap = BACKGROUND_FORMS.reduce<Record<string, FormDefinition>>((carry, form) => {
  carry[form.id] = form;
  return carry;
}, {} as Record<string, FormDefinition>);

const initialSaveStatus = BACKGROUND_FORMS.reduce<Record<string, SaveStatus>>((acc, form) => {
  acc[form.id] = 'idle';
  return acc;
}, {} as Record<string, SaveStatus>);

const initialSavedFlags = BACKGROUND_FORMS.reduce<Record<string, boolean>>((acc, form) => {
  acc[form.id] = false;
  return acc;
}, {} as Record<string, boolean>);

const bytesToBase64 = (bytes: Uint8Array) => {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(''));
};

export default function BackgroundChecksFormPage() {
  const router = useRouter();
  const [selectedFormId, setSelectedFormId] = useState<FormDefinition['id']>(BACKGROUND_FORMS[0].id);
  const selectedForm = useMemo(() => formMap[selectedFormId] ?? BACKGROUND_FORMS[0], [selectedFormId]);
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>(initialSaveStatus);
  const [hasFormData, setHasFormData] = useState<Record<string, boolean>>(initialSavedFlags);
  const [lastSavedAt, setLastSavedAt] = useState<Record<string, string | null>>(() => {
    const map: Record<string, string | null> = {};
    BACKGROUND_FORMS.forEach((form) => {
      map[form.id] = null;
    });
    return map;
  });
  const [recordUpdatedAt, setRecordUpdatedAt] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting'>('idle');

  const pendingSavesRef = useRef(new Map<string, Uint8Array>());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistForm = useCallback(async (formId: FormDefinition['id'], bytes: Uint8Array) => {
    setSaveError(null);
    setSaveStatus((prev) => ({ ...prev, [formId]: 'saving' }));
    try {
      const base64 = bytesToBase64(bytes);
      const payload: Record<string, string | null> = { signature: null, signatureType: null };
      if (formId === 'background-waiver') {
        payload.waiverPdfData = base64;
        payload.pdfData = base64;
      } else if (formId === 'background-disclosure') {
        payload.disclosurePdfData = base64;
      } else if (formId === 'background-addon') {
        payload.addonPdfData = base64;
      }

      const response = await fetch('/api/background-waiver/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let message = response.statusText || 'Unable to save form';
        try {
          const json = await response.json();
          message = json?.error || json?.message || message;
        } catch {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }

      setSaveStatus((prev) => ({ ...prev, [formId]: 'saved' }));
      setHasFormData((prev) => ({ ...prev, [formId]: true }));
      const timestamp = new Date().toISOString();
      setLastSavedAt((prev) => ({ ...prev, [formId]: timestamp }));
      setRecordUpdatedAt(timestamp);

      const formTitle = formMap[formId]?.title ?? 'Form';
      setGlobalMessage(`${formTitle} saved`);
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
      }
      messageTimerRef.current = setTimeout(() => setGlobalMessage(null), 4000);
    } catch (error: any) {
      console.error('[BACKGROUND CHECKS FORM] Save failed', formId, error);
      setSaveStatus((prev) => ({ ...prev, [formId]: 'error' }));
      setSaveError(error?.message || 'Unable to save this form. Please try again.');
      throw error;
    }
  }, []);

  const flushPendingSaves = useCallback(
    async (options?: { throwOnError?: boolean }) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      const entries = Array.from(pendingSavesRef.current.entries());
      pendingSavesRef.current.clear();
      for (const [formId, bytes] of entries) {
        try {
          await persistForm(formId as FormDefinition['id'], bytes);
        } catch (err) {
          if (options?.throwOnError) {
            throw err;
          }
          break;
        }
      }
    },
    [persistForm]
  );

  const handlePDFSave = useCallback(
    (formId: FormDefinition['id'], pdfBytes: Uint8Array) => {
      pendingSavesRef.current.set(formId, pdfBytes);
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        void flushPendingSaves();
      }, 1200);
    },
    [flushPendingSaves]
  );

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    setSubmitStatus('submitting');
    try {
      await flushPendingSaves({ throwOnError: true });

      const completeResponse = await fetch('/api/background-waiver/complete', {
        method: 'POST',
      });
      if (!completeResponse.ok) {
        const body = await completeResponse.text();
        throw new Error(body || 'Unable to submit background check.');
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        throw new Error('Unable to determine current user.');
      }

      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('is_temporary_password, must_change_password')
        .eq('id', userId)
        .single();
      if (userError || !userRow) {
        throw new Error('Unable to load user profile.');
      }

      const needsPasswordChange = Boolean(
        userRow.is_temporary_password || userRow.must_change_password
      );

      sessionStorage.removeItem('background_check_required');
      sessionStorage.removeItem('mfa_checkpoint');
      sessionStorage.removeItem('mfa_verified');

      if (needsPasswordChange) {
        sessionStorage.setItem('requires_password_change', 'true');
        router.replace('/password');
      } else {
        sessionStorage.removeItem('requires_password_change');
        router.replace('/verify-mfa');
      }
    } catch (error: any) {
      console.error('[BACKGROUND CHECKS FORM] Submission failed', error);
      setSubmitError(error?.message || 'Unable to submit background check. Please try again.');
    } finally {
      setSubmitStatus('idle');
    }
  }, [flushPendingSaves, router]);

  useEffect(() => {
    let active = true;
    const loadRecord = async () => {
      try {
        const response = await fetch('/api/background-waiver/save', { cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 404) {
            return;
          }
          const message = await response.text();
          throw new Error(message || 'Unable to load saved background check data.');
        }
        const payload = await response.json();
        if (!active) return;
        const record = payload?.data;
        if (!record) return;
        setRecordUpdatedAt(record.updated_at || record.created_at || null);
        setHasFormData((prev) => {
          const next = { ...prev };
          BACKGROUND_FORMS.forEach((form) => {
            next[form.id] = Boolean(record[form.column]);
          });
          return next;
        });
        setSaveStatus((prev) => {
          const next = { ...prev };
          BACKGROUND_FORMS.forEach((form) => {
            if (record[form.column]) {
              next[form.id] = 'saved';
            }
          });
          return next;
        });
        const updatedAt = record.updated_at || record.created_at;
        if (updatedAt) {
          setLastSavedAt((prev) => {
            const next = { ...prev };
            BACKGROUND_FORMS.forEach((form) => {
              if (record[form.column]) {
                next[form.id] = updatedAt;
              }
            });
            return next;
          });
        }
      } catch (error: any) {
        console.error('[BACKGROUND CHECKS FORM] Unable to load saved PDF', error);
        if (!active) return;
        setFetchError(error?.message || 'Unable to load saved background check data.');
      }
    };
    loadRecord();
    return () => {
      active = false;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (messageTimerRef.current) {
        clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  const pendingSaveInProgress =
    pendingSavesRef.current.size > 0 || Object.values(saveStatus).includes('saving');

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold text-gray-900">Complete your background check</h1>
            <p className="text-sm text-gray-600">
              Submit the vendor background check forms to continue the onboarding flow. Your changes
              are auto-saved, but make sure every form shows a saved status before you submit.
            </p>
            {recordUpdatedAt && (
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Last auto-save recorded {new Date(recordUpdatedAt).toLocaleString()}
              </p>
            )}
            {globalMessage && (
              <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-800">
                {globalMessage}
              </div>
            )}
            {saveError && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
                {saveError}
              </div>
            )}
            {fetchError && (
              <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-800">
                {fetchError}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-wrap gap-3 border-b border-gray-100 px-4 py-3">
            {BACKGROUND_FORMS.map((form) => {
              const selected = selectedFormId === form.id;
              const status = saveStatus[form.id];
              const statusText =
                status === 'saving'
                  ? 'Saving…'
                  : status === 'saved'
                    ? 'Saved'
                    : status === 'error'
                      ? 'Not saved'
                      : hasFormData[form.id]
                        ? 'Saved'
                        : 'Ready';
              return (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => setSelectedFormId(form.id)}
                  className={`rounded-full border px-4 py-1 text-sm font-medium transition ${
                    selected
                      ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div>{form.title}</div>
                  <div className="text-[11px] leading-4 text-gray-400">{statusText}</div>
                </button>
              );
            })}
          </div>

          <div className="lg:grid lg:grid-cols-[1fr,240px]">
            <div className="border-b border-gray-100 px-4 py-4 lg:border-r lg:border-b-0 lg:px-6 lg:py-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-gray-900">{selectedForm.title}</p>
                  <p className="text-xs text-gray-500">{selectedForm.description}</p>
                </div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500">
                  {saveStatus[selectedForm.id] === 'saving'
                    ? 'Saving…'
                    : lastSavedAt[selectedForm.id]
                      ? `Saved ${new Date(lastSavedAt[selectedForm.id]!).toLocaleString()}`
                      : 'Not saved yet'}
                </div>
              </div>
              <div className="h-[620px] overflow-hidden rounded-xl border border-gray-200 bg-white">
                <PDFFormEditor
                  key={`${selectedForm.id}-${selectedForm.endpoint}`}
                  pdfUrl={selectedForm.endpoint}
                  formId={selectedForm.id}
                  onSave={(bytes) => handlePDFSave(selectedForm.id, bytes)}
                  skipButtonDetection
                />
              </div>
            </div>

            <div className="space-y-3 px-4 py-6">
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-semibold text-gray-800">How to finish:</p>
                <ul className="mt-2 space-y-2">
                  <li>1. Fill each form using the embedded editor.</li>
                  <li>2. Wait for the <span className="font-semibold text-gray-900">Saved</span> badge.</li>
                  <li>3. Click “Submit background check” to notify HR and continue.</li>
                </ul>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-600 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
                <div className="mt-3 space-y-2 text-sm">
                  {BACKGROUND_FORMS.map((form) => (
                    <div key={form.id} className="flex items-center justify-between">
                      <span className="text-gray-700">{form.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          saveStatus[form.id] === 'saving'
                            ? 'bg-blue-50 text-blue-700'
                            : hasFormData[form.id] || saveStatus[form.id] === 'saved'
                              ? 'bg-green-50 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {saveStatus[form.id] === 'saving'
                          ? 'Saving…'
                          : hasFormData[form.id] || saveStatus[form.id] === 'saved'
                            ? 'Saved'
                            : 'Waiting'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-600 shadow-sm">
                <p className="font-semibold text-gray-700">Need help?</p>
                <p className="mt-1 text-xs text-gray-500">
                  Email us at <a className="font-semibold text-indigo-600" href="mailto:portal@1pds.net">portal@1pds.net</a>
                  <span className="text-gray-400"> for assistance.</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          {submitError && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
              {submitError}
            </div>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-600">
              After submission, you will be redirected to reset your password (if required) or
              continue with MFA verification.
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitStatus === 'submitting' || pendingSaveInProgress}
              className="inline-flex items-center justify-center rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitStatus === 'submitting' ? 'Submitting…' : 'Submit background check'}
            </button>
          </div>
          {pendingSaveInProgress && (
            <p className="mt-3 text-xs text-gray-500">Saving pending changes… please wait.</p>
          )}
        </div>
      </div>
    </div>
  );
}
