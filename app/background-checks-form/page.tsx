'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { supabase } from '@/lib/supabase';

// Dynamically import PDFFormEditor to avoid SSR issues
const PDFFormEditor = dynamicImport(() => import('@/app/components/PDFFormEditor'), {
  ssr: false,
  loading: () => <div style={{ padding: '20px', textAlign: 'center' }}>Loading PDF editor...</div>
});

export default function BackgroundChecksForm() {
  const router = useRouter();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const [signatures, setSignatures] = useState<Map<string, string>>(new Map());
  const [currentSignature, setCurrentSignature] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [signatureMode, setSignatureMode] = useState<'type' | 'draw'>('type');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);

  // Check if user is authorized to access this form
  useEffect(() => {
    const checkAccess = async () => {
      console.log('[BACKGROUND CHECK PAGE] Starting access check...');

      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('[BACKGROUND CHECK PAGE] Session error:', sessionError);
      }

      if (!session) {
        console.log('[BACKGROUND CHECK PAGE] ❌ No session found, redirecting to login');
        router.push('/login');
        return;
      }

      console.log('[BACKGROUND CHECK PAGE] ✅ Session found:', {
        userId: session.user.id,
        email: session.user.email
      });

      // Check if they've already completed the background check (database column)
      console.log('[BACKGROUND CHECK PAGE] Checking background_check_completed status...');

      const { data: userData, error: userError } = await (supabase
        .from('users')
        .select('background_check_completed')
        .eq('id', session.user.id)
        .single() as any);

      if (userError) {
        console.error('[BACKGROUND CHECK PAGE] Error fetching user data:', userError);
      }

      console.log('[BACKGROUND CHECK PAGE] User data:', userData);
      console.log('[BACKGROUND CHECK PAGE] background_check_completed value:', userData?.background_check_completed);

      if (userData?.background_check_completed === true) {
        // Already completed - redirect to dashboard
        console.log('[BACKGROUND CHECK PAGE] ✅ Background check already completed, redirecting to dashboard');
        router.push('/dashboard');
        return;
      }

      // Authorized to access (background check not completed)
      console.log('[BACKGROUND CHECK PAGE] ⚠️ Background check not completed - ALLOWING ACCESS');
      console.log('[BACKGROUND CHECK PAGE] User can now complete the form');
      setIsAuthorized(true);
    };

    checkAccess();
  }, [router]);

  // Handle PDF save from editor
  const handlePDFSave = (pdfBytes: Uint8Array) => {
    console.log(`[BACKGROUND CHECK FORM] onSave called with ${pdfBytes.length} bytes`);
    pdfBytesRef.current = pdfBytes;
    console.log('[BACKGROUND CHECK FORM] pdfBytesRef.current updated');
  };

  // Handle field change - trigger auto-save after debounce
  const handleFieldChange = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      handleManualSave();
    }, 3000); // Auto-save 3 seconds after user stops typing
  };

  // Manual save function - saves to background_check_pdfs table
  const handleManualSave = async () => {
    if (!pdfBytesRef.current) {
      console.warn('[SAVE] No PDF data to save');
      return;
    }

    try {
      console.log(`[SAVE] Starting save process, PDF size: ${pdfBytesRef.current.length} bytes`);
      setSaveStatus('saving');

      // Get session for authentication
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.error('[SAVE] No session found');
        setSaveStatus('error');
        return;
      }

      // Convert Uint8Array to base64
      const base64 = btoa(
        Array.from(pdfBytesRef.current)
          .map(byte => String.fromCharCode(byte))
          .join('')
      );
      console.log(`[SAVE] Converted to base64, length: ${base64.length} characters`);

      // Determine signature type
      const signatureType = currentSignature ?
        (currentSignature.startsWith('data:image') ? 'draw' : 'type') :
        null;

      // Save to background_check_pdfs table
      console.log(`[SAVE] Saving to background_check_pdfs table`);
      console.log(`[SAVE] Signature type:`, signatureType);

      const response = await fetch('/api/background-waiver/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          pdfData: base64,
          signature: currentSignature || null,
          signatureType: signatureType
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[SAVE] ✅ Save successful:', result);
        setSaveStatus('saved');
        setLastSaved(new Date());
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        const error = await response.json();
        console.error('[SAVE] ❌ Save failed:', error);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } catch (error) {
      console.error('[SAVE] ❌ Save exception:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // Continue to next step (dashboard or next form)
  const handleContinue = async () => {
    console.log('Continue clicked, pdfBytesRef:', pdfBytesRef.current ? 'has data' : 'null');

    // Check if signature is required but not provided
    if (!currentSignature) {
      alert('Please provide your signature before continuing.');
      return;
    }

    setSaveStatus('saving');

    try {
      // Save before continuing if we have data
      if (pdfBytesRef.current) {
        console.log('Saving before continue...');
        await handleManualSave();
        console.log('Save completed');
      }

      // Mark background check as completed in database
      console.log('[BACKGROUND CHECK] Marking as completed...');
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        alert('Session expired. Please log in again.');
        router.push('/login');
        return;
      }

      const response = await fetch('/api/background-waiver/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        credentials: 'same-origin',
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[BACKGROUND CHECK] Failed to mark as completed:', error);
        alert('Failed to complete background check. Please try again.');
        setSaveStatus('error');
        return;
      }

      console.log('[BACKGROUND CHECK] ✅ Marked as completed');

      // Clear the new user onboarding flag
      sessionStorage.removeItem('new_user_onboarding');

      // Navigate to dashboard
      setSaveStatus('saved');
      router.push('/dashboard');

    } catch (error) {
      console.error('[BACKGROUND CHECK] Error:', error);
      alert('An error occurred. Please try again.');
      setSaveStatus('error');
    }
  };

  const handleBack = () => {
    router.push('/dashboard');
  };

  // Signature canvas handlers
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return { x, y };
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
      setCurrentSignature(dataUrl);
    }
  };

  const handleSignatureChange = (value: string) => {
    setCurrentSignature(value);
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
    setCurrentSignature('');
  };

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && signatureMode === 'draw') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [signatureMode]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Show loading state while checking authorization
  if (!isAuthorized) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '50px',
            height: '50px',
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #1976d2',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }} />
          <p style={{ color: '#666', fontSize: '16px' }}>Checking access...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        padding: '16px 24px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>Background Check Waiver</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#666' }}>
            Please review and sign the background check waiver form. Your progress is automatically saved.
          </p>
        </div>

        {/* Save Status Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '14px'
        }}>
          {saveStatus === 'saving' && (
            <span style={{ color: '#1976d2' }}>💾 Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span style={{ color: '#2e7d32' }}>✓ Saved</span>
          )}
          {saveStatus === 'error' && (
            <span style={{ color: '#d32f2f' }}>⚠ Save failed</span>
          )}
          {lastSaved && (
            <span style={{ color: '#666', fontSize: '12px' }}>
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* PDF Editor */}
      <div style={{
        flex: 1,
        padding: '24px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ flex: 1, marginBottom: '20px' }}>
          <PDFFormEditor
            key="background-waiver"
            pdfUrl="/api/background-waiver"
            formId="background-waiver"
            onSave={handlePDFSave}
            onFieldChange={handleFieldChange}
            onContinue={handleContinue}
          />
        </div>

        {/* Signature Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '20px'
        }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 'bold' }}>
            Signature Required
          </h2>

          {/* Signature Mode Toggle */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <button
              onClick={() => setSignatureMode('type')}
              style={{
                padding: '8px 16px',
                backgroundColor: signatureMode === 'type' ? '#1976d2' : '#f5f5f5',
                color: signatureMode === 'type' ? 'white' : '#333',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Type Signature
            </button>
            <button
              onClick={() => setSignatureMode('draw')}
              style={{
                padding: '8px 16px',
                backgroundColor: signatureMode === 'draw' ? '#1976d2' : '#f5f5f5',
                color: signatureMode === 'draw' ? 'white' : '#333',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              Draw Signature
            </button>
            {currentSignature && (
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
                  marginLeft: 'auto'
                }}
              >
                Clear Signature
              </button>
            )}
          </div>

          {/* Type Signature Mode */}
          {signatureMode === 'type' && (
            <div>
              <input
                type="text"
                value={currentSignature}
                onChange={(e) => handleSignatureChange(e.target.value)}
                placeholder="Type your full name here"
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '24px',
                  fontFamily: 'cursive',
                  border: '2px solid #ddd',
                  borderRadius: '6px',
                  outline: 'none'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1976d2'}
                onBlur={(e) => e.target.style.borderColor = '#ddd'}
              />
              {currentSignature && !currentSignature.startsWith('data:image') && (
                <div style={{
                  marginTop: '16px',
                  padding: '20px',
                  border: '2px solid #ddd',
                  borderRadius: '6px',
                  backgroundColor: '#f9f9f9',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '32px', fontFamily: 'cursive', color: '#000' }}>
                    {currentSignature}
                  </div>
                  <p style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                    Preview of your typed signature
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Draw Signature Mode */}
          {signatureMode === 'draw' && (
            <div>
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
            </div>
          )}

          {/* Signature Status Indicator */}
          {currentSignature && (
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
                Signature saved for this document
              </span>
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginTop: 'auto'
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
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e0e0e0'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
          >
            ← Back to Dashboard
          </button>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleManualSave}
              disabled={saveStatus === 'saving'}
              style={{
                padding: '12px 24px',
                backgroundColor: saveStatus === 'saving' ? '#ccc' : '#666',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                fontSize: '16px'
              }}
              onMouseOver={(e) => {
                if (saveStatus !== 'saving') {
                  e.currentTarget.style.backgroundColor = '#555';
                }
              }}
              onMouseOut={(e) => {
                if (saveStatus !== 'saving') {
                  e.currentTarget.style.backgroundColor = '#666';
                }
              }}
            >
              {saveStatus === 'saving' ? '💾 Saving...' : '💾 Save'}
            </button>

            <button
              onClick={handleContinue}
              disabled={saveStatus === 'saving'}
              style={{
                padding: '12px 24px',
                backgroundColor: saveStatus === 'saving' ? '#ccc' : '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                fontSize: '16px'
              }}
              onMouseOver={(e) => {
                if (saveStatus !== 'saving') {
                  e.currentTarget.style.backgroundColor = '#1565c0';
                }
              }}
              onMouseOut={(e) => {
                if (saveStatus !== 'saving') {
                  e.currentTarget.style.backgroundColor = '#1976d2';
                }
              }}
            >
              Save & Continue to Dashboard →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
