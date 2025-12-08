'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function MealWaiver6HourPage() {
  const router = useRouter();
  const [employeeName, setEmployeeName] = useState('');
  const [position, setPosition] = useState('');
  const [acknowledges, setAcknowledges] = useState(false);
  const [signatureDate, setSignatureDate] = useState(new Date().toISOString().split('T')[0]);
  const [signature, setSignature] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load existing data
  useEffect(() => {
    const loadExistingData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push('/login');
          return;
        }

        const response = await fetch('/api/meal-waiver?type=6_hour', {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.waiver) {
            setEmployeeName(data.waiver.employee_name || '');
            setPosition(data.waiver.position || '');
            setAcknowledges(data.waiver.acknowledges_terms || false);
            setSignatureDate(data.waiver.signature_date || new Date().toISOString().split('T')[0]);
            setSignature(data.waiver.employee_signature || '');

            // Restore signature to canvas
            if (data.waiver.employee_signature && data.waiver.employee_signature.startsWith('data:image')) {
              const canvas = canvasRef.current;
              if (canvas) {
                const ctx = canvas.getContext('2d');
                const img = new Image();
                img.onload = () => {
                  if (ctx) {
                    ctx.drawImage(img, 0, 0);
                  }
                };
                img.src = data.waiver.employee_signature;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error loading meal waiver data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadExistingData();
  }, [router]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, []);

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
      y: (clientY - rect.top) * scaleY
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
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    setSignature('');
  };

  const handleSave = async () => {
    if (!employeeName.trim()) {
      alert('Please enter your full name');
      return;
    }

    if (!acknowledges) {
      alert('Please check the acknowledgment box');
      return;
    }

    if (!signature) {
      alert('Please provide your signature');
      return;
    }

    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Session expired. Please log in again.');
        router.push('/login');
        return;
      }

      const response = await fetch('/api/meal-waiver', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({
          waiver_type: '6_hour',
          employee_name: employeeName,
          position: position,
          signature_date: signatureDate,
          employee_signature: signature,
          acknowledges_terms: acknowledges
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save meal waiver');
      }

      alert('Meal waiver saved successfully!');
    } catch (error) {
      console.error('Save error:', error);
      alert(error instanceof Error ? error.message : 'Failed to save meal waiver');
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    await handleSave();
    router.push('/payroll-packet-ca/meal-waiver-10-12');
  };

  const handleBack = () => {
    router.push('/payroll-packet-ca/form-viewer?form=notice-to-employee');
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p style={{ marginTop: '20px', color: '#666' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: '900px',
        margin: '0 auto',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        padding: '32px'
      }}>
        {/* Header */}
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '8px' }}>
            Meal Period Waiver Agreement
          </h1>
          <p style={{ fontSize: '16px', color: '#666' }}>
            For Hourly Employees Working 6 Hours or Less
          </p>
        </div>

        {/* Waiver Text */}
        <div style={{
          backgroundColor: '#f9f9f9',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          padding: '24px',
          marginBottom: '32px',
          fontSize: '14px',
          lineHeight: '1.6',
          color: '#333'
        }}>
          <p style={{ marginBottom: '16px', fontWeight: 'bold' }}>
            California Labor Code Section 512
          </p>
          <p style={{ marginBottom: '16px' }}>
            Under California law, non-exempt employees who work more than five (5) hours in a workday are entitled to a thirty (30) minute unpaid meal period. However, if your total workday is <strong>no more than six (6) hours</strong>, you may voluntarily agree to waive this meal period.
          </p>
          <p style={{ marginBottom: '16px' }}>
            By signing this waiver, I acknowledge that:
          </p>
          <ul style={{ marginLeft: '24px', marginBottom: '16px' }}>
            <li style={{ marginBottom: '8px' }}>I understand my right to take an unpaid 30-minute meal period when working more than 5 hours per day.</li>
            <li style={{ marginBottom: '8px' }}>I voluntarily choose to waive this meal period when my total work period is 6 hours or less.</li>
            <li style={{ marginBottom: '8px' }}>I may revoke this waiver at any time by providing written notice to my employer.</li>
            <li style={{ marginBottom: '8px' }}>This waiver only applies when my total work period does not exceed 6 hours.</li>
          </ul>
          <p style={{ fontStyle: 'italic', color: '#666' }}>
            This agreement is voluntary and does not affect my rights under California labor law for shifts exceeding 6 hours.
          </p>
        </div>

        {/* Form Fields */}
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
                outline: 'none'
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
                outline: 'none'
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
                outline: 'none'
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#1976d2')}
              onBlur={(e) => (e.currentTarget.style.borderColor = '#ddd')}
            />
          </div>

          {/* Acknowledgment Checkbox */}
          <div style={{
            marginBottom: '24px',
            padding: '16px',
            backgroundColor: '#fff3e0',
            border: '2px solid #ff9800',
            borderRadius: '6px'
          }}>
            <label style={{ display: 'flex', alignItems: 'start', gap: '12px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={acknowledges}
                onChange={(e) => setAcknowledges(e.target.checked)}
                style={{
                  width: '20px',
                  height: '20px',
                  marginTop: '2px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ fontSize: '14px', color: '#333', lineHeight: '1.5' }}>
                <strong>I acknowledge and agree</strong> that I have read and understand this meal period waiver agreement. I am voluntarily choosing to waive my meal period for shifts of 6 hours or less, and I understand that I may revoke this waiver at any time.
              </span>
            </label>
          </div>

          {/* Signature Section */}
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
                    fontSize: '14px'
                  }}
                >
                  Clear Signature
                </button>
              )}
            </div>

            <div style={{
              border: '2px solid #ddd',
              borderRadius: '6px',
              overflow: 'hidden',
              backgroundColor: 'white'
            }}>
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
                style={{
                  width: '100%',
                  height: '200px',
                  cursor: 'crosshair',
                  touchAction: 'none'
                }}
              />
            </div>
            <p style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
              Draw your signature above using your mouse or touchscreen
            </p>

            {signature && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                backgroundColor: '#e8f5e9',
                border: '1px solid #4caf50',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
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

        {/* Navigation Buttons */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 0',
          borderTop: '1px solid #e0e0e0',
          marginTop: '32px'
        }}>
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
              fontSize: '16px'
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
                fontSize: '16px'
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
                fontSize: '16px'
              }}
              onMouseOver={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#1565c0';
              }}
              onMouseOut={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#1976d2';
              }}
            >
              Save & Continue →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
