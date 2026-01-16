'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type WaiverType = '6_hour' | '10_hour' | '12_hour';

type MealWaiverFormProps = {
  stateName: string;
  basePath: string;
  title: string;
  description: string;
  allowedTypes: WaiverType[];
  backHref: string;
  nextHref: string | null;
  isLastForm?: boolean;
  showTypeSelector?: boolean;
  signatureFormId?: string;
  signatureFormType?: string;
};

const getDefaultDate = () => new Date().toISOString().split('T')[0];

export default function MealWaiverForm({
  stateName,
  basePath,
  title,
  description,
  allowedTypes,
  backHref,
  nextHref,
  isLastForm = false,
  showTypeSelector = true,
  signatureFormId,
  signatureFormType,
}: MealWaiverFormProps) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<WaiverType>(allowedTypes[0]);
  const [employeeName, setEmployeeName] = useState('');
  const [position, setPosition] = useState('');
  const [acknowledges, setAcknowledges] = useState(false);
  const [signatureDate, setSignatureDate] = useState(getDefaultDate());
  const [signature, setSignature] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSavedSignatureRef = useRef<string | null>(null);

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
      setSignatureDate(getDefaultDate());
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
            setSignatureDate(data.waiver.signature_date || getDefaultDate());
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
    loadExistingData(selectedType);
  }, [selectedType, loadExistingData]);

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

  const saveSignatureToDatabase = async (signatureData: string, sessionToken?: string | null) => {
    if (!signatureFormId || !signatureFormType) return;

    const signatureKey = `${signatureFormId}_${selectedType}_${signatureData}`;
    if (lastSavedSignatureRef.current === signatureKey) {
      return;
    }

    try {
      const formDataForSignature = JSON.stringify({
        waiver_type: selectedType,
        employee_name: employeeName,
        position,
        signature_date: signatureDate,
        acknowledges_terms: acknowledges,
      });

      const response = await fetch('/api/form-signatures/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          formId: signatureFormId,
          formType: signatureFormType,
          signatureData,
          formData: formDataForSignature,
        }),
      });

      if (response.ok) {
        lastSavedSignatureRef.current = signatureKey;
      } else {
        const error = await response.json();
        console.error('[MEAL WAIVER] Failed to save signature:', error);
      }
    } catch (error) {
      console.error('[MEAL WAIVER] Exception saving signature:', error);
    }
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
          waiver_type: selectedType,
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

      await saveSignatureToDatabase(signature, session?.access_token);
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
    const saved = await handleSave();
    if (saved) {
      if (isLastForm || !nextHref) {
        // Last form completed - mark onboarding as completed and redirect to login
        console.log('[MEAL WAIVER] Last form completed, completing onboarding workflow');
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          const response = await fetch('/api/onboarding-notification', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({
              form: 'meal-waiver',
              trigger: 'save-finish',
            }),
          });

          if (!response.ok) {
            console.error('[MEAL WAIVER] Failed to send onboarding notification');
          } else {
            console.log('[MEAL WAIVER] Onboarding notification sent successfully');
          }
        } catch (error) {
          console.error('[MEAL WAIVER] Error sending onboarding notification:', error);
        }

        // Redirect to login regardless of notification success
        router.push('/login');
      } else {
        router.push(nextHref);
      }
    }
  };

  const handleBack = () => {
    router.push(backHref);
  };

  const typeLabel = selectedType === '6_hour' ? '6 Hour Waiver' : selectedType === '10_hour' ? '10 Hour Waiver' : '12 Hour Waiver';

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p style={{ marginTop: '20px', color: '#666' }}>Loading...</p>
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
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          padding: '32px',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          {showTypeSelector && allowedTypes.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: '12px',
                marginBottom: '16px',
                flexWrap: 'wrap',
              }}
            >
              {allowedTypes.map((type) => {
                const isActive = type === selectedType;
                const label = type === '10_hour' ? '10-hour waiver' : type === '12_hour' ? '12-hour waiver' : '6-hour waiver';
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
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
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          <p style={{ fontSize: '14px', color: '#555', margin: 0 }}>{description}</p>
        </div>

        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '8px' }}>{title}</h1>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '8px' }}>{stateName} hourly employees</p>
          <p style={{ fontSize: '14px', color: '#444' }}>
            This web form captures your consent to waive a meal period when the shift length matches the selection above. Please read and sign below.
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
          <p style={{ marginBottom: '16px', fontWeight: 'bold' }}>What this waiver means</p>
          <p style={{ marginBottom: '16px' }}>
            You are choosing to waive a meal period for the selected shift length. You may revoke this waiver at any time by notifying your manager and taking your entitled meal period.
          </p>
          <ul style={{ marginLeft: '24px', marginBottom: '16px' }}>
            <li style={{ marginBottom: '8px' }}>You understand your right to an unpaid 30-minute meal period.</li>
            <li style={{ marginBottom: '8px' }}>You are voluntarily waiving that period for the shift length selected above ({typeLabel}).</li>
            <li style={{ marginBottom: '8px' }}>You can always choose to take a meal period on any day by informing your supervisor.</li>
            <li style={{ marginBottom: '8px' }}>This waiver may be revoked by you at any time.</li>
          </ul>
          <p style={{ fontStyle: 'italic', color: '#666' }}>
            Signing below records your consent so you can continue through the payroll packet without downloading a separate PDF.
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
                <strong>I acknowledge and agree</strong> that I have read and understand this meal period waiver. I voluntarily waive the applicable meal period for the shift length shown above and understand I may revoke the waiver at any time.
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
            Back
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
              {saving ? 'Saving...' : 'Save'}
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
              {isLastForm || !nextHref ? 'Save & Finish' : 'Save & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
