'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────
interface BackgroundCheck {
  id: string;
  background_check_completed: boolean;
  completed_date: string | null;
  notes: string | null;
  updated_at: string;
}

interface OnboardingStatus {
  id: string;
  onboarding_completed: boolean;
  completed_date: string | null;
  notes: string | null;
  updated_at: string;
  hr_approval_sent_at?: string | null;
}

interface FormProgress {
  form_name: string;
  updated_at: string;
  position: number;
  display_name: string;
}

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

// Unified per-user record that merges the background-check and onboarding feeds.
// The two sources share a join key (user_id) but each carries its own profile
// `id` for its POST actions and its own PDF (background-check PDF vs onboarding
// documents PDF), so those are namespaced here to avoid collisions.
interface CombinedRecord {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  phone: string | null;
  created_at: string;
  has_temporary_password: boolean;

  // ── Background-check side (from /api/background-checks) ──
  bgProfileId: string | null;
  background_check: BackgroundCheck | null;
  background_check_completed_user_table: boolean;
  bg_has_submitted_pdf: boolean;
  bg_pdf_submitted_at: string | null;
  bg_pdf_downloaded: boolean;
  bg_pdf_downloaded_at: string | null;

  // ── Onboarding side (from /api/onboarding) ──
  onbProfileId: string | null;
  onboarding_status: OnboardingStatus | null;
  background_check_completed: boolean;
  latest_form_progress: FormProgress | null;
  forms_completed: number;
  total_forms: number;
  completed_forms: string[];
  missing_forms_display?: string[];
  onb_has_submitted_pdf: boolean;
  onb_pdf_submitted_at: string | null;
  onb_pdf_downloaded: boolean;
  onb_pdf_downloaded_at: string | null;
}

const SIGNATURE_AUDIT_HEADER = 'x-signature-audit';
const SIGNATURE_AUDIT_VERSION_HEADER = 'x-signature-audit-version';

const makeRecord = (user_id: string): CombinedRecord => ({
  user_id,
  full_name: '',
  email: '',
  role: '',
  phone: null,
  created_at: '',
  has_temporary_password: false,
  bgProfileId: null,
  background_check: null,
  background_check_completed_user_table: false,
  bg_has_submitted_pdf: false,
  bg_pdf_submitted_at: null,
  bg_pdf_downloaded: false,
  bg_pdf_downloaded_at: null,
  onbProfileId: null,
  onboarding_status: null,
  background_check_completed: false,
  latest_form_progress: null,
  forms_completed: 0,
  total_forms: 0,
  completed_forms: [],
  missing_forms_display: [],
  onb_has_submitted_pdf: false,
  onb_pdf_submitted_at: null,
  onb_pdf_downloaded: false,
  onb_pdf_downloaded_at: null,
});

export default function OnboardingBackgroundChecksPage() {
  const [records, setRecords] = useState<CombinedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Background-check action state
  const [bgUpdating, setBgUpdating] = useState<string | null>(null);

  // Onboarding action state
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [emailSentNow, setEmailSentNow] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
  const [signatureAudits, setSignatureAudits] = useState<Record<string, SignatureAuditEntry[]>>({});

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBackground, setFilterBackground] = useState<'all' | 'completed' | 'pending'>('all');
  const [filterOnboarding, setFilterOnboarding] = useState<'all' | 'completed' | 'pending' | 'not_submitted'>('all');
  const [filterPassword, setFilterPassword] = useState<'all' | 'temporary' | 'permanent'>('all');
  const [filterForm, setFilterForm] = useState<string>('all');
  const [showOnlyWithProgress, setShowOnlyWithProgress] = useState(false);

  // Current user's role (from users table)
  const [myRole, setMyRole] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    Promise.all([loadCurrentUserRole(), loadData()]).finally(() => setLoading(false));
  }, []);

  const loadCurrentUserRole = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setMyRole(null);
        return;
      }

      const { data, error } = await (supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single() as any);

      if (error) {
        console.error('[Onboarding+Background] Role fetch error:', error);
        setMyRole(null);
        return;
      }

      const role = (data?.role ?? '').trim().toLowerCase();
      setMyRole(role || null);
    } catch (e) {
      console.error('[Onboarding+Background] Role fetch exception:', e);
      setMyRole(null);
    }
  };

  // Fetch both feeds in parallel and merge them by user_id.
  const loadData = async () => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const [bgRes, onbRes] = await Promise.all([
        fetch('/api/background-checks', { method: 'GET', headers }),
        fetch('/api/onboarding', { method: 'GET', headers }),
      ]);

      const bgData = await bgRes.json().catch(() => ({} as any));
      const onbData = await onbRes.json().catch(() => ({} as any));

      const describeError = (label: string, res: Response, data: any) => {
        if (res.status === 403) {
          const roleMsg = data?.currentRole ? ` Your current role: ${data.currentRole}` : '';
          return `${label}: Access denied. Admin privileges required.${roleMsg}`;
        }
        if (res.status === 401) return `${label}: Please log in to continue.`;
        if (res.status === 500) return `${label}: Server error: ${data?.error || 'Unknown error'}.`;
        return `${label}: ${data?.error || 'Failed to load'}`;
      };

      const errs: string[] = [];
      if (!bgRes.ok) errs.push(describeError('Background checks', bgRes, bgData));
      if (!onbRes.ok) errs.push(describeError('Onboarding', onbRes, onbData));
      if (errs.length) setError(errs.join('  •  '));

      const map = new Map<string, CombinedRecord>();
      const ensure = (userId: string) => {
        let rec = map.get(userId);
        if (!rec) {
          rec = makeRecord(userId);
          map.set(userId, rec);
        }
        return rec;
      };

      for (const v of (bgData?.vendors || [])) {
        if (!v?.user_id) continue;
        const rec = ensure(v.user_id);
        rec.full_name = v.full_name ?? rec.full_name;
        rec.email = v.email ?? rec.email;
        rec.role = v.role ?? rec.role;
        rec.phone = v.phone ?? rec.phone;
        rec.created_at = v.created_at ?? rec.created_at;
        rec.has_temporary_password = !!v.has_temporary_password;
        rec.bgProfileId = v.id ?? null;
        rec.background_check = v.background_check ?? null;
        rec.background_check_completed_user_table = !!v.background_check_completed_user_table;
        rec.bg_has_submitted_pdf = !!v.has_submitted_pdf;
        rec.bg_pdf_submitted_at = v.pdf_submitted_at ?? null;
        rec.bg_pdf_downloaded = !!v.pdf_downloaded;
        rec.bg_pdf_downloaded_at = v.pdf_downloaded_at ?? null;
      }

      for (const u of (onbData?.users || [])) {
        if (!u?.user_id) continue;
        const rec = ensure(u.user_id);
        // Onboarding payload carries the richer identity — prefer it.
        rec.full_name = u.full_name ?? rec.full_name;
        rec.email = u.email ?? rec.email;
        rec.role = u.role ?? rec.role;
        rec.phone = u.phone ?? rec.phone;
        rec.created_at = u.created_at ?? rec.created_at;
        rec.has_temporary_password = !!u.has_temporary_password;
        rec.onbProfileId = u.id ?? null;
        rec.onboarding_status = u.onboarding_status ?? null;
        rec.background_check_completed = !!u.background_check_completed;
        rec.latest_form_progress = u.latest_form_progress ?? null;
        rec.forms_completed = u.forms_completed ?? 0;
        rec.total_forms = u.total_forms ?? 0;
        rec.completed_forms = u.completed_forms ?? [];
        rec.missing_forms_display = u.missing_forms_display ?? [];
        rec.onb_has_submitted_pdf = !!u.has_submitted_pdf;
        rec.onb_pdf_submitted_at = u.pdf_submitted_at ?? null;
        rec.onb_pdf_downloaded = !!u.pdf_downloaded;
        rec.onb_pdf_downloaded_at = u.pdf_downloaded_at ?? null;
      }

      setRecords(Array.from(map.values()));
    } catch (e: any) {
      console.error('[Onboarding+Background] Error:', e);
      setError(e.message || 'Failed to load records');
    }
  };

  const reload = async () => {
    setLoading(true);
    await loadData();
    setLoading(false);
  };

  const updateRecordByUserId = (userId: string, patch: Partial<CombinedRecord>) => {
    setRecords(prev => prev.map(r => (r.user_id === userId ? { ...r, ...patch } : r)));
  };

  // ── Background check: toggle completion (HR/Exec only) ──
  const handleBgCheckboxChange = async (record: CombinedRecord, isChecked: boolean) => {
    if (!record.bgProfileId) {
      setActionError(prev => ({ ...prev, [record.user_id]: 'No background-check profile for this user.' }));
      return;
    }
    try {
      setBgUpdating(record.user_id);
      setActionError(prev => { const next = { ...prev }; delete next[record.user_id]; return next; });

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/background-checks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          profile_id: record.bgProfileId,
          background_check_completed: isChecked,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update background check status');

      updateRecordByUserId(record.user_id, { background_check: data.background_check });
    } catch (err: any) {
      console.error('Error updating background check:', err);
      setActionError(prev => ({ ...prev, [record.user_id]: err.message || 'Failed to update background check status.' }));
      reload();
    } finally {
      setBgUpdating(null);
    }
  };

  // ── Onboarding: update vendor_onboarding_status in the DB (no email sent) ──
  const handleStatusToggle = async (record: CombinedRecord, isChecked: boolean) => {
    if (!record.onbProfileId) {
      setActionError(prev => ({ ...prev, [record.user_id]: 'No onboarding profile for this user.' }));
      return;
    }
    try {
      setUpdatingStatus(record.user_id);
      setActionError(prev => { const next = { ...prev }; delete next[record.user_id]; return next; });

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          profile_id: record.onbProfileId,
          onboarding_completed: isChecked,
          send_email: false, // email is a separate action
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update onboarding status');

      updateRecordByUserId(record.user_id, { onboarding_status: data.onboarding_status });
    } catch (err: any) {
      console.error('Error updating onboarding:', err);
      setActionError(prev => ({ ...prev, [record.user_id]: err.message || 'Failed to update status' }));
      reload();
    } finally {
      setUpdatingStatus(null);
    }
  };

  // ── Onboarding: send the Phase 2 approval email (no DB status change) ──
  const handleSendEmail = async (record: CombinedRecord) => {
    if (!record.onbProfileId) {
      setActionError(prev => ({ ...prev, [record.user_id]: 'No onboarding profile for this user.' }));
      return;
    }
    if (emailSentNow.has(record.user_id)) return;
    try {
      setSendingEmail(record.user_id);
      setActionError(prev => { const next = { ...prev }; delete next[record.user_id]; return next; });

      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          profile_id: record.onbProfileId,
          only_send_email: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send email');

      if (data.onboarding_status) {
        updateRecordByUserId(record.user_id, { onboarding_status: data.onboarding_status });
      } else {
        setEmailSentNow(prev => new Set(prev).add(record.user_id));
      }
    } catch (err: any) {
      console.error('Error sending approval email:', err);
      setActionError(prev => ({ ...prev, [record.user_id]: err.message || 'Failed to send email' }));
    } finally {
      setSendingEmail(null);
    }
  };

  // ── Download helpers (unified on the most robust implementation) ──
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

  // ── Background-check PDF download (simple per-user endpoint) ──
  const handleDownloadBackgroundPDF = async (userId: string, vendorName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/background-checks/pdf?user_id=${userId}`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to download PDF');
      }
      const blob = await response.blob();
      downloadBlob(blob, `background_check_${vendorName.replace(/\s+/g, '_')}.pdf`);

      updateRecordByUserId(userId, { bg_pdf_downloaded: true, bg_pdf_downloaded_at: new Date().toISOString() });
    } catch (err: any) {
      console.error('Error downloading background PDF:', err);
      alert(`Failed to download PDF: ${err.message}`);
    }
  };

  // ── Onboarding documents PDF download (full-fidelity flow) ──
  const handleDownloadOnboardingPDF = async (userId: string, userName: string) => {
    if (!userId) {
      alert('Unable to determine the user account right now. Please refresh and try again.');
      return;
    }

    if (downloadingPdf) {
      alert('Another download is in progress. Please wait before starting a new one.');
      return;
    }

    setDownloadingPdf(userId);

    const fallbackName = (userName || 'onboarding_user').trim();
    const fallbackFilename = buildOnboardingFilename(fallbackName);

    try {
      console.log('[PDF Download] Starting download for user:', userId);

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
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
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
            setSignatureAudits((prev) => ({
              ...prev,
              [userId]: parsedAudit,
            }));
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

      updateRecordByUserId(userId, { onb_pdf_downloaded: true, onb_pdf_downloaded_at: new Date().toISOString() });

      alert('Your onboarding documents are downloading. This may take a few moments for large submissions.');
    } catch (err: any) {
      console.error('Error downloading PDF:', err);
      if (err?.name === 'AbortError') {
        alert('Download timed out after 5 minutes. Please try again or contact support if the issue persists.');
      } else {
        alert(`Failed to download onboarding documents: ${err?.message || 'Unknown error'}`);
      }
    } finally {
      setDownloadingPdf(null);
    }
  };

  // ── Excel exports ──
  const handleExportBackground = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/background-checks/export', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to export data');
      }
      const blob = await response.blob();
      const date = new Date().toISOString().split('T')[0];
      downloadBlob(blob, `background_checks_report_${date}.xlsx`);
    } catch (err: any) {
      console.error('Error exporting background checks:', err);
      alert(`Failed to export data: ${err.message}`);
    }
  };

  const handleExportOnboarding = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/onboarding/export', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to export data');
      }
      const blob = await response.blob();
      const date = new Date().toISOString().split('T')[0];
      downloadBlob(blob, `onboarding_report_${date}.xlsx`);
    } catch (err: any) {
      console.error('Error exporting onboarding:', err);
      alert(`Failed to export data: ${err.message}`);
    }
  };

  const normalizeFormFilterValue = (value?: string | null) => {
    const normalized = (value || '').toLowerCase().trim().replace(/\.pdf$/i, '');
    return normalized.replace(/^(ca|ny|wi|az|nv)-/, '');
  };

  // ── Filtering + sorting ──
  const filteredRecords = records
    .filter(record => {
      const matchesSearch =
        record.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.email.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (filterBackground === 'completed') {
        if (!record.background_check?.background_check_completed) return false;
      } else if (filterBackground === 'pending') {
        if (record.background_check?.background_check_completed) return false;
      }

      if (filterOnboarding === 'completed') {
        if (!record.onboarding_status?.onboarding_completed) return false;
      } else if (filterOnboarding === 'pending') {
        if (!record.onboarding_status) return false;
        if (record.onboarding_status.onboarding_completed) return false;
      } else if (filterOnboarding === 'not_submitted') {
        if (record.onboarding_status) return false;
      }

      if (filterPassword === 'temporary') {
        if (!record.has_temporary_password) return false;
      } else if (filterPassword === 'permanent') {
        if (record.has_temporary_password) return false;
      }

      if (filterForm === 'no_progress') {
        if (record.latest_form_progress) return false;
      } else if (filterForm !== 'all') {
        const normalizedLatestForm = normalizeFormFilterValue(record.latest_form_progress?.form_name);
        if (!normalizedLatestForm || normalizedLatestForm !== filterForm) return false;
      }

      if (showOnlyWithProgress) {
        if (!record.latest_form_progress || record.latest_form_progress.position === 0) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Anyone who has submitted any PDF surfaces first, newest submission first.
      const aSubmitted = a.onb_has_submitted_pdf || a.bg_has_submitted_pdf;
      const bSubmitted = b.onb_has_submitted_pdf || b.bg_has_submitted_pdf;
      if (aSubmitted && !bSubmitted) return -1;
      if (!aSubmitted && bSubmitted) return 1;

      const aDate = a.onb_pdf_submitted_at || a.bg_pdf_submitted_at || a.created_at;
      const bDate = b.onb_pdf_submitted_at || b.bg_pdf_submitted_at || b.created_at;
      const aTime = aDate ? new Date(aDate).getTime() : 0;
      const bTime = bDate ? new Date(bDate).getTime() : 0;
      return bTime - aTime;
    });

  // ── Stats ──
  const total = records.length;
  const backgroundCompletedCount = records.filter(r => r.background_check?.background_check_completed).length;
  const backgroundPendingCount = total - backgroundCompletedCount;
  const onboardingCompletedCount = records.filter(r => r.onboarding_status?.onboarding_completed).length;
  const onboardingPendingCount = records.filter(r => r.onboarding_status && !r.onboarding_status.onboarding_completed).length;
  const notSubmittedCount = records.filter(r => !r.onboarding_status).length;
  const bgPdfSubmittedCount = records.filter(r => r.bg_has_submitted_pdf).length;
  const onbPdfSubmittedCount = records.filter(r => r.onb_has_submitted_pdf).length;
  const temporaryPasswordCount = records.filter(r => r.has_temporary_password).length;
  const hrApprovedCount = records.filter(r => r.onboarding_status?.hr_approval_sent_at).length;

  const uniqueFormNames = Array.from(
    new Set(
      records
        .map(r => normalizeFormFilterValue(r.latest_form_progress?.form_name))
        .filter((formName): formName is string => !!formName)
    )
  ).sort();

  const normalizedMyRole = (myRole?.trim().toLowerCase() || null);
  const canEdit = normalizedMyRole === 'hr' || normalizedMyRole === 'exec';

  const headerBtnPrimary =
    'inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors';
  const headerBtnSecondary =
    'inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white text-gray-700 text-sm font-medium border border-gray-300 hover:bg-gray-50 transition-colors';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading records...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Onboarding &amp; Background Checks</h1>
            <p className="mt-2 text-gray-600">
              Combined view of background-check and onboarding status, with document downloads for both.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleExportBackground} className={headerBtnSecondary} title="Export background checks to Excel">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export Background
            </button>
            <button onClick={handleExportOnboarding} className={headerBtnSecondary} title="Export onboarding to Excel">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export Onboarding
            </button>
            {canEdit && (
              <button onClick={() => router.push('/hr-dashboard')} className={headerBtnPrimary}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Back to Dashboard
              </button>
            )}
          </div>
        </div>

        {/* HR Approved Banner */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6 flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
            <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium text-green-700">HR Approved Users</div>
            <div className="text-4xl font-bold text-green-700 leading-none mt-0.5">
              {hrApprovedCount}
              <span className="text-base font-normal text-green-600 ml-2">/ {total} total</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Total Users</div>
            <div className="mt-2 text-3xl font-semibold text-gray-900">{total}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Background Completed</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{backgroundCompletedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Background Pending</div>
            <div className="mt-2 text-3xl font-semibold text-orange-600">{backgroundPendingCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Onboarding Completed</div>
            <div className="mt-2 text-3xl font-semibold text-green-600">{onboardingCompletedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Form Submitted</div>
            <div className="mt-2 text-3xl font-semibold text-orange-600">{onboardingPendingCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Not Submitted</div>
            <div className="mt-2 text-3xl font-semibold text-gray-700">{notSubmittedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Background PDF Submitted</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">{bgPdfSubmittedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Onboarding PDF Submitted</div>
            <div className="mt-2 text-3xl font-semibold text-blue-600">{onbPdfSubmittedCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-sm font-medium text-gray-500">Temporary Password</div>
            <div className="mt-2 text-3xl font-semibold text-red-600">{temporaryPasswordCount}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">Search Users</label>
              <input
                type="text"
                id="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="filterBackground" className="block text-sm font-medium text-gray-700 mb-1">Background Check</label>
              <select
                id="filterBackground"
                value={filterBackground}
                onChange={(e) => setFilterBackground(e.target.value as 'all' | 'completed' | 'pending')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label htmlFor="filterOnboarding" className="block text-sm font-medium text-gray-700 mb-1">Onboarding Status</label>
              <select
                id="filterOnboarding"
                value={filterOnboarding}
                onChange={(e) => setFilterOnboarding(e.target.value as 'all' | 'completed' | 'pending' | 'not_submitted')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="pending">Form Submitted</option>
                <option value="not_submitted">Not Submitted</option>
              </select>
            </div>
            <div>
              <label htmlFor="filterPassword" className="block text-sm font-medium text-gray-700 mb-1">Password Status</label>
              <select
                id="filterPassword"
                value={filterPassword}
                onChange={(e) => setFilterPassword(e.target.value as 'all' | 'temporary' | 'permanent')}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Passwords</option>
                <option value="temporary">Temporary</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>
            <div>
              <label htmlFor="filterForm" className="block text-sm font-medium text-gray-700 mb-1">Form Progress</label>
              <select
                id="filterForm"
                value={filterForm}
                onChange={(e) => setFilterForm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Forms</option>
                <option value="no_progress">No Progress</option>
                {uniqueFormNames.map((formName) => (
                  <option key={formName} value={formName}>
                    {formName.replace(/_/g, ' ').replace(/\.pdf$/i, '')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center">
            <input
              type="checkbox"
              id="showOnlyWithProgress"
              checked={showOnlyWithProgress}
              onChange={(e) => setShowOnlyWithProgress(e.target.checked)}
              className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer"
            />
            <label htmlFor="showOnlyWithProgress" className="ml-2 text-sm text-gray-700 cursor-pointer">
              Show only users with form progress
            </label>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Records Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">User Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Password</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Background Check</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Onboarding</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">Form Progress</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase keeping-wider">PDFs</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase keeping-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                      {searchTerm || filterBackground !== 'all' || filterOnboarding !== 'all'
                        ? 'No users found matching your filters.'
                        : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => {
                    const progressDenominator = Math.max(record.total_forms || 0, 1);
                    const progressNumerator = Math.max(0, Math.min(record.latest_form_progress?.position || 0, progressDenominator));
                    const progressPercent = Math.round((progressNumerator / progressDenominator) * 100);
                    const bgDownloadable = record.bg_has_submitted_pdf && record.background_check_completed_user_table;
                    return (
                      <tr key={record.user_id} className="hover:bg-gray-50 align-top">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{record.full_name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">{record.email}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800 capitalize">
                            {record.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {record.has_temporary_password ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Temporary</span>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Permanent</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {record.background_check?.background_check_completed ? (
                            <div>
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Completed</span>
                              {record.background_check.completed_date && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {new Date(record.background_check.completed_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">Pending</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {record.onboarding_status?.onboarding_completed ? (
                            <div>
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Completed</span>
                              {record.onboarding_status.completed_date && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {new Date(record.onboarding_status.completed_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          ) : record.onboarding_status ? (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-orange-100 text-orange-800">Form Submitted</span>
                          ) : (
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Not Submitted</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="min-w-[180px]">
                            {record.latest_form_progress ? (
                              <>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-gray-700">Step {progressNumerator}/{progressDenominator}</span>
                                  <span className="text-xs text-gray-500">{progressPercent}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${progressNumerator === progressDenominator ? 'bg-green-500' : 'bg-indigo-500'}`}
                                    style={{ width: `${progressPercent}%` }}
                                  />
                                </div>
                                <div className="text-xs text-gray-600 mt-1 truncate" title={record.latest_form_progress.display_name}>
                                  {record.latest_form_progress.display_name}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {new Date(record.latest_form_progress.updated_at).toLocaleDateString()}
                                </div>
                                {record.completed_forms && record.completed_forms.length > 0 && (
                                  <details className="mt-1">
                                    <summary className="text-xs text-indigo-600 cursor-pointer hover:text-indigo-800">
                                      View all {record.completed_forms.length} completed forms
                                    </summary>
                                    <ul className="mt-1 text-xs text-gray-500 pl-2 space-y-0.5 max-h-32 overflow-y-auto">
                                      {record.completed_forms.map((formName, idx) => (
                                        <li key={idx} className="truncate" title={formName}>
                                          • {formName.replace(/^[a-z]{2}-/, '').replace(/-/g, ' ')}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                                {record.missing_forms_display && record.missing_forms_display.length > 0 && record.forms_completed < record.total_forms && (
                                  <details className="mt-1">
                                    <summary className="text-xs text-amber-700 cursor-pointer hover:text-amber-900">
                                      Missing {record.missing_forms_display.length} forms
                                    </summary>
                                    <ul className="mt-1 text-xs text-amber-800 pl-2 space-y-0.5 max-h-32 overflow-y-auto">
                                      {record.missing_forms_display.map((formDisplay, idx) => (
                                        <li key={idx} className="truncate" title={formDisplay}>• {formDisplay}</li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-medium text-gray-500">Not started</span>
                                  <span className="text-xs text-gray-400">0%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                  <div className="h-2 rounded-full bg-gray-300" style={{ width: '0%' }} />
                                </div>
                                <div className="text-xs text-gray-400 mt-1">No forms completed</div>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 w-20">Background</span>
                              {record.bg_has_submitted_pdf && record.background_check_completed_user_table ? (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                  Yes{record.bg_pdf_submitted_at ? ` · ${new Date(record.bg_pdf_submitted_at).toLocaleDateString()}` : ''}
                                </span>
                              ) : (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">No</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 w-20">Onboarding</span>
                              {record.onb_has_submitted_pdf ? (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                  Yes{record.onb_pdf_submitted_at ? ` · ${new Date(record.onb_pdf_submitted_at).toLocaleDateString()}` : ''}
                                </span>
                              ) : (
                                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">No</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-3 min-w-[230px]">
                            {canEdit && (
                              <>
                                {/* Background check completion */}
                                {record.bgProfileId && (
                                  <label className={`flex items-start gap-2 ${bgUpdating === record.user_id ? 'opacity-60' : 'cursor-pointer'}`}>
                                    <input
                                      type="checkbox"
                                      checked={record.background_check?.background_check_completed || false}
                                      onChange={(e) => handleBgCheckboxChange(record, e.target.checked)}
                                      disabled={bgUpdating === record.user_id}
                                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                    />
                                    <span className="text-xs leading-tight select-none">
                                      <span className="font-semibold text-blue-700 block">
                                        Background Complete
                                        {bgUpdating === record.user_id && <span className="ml-1 text-gray-400">(saving…)</span>}
                                      </span>
                                      <span className="text-gray-400 block">Marks background check completed</span>
                                    </span>
                                  </label>
                                )}

                                {record.onbProfileId && (
                                  <>
                                    <div className="border-t border-gray-100" />

                                    {/* Onboarding bypass */}
                                    <label className={`flex items-start gap-2 ${updatingStatus === record.user_id ? 'opacity-60' : 'cursor-pointer'}`}>
                                      <input
                                        type="checkbox"
                                        checked={record.onboarding_status?.onboarding_completed || false}
                                        onChange={(e) => handleStatusToggle(record, e.target.checked)}
                                        disabled={updatingStatus === record.user_id}
                                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer disabled:cursor-not-allowed"
                                      />
                                      <span className="text-xs leading-tight select-none">
                                        <span className="font-semibold text-green-700 block">
                                          By Pass
                                          {updatingStatus === record.user_id && <span className="ml-1 text-gray-400">(saving…)</span>}
                                        </span>
                                        <span className="text-gray-400 block">
                                          Sets <code className="text-gray-500">vendor_onboarding_status</code> in database
                                        </span>
                                        {record.onboarding_status?.onboarding_completed && record.onboarding_status.completed_date && (
                                          <span className="text-green-600 block mt-0.5">
                                            ✓ {new Date(record.onboarding_status.completed_date).toLocaleDateString()}
                                          </span>
                                        )}
                                      </span>
                                    </label>

                                    <div className="border-t border-gray-100" />

                                    {/* HR approval email */}
                                    <label className={`flex items-start gap-2 ${sendingEmail === record.user_id || !!record.onboarding_status?.hr_approval_sent_at || emailSentNow.has(record.user_id) ? 'opacity-60' : 'cursor-pointer'}`}>
                                      <input
                                        type="checkbox"
                                        checked={!!record.onboarding_status?.hr_approval_sent_at || emailSentNow.has(record.user_id)}
                                        onChange={() => handleSendEmail(record)}
                                        disabled={sendingEmail === record.user_id || !!record.onboarding_status?.hr_approval_sent_at || emailSentNow.has(record.user_id)}
                                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                      />
                                      <span className="text-xs leading-tight select-none">
                                        <span className="font-semibold text-blue-700 block">
                                          HR Approval
                                          {sendingEmail === record.user_id && <span className="ml-1 text-gray-400">(sending…)</span>}
                                        </span>
                                        <span className="text-gray-400 block">Sends Phase 2 approval email to employee</span>
                                        {(record.onboarding_status?.hr_approval_sent_at || emailSentNow.has(record.user_id)) && (
                                          <span className="text-blue-600 block mt-0.5">
                                            ✓ Email sent{record.onboarding_status?.hr_approval_sent_at ? ` ${new Date(record.onboarding_status.hr_approval_sent_at).toLocaleDateString()}` : ''}
                                          </span>
                                        )}
                                      </span>
                                    </label>
                                  </>
                                )}

                                <div className="border-t border-gray-100" />
                              </>
                            )}

                            {/* Download: Background check PDF */}
                            {bgDownloadable && (
                              <button
                                onClick={() => handleDownloadBackgroundPDF(record.user_id, record.full_name)}
                                className={`px-2 py-1 text-xs font-medium rounded border ${
                                  record.bg_pdf_downloaded
                                    ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-50 border-purple-300 bg-purple-50'
                                    : 'text-green-600 hover:text-green-800 hover:bg-green-50 border-green-300'
                                }`}
                                title={record.bg_pdf_downloaded ? 'Background docs downloaded — click to download again' : 'Download background check documents'}
                              >
                                {record.bg_pdf_downloaded ? 'Background Docs ✓' : 'Download Background Docs'}
                              </button>
                            )}

                            {/* Download: Onboarding documents PDF */}
                            {record.onb_has_submitted_pdf && (
                              <button
                                onClick={() => handleDownloadOnboardingPDF(record.user_id, record.full_name)}
                                disabled={downloadingPdf === record.user_id}
                                className={`px-2 py-1 text-xs font-medium rounded border ${
                                  downloadingPdf === record.user_id
                                    ? 'text-gray-400 bg-gray-50 border-gray-300 cursor-wait'
                                    : record.onb_pdf_downloaded
                                    ? 'text-purple-600 hover:text-purple-800 hover:bg-purple-50 border-purple-300 bg-purple-50'
                                    : 'text-green-600 hover:text-green-800 hover:bg-green-50 border-green-300'
                                } disabled:opacity-50`}
                                title={
                                  downloadingPdf === record.user_id
                                    ? 'Generating PDF... This may take up to 5 minutes'
                                    : record.onb_pdf_downloaded
                                    ? 'Downloaded — click to download again'
                                    : 'Download onboarding documents'
                                }
                              >
                                {downloadingPdf === record.user_id
                                  ? 'Generating PDF...'
                                  : record.onb_pdf_downloaded
                                  ? 'Onboarding Docs ✓'
                                  : 'Download Onboarding Docs'}
                              </button>
                            )}

                            {!bgDownloadable && !record.onb_has_submitted_pdf && (
                              <span className="text-xs text-gray-400">No documents submitted</span>
                            )}

                            {actionError[record.user_id] && (
                              <p className="text-xs text-red-600">{actionError[record.user_id]}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-6 text-sm text-gray-500 text-center">
          Showing {filteredRecords.length} of {total} users
        </div>
      </div>
    </div>
  );
}
