'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PDFFormEditor from '@/app/components/PDFFormEditor';

type FormMeta = {
  id: string;
  title: string;
  requires_signature: boolean;
};

export default function EmployeeFormPage() {
  const router = useRouter();
  const params = useParams();
  const formId = params.id as string;

  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Current PDF bytes (updated by PDFFormEditor on every field change)
  const currentPdfBytesRef = useRef<Uint8Array | null>(null);

  // Signature pad
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    loadForm();
  }, [formId]);

  const loadForm = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }

    try {
      // Load form metadata from the list
      const res = await fetch('/api/custom-forms/list', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to load forms');
      const data = await res.json();
      const form = (data.forms as FormMeta[]).find(f => f.id === formId);
      if (!form) throw new Error('Form not found');
      setMeta(form);

      // Build the PDF URL (the API route streams the PDF with auth)
      // We pass the token as a query param so PDFFormEditor can fetch it
      setPdfUrl(`/api/custom-forms/${formId}/pdf?token=${session.access_token}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Update the PDF proxy route to also accept ?token= query param
  // PDFFormEditor fetches the URL with an Authorization header if session exists

  const handleSave = useCallback((bytes: Uint8Array) => {
    currentPdfBytesRef.current = bytes;
  }, []);

  // ─── Signature pad helpers ────────────────────────────────────────────────
  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    setIsDrawing(true);
    setHasSig(true);
    lastPosRef.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current!.x, lastPosRef.current!.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPosRef.current = pos;
  };

  const endDraw = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!currentPdfBytesRef.current) {
      setError('PDF not loaded yet. Please wait a moment and try again.');
      return;
    }

    if (meta?.requires_signature && !hasSig) {
      setError('Please provide your signature before submitting.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      let finalBytes = currentPdfBytesRef.current;

      // Embed signature into the PDF if required
      if (meta?.requires_signature && hasSig && canvasRef.current) {
        const sigDataUrl = canvasRef.current.toDataURL('image/png');
        finalBytes = await embedSignatureIntoPdf(finalBytes, sigDataUrl);
      }

      // Convert to base64
      const base64 = uint8ArrayToBase64(finalBytes);

      const res = await fetch('/api/pdf-form-progress/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          formName: `custom-form-${formId}`,
          formData: base64,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save');

      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const embedSignatureIntoPdf = async (pdfBytes: Uint8Array, sigDataUrl: string): Promise<Uint8Array> => {
    const { PDFDocument, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    // Convert data URL to Uint8Array
    const base64 = sigDataUrl.replace(/^data:image\/png;base64,/, '');
    const sigBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const sigImage = await pdfDoc.embedPng(sigBytes);

    const sigWidth = 200;
    const sigHeight = 60;
    const x = 40;
    const y = 40;

    lastPage.drawImage(sigImage, {
      x,
      y,
      width: sigWidth,
      height: sigHeight,
    });

    // Add "Employee Signature" label
    const { StandardFonts } = await import('pdf-lib');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    lastPage.drawText('Employee Signature', {
      x,
      y: y + sigHeight + 4,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });

    return pdfDoc.save();
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading form...</p>
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <p className="text-red-600">{error}</p>
        <button onClick={() => router.push('/employee')} className="text-blue-600 hover:underline text-sm">
          Back to Forms
        </button>
      </div>
    );
  }

  if (saved) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-6 px-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center max-w-md w-full">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Form Submitted</h2>
          <p className="text-gray-500 text-sm mb-6">
            Your filled form has been saved successfully.
          </p>
          <button
            onClick={() => router.push('/employee')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors"
          >
            Back to My Forms
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/employee')}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            ← Back
          </button>
          <h1 className="font-semibold text-gray-900 text-lg">{meta?.title}</h1>
          {meta?.requires_signature && (
            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              Signature required
            </span>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving...' : 'Submit Form'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* PDF Editor */}
      <div className="flex-1" style={{ minHeight: '600px' }}>
        {pdfUrl && (
          <PDFFormEditor
            pdfUrl={pdfUrl}
            formId={`custom-form-${formId}`}
            onSave={handleSave}
            skipButtonDetection={true}
          />
        )}
      </div>

      {/* Signature Pad (shown only if required) */}
      {meta?.requires_signature && (
        <div className="bg-white border-t border-gray-200 px-4 py-6">
          <div className="max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">Your Signature</h3>
              <button
                onClick={clearSignature}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear
              </button>
            </div>
            <canvas
              ref={canvasRef}
              width={560}
              height={120}
              className="w-full border-2 border-dashed border-gray-300 rounded-lg bg-white cursor-crosshair touch-none"
              style={{ maxWidth: '100%' }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
            />
            <p className="text-xs text-gray-400 mt-2 text-center">
              Draw your signature above using your mouse or touch
            </p>
          </div>
        </div>
      )}

      {/* Submit bar at bottom */}
      <div className="bg-white border-t border-gray-200 px-4 py-4 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-2.5 px-8 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving...' : 'Submit Form'}
        </button>
      </div>
    </div>
  );
}
