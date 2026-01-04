'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { supabase } from '@/lib/supabase';

// Dynamically import PDFFormEditor to avoid SSR issues
const PDFFormEditor = dynamicImport(() => import('@/app/components/PDFFormEditor'), {
  ssr: false,
  loading: () => <div style={{ padding: '20px', textAlign: 'center' }}>Loading PDF editor...</div>
});

type I9Mode = 'A' | 'BC';

const MEAL_WAIVER_ROUTE_MAP: Record<string, { path: string; label: string }> = {
  'meal-waiver-6hour': { path: '/payroll-packet-ca/meal-waiver-6hour', label: 'Meal Waiver 6-hour' },
  'meal-waiver-10-12': { path: '/payroll-packet-ca/meal-waiver-10-12', label: 'Meal Waiver 10/12 Hour' },
};

function FormViewerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formName = searchParams.get('form') || 'fillable';

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const [signatures, setSignatures] = useState<Map<string, string>>(new Map());
  const [currentSignature, setCurrentSignature] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // --- I-9 selection mode + options ---
  const I9_LIST_A = [
    'U.S. Passport or U.S. Passport Card',
    'Permanent Resident Card (Form I-551)',
    'Employment Authorization Document with Photo (Form I-766)',
    'Foreign Passport with Form I-94 indicating work authorization',
    'Passport from Micronesia/Marshall Islands with Form I-94',
  ];
  const I9_LIST_B = [
    'Driver’s license or State ID (with photo or info)',
    'ID card issued by federal/state/local agency (with photo/info)',
    'School ID card with photograph',
    'Voter’s registration card',
    'U.S. military card or draft record',
    'Military dependent’s ID card',
    'U.S. Coast Guard Merchant Mariner Card',
    'Native American tribal document',
    'Driver’s license issued by Canadian authority',
  ];
  const I9_LIST_C = [
    'U.S. Social Security Card (unrestricted)',
    'Certification of Birth Abroad (Form FS-545)',
    'Certification of Report of Birth (Form DS-1350)',
    'Original or certified Birth Certificate',
    'Native American tribal document',
    'U.S. Citizen ID Card (Form I-197)',
    'ID Card for Resident Citizen in the U.S. (Form I-179)',
    'Employment Authorization Document issued by DHS',
  ];

  const [i9Mode, setI9Mode] = useState<I9Mode>('A');
  const [i9Selections, setI9Selections] = useState<{ listA?: string; listB?: string; listC?: string }>({});
  const [i9Documents, setI9Documents] = useState<{
    listA?: { url: string; filename: string };
    listB?: { url: string; filename: string };
    listC?: { url: string; filename: string };
  }>({});
  const [uploadingDoc, setUploadingDoc] = useState<'i9_list_a' | 'i9_list_b' | 'i9_list_c' | null>(null);
  const [hasReadForm, setHasReadForm] = useState(false);

  // (Email notification moved to explicit Save click per request)

  // Map form names to display names and API endpoints
  const formConfig: Record<
    string,
    { display: string; api: string; formId: string; next?: string; requiresSignature?: boolean }
  > = {
    fillable: { display: 'CA DE-4 State Tax Form', api: '/api/payroll-packet-ca/fillable', formId: 'ca-de4', next: 'fw4', requiresSignature: true },
    fw4: { display: 'Federal W-4', api: '/api/payroll-packet-ca/fw4', formId: 'fw4', next: 'i9', requiresSignature: true },
    i9: { display: 'I-9 Employment Verification', api: '/api/payroll-packet-ca/i9', formId: 'i9', next: 'adp-deposit', requiresSignature: true },
    'adp-deposit': { display: 'ADP Direct Deposit', api: '/api/payroll-packet-ca/adp-deposit', formId: 'adp-deposit', next: 'ui-guide', requiresSignature: true },
    'ui-guide': { display: 'UI Guide', api: '/api/payroll-packet-ca/ui-guide', formId: 'ui-guide', next: 'disability-insurance' },
    'disability-insurance': { display: 'Disability Insurance', api: '/api/payroll-packet-ca/disability-insurance', formId: 'disability-insurance', next: 'paid-family-leave' },
    'paid-family-leave': { display: 'Paid Family Leave', api: '/api/payroll-packet-ca/paid-family-leave', formId: 'paid-family-leave', next: 'sexual-harassment' },
    'sexual-harassment': { display: 'Sexual Harassment', api: '/api/payroll-packet-ca/sexual-harassment', formId: 'sexual-harassment', next: 'survivors-rights' },
    'survivors-rights': { display: 'Survivors Rights', api: '/api/payroll-packet-ca/survivors-rights', formId: 'survivors-rights', next: 'transgender-rights' },
    'transgender-rights': { display: 'Transgender Rights', api: '/api/payroll-packet-ca/transgender-rights', formId: 'transgender-rights', next: 'health-insurance' },
    'health-insurance': { display: 'Health Insurance', api: '/api/payroll-packet-ca/health-insurance', formId: 'health-insurance', next: 'time-of-hire' },
    'time-of-hire': { display: 'Time of Hire Notice', api: '/api/payroll-packet-ca/time-of-hire', formId: 'time-of-hire', next: 'notice-to-employee', requiresSignature: true },
    'notice-to-employee': { display: 'LC 2810.5 Notice to Employee', api: '/api/payroll-packet-ca/notice-to-employee', formId: 'notice-to-employee', next: 'discrimination-law', requiresSignature: true },
    'discrimination-law': { display: 'Discrimination Law', api: '/api/payroll-packet-ca/discrimination-law', formId: 'discrimination-law', next: 'immigration-rights' },
    'immigration-rights': { display: 'Immigration Rights', api: '/api/payroll-packet-ca/immigration-rights', formId: 'immigration-rights', next: 'military-rights' },
    'military-rights': { display: 'Military Rights', api: '/api/payroll-packet-ca/military-rights', formId: 'military-rights', next: 'lgbtq-rights' },
    'lgbtq-rights': { display: 'LGBTQ Rights', api: '/api/payroll-packet-ca/lgbtq-rights', formId: 'lgbtq-rights', next: 'meal-waiver-6hour' },
  };

  const currentForm = formConfig[formName];
  const mealWaiverRoute = MEAL_WAIVER_ROUTE_MAP[formName];

  useEffect(() => {
    if (!currentForm && mealWaiverRoute) {
      router.push(mealWaiverRoute.path);
    }
  }, [currentForm, mealWaiverRoute, router]);

  // Handle invalid form name
  if (!currentForm) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Form not found</h1>
        <p>The form "{formName}" does not exist.</p>
        <p>Available forms: {Object.keys(formConfig).join(', ')}</p>
        <button
          onClick={() => router.push('/payroll-packet-ca/form-viewer?form=fillable')}
          style={{
            padding: '12px 24px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginTop: '20px'
          }}
        >
          Go to first form
        </button>
        {mealWaiverRoute && (
          <button
            onClick={() => router.push(mealWaiverRoute.path)}
            style={{
              padding: '12px 24px',
              backgroundColor: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginTop: '12px'
            }}
          >
            Open {mealWaiverRoute.label}
          </button>
        )}
      </div>
    );
  }

  // Handle PDF save from editor
  const handlePDFSave = (pdfBytes: Uint8Array) => {
    console.log(`[FORM VIEWER] onSave called with ${pdfBytes.length} bytes`);
    pdfBytesRef.current = pdfBytes;
    console.log('[FORM VIEWER] pdfBytesRef.current updated');
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

  // Manual save function
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

      // Convert Uint8Array to base64
      const base64 = btoa(
        Array.from(pdfBytesRef.current)
          .map(byte => String.fromCharCode(byte))
          .join('')
      );
      console.log(`[SAVE] Converted to base64, length: ${base64.length} characters`);
      console.log(`[SAVE] Base64 preview: ${base64.substring(0, 50)}...`);

      // Save to database (+ optionally persist i9 mode/selections)
      console.log(`[SAVE] Sending to API for form: ${currentForm.formId}`);
      const payload: any = {
        formName: currentForm.formId,
        formData: base64,
      };
      if (formName === 'i9') {
        payload.i9Mode = i9Mode;
        payload.i9Selections = i9Selections;
      }

      const response = await fetch('/api/pdf-form-progress/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
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

  // Save button click
  const handleManualSaveClick = async () => {
    await handleManualSave();
  };

  // Continue to next form
  const handleContinue = async () => {
    console.log('Continue clicked, pdfBytesRef:', pdfBytesRef.current ? 'has data' : 'null');

    // Check if signature is required but not provided
    if (currentForm.requiresSignature && !currentSignature) {
      alert('Please provide your signature before continuing to the next form.');
      return;
    }

    // Check if form doesn't require signature but user hasn't confirmed reading it
    if (!currentForm.requiresSignature && !hasReadForm) {
      alert('Please confirm that you have read and understood this document.');
      return;
    }

    // I-9 validations (mode + selections + files)
    if (formName === 'i9') {
      if (i9Mode === 'A') {
        if (!i9Selections.listA) {
          alert('Please choose a List A document type.');
          return;
        }
        if (!i9Documents.listA) {
          alert('Please upload your List A document.');
          return;
        }
      } else {
        if (!i9Selections.listB) {
          alert('Please choose a List B document type.');
          return;
        }
        if (!i9Documents.listB) {
          alert('Please upload your List B document.');
          return;
        }
        if (!i9Selections.listC) {
          alert('Please choose a List C document type.');
          return;
        }
        if (!i9Documents.listC) {
          alert('Please upload your List C document.');
          return;
        }
      }
    }

    // Save before continuing if we have data
    if (pdfBytesRef.current) {
      console.log('Saving before continue...');
      await handleManualSave();
      console.log('Save completed');
    } else {
      console.log('No PDF data to save, continuing anyway');
    }

    // Navigate to next form
    if (currentForm.next) {
      console.log('Navigating to:', currentForm.next);
      if (currentForm.next === 'meal-waiver-6hour') {
        router.push('/payroll-packet-ca/meal-waiver-6hour');
      } else {
        router.push(`/payroll-packet-ca/form-viewer?form=${currentForm.next}`);
      }
    } else {
      console.log('No next form, going to login');
      router.push('/login');
    }
  };

  const handleBack = () => {
    // Find the previous form
    const formNames = Object.keys(formConfig);
    const currentIndex = formNames.indexOf(formName);

    if (currentIndex > 0) {
      const prevForm = formNames[currentIndex - 1];
      router.push(`/payroll-packet-ca/form-viewer?form=${prevForm}`);
    } else {
      router.push('/');
    }
  };

  // Signature canvas handlers
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    // Scale coordinates to match canvas internal resolution
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
      // Save signature for current form
      setSignatures(prev => {
        const newSigs = new Map(prev);
        newSigs.set(formName, dataUrl);
        return newSigs;
      });
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Re-fill with white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    setCurrentSignature('');
    // Remove signature for current form
    setSignatures(prev => {
      const newSigs = new Map(prev);
      newSigs.delete(formName);
      return newSigs;
    });
  };

  // I-9 Document Upload Functions (A/B/C slots)
  const handleDocumentUpload = async (
    documentType: 'i9_list_a' | 'i9_list_b' | 'i9_list_c',
    file: File
  ) => {
    try {
      setUploadingDoc(documentType);

      // Get session for authentication
      const { data: { session } } = await supabase.auth.getSession();

      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);

      const response = await fetch('/api/i9-documents/upload', {
        method: 'POST',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();
      console.log('[I9_UPLOAD] Success:', result);

      const toKey = documentType === 'i9_list_a' ? 'listA' : documentType === 'i9_list_b' ? 'listB' : 'listC';

      setI9Documents(prev => ({
        ...prev,
        [toKey]: {
          url: result.url,
          filename: result.filename,
        },
      }));

      alert('Document uploaded successfully!');
    } catch (error) {
      console.error('[I9_UPLOAD] Error:', error);
      alert(`Failed to upload: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUploadingDoc(null);
    }
  };

  const loadI9Documents = async () => {
    if (formName !== 'i9') return;

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch('/api/i9-documents/upload', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.documents) {
          const docs: any = {};

          // Preferred new keys
          if (result.documents.list_a_url) {
            docs.listA = {
              url: result.documents.list_a_url,
              filename: result.documents.list_a_filename,
            };
          }
          if (result.documents.list_b_url) {
            docs.listB = {
              url: result.documents.list_b_url,
              filename: result.documents.list_b_filename,
            };
          }
          if (result.documents.list_c_url) {
            docs.listC = {
              url: result.documents.list_c_url,
              filename: result.documents.list_c_filename,
            };
          }

          // Back-compat: legacy keys -> B/C
          if (!docs.listB && result.documents.drivers_license_url) {
            docs.listB = {
              url: result.documents.drivers_license_url,
              filename: result.documents.drivers_license_filename,
            };
          }
          if (!docs.listC && result.documents.ssn_document_url) {
            docs.listC = {
              url: result.documents.ssn_document_url,
              filename: result.documents.ssn_document_filename,
            };
          }

          setI9Documents(docs);
        }
      }
    } catch (error) {
      console.error('[I9_LOAD] Error loading documents:', error);
    }
  };

  // Load I-9 documents when on I-9 form
  useEffect(() => {
    if (formName === 'i9') {
      loadI9Documents();
    }
  }, [formName]);

  // Load signature for current form and reset canvas when form changes
  useEffect(() => {
    // Reset read confirmation when form changes
    setHasReadForm(false);

    // Load existing drawn signature for this form if it exists
    const savedSignature = signatures.get(formName);
    if (savedSignature && savedSignature.startsWith('data:image')) {
      setCurrentSignature(savedSignature);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          if (ctx) {
            ctx.drawImage(img, 0, 0);
          }
        };
        img.src = savedSignature;
      }
    } else {
      // Clear signature for new form or unsupported saved data
      setCurrentSignature('');
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
  }, [formName, signatures]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

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
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{currentForm.display}</h1>
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
            key={`${currentForm.formId}-${formName}`}
            pdfUrl={currentForm.api}
            formId={currentForm.formId}
            onSave={handlePDFSave}
            onFieldChange={handleFieldChange}
            onContinue={handleContinue}
            skipButtonDetection={!currentForm.requiresSignature}
          />
        </div>

        {/* Read Confirmation Section - Only show if form doesn't require signature */}
        {!currentForm.requiresSignature && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '20px'
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
              fontSize: '16px'
            }}>
              <input
                type="checkbox"
                checked={hasReadForm}
                onChange={(e) => setHasReadForm(e.target.checked)}
                style={{
                  width: '20px',
                  height: '20px',
                  cursor: 'pointer',
                  accentColor: '#1976d2'
                }}
              />
              <span style={{ color: '#333' }}>
                I confirm that I have read and understood this document
                <span style={{ color: '#d32f2f', marginLeft: '4px' }}>*</span>
              </span>
            </label>

            {hasReadForm && (
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
                  Acknowledgment confirmed
                </span>
              </div>
            )}
          </div>
        )}

        {/* Signature Section - Only show if form requires signature */}
        {currentForm.requiresSignature && (
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

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '12px'
            }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                Draw your signature above using your mouse or touchscreen
              </p>
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
                    fontSize: '14px'
                  }}
                >
                  Clear Signature
                </button>
              )}
            </div>

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
        )}

        {/* I-9 Document Uploads - Only show for I-9 form */}
        {formName === 'i9' && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '20px'
          }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
              Identity & Employment Verification (Form I-9)
            </h2>
            <p style={{ margin: '8px 0 20px 0', fontSize: '14px', color: '#666' }}>
              Choose <strong>one</strong> of the following: provide a <strong>List A</strong> document,
              or provide <strong>one from List B</strong> <em>and</em> <strong>one from List C</strong>.
            </p>

            {/* Mode selector */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="i9mode"
                  checked={i9Mode === 'A'}
                  onChange={() => setI9Mode('A')}
                />
                <span>Use List A (one document)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="i9mode"
                  checked={i9Mode === 'BC'}
                  onChange={() => setI9Mode('BC')}
                />
                <span>Use List B + List C (two documents)</span>
              </label>
            </div>

            {/* List A */}
            {i9Mode === 'A' && (
              <div style={{ borderTop: '1px solid #eee', paddingTop: 16 }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 'bold' }}>List A Document</h3>

                {/* List A dropdown */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
                    Select document type <span style={{ color: '#d32f2f' }}>*</span>
                  </label>
                  <select
                    value={i9Selections.listA || ''}
                    onChange={(e) => setI9Selections(prev => ({ ...prev, listA: e.target.value || undefined }))}
                    style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 6 }}
                  >
                    <option value="">— Select —</option>
                    {I9_LIST_A.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* Upload 1 field for List A */}
                <div>
                  <h4 style={{ margin: '12px 0', fontSize: 14, fontWeight: 700 }}>
                    Upload List A document <span style={{ color: '#d32f2f' }}>*</span>
                  </h4>
                  {i9Documents.listA ? (
                    <div style={{ border: '2px solid #4caf50', borderRadius: 6, padding: 12, background: '#e8f5e9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <div>
                          <div style={{ color: '#2e7d32', fontWeight: 700 }}>Uploaded</div>
                          <div style={{ fontSize: 13, color: '#555' }}>{i9Documents.listA.filename}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <a
                            href={i9Documents.listA.url}
                            target="_blank" rel="noopener noreferrer"
                            style={{ padding: '8px 12px', background: '#1976d2', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}
                          >
                            View
                          </a>
                          <label style={{ padding: '8px 12px', background: '#666', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            Replace
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleDocumentUpload('i9_list_a', file);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label style={{
                      display: 'block', border: '2px dashed #ddd', borderRadius: 6, padding: 20, textAlign: 'center', cursor: 'pointer',
                      backgroundColor: uploadingDoc === 'i9_list_a' ? '#f5f5f5' : '#fff'
                    }}>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        style={{ display: 'none' }}
                        disabled={uploadingDoc === 'i9_list_a'}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleDocumentUpload('i9_list_a', file);
                        }}
                      />
                      <div style={{ marginBottom: 8, color: '#666' }}>
                        {uploadingDoc === 'i9_list_a' ? 'Uploading…' : 'Click to upload or drag & drop'}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>JPG, PNG, WEBP, or PDF (max 10MB)</div>
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* List B + List C */}
            {i9Mode === 'BC' && (
              <div style={{ borderTop: '1px solid #eee', paddingTop: 16 }}>
                {/* List B */}
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 'bold' }}>List B Document</h3>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
                      Select document type <span style={{ color: '#d32f2f' }}>*</span>
                    </label>
                    <select
                      value={i9Selections.listB || ''}
                      onChange={(e) => setI9Selections(prev => ({ ...prev, listB: e.target.value || undefined }))}
                      style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 6 }}
                    >
                      <option value="">— Select —</option>
                      {I9_LIST_B.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  {/* Upload for B */}
                  {i9Documents.listB ? (
                    <div style={{ border: '2px solid #4caf50', borderRadius: 6, padding: 12, background: '#e8f5e9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <div>
                          <div style={{ color: '#2e7d32', fontWeight: 700 }}>Uploaded</div>
                          <div style={{ fontSize: 13, color: '#555' }}>{i9Documents.listB.filename}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <a href={i9Documents.listB.url} target="_blank" rel="noopener noreferrer"
                             style={{ padding: '8px 12px', background: '#1976d2', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                            View
                          </a>
                          <label style={{ padding: '8px 12px', background: '#666', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            Replace
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleDocumentUpload('i9_list_b', file);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label style={{
                      display: 'block', border: '2px dashed #ddd', borderRadius: 6, padding: 20, textAlign: 'center', cursor: 'pointer',
                      backgroundColor: uploadingDoc === 'i9_list_b' ? '#f5f5f5' : '#fff'
                    }}>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        style={{ display: 'none' }}
                        disabled={uploadingDoc === 'i9_list_b'}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleDocumentUpload('i9_list_b', file);
                        }}
                      />
                      <div style={{ marginBottom: 8, color: '#666' }}>
                        {uploadingDoc === 'i9_list_b' ? 'Uploading…' : 'Click to upload or drag & drop'}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>JPG, PNG, WEBP, or PDF (max 10MB)</div>
                    </label>
                  )}
                </div>

                {/* List C */}
                <div>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 'bold' }}>List C Document</h3>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
                      Select document type <span style={{ color: '#d32f2f' }}>*</span>
                    </label>
                    <select
                      value={i9Selections.listC || ''}
                      onChange={(e) => setI9Selections(prev => ({ ...prev, listC: e.target.value || undefined }))}
                      style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 6 }}
                    >
                      <option value="">— Select —</option>
                      {I9_LIST_C.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  {/* Upload for C */}
                  {i9Documents.listC ? (
                    <div style={{ border: '2px solid #4caf50', borderRadius: 6, padding: 12, background: '#e8f5e9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <div>
                          <div style={{ color: '#2e7d32', fontWeight: 700 }}>Uploaded</div>
                          <div style={{ fontSize: 13, color: '#555' }}>{i9Documents.listC.filename}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <a href={i9Documents.listC.url} target="_blank" rel="noopener noreferrer"
                             style={{ padding: '8px 12px', background: '#1976d2', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
                            View
                          </a>
                          <label style={{ padding: '8px 12px', background: '#666', color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            Replace
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleDocumentUpload('i9_list_c', file);
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label style={{
                      display: 'block', border: '2px dashed #ddd', borderRadius: 6, padding: 20, textAlign: 'center', cursor: 'pointer',
                      backgroundColor: uploadingDoc === 'i9_list_c' ? '#f5f5f5' : '#fff'
                    }}>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        style={{ display: 'none' }}
                        disabled={uploadingDoc === 'i9_list_c'}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleDocumentUpload('i9_list_c', file);
                        }}
                      />
                      <div style={{ marginBottom: 8, color: '#666' }}>
                        {uploadingDoc === 'i9_list_c' ? 'Uploading…' : 'Click to upload or drag & drop'}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>JPG, PNG, WEBP, or PDF (max 10MB)</div>
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* Security Notice */}
            <div style={{
              marginTop: '20px',
              padding: '12px',
              backgroundColor: '#e3f2fd',
              border: '1px solid #2196f3',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'start',
              gap: '12px'
            }}>
              <svg style={{ width: '20px', height: '20px', fill: '#1976d2', flexShrink: 0, marginTop: '2px' }} viewBox="0 0 24 24">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
              </svg>
              <div style={{ fontSize: '12px', color: '#1565c0' }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>Your documents are secure</p>
                <p style={{ margin: '4px 0 0 0' }}>
                  All uploaded documents are encrypted and stored securely in compliance with federal regulations.
                  These documents are only accessible to authorized HR personnel for employment verification purposes.
                </p>
              </div>
            </div>
          </div>
        )}

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
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#e0e0e0')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
          >
            ← Back
          </button>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleManualSaveClick}
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
              {currentForm.next ? 'Save & Continue →' : 'Save & Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FormViewer() {
  return (
    <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>}>
      <FormViewerContent />
    </Suspense>
  );
}
