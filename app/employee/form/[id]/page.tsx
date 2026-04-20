'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PDFFormEditor from '@/app/components/PDFFormEditor';

type FormMeta = {
  id: string;
  title: string;
  requires_signature: boolean;
  allow_date_input: boolean;
  allow_print_name: boolean;
  allow_venue_display: boolean;
};

type AssignedVenue = {
  id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
};

type UploadedDoc = {
  filename: string;
  url: string;
  storagePath: string;
};

// Slot IDs match the I-9 naming convention
type SlotId = 'list_a' | 'list_b' | 'list_c';

const LIST_A_EXAMPLES = [
  'U.S. Passport or Passport Card',
  'Permanent Resident Card (I-551)',
  'Employment Authorization Document (I-766)',
  'Foreign Passport with I-551 stamp or I-94',
];

const LIST_B_EXAMPLES = [
  "Driver's License or State ID card",
  'Federal, State, or local government agency ID',
  'School ID with photograph',
  'U.S. Military card or draft record',
];

const LIST_C_EXAMPLES = [
  'Social Security Account Number card',
  'U.S. birth or birth abroad certificate',
  'Native American tribal document',
  'U.S. Citizen ID card (I-197)',
];

export default function EmployeeFormPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const formId = params.id as string;
  // When opened from an admin's employee profile page, asUser holds the employee's ID.
  // The form is then saved under that employee's ID rather than the logged-in admin's ID.
  const asUserId = searchParams.get('asUser') ?? undefined;

  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Date input (shown when admin enabled allow_date_input for this form)
  const [formDate, setFormDate] = useState('');

  // Print name (shown when admin enabled allow_print_name for this form)
  const [printName, setPrintName] = useState('');

  // Assigned venue
  const [assignedVenues, setAssignedVenues] = useState<AssignedVenue[]>([]);

  // Already-submitted state
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [submittedDocs, setSubmittedDocs] = useState<{ slot: string; label: string; filename: string; url: string | null }[]>([]);

  // PDF bytes (updated by PDFFormEditor on each field change)
  const currentPdfBytesRef = useRef<Uint8Array | null>(null);

  // Document uploads — List A or List B+C
  const [docMode, setDocMode] = useState<'A' | 'BC'>('A');
  const [uploadedDocs, setUploadedDocs] = useState<Partial<Record<SlotId, UploadedDoc>>>({});
  const [uploadingSlot, setUploadingSlot] = useState<SlotId | null>(null);
  const listARef  = useRef<HTMLInputElement>(null);
  const listBRef  = useRef<HTMLInputElement>(null);
  const listCRef  = useRef<HTMLInputElement>(null);

  // Signature pad
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const loadRequestIdRef = useRef(0);

  const loadForm = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError('');
    setMeta(null);
    setPdfUrl('');
    setAssignedVenues([]);
    setAlreadySubmitted(false);
    setSubmittedAt(null);
    setSubmittedDocs([]);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }
    if (loadRequestIdRef.current !== requestId) return;
    setSessionToken(session.access_token);

    try {
      // Load assigned venue(s) for this user via service-role API (bypasses RLS on venue_reference)
      const venueUrl = asUserId
        ? `/api/my-assigned-venues?asUser=${asUserId}`
        : '/api/my-assigned-venues';
      const venueRes = await fetch(venueUrl, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (loadRequestIdRef.current !== requestId) return;
      if (venueRes.ok) {
        const venueData = await venueRes.json();
        if (loadRequestIdRef.current !== requestId) return;
        setAssignedVenues(venueData.venues ?? []);
      }

      // Fetch form list first — we need the title to build the formName key
      const listRes = await fetch('/api/custom-forms/list', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (loadRequestIdRef.current !== requestId) return;

      if (!listRes.ok) throw new Error('Failed to load forms');
      const data = await listRes.json();
      if (loadRequestIdRef.current !== requestId) return;
      const form = (data.forms as FormMeta[]).find(f => f.id === formId);
      if (!form) throw new Error('Form not found');
      setMeta(form);
      setPdfUrl(`/api/custom-forms/${formId}/pdf?token=${session.access_token}`);

      // Build the canonical form name: "{Title} {Year}"
      const savedFormName = `${form.title} ${new Date().getFullYear()}`;

      // Check if already submitted using the title-based key
      const progressRes = await fetch(
        `/api/pdf-form-progress/retrieve?formName=${encodeURIComponent(savedFormName)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (loadRequestIdRef.current !== requestId) return;
      const progressData = await progressRes.json();
      if (loadRequestIdRef.current !== requestId) return;
      if (progressData.found) {
        setAlreadySubmitted(true);
        setSubmittedAt(progressData.updatedAt ?? null);

        // Load any uploaded supporting documents
        const docsRes = await fetch(`/api/custom-forms/${formId}/docs`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (loadRequestIdRef.current !== requestId) return;
        if (docsRes.ok) {
          const docsData = await docsRes.json();
          if (loadRequestIdRef.current !== requestId) return;
          setSubmittedDocs(docsData.docs ?? []);
        }
      }
    } catch (err: any) {
      if (loadRequestIdRef.current !== requestId) return;
      setError(err.message);
    } finally {
      if (loadRequestIdRef.current !== requestId) return;
      setLoading(false);
    }
  }, [asUserId, formId, router]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  const handleSave = useCallback((bytes: Uint8Array) => {
    currentPdfBytesRef.current = bytes;
  }, []);

  // ─── Document upload ───────────────────────────────────────────────────────
  const refForSlot = (slot: SlotId) =>
    slot === 'list_a' ? listARef : slot === 'list_b' ? listBRef : listCRef;

  const handleDocUpload = async (slot: SlotId, file: File) => {
    setUploadingSlot(slot);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('slot', slot);
      if (asUserId) fd.append('targetUserId', asUserId);

      const res = await fetch(`/api/custom-forms/${formId}/upload-doc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');

      setUploadedDocs(prev => ({
        ...prev,
        [slot]: { filename: json.filename, url: json.url, storagePath: json.storagePath },
      }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploadingSlot(null);
    }
  };

  const removeDoc = (slot: SlotId) => {
    setUploadedDocs(prev => { const n = { ...prev }; delete n[slot]; return n; });
    const ref = refForSlot(slot);
    if (ref.current) ref.current.value = '';
  };

  // ─── Signature pad ─────────────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    e.preventDefault(); setIsDrawing(true); setHasSig(true);
    lastPosRef.current = getPos(e, canvas);
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPosRef.current!.x, lastPosRef.current!.y);
    ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke();
    lastPosRef.current = pos;
  };
  const endDraw = () => setIsDrawing(false);
  const clearSignature = () => {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasSig(false);
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!currentPdfBytesRef.current) {
      setError('PDF not loaded yet. Please wait a moment and try again.'); return;
    }
    if (meta?.requires_signature && !hasSig) {
      setError('Please provide your signature before submitting.'); return;
    }
    if (meta?.allow_date_input && !formDate) {
      setError('Please enter the form date before submitting.'); return;
    }
    if (meta?.allow_print_name && !printName.trim()) {
      setError('Please print your name before submitting.'); return;
    }

    setSaving(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      let finalBytes = currentPdfBytesRef.current;
      if (meta?.requires_signature && hasSig && canvasRef.current) {
        finalBytes = await embedSignatureIntoPdf(finalBytes, canvasRef.current.toDataURL('image/png'));
      }
      if (meta?.allow_date_input && formDate) {
        finalBytes = await embedDateIntoPdf(finalBytes, formDate);
      }
      if (meta?.allow_print_name && printName.trim()) {
        finalBytes = await embedPrintNameIntoPdf(finalBytes, printName.trim());
      }

      const base64 = uint8ArrayToBase64(finalBytes);
      const docSummary = Object.entries(uploadedDocs)
        .map(([slot, doc]) => `${slot}:${doc.filename}`).join('|');

      const res = await fetch('/api/pdf-form-progress/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          formName: `custom-form-${formId}`,
          formData: base64,
          ...(asUserId ? { targetUserId: asUserId } : {}),
          ...(docSummary ? { notes: docSummary } : {}),
          ...(meta?.allow_date_input && formDate ? { formDate } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');
      const redirectUserId = asUserId ?? session.user.id;
      router.push(`/employees/${redirectUserId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const uint8ArrayToBase64 = (bytes: Uint8Array) => {
    let b = '';
    for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
    return btoa(b);
  };

  const embedSignatureIntoPdf = async (pdfBytes: Uint8Array, sigDataUrl: string): Promise<Uint8Array> => {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1)!;
    const base64 = sigDataUrl.replace(/^data:image\/png;base64,/, '');
    const sigImage = await pdfDoc.embedPng(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
    const x = 40, y = 40, w = 200, h = 60;
    lastPage.drawImage(sigImage, { x, y, width: w, height: h });
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    lastPage.drawText('Employee Signature', { x, y: y + h + 4, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    // Underline baseline shared with the date field
    lastPage.drawLine({ start: { x, y: y - 2 }, end: { x: x + w, y: y - 2 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    return pdfDoc.save();
  };

  const embedPrintNameIntoPdf = async (pdfBytes: Uint8Array, name: string): Promise<Uint8Array> => {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1)!;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    lastPage.drawText('Print Name', { x: 40, y: 180, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    lastPage.drawText(name, { x: 40, y: 155, size: 11, font, color: rgb(0, 0, 0) });
    lastPage.drawLine({ start: { x: 40, y: 140 }, end: { x: 240, y: 140 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    return pdfDoc.save();
  };

  const embedDateIntoPdf = async (pdfBytes: Uint8Array, date: string): Promise<Uint8Array> => {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1)!;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    // Format: e.g. "February 24, 2026"  (avoid timezone shift by parsing as local date)
    const [y, m, d] = date.split('-').map(Number);
    const formatted = new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    // Place the date block to the right of the signature (x=330), same label height and baseline
    lastPage.drawText('Date', { x: 330, y: 104, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    lastPage.drawText(formatted, { x: 330, y: 60, size: 11, font, color: rgb(0, 0, 0) });
    // Underline at same baseline as signature field (y=38)
    lastPage.drawLine({ start: { x: 330, y: 38 }, end: { x: 510, y: 38 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    return pdfDoc.save();
  };

  // ─── Upload slot component (inline) ───────────────────────────────────────
  const UploadSlot = ({
    slot, label, examples, inputRef,
  }: {
    slot: SlotId;
    label: string;
    examples: string[];
    inputRef: React.RefObject<HTMLInputElement>;
  }) => {
    const uploaded = uploadedDocs[slot];
    const isUploading = uploadingSlot === slot;

    return (
      <div className={`rounded-xl border-2 transition-colors ${uploaded ? 'border-green-300 bg-green-50' : 'border-dashed border-gray-300 bg-white'}`}>
        {uploaded ? (
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <p className="text-xs text-gray-500 truncate">{uploaded.filename}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <a href={uploaded.url} target="_blank" rel="noopener noreferrer"
                className="text-xs font-medium text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50">
                View
              </a>
              <button onClick={() => removeDoc(slot)}
                className="text-xs font-medium text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50">
                Replace
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={isUploading}
            className="w-full flex items-start gap-4 px-4 py-4 text-left hover:bg-gray-50 transition-colors rounded-xl disabled:opacity-60">
            <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
              {isUploading ? (
                <svg className="w-4 h-4 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{isUploading ? 'Uploading…' : label}</p>
              <ul className="mt-1 space-y-0.5">
                {examples.slice(0, 3).map(ex => (
                  <li key={ex} className="text-xs text-gray-400">• {ex}</li>
                ))}
              </ul>
            </div>
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleDocUpload(slot, f); }} />
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-500 text-lg">Loading form...</p>
    </div>
  );

  if (error && !meta) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <p className="text-red-600">{error}</p>
      <button onClick={() => router.push('/employee')} className="text-blue-600 hover:underline text-sm">Back to Forms</button>
    </div>
  );

  // HR admins (asUserId present) can always edit even if already submitted
  if (alreadySubmitted && !asUserId) return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => router.push('/employee')} className="text-gray-500 hover:text-gray-700 text-sm">
          ← Back
        </button>
        <h1 className="font-semibold text-gray-900 text-lg">{meta?.title}</h1>
        <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
          Submitted
        </span>
      </div>

      <div className="max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
        {/* Submitted banner */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-green-800">This form has already been submitted</p>
            {submittedAt && (
              <p className="text-sm text-green-600 mt-0.5">
                Submitted on {new Date(submittedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            )}
            <p className="text-sm text-green-700 mt-1">
              You cannot edit or re-submit this form. Contact your manager if changes are needed.
            </p>
          </div>
        </div>

        {/* Supporting documents — read-only after submission */}
        {submittedDocs.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Supporting Documents</h3>
            <div className="space-y-2">
              {submittedDocs.map(doc => (
                <div key={doc.slot} className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-100 last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500">{doc.label}</p>
                    <p className="text-sm text-gray-900 truncate">{doc.filename}</p>
                  </div>
                  {doc.url && (
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={doc.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-1 rounded-lg hover:bg-blue-50 border border-blue-200 transition-colors">
                        View
                      </a>
                      <a href={doc.url} download={doc.filename}
                        className="text-xs font-medium text-gray-600 hover:text-gray-800 px-3 py-1 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors">
                        Download
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => router.push('/employee')}
          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 px-6 rounded-lg text-sm transition-colors">
          Back to My Forms
        </button>
      </div>
    </div>
  );

  if (saved) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-6 px-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center max-w-md w-full">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Form Submitted</h2>
        <p className="text-gray-500 text-sm mb-6">Your form and documents have been saved successfully.</p>
        <button onClick={() => router.push('/employee')}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors">
          Back to My Forms
        </button>
      </div>
    </div>
  );

  const docCount = Object.keys(uploadedDocs).length;
  // Show I-9 supporting document upload only for forms whose title contains "I-9" or "I9"
  const isI9Form = /i-?9/i.test(meta?.title ?? '');
  const assignedVenueName =
    meta?.allow_venue_display && assignedVenues.length > 0
      ? assignedVenues[0].venue_name
      : undefined;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(asUserId ? `/hr/employees/${asUserId}` : '/employee')} className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back
          </button>
          <h1 className="font-semibold text-gray-900 text-lg">{meta?.title}</h1>
          {meta?.requires_signature && (
            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              Signature required
            </span>
          )}
        </div>
        <button onClick={handleSubmit} disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors">
          {saving ? 'Saving...' : 'Submit Form'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* HR admin re-edit banner */}
      {asUserId && alreadySubmitted && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
          Editing a previously submitted form on behalf of this employee. Saving will overwrite the existing submission.
        </div>
      )}

      {/* PDF Editor */}
      <div className="flex-1" style={{ minHeight: '500px' }}>
        {pdfUrl && (
          <PDFFormEditor
            pdfUrl={pdfUrl}
            formId={meta ? `${meta.title} ${new Date().getFullYear()}` : `custom-form-${formId}`}
            onSave={handleSave}
            skipButtonDetection={true}
            assignedVenueName={assignedVenueName}
          />
        )}
      </div>

      {/* ── Assigned Venue ───────────────────────────────────────────────────── */}
      {meta?.allow_venue_display && assignedVenues.length > 0 && (
        <div className="bg-white border-t border-gray-200 px-4 py-6">
          <div className="max-w-2xl mx-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Your Assigned Venue</h3>
            <div className="flex flex-col gap-2">
              {assignedVenues.map((v) => (
                <div key={v.id} className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-blue-900">{v.venue_name}</p>
                    {(v.city || v.state) && (
                      <p className="text-xs text-blue-600">{[v.city, v.state].filter(Boolean).join(', ')}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Print Name ───────────────────────────────────────────────────────── */}
      {meta?.allow_print_name && (
        <div className="bg-white border-t border-gray-200 px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Print Name</h3>
            <p className="text-sm text-gray-500 mb-4">Type your full legal name clearly.</p>
            <input
              type="text"
              value={printName}
              onChange={e => setPrintName(e.target.value)}
              placeholder="Full legal name"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-xs"
            />
          </div>
        </div>
      )}

      {/* ── Date Input ───────────────────────────────────────────────────────── */}
      {meta?.allow_date_input && (
        <div className="bg-white border-t border-gray-200 px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Form Date</h3>
            <p className="text-sm text-gray-500 mb-4">Enter the date for this form.</p>
            <input
              type="date"
              value={formDate}
              onChange={e => setFormDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full max-w-xs"
            />
          </div>
        </div>
      )}

      {/* ── Supporting Documents (I-9 only) ──────────────────────────────────── */}
      {isI9Form && <div className="bg-white border-t border-gray-200 px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <h3 className="text-lg font-semibold text-gray-900">Supporting Documents</h3>
          <p className="text-sm text-gray-500 mt-0.5 mb-5">
            Upload documents that verify identity and work authorization.
          </p>

          {/* Mode toggle */}
          <div className="flex gap-3 mb-5">
            <button
              type="button"
              onClick={() => setDocMode('A')}
              className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all text-left ${
                docMode === 'A'
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="block text-base font-bold mb-0.5">List A</span>
              One document proving identity <em>and</em> work authorization
            </button>
            <button
              type="button"
              onClick={() => setDocMode('BC')}
              className={`flex-1 py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all text-left ${
                docMode === 'BC'
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <span className="block text-base font-bold mb-0.5">List B + List C</span>
              One identity doc <em>and</em> one work authorization doc
            </button>
          </div>

          {/* Slots */}
          <div className="space-y-3">
            {docMode === 'A' ? (
              <UploadSlot
                slot="list_a"
                label="List A — Identity & Work Authorization"
                examples={LIST_A_EXAMPLES}
                inputRef={listARef}
              />
            ) : (
              <>
                <UploadSlot
                  slot="list_b"
                  label="List B — Identity Document"
                  examples={LIST_B_EXAMPLES}
                  inputRef={listBRef}
                />
                <UploadSlot
                  slot="list_c"
                  label="List C — Work Authorization Document"
                  examples={LIST_C_EXAMPLES}
                  inputRef={listCRef}
                />
              </>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-3">Accepted: JPG, PNG, WEBP, PDF — max 10 MB each</p>
        </div>
      </div>}

      {/* ── Signature Pad ─────────────────────────────────────────────────────── */}
      {meta?.requires_signature && (
        <div className="bg-white border-t border-gray-200 px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Employee Signature</h3>
                <p className="text-sm text-gray-500">Draw your signature to certify this form.</p>
              </div>
              <button onClick={clearSignature} className="text-sm text-gray-500 hover:text-gray-700 underline">
                Clear
              </button>
            </div>
            <div className={`rounded-xl border-2 overflow-hidden ${hasSig ? 'border-blue-300 bg-blue-50/30' : 'border-dashed border-gray-300 bg-white'}`}>
              <canvas
                ref={canvasRef}
                width={640}
                height={140}
                className="w-full cursor-crosshair touch-none block"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
            </div>
            {hasSig
              ? <p className="text-xs text-blue-600 mt-2 font-medium">Signature captured ✓</p>
              : <p className="text-xs text-gray-400 mt-2 text-center">Sign using your mouse or finger</p>
            }
          </div>
        </div>
      )}

      {/* Submit bar */}
      <div className="bg-white border-t border-gray-200 px-4 py-4 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {isI9Form && `${docCount} document${docCount !== 1 ? 's' : ''} attached`}
          {meta?.requires_signature && (hasSig ? `${isI9Form ? ' · ' : ''}Signature captured` : `${isI9Form ? ' · ' : ''}Signature required`)}
        </p>
        <button onClick={handleSubmit} disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2.5 px-8 rounded-lg text-sm transition-colors">
          {saving ? 'Saving...' : 'Submit Form'}
        </button>
      </div>
    </div>
  );
}
