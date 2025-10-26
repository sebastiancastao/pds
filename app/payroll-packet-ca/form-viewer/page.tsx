'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';

// Dynamically import PDFFormEditor to avoid SSR issues
const PDFFormEditor = dynamic(() => import('@/app/components/PDFFormEditor'), {
  ssr: false,
  loading: () => <div style={{ padding: '20px', textAlign: 'center' }}>Loading PDF editor...</div>
});

export default function FormViewer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formName = searchParams.get('form') || 'fillable';
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);

  // Map form names to display names and API endpoints
  const formConfig: Record<string, { display: string; api: string; formId: string; next?: string }> = {
    'fillable': { display: 'CA DE-4 State Tax Form', api: '/api/payroll-packet-ca/fillable', formId: 'ca-de4', next: 'fw4' },
    'fw4': { display: 'Federal W-4', api: '/api/payroll-packet-ca/fw4', formId: 'fw4', next: 'i9' },
    'i9': { display: 'I-9 Employment Verification', api: '/api/payroll-packet-ca/i9', formId: 'i9', next: 'adp-deposit' },
    'adp-deposit': { display: 'ADP Direct Deposit', api: '/api/payroll-packet-ca/adp-deposit', formId: 'adp-deposit', next: 'ui-guide' },
    'ui-guide': { display: 'UI Guide', api: '/api/payroll-packet-ca/ui-guide', formId: 'ui-guide', next: 'disability-insurance' },
    'disability-insurance': { display: 'Disability Insurance', api: '/api/payroll-packet-ca/disability-insurance', formId: 'disability-insurance', next: 'paid-family-leave' },
    'paid-family-leave': { display: 'Paid Family Leave', api: '/api/payroll-packet-ca/paid-family-leave', formId: 'paid-family-leave', next: 'sexual-harassment' },
    'sexual-harassment': { display: 'Sexual Harassment', api: '/api/payroll-packet-ca/sexual-harassment', formId: 'sexual-harassment', next: 'survivors-rights' },
    'survivors-rights': { display: 'Survivors Rights', api: '/api/payroll-packet-ca/survivors-rights', formId: 'survivors-rights', next: 'transgender-rights' },
    'transgender-rights': { display: 'Transgender Rights', api: '/api/payroll-packet-ca/transgender-rights', formId: 'transgender-rights', next: 'health-insurance' },
    'health-insurance': { display: 'Health Insurance', api: '/api/payroll-packet-ca/health-insurance', formId: 'health-insurance', next: 'time-of-hire' },
    'time-of-hire': { display: 'Time of Hire Notice', api: '/api/payroll-packet-ca/time-of-hire', formId: 'time-of-hire', next: 'discrimination-law' },
    'discrimination-law': { display: 'Discrimination Law', api: '/api/payroll-packet-ca/discrimination-law', formId: 'discrimination-law', next: 'immigration-rights' },
    'immigration-rights': { display: 'Immigration Rights', api: '/api/payroll-packet-ca/immigration-rights', formId: 'immigration-rights', next: 'military-rights' },
    'military-rights': { display: 'Military Rights', api: '/api/payroll-packet-ca/military-rights', formId: 'military-rights', next: 'lgbtq-rights' },
    'lgbtq-rights': { display: 'LGBTQ Rights', api: '/api/payroll-packet-ca/lgbtq-rights', formId: 'lgbtq-rights' },
  };

  const currentForm = formConfig[formName];

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

      // Save to database
      console.log(`[SAVE] Sending to API for form: ${currentForm.formId}`);
      const response = await fetch('/api/pdf-form-progress/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        credentials: 'same-origin', // Include cookies with request
        body: JSON.stringify({
          formName: currentForm.formId,
          formData: base64,
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

  // Continue to next form
  const handleContinue = async () => {
    console.log('Continue clicked, pdfBytesRef:', pdfBytesRef.current ? 'has data' : 'null');

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
      router.push(`/payroll-packet-ca/form-viewer?form=${currentForm.next}`);
    } else {
      console.log('No next form, going to homepage');
      router.push('/');
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
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#666' }}>
            Fill out the form below. Your progress is automatically saved as you type.
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
            pdfUrl={currentForm.api}
            formId={currentForm.formId}
            onSave={handlePDFSave}
            onFieldChange={handleFieldChange}
            onContinue={handleContinue}
          />
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
            ← Back
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
              {currentForm.next ? 'Save & Continue →' : 'Save & Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
