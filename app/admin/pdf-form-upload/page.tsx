'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { PDF_FORM_SELECT_OPTIONS } from '@/lib/pdf-forms';

const AdminPDFEditor = dynamicImport(() => import('@/app/components/AdminPDFEditor'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-4 border-transparent border-t-ios-blue"></div><span className="ml-3">Loading PDF editor...</span></div>
});

const ALLOWED_ROLES = new Set(['exec', 'admin']);
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const DEFAULT_VIEWER_HEIGHT = 520;
const EDITOR_HEIGHT = 700;

const FORM_VIEWER_PATHS: Record<string, string> = {
  'ca-de4': '/payroll-packet-ca/form-viewer?form=fillable',
  'fw4': '/payroll-packet-ca/form-viewer?form=fw4',
  'i9': '/payroll-packet-ca/form-viewer?form=i9',
  'adp-deposit': '/payroll-packet-ca/form-viewer?form=adp-deposit',
  'ui-guide': '/payroll-packet-ca/form-viewer?form=ui-guide',
  'disability-insurance': '/payroll-packet-ca/form-viewer?form=disability-insurance',
  'paid-family-leave': '/payroll-packet-ca/form-viewer?form=paid-family-leave',
  'sexual-harassment': '/payroll-packet-ca/form-viewer?form=sexual-harassment',
  'survivors-rights': '/payroll-packet-ca/form-viewer?form=survivors-rights',
  'transgender-rights': '/payroll-packet-ca/form-viewer?form=transgender-rights',
  'health-insurance': '/payroll-packet-ca/form-viewer?form=health-insurance',
  'time-of-hire': '/payroll-packet-ca/form-viewer?form=time-of-hire',
  'discrimination-law': '/payroll-packet-ca/form-viewer?form=discrimination-law',
  'immigration-rights': '/payroll-packet-ca/form-viewer?form=immigration-rights',
  'military-rights': '/payroll-packet-ca/form-viewer?form=military-rights',
  'lgbtq-rights': '/payroll-packet-ca/form-viewer?form=lgbtq-rights',
  'notice-to-employee': '/payroll-packet-ca/form-viewer?form=notice-to-employee',
  'meal-waiver-6hour': '/payroll-packet-ca/form-viewer?form=meal-waiver-6hour',
  'meal-waiver-10-12': '/payroll-packet-ca/form-viewer?form=meal-waiver-10-12',
  'employee-information': '/payroll-packet-ca/form-viewer?form=employee-information',
  'state-tax': '/payroll-packet-ca/form-viewer?form=state-tax',
  'employee-handbook': '/payroll-packet-ca/form-viewer?form=employee-handbook',
  'ny-state-tax': '/payroll-packet-ny/form-viewer?form=state-tax',
  'wi-state-tax': '/payroll-packet-wi/form-viewer?form=state-tax',
  'az-state-tax': '/payroll-packet-az/form-viewer?form=state-tax',
};

// API endpoints for fetching clean/blank form templates
const CLEAN_FORM_API_PATHS: Record<string, string> = {
  'ca-de4': '/api/payroll-packet-ca/fillable',
  'fw4': '/api/payroll-packet-ca/fw4',
  'i9': '/api/payroll-packet-ca/i9',
  'adp-deposit': '/api/payroll-packet-ca/adp-deposit',
  'ui-guide': '/api/payroll-packet-ca/ui-guide',
  'disability-insurance': '/api/payroll-packet-ca/disability-insurance',
  'paid-family-leave': '/api/payroll-packet-ca/paid-family-leave',
  'sexual-harassment': '/api/payroll-packet-ca/sexual-harassment',
  'survivors-rights': '/api/payroll-packet-ca/survivors-rights',
  'transgender-rights': '/api/payroll-packet-ca/transgender-rights',
  'health-insurance': '/api/payroll-packet-ca/health-insurance',
  'time-of-hire': '/api/payroll-packet-ca/time-of-hire',
  'discrimination-law': '/api/payroll-packet-ca/discrimination-law',
  'immigration-rights': '/api/payroll-packet-ca/immigration-rights',
  'military-rights': '/api/payroll-packet-ca/military-rights',
  'lgbtq-rights': '/api/payroll-packet-ca/lgbtq-rights',
  'notice-to-employee': '/api/payroll-packet-ca/notice-to-employee',
  'meal-waiver-6hour': '/api/payroll-packet-ca/meal-waiver-6hour',
  'meal-waiver-10-12': '/api/payroll-packet-ca/meal-waiver-10-12',
  'employee-information': '/api/payroll-packet-ca/employee-information',
  'state-tax': '/api/payroll-packet-ca/state-tax',
  'employee-handbook': '/api/payroll-packet-ca/employee-handbook',
  'ny-state-tax': '/api/payroll-packet-ny/state-tax',
  'wi-state-tax': '/api/payroll-packet-wi/state-tax',
  'az-state-tax': '/api/payroll-packet-az/state-tax',
};

type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
};

type Notification = {
  type: 'success' | 'error' | 'info';
  message: string;
};

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string | null;
      if (!result) {
        reject(new Error('Unable to read file'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const estimateBytesFromBase64 = (base64: string): number => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.ceil((base64.length * 3) / 4) - padding);
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const base64ToBlob = (base64: string, mime = 'application/pdf') => {
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    buffer[i] = binary.charCodeAt(i);
  }
  return new Blob([buffer], { type: mime });
};

export default function PdfFormUploadPage() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedFormName, setSelectedFormName] = useState(PDF_FORM_SELECT_OPTIONS[0]?.value || '');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [previousTimestamp, setPreviousTimestamp] = useState<string | null>(null);
  const [storedForm, setStoredForm] = useState<
    | { found: false }
    | { found: true; formData: string; updatedAt?: string | null }
    | null
  >(null);
  const [fetchingStoredForm, setFetchingStoredForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loadingCleanForm, setLoadingCleanForm] = useState(false);
  const [cleanFormBase64, setCleanFormBase64] = useState<string | null>(null);
  const [isEditingCleanForm, setIsEditingCleanForm] = useState(false);
  const editedPdfBytesRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    let active = true;

    const loadUsers = async (accessToken?: string) => {
      if (!accessToken) return;
      setLoadingUsers(true);
      try {
        const res = await fetch('/api/users/all', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Unable to load users');
        }

        const data = await res.json();
        const fetchedUsers: UserRow[] = Array.isArray(data.users) ? data.users : [];
        if (!active) return;
        setUsers(fetchedUsers);
        if (!selectedUserId && fetchedUsers.length > 0) {
          setSelectedUserId(fetchedUsers[0].id);
        }
      } catch (error: any) {
        console.error('[PDF-UPLOAD] Failed to load users', error);
        if (active) {
          setAuthError(error?.message || 'Could not load users');
        }
      } finally {
        if (active) setLoadingUsers(false);
      }
    };

    const checkAuth = async () => {
      setCheckingAuth(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

        const { data: userRecord, error } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();

        if (error || !userRecord || !ALLOWED_ROLES.has(userRecord.role)) {
          setAuthError('Admin or Exec access required for this page.');
          return;
        }

        if (active) {
          setAuthorized(true);
          setSession(session);
        }

        await loadUsers(session.access_token);
      } catch (error) {
        console.error('[PDF-UPLOAD] Auth check failed', error);
        if (active) {
          setAuthError('Unable to verify session.');
        }
      } finally {
        if (active) setCheckingAuth(false);
      }
    };

    checkAuth();

    return () => {
      active = false;
    };
  }, [router]);

  const fetchStoredForm = useCallback(async () => {
    if (!session?.access_token || !selectedUserId || !selectedFormName) {
      setStoredForm(null);
      setFetchingStoredForm(false);
      return;
    }

    setFetchingStoredForm(true);
    setStoredForm(null);

    try {
      const params = new URLSearchParams({
        userId: selectedUserId,
        formName: selectedFormName,
      });

      const response = await fetch(`/api/pdf-form-progress/admin-fetch?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok) {
        if (payload?.found) {
          setStoredForm({
            found: true,
            formData: payload.formData,
            updatedAt: payload.updatedAt,
          });
        } else {
          setStoredForm({ found: false });
        }
      } else {
        console.error('[PDF-UPLOAD] Stored form fetch failed', payload);
        setStoredForm({ found: false });
      }
    } catch (error: any) {
      console.error('[PDF-UPLOAD] Stored form fetch error', error);
      setStoredForm({ found: false });
    } finally {
      setFetchingStoredForm(false);
    }
  }, [selectedFormName, selectedUserId, session?.access_token]);

  useEffect(() => {
    setPreviousTimestamp(null);
  }, [selectedUserId, selectedFormName]);

  useEffect(() => {
    fetchStoredForm();
  }, [fetchStoredForm]);

  const selectedUser = users.find((user) => user.id === selectedUserId);
  const viewerPath = FORM_VIEWER_PATHS[selectedFormName];

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] || null;
    if (!selected) {
      setFile(null);
      return;
    }

    if (selected.type !== 'application/pdf') {
      setNotification({ type: 'error', message: 'Only PDF files are allowed.' });
      event.target.value = '';
      setFile(null);
      return;
    }

    if (selected.size > MAX_FILE_SIZE) {
      setNotification({ type: 'error', message: 'Please choose a file smaller than 12 MB.' });
      event.target.value = '';
      setFile(null);
      return;
    }

    setNotification(null);
    setFile(selected);
  };

  const handleOpenStoredPdf = () => {
    if (!storedForm?.found || !storedForm.formData) return;
    const url = `data:application/pdf;base64,${storedForm.formData}`;
    window.open(url, '_blank');
  };

  const handleDownloadStoredPdf = () => {
    if (!storedForm?.found || !storedForm.formData) return;
    const blob = base64ToBlob(storedForm.formData);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${selectedFormName || 'form'}.pdf`;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  };

  const handleEnterEditMode = () => {
    if (!storedForm?.found || !storedForm.formData) return;
    setCleanFormBase64(null);
    setIsEditingCleanForm(false);
    setEditMode(true);
    editedPdfBytesRef.current = null;
  };

  const handleLoadCleanForm = async () => {
    if (!selectedFormName) {
      setNotification({ type: 'error', message: 'Please select a form type first.' });
      return;
    }

    const apiPath = CLEAN_FORM_API_PATHS[selectedFormName];
    if (!apiPath) {
      setNotification({ type: 'error', message: `No template available for "${selectedFormName}".` });
      return;
    }

    setLoadingCleanForm(true);
    setNotification(null);

    try {
      const response = await fetch(apiPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch template: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Convert to base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      setCleanFormBase64(base64);
      setIsEditingCleanForm(true);
      setEditMode(true);
      editedPdfBytesRef.current = null;
      setNotification({ type: 'info', message: 'Clean form loaded. Make your edits and click Save to store for this user.' });
    } catch (error: any) {
      console.error('[PDF-UPLOAD] Failed to load clean form', error);
      setNotification({ type: 'error', message: error?.message || 'Failed to load clean form' });
    } finally {
      setLoadingCleanForm(false);
    }
  };

  const handleExitEditMode = () => {
    setEditMode(false);
    setCleanFormBase64(null);
    setIsEditingCleanForm(false);
    editedPdfBytesRef.current = null;
  };

  const handlePdfEditorSave = (pdfBytes: Uint8Array) => {
    editedPdfBytesRef.current = pdfBytes;
  };

  const handleSaveEditedPdf = async () => {
    if (!editedPdfBytesRef.current || !selectedUserId || !selectedFormName) {
      setNotification({ type: 'error', message: 'No changes to save or missing user/form selection.' });
      return;
    }

    if (!session?.access_token) {
      setNotification({ type: 'error', message: 'Session expired. Please refresh the page.' });
      return;
    }

    setSavingEdit(true);
    setNotification(null);

    try {
      // Convert Uint8Array to base64
      const binary = Array.from(editedPdfBytesRef.current)
        .map((byte) => String.fromCharCode(byte))
        .join('');
      const base64Data = btoa(binary);

      const response = await fetch('/api/pdf-form-progress/admin-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: selectedUserId,
          formName: selectedFormName,
          formData: base64Data,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Save failed');
      }

      setNotification({ type: 'success', message: 'PDF changes saved successfully.' });
      // Refresh stored form data
      await fetchStoredForm();
      handleExitEditMode();
    } catch (error: any) {
      console.error('[PDF-UPLOAD] Save edit failed', error);
      setNotification({ type: 'error', message: error?.message || 'Save failed' });
    } finally {
      setSavingEdit(false);
    }
  };

  // Track previous user/form to detect changes
  const prevUserIdRef = useRef(selectedUserId);
  const prevFormNameRef = useRef(selectedFormName);

  // Exit edit mode when user or form changes (but not on initial mount)
  useEffect(() => {
    const userChanged = prevUserIdRef.current !== selectedUserId;
    const formChanged = prevFormNameRef.current !== selectedFormName;

    if ((userChanged || formChanged) && editMode) {
      setEditMode(false);
      setCleanFormBase64(null);
      setIsEditingCleanForm(false);
      editedPdfBytesRef.current = null;
    }

    prevUserIdRef.current = selectedUserId;
    prevFormNameRef.current = selectedFormName;
  }, [selectedUserId, selectedFormName, editMode]);

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUserId || !selectedFormName || !file) {
      setNotification({ type: 'error', message: 'Select a user, form, and PDF before uploading.' });
      return;
    }

    if (!session?.access_token) {
      setNotification({ type: 'error', message: 'Session expired. Please refresh the page.' });
      return;
    }

    setUploading(true);
    setNotification(null);
    setPreviousTimestamp(null);

    try {
      const base64Data = await toBase64(file);
      const response = await fetch('/api/pdf-form-progress/admin-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: selectedUserId,
          formName: selectedFormName,
          formData: base64Data,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Upload failed');
      }

      setPreviousTimestamp(payload.previousUpdatedAt ?? payload.updatedAt ?? null);
      setNotification({ type: 'success', message: 'PDF saved and timestamp preserved.' });
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('[PDF-UPLOAD] Upload failed', error);
      setNotification({ type: 'error', message: error?.message || 'Upload failed' });
    } finally {
      setUploading(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="liquid-card-compact p-8 animate-scale-in">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-transparent border-t-ios-blue mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium text-center keeping-apple">Verifying permissions...</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-12">
        <div className="liquid-card-spacious max-w-lg text-center">
          <div className="liquid-badge-red mx-auto mb-4">Access Restricted</div>
          <p className="text-gray-700 mb-4">{authError || 'You do not have permission to view this page.'}</p>
          <button
            onClick={() => router.push('/')}
            className="liquid-btn-glass liquid-btn-sm"
          >
            Return Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <section className="liquid-card-spacious">
          <h1 className="text-4xl font-bold text-gray-900 keeping-apple-tight mb-2">PDF Form Upload</h1>
          <p className="text-gray-600 mb-4">
            Upload a final version of any PDF form for a user and keep the original <code>updated_at</code> timestamp intact.
          </p>
          {authError && (
            <div className="liquid-alert liquid-alert-error mb-4">
              {authError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-gray-500 mb-1">Selected user</p>
              <p className="text-lg font-semibold text-gray-900">
                {selectedUser ? `${selectedUser.first_name ?? ''} ${selectedUser.last_name ?? ''}`.trim() || selectedUser.email : 'Select a user'}
              </p>
              <p className="text-sm text-gray-500">{selectedUser?.email || '—'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 mb-1">Retained timestamp</p>
              <p className="text-lg font-semibold text-gray-900">
                {previousTimestamp
                  ? new Date(previousTimestamp).toLocaleString()
                  : 'Will be populated after upload'}
              </p>
            </div>
          </div>
        </section>

        <section className="liquid-card-spacious">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 keeping-apple-tight">Form viewer preview</h2>
                <p className="text-sm text-gray-500">
                  The embedded payroll packet viewer shows the same input fields your user will see.
                </p>
              </div>
              {viewerPath && (
                <a
                  href={viewerPath}
                  target="_blank"
                  rel="noreferrer"
                  className="liquid-btn-glass liquid-btn-sm"
                >
                  Open preview in new tab
                </a>
              )}
            </div>

            {viewerPath ? (
              <div className="rounded-liquid border border-[#e5e7eb] bg-white shadow-inner">
                <iframe
                  key={viewerPath}
                  title={`Form preview: ${selectedFormName}`}
                  src={viewerPath}
                  className="w-full rounded-liquid"
                  style={{ minHeight: DEFAULT_VIEWER_HEIGHT, border: 'none' }}
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="liquid-alert liquid-alert-info">
                Preview not available for this form yet. You can still upload the PDF and it will be stored under the
                selected user and form name.
              </div>
            )}
            <div className="rounded-liquid border border-dashed border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-700">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold">
                  {fetchingStoredForm
                    ? 'Checking stored PDF…'
                    : storedForm?.found
                      ? 'Stored PDF available'
                      : 'No stored PDF saved yet'}
                </span>
                {!fetchingStoredForm && storedForm?.found && storedForm.formData && (
                  <>
                    <span>Size: {formatBytes(estimateBytesFromBase64(storedForm.formData))}</span>
                    <span>
                      Updated: {storedForm.updatedAt ? new Date(storedForm.updatedAt).toLocaleString() : '—'}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {storedForm?.found && storedForm.formData && (
                  <>
                    <button
                      type="button"
                      className="liquid-btn liquid-btn-secondary text-xs px-3 py-1 uppercase tracking-wide"
                      onClick={handleOpenStoredPdf}
                    >
                      Open stored PDF
                    </button>
                    <button
                      type="button"
                      className="liquid-btn liquid-btn-glass text-xs px-3 py-1 uppercase tracking-wide"
                      onClick={handleDownloadStoredPdf}
                    >
                      Download stored PDF
                    </button>
                    <button
                      type="button"
                      className="liquid-btn liquid-btn-primary text-xs px-3 py-1 uppercase tracking-wide"
                      onClick={handleEnterEditMode}
                      disabled={editMode}
                    >
                      Edit Stored PDF
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="liquid-btn liquid-btn-glass text-xs px-3 py-1 uppercase tracking-wide border-2 border-dashed border-blue-400"
                  onClick={handleLoadCleanForm}
                  disabled={editMode || loadingCleanForm}
                >
                  {loadingCleanForm ? 'Loading...' : 'Load Clean Form'}
                </button>
              </div>

              {/* PDF Editor Section */}
              {editMode && (isEditingCleanForm ? cleanFormBase64 : (storedForm?.found && storedForm.formData)) && (
                <div className="mt-4 border border-gray-300 rounded-liquid bg-white">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {isEditingCleanForm ? 'Editing Clean Form' : 'Editing Stored PDF'}
                      </h3>
                      {isEditingCleanForm && (
                        <p className="text-xs text-blue-600 mt-1">
                          This is a blank template. Fill it out and save to store for {selectedUser?.first_name || selectedUser?.email || 'this user'}.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="liquid-btn liquid-btn-primary text-xs px-4 py-2"
                        onClick={handleSaveEditedPdf}
                        disabled={savingEdit}
                      >
                        {savingEdit ? 'Saving...' : `Save to User's Record`}
                      </button>
                      <button
                        type="button"
                        className="liquid-btn liquid-btn-glass text-xs px-4 py-2"
                        onClick={handleExitEditMode}
                        disabled={savingEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div style={{ height: EDITOR_HEIGHT }}>
                    <AdminPDFEditor
                      pdfBase64={isEditingCleanForm ? cleanFormBase64! : storedForm?.found ? storedForm.formData : ''}
                      formId={`admin-edit-${selectedFormName}`}
                      onSave={handlePdfEditorSave}
                      onFieldChange={() => {}}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="liquid-card-spacious">
          <form className="space-y-6" onSubmit={handleUpload}>
            <div>
              <label className="liquid-label" htmlFor="user">User</label>
              <select
                id="user"
                className="liquid-select"
                value={selectedUserId}
                disabled={loadingUsers}
                onChange={(event) => setSelectedUserId(event.target.value)}
              >
                {loadingUsers && <option value="">Loading users...</option>}
                {!loadingUsers && users.length === 0 && <option value="">No users available</option>}
                {!loadingUsers && users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.first_name || user.last_name
                      ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
                      : user.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="liquid-label" htmlFor="formName">Form name</label>
              <select
                id="formName"
                className="liquid-select"
                value={selectedFormName}
                onChange={(event) => setSelectedFormName(event.target.value)}
              >
                {PDF_FORM_SELECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="liquid-label" htmlFor="pdfFile">Choose PDF</label>
              <input
                ref={fileInputRef}
                id="pdfFile"
                type="file"
                accept="application/pdf"
                className="liquid-input"
                onChange={handleFileChange}
              />
              {file && (
                <p className="text-sm text-gray-500 mt-2">Selected: {file.name}</p>
              )}
              <p className="text-sm text-gray-400 mt-2">Max size {Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.</p>
            </div>

            {notification && (
              <div className={`liquid-alert ${notification.type === 'success' ? 'liquid-alert-success' : notification.type === 'error' ? 'liquid-alert-error' : 'liquid-alert-info'}`}>
                {notification.message}
              </div>
            )}

            <button
              type="submit"
              className="liquid-btn liquid-btn-primary w-full justify-center"
              disabled={uploading || loadingUsers || !file}
            >
              {uploading ? 'Uploading…' : 'Upload PDF while keeping timestamp'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
