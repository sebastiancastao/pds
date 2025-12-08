'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const WAIVER_TYPE = '10_hour';

const getDefaultDate = () => new Date().toISOString().split('T')[0];

const waiverHighlights = [
  'When working more than 10 hours in a workday, I am entitled to a second 30-minute unpaid meal period.',
  'If my work schedule lasts for more than 10 hours but less than 12 hours, I prefer to waive the second 30-minute unpaid meal period instead of extending my workday by another thirty minutes.',
  'This waiver is only valid if I have properly taken my first 30-minute meal period of the workday.',
  'This waiver is only permissible when my shift will be less than 12 hours.',
];

const generalTerms = [
  'On any day I choose to take a meal period (including shifts more than 5 but less than 6 hours, or more than 10 but no more than 12 hours), I may do so by informing my supervisor.',
  'My employer has not encouraged me to skip meals, and I have the opportunity to take my 30-minute meal period on any day I wish.',
  'I have read this waiver, understand it, and agree voluntarily without coercion by my employer.',
  'I may revoke this meal period waiver at any time.',
];

export default function MealWaiver10to12NYPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [signatureDate, setSignatureDate] = useState(getDefaultDate());
  const [signature, setSignature] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const restoreSignature = useCallback(
    (dataUrl?: string) => {
      if (!dataUrl) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      clearCanvas();
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = dataUrl;
    },
    [clearCanvas],
  );

  const loadExisting = useCallback(async () => {
    setLoading(true);
    setFullName('');
    setPosition('');
    setSignatureDate(getDefaultDate());
    setSignature('');
    setAcknowledged(false);
    clearCanvas();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const response = await fetch(`/api/meal-waiver?type=${WAIVER_TYPE}`, {
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.waiver) {
          setFullName(data.waiver.employee_name || '');
          setPosition(data.waiver.position || '');
          setSignatureDate(data.waiver.signature_date || getDefaultDate());
          setAcknowledged(Boolean(data.waiver.acknowledges_terms));
          const savedSignature = data.waiver.employee_signature || '';
          setSignature(savedSignature);
          if (savedSignature.startsWith('data:image')) {
            restoreSignature(savedSignature);
          }
        }
      }
    } catch (error) {
      console.error('Error loading 10-12 hour meal waiver:', error);
    } finally {
      setLoading(false);
    }
  }, [router, restoreSignature, clearCanvas]);

  useEffect(() => {
    clearCanvas();
    loadExisting();
  }, [clearCanvas, loadExisting]);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL();
      setSignature(dataUrl);
    }
  };

  const clearSignature = () => {
    clearCanvas();
    setSignature('');
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      alert('Please enter your printed name.');
      return false;
    }
    if (!acknowledged) {
      alert('Please acknowledge the terms of this waiver.');
      return false;
    }
    if (!signature) {
      alert('Please provide your signature.');
      return false;
    }

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        alert('Session expired. Please log in again.');
        router.push('/login');
        return false;
      }

      const response = await fetch('/api/meal-waiver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          waiver_type: WAIVER_TYPE,
          employee_name: fullName.trim(),
          position: position.trim() || null,
          signature_date: signatureDate,
          employee_signature: signature,
          acknowledges_terms: acknowledged,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save meal waiver');
      }

      alert('Meal waiver saved successfully.');
      return true;
    } catch (error) {
      console.error('Save error:', error);
      alert(error instanceof Error ? error.message : 'Failed to save meal waiver');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    const saved = await handleSave();
    if (saved) {
      router.push('/payroll-packet-ny/form-viewer?form=state-tax');
    }
  };

  const handleBack = () => {
    router.push('/payroll-packet-ny/meal-waiver-6hour');
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p style={{ marginTop: '20px', color: '#666' }}>Loading 10-12 hour waiver...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: '24px' }}>
      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          backgroundColor: 'white',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '8px' }}>
            Meal Period Waiver Agreement
          </h1>
          <p style={{ fontSize: '16px', color: '#666' }}>For Hourly Employees Working 10-12 Hours</p>
        </div>

        <div
          style={{
            backgroundColor: '#f9f9f9',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            padding: '24px',
            marginBottom: '32px',
            fontSize: '14px',
            lineHeight: '1.6',
            color: '#333',
          }}
        >
          <p style={{ marginBottom: '16px', fontWeight: 'bold' }}>10-12 Hour Break Waiver</p>
          <p style={{ marginBottom: '16px' }}>
            This captures the statements from the "Meal Period Waiver - 10-12 Hour (Hourly Employees)" document. Please review
            carefully before signing.
          </p>
          <ul style={{ marginLeft: '24px', marginBottom: '16px' }}>
            {waiverHighlights.map((item) => (
              <li key={item} style={{ marginBottom: '8px' }}>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: '16px', fontWeight: 'bold' }}>General Terms</p>
          <ul style={{ marginLeft: '24px', marginBottom: '16px' }}>
            {generalTerms.map((item) => (
              <li key={item} style={{ marginBottom: '8px' }}>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ fontStyle: 'italic', color: '#666' }}>
            This waiver can be revoked by you at any time by notifying your supervisor.
          </p>
        </div>

        <section
          style={{
            backgroundColor: '#fff9f0',
            border: '1px solid #f6c07b',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <label style={{ display: 'flex', gap: '12px', alignItems: 'start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              style={{ width: '20px', height: '20px', marginTop: '2px' }}
            />
            <span style={{ color: '#7c2d12', fontSize: '14px' }}>
              I acknowledge I have read and agree to the 10-12 hour meal period waiver statements above, and I understand I may revoke this waiver at any time.
            </span>
          </label>
        </section>

        <section
          style={{
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', color: '#111827', marginBottom: '8px' }}>
              Name (print) <span style={{ color: '#d32f2f' }}>*</span>
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full legal name"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #d1d5db',
                borderRadius: '6px',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', color: '#111827', marginBottom: '8px' }}>
              Position/Job Title
            </label>
            <input
              type="text"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g., Merchandise Vendor"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #d1d5db',
                borderRadius: '6px',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', color: '#111827', marginBottom: '8px' }}>
              Date <span style={{ color: '#d32f2f' }}>*</span>
            </label>
            <input
              type="date"
              value={signatureDate}
              onChange={(e) => setSignatureDate(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #d1d5db',
                borderRadius: '6px',
              }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <label style={{ fontWeight: 'bold', color: '#111827' }}>
                Signature <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              {signature && (
                <button
                  type="button"
                  onClick={clearSignature}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: '#d14343',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Clear signature
                </button>
              )}
            </div>

            <div style={{ border: '2px solid #d1d5db', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'white' }}>
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                style={{ width: '100%', height: '200px', cursor: 'crosshair', touchAction: 'none' }}
              />
            </div>
            <p style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>Draw your signature above using your mouse or touchscreen.</p>
          </div>
        </section>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            style={{
              padding: '12px 24px',
              backgroundColor: '#f3f4f6',
              color: '#111827',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '16px',
            }}
          >
            Back
          </button>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#9ca3af' : '#4b5563',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#9ca3af' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
              }}
            >
              Save & Continue
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
