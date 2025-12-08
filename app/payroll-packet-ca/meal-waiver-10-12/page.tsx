'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type WaiverType = '10_hour' | '12_hour';

const WAIVER_OPTIONS: { value: WaiverType; title: string; description: string }[] = [
  {
    value: '10_hour',
    title: '10-hour waiver',
    description: 'Use this version when your shift is scheduled for up to ten hours and you are waiving the second meal period.',
  },
  {
    value: '12_hour',
    title: '12-hour waiver',
    description: 'Use this version when your shift extends to twelve hours and you need to waive the second and third meal periods.',
  },
];

const getDefaultSignatureDate = () => new Date().toISOString().split('T')[0];

export default function MealWaiver10to12Page() {
  const router = useRouter();
  const [selectedWaiverType, setSelectedWaiverType] = useState<WaiverType>('10_hour');
  const [employeeName, setEmployeeName] = useState('');
  const [position, setPosition] = useState('');
  const [acknowledges, setAcknowledges] = useState(false);
  const [signatureDate, setSignatureDate] = useState(getDefaultSignatureDate());
  const [signature, setSignature] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const restoreSignatureOnCanvas = useCallback(
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
    [clearCanvas]
  );

  const loadExistingData = useCallback(
    async (type: WaiverType) => {
      setLoading(true);
      setAcknowledges(false);
      setEmployeeName('');
      setPosition('');
      setSignatureDate(getDefaultSignatureDate());
      setSignature('');
      clearCanvas();

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          router.push('/login');
          return;
        }

        const response = await fetch(`/api/meal-waiver?type=${type}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.waiver) {
            setEmployeeName(data.waiver.employee_name || '');
            setPosition(data.waiver.position || '');
            setAcknowledges(data.waiver.acknowledges_terms || false);
            setSignatureDate(data.waiver.signature_date || getDefaultSignatureDate());
            const savedSignature = data.waiver.employee_signature || '';
            setSignature(savedSignature);
            if (savedSignature.startsWith('data:image')) {
              restoreSignatureOnCanvas(savedSignature);
            } else {
              clearCanvas();
            }
          }
        }
      } catch (error) {
        console.error('Error loading meal waiver data:', error);
      } finally {
        setLoading(false);
      }
    },
    [router, clearCanvas, restoreSignatureOnCanvas]
  );

  useEffect(() => {
    loadExistingData(selectedWaiverType);
  }, [selectedWaiverType, loadExistingData]);

  useEffect(() => {
    clearCanvas();
  }, [clearCanvas]);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

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
    if (!employeeName.trim()) {
      alert('Please enter your full name');
      return false;
    }

    if (!acknowledges) {
      alert('Please check the acknowledgment box');
      return false;
    }

    if (!signature) {
      alert('Please provide your signature');
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
          waiver_type: selectedWaiverType,
          employee_name: employeeName,
          position: position,
          signature_date: signatureDate,
          employee_signature: signature,
          acknowledges_terms: acknowledges,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save meal waiver');
      }

      alert('Meal waiver saved successfully!');
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
    const ok = await handleSave();
    if (!ok) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('/api/onboarding-notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ form: 'meal-waiver-10-12', trigger: 'save-finish', state: 'ca' }),
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = await resp.text(); } catch {}
        console.warn('[MEAL-WAIVER-10-12] Onboarding notification failed:', resp.status, detail);
      }
    } catch (e) {
      console.warn('[MEAL-WAIVER-10-12] Onboarding notification exception:', e);
    }

    router.push('/payroll-packet-ca/employee-information');
  };

  const handleBack = () => {
    router.push('/payroll-packet-ca/meal-waiver-6hour');
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p style={{ marginTop: '20px', color: '#666' }}>Loading...</p>
      </div>
    );
  }

  const currentOption = WAIVER_OPTIONS.find((option) => option.value === selectedWaiverType);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: '24px' }}>
      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          padding: '32px',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '16px',
              flexWrap: 'wrap',
            }}
          >
            {WAIVER_OPTIONS.map((option) => {
              const isActive = option.value === selectedWaiverType;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedWaiverType(option.value)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '999px',
                    border: isActive ? '2px solid #1976d2' : '1px solid #ddd',
                    backgroundColor: isActive ? '#e3f2fd' : '#fff',
                    fontWeight: isActive ? 'bold' : '500',
                    cursor: 'pointer',
                    color: '#1a1a1a',
                  }}
                >
                  {option.title}
                </button>
              );
            })}
          </div>
          {currentOption && (
            <p style={{ fontSize: '14px', color: '#555', margin: 0 }}>
              {currentOption.description}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '8px' }}>
            Meal Period Waiver Agreement
          </h1>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '8px' }}>
            For Hourly Employees Working 10 or 12 Hours
          </p>
          <p style={{ fontSize: '14px', color: '#444' }}>
            This digital form mirrors the official "Meal Period Waiver - 10 12 Hour (Hourly Employees)" agreement so you can submit it alongside the rest of your onboarding paperwork.
          </p>
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
          <p style={{ marginBottom: '16px', fontWeight: 'bold' }}>
            California Labor Code Section 512
          </p>
          <p style={{ marginBottom: '16px' }}>
            Under California law, non-exempt employees who work more than five (5) hours in a workday are entitled to a thirty (30) minute unpaid meal period. This waiver lets you document that you will voluntarily waive the second (and third, if applicable) meal period for the duration of a long shift.
          </p>
          <p style={{ marginBottom: '16px' }}>By signing this waiver, I acknowledge that:</p>
          <ul style={{ marginLeft: '24px', marginBottom: '16px' }}>
            <li style={{ marginBottom: '8px' }}>I understand my right to take an unpaid 30-minute meal period when working more than 5 hours.</li>
            <li style={{ marginBottom: '8px' }}>I voluntarily choose to waive the second meal period when my workday spans ten hours, or both the second and third meal periods when it spans twelve hours.</li>
            <li style={{ marginBottom: '8px' }}>I may revoke this waiver at any time by providing written notice to my employer.</li>
            <li style={{ marginBottom: '8px' }}>This waiver is only in effect for the specific shift length selected above.</li>
          </ul>
          <p style={{ fontStyle: 'italic', color: '#666' }}>
            Signing this agreement does not affect other rights you have under California labor law for shifts that exceed twelve hours.
          </p>
        </div>

        <div style={{ marginBottom: '32px' }}>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
              Full Name <span style={{ color: '#d32f2f' }}>*</span>
            </label>
            <input
              type="text"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Enter your full legal name"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#1976d2')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#ddd')}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
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
                border: '2px solid #ddd',
                borderRadius: '6px',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#1976d2')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#ddd')}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
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
                border: '2px solid #ddd',
                borderRadius: '6px',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#1976d2')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#ddd')}
            />
          </div>

          <div
            style={{
              marginBottom: '24px',
              padding: '16px',
              backgroundColor: '#fff3e0',
              border: '2px solid #ff9800',
              borderRadius: '6px',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'start', gap: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={acknowledges}
                onChange={(e) => setAcknowledges(e.target.checked)}
                style={{ width: '20px', height: '20px', marginTop: '2px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '14px', color: '#333', lineHeight: '1.5' }}>
                <strong>I acknowledge and agree</strong> that I have read and understand this meal period waiver agreement and the shift length selected above. I voluntarily waive the required meal periods for this shift length and understand I may revoke the waiver at any time.
              </span>
            </label>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <label style={{ fontWeight: 'bold', color: '#333' }}>
                Employee Signature <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              {signature && (
                <button
                  onClick={clearSignature}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Clear Signature
                </button>
              )}
            </div>

            <div style={{ border: '2px solid #ddd', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'white' }}>
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
            <p style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
              Draw your signature above using your mouse or touchscreen
            </p>

            {signature && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  backgroundColor: '#e8f5e9',
                  border: '1px solid #4caf50',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <svg style={{ width: '20px', height: '20px', fill: '#4caf50' }} viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
                <span style={{ color: '#2e7d32', fontWeight: 'bold', fontSize: '14px' }}>
                  Signature captured
                </span>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 0',
            borderTop: '1px solid #e0e0e0',
            marginTop: '32px',
          }}
        >
          <button
            onClick={handleBack}
            style={{
              padding: '12px 24px',
              backgroundColor: '#f5f5f5',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '16px',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#e0e0e0')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
          >
            ← Back
          </button>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#ccc' : '#666',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
              }}
              onMouseOver={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#555';
              }}
              onMouseOut={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#666';
              }}
            >
              {saving ? '💾 Saving...' : '💾 Save'}
            </button>

            <button
              onClick={handleContinue}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#ccc' : '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
              }}
              onMouseOver={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#1565c0';
              }}
              onMouseOut={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#1976d2';
              }}
            >
              Save & Finish
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
