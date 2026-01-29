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

  const escapeFieldNameForSelector = (fieldName: string) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(fieldName);
    }
    return fieldName.replace(/([^\w-])/g, '\\\\$1');
  };

  const isCheckboxCheckedInDom = (fieldName: string) => {
    if (typeof document === 'undefined') return false;
    const selector = `input[data-field-name=\"${escapeFieldNameForSelector(fieldName)}\"]`;
    const input = document.querySelector<HTMLInputElement>(selector);
    return Boolean(input?.checked);
  };

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const pdfBytesByFormRef = useRef<Map<string, Uint8Array>>(new Map());
  const embeddedSignatureByFormRef = useRef<Map<string, string>>(new Map());
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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [emptyFieldPage, setEmptyFieldPage] = useState<number | null>(null);
  const [missingRequiredFields, setMissingRequiredFields] = useState<string[]>([]);
  const lastSavedSignatureRef = useRef<string | null>(null);

  // (Email notification moved to explicit Save click per request)

  // Map form names to display names and API endpoints
  const formConfig: Record<
    string,
    { display: string; api: string; formId: string; next?: string; requiresSignature?: boolean }
  > = {
    fillable: { display: 'CA DE-4 State Tax Form', api: '/api/payroll-packet-ca/fillable', formId: 'ca-de4', next: 'fw4', requiresSignature: true },
    fw4: { display: 'Federal W-4', api: '/api/payroll-packet-ca/fw4', formId: 'fw4', next: 'i9', requiresSignature: true },
    i9: { display: 'I-9 Employment Verification', api: '/api/payroll-packet-ca/i9', formId: 'i9', next: 'adp-deposit', requiresSignature: true },
    'adp-deposit': { display: 'ADP Direct Deposit', api: '/api/payroll-packet-ca/adp-deposit', formId: 'adp-deposit', next: 'employee-handbook', requiresSignature: true },
    'employee-handbook': { display: 'PDS Employee Handbook 2026', api: '/api/payroll-packet-ca/employee-handbook', formId: 'employee-handbook', next: 'ui-guide', requiresSignature: true },
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
    'lgbtq-rights': { display: 'LGBTQ Rights', api: '/api/payroll-packet-ca/lgbtq-rights', formId: 'lgbtq-rights', next: 'temp-employment-agreement' },
    'temp-employment-agreement': { display: 'Temporary Employment Commission Agreement', api: '/api/payroll-packet-ca/temp-employment-agreement', formId: 'temp-employment-agreement', next: 'arbitration-agreement', requiresSignature: true },
    'arbitration-agreement': { display: 'Arbitration Agreement', api: '/api/payroll-packet-ca/arbitration-agreement', formId: 'arbitration-agreement', next: 'meal-waiver-6hour', requiresSignature: true },
  };

  const currentForm = formConfig[formName];
  const mealWaiverRoute = MEAL_WAIVER_ROUTE_MAP[formName];
  const continueUrl = currentForm?.next
    ? currentForm.next === 'meal-waiver-6hour'
      ? '/payroll-packet-ca/meal-waiver-6hour'
      : `/payroll-packet-ca/form-viewer?form=${currentForm.next}`
    : undefined;

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

  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setMissingRequiredFields([]);
  }, [formName]);

  const getPdfBytesForForm = (formIdOverride?: string) => {
    const formId = formIdOverride || currentForm?.formId;
    if (!formId) return pdfBytesRef.current;
    return pdfBytesByFormRef.current.get(formId) || pdfBytesRef.current;
  };

  const embedAdpSignature = async (pdfBytes: Uint8Array, signatureData: string) => {
    const match = signatureData.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return pdfBytes;

    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const form = pdfDoc.getForm();
      let field: any;

      try {
        field = form.getField('Employee Signature') as any;
      } catch (error) {
        console.warn('[SAVE] Employee Signature field not found in ADP PDF', error);
        return pdfBytes;
      }

      const widgets = field?.acroField?.getWidgets?.() || [];
      if (!widgets.length) return pdfBytes;

      const widget = widgets[0];
      const rect = widget.getRectangle();
      const pageRef = widget.P?.();
      let page = pageRef ? pdfDoc.getPages().find((p) => p.ref === pageRef) : undefined;

      if (!page && typeof (pdfDoc as any).findPageForAnnotationRef === 'function') {
        const widgetRef = (pdfDoc as any).context?.getObjectRef?.(widget.dict);
        if (widgetRef) {
          page = (pdfDoc as any).findPageForAnnotationRef(widgetRef);
        }
      }

      if (!page) {
        page = pdfDoc.getPages()[0];
      }

      const base64 = match[2];
      const imageBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const format = match[1].toLowerCase();
      const image = format === 'jpg' || format === 'jpeg'
        ? await pdfDoc.embedJpg(imageBytes)
        : await pdfDoc.embedPng(imageBytes);

      const scale = Math.min(rect.width / image.width, rect.height / image.height, 1);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      const x = rect.x + (rect.width - drawWidth) / 2;
      const y = rect.y + (rect.height - drawHeight) / 2;

      page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
      const updatedBytes = await pdfDoc.save();
      return new Uint8Array(updatedBytes);
    } catch (error) {
      console.warn('[SAVE] Failed to embed ADP signature', error);
      return pdfBytes;
    }
  };

  // Handle PDF save from editor
  const handlePDFSave = (pdfBytes: Uint8Array) => {
    console.log(`[FORM VIEWER] onSave called with ${pdfBytes.length} bytes`);
    pdfBytesRef.current = pdfBytes;
    if (currentForm?.formId) {
      pdfBytesByFormRef.current.set(currentForm.formId, pdfBytes);
    }
    console.log('[FORM VIEWER] pdfBytesRef.current updated');
  };

  // Handle field change - trigger auto-save after debounce
  const handleFieldChange = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    const formId = currentForm?.formId;
    autoSaveTimerRef.current = setTimeout(() => {
      handleManualSave(formId);
    }, 30000); // Auto-save 30 seconds after user stops typing
  };

  // Manual save function
  const handleManualSave = async (formIdOverride?: string) => {
    const formId = formIdOverride || currentForm?.formId;
    if (!formId) {
      console.warn('[SAVE] No form id available for save');
      return;
    }

    const pdfBytes = getPdfBytesForForm(formId);
    if (!pdfBytes) {
      console.warn('[SAVE] No PDF data to save');
      return;
    }

    const isCurrentForm = formId === currentForm.formId;

    try {
      console.log(`[SAVE] Starting save process for ${formId}, PDF size: ${pdfBytes.length} bytes`);
      if (isCurrentForm) {
        setSaveStatus('saving');
      }

      let pdfBytesToSave = pdfBytes;
      if (isCurrentForm && formId === 'adp-deposit' && currentSignature) {
        const lastEmbedded = embeddedSignatureByFormRef.current.get(formId);
        if (lastEmbedded !== currentSignature) {
          const updatedBytes = await embedAdpSignature(pdfBytes, currentSignature);
          if (updatedBytes !== pdfBytes) {
            pdfBytesToSave = updatedBytes;
            pdfBytesRef.current = updatedBytes;
            pdfBytesByFormRef.current.set(formId, updatedBytes);
          }
          embeddedSignatureByFormRef.current.set(formId, currentSignature);
        }
      }

      // Get session for authentication
      const { data: { session } } = await supabase.auth.getSession();

      // Convert Uint8Array to base64
      const base64 = btoa(
        Array.from(pdfBytesToSave)
          .map(byte => String.fromCharCode(byte))
          .join('')
      );
      console.log(`[SAVE] Converted to base64, length: ${base64.length} characters`);
      console.log(`[SAVE] Base64 preview: ${base64.substring(0, 50)}...`);

      // Save to database (+ optionally persist i9 mode/selections)
      console.log(`[SAVE] Sending to API for form: ${formId}`);
      const payload: any = {
        formName: formId,
        formData: base64,
      };
      if (formId === 'i9') {
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
        if (isCurrentForm) {
          setSaveStatus('saved');
          setLastSaved(new Date());
          setTimeout(() => setSaveStatus('idle'), 2000);

          if (session?.user?.id && typeof window !== 'undefined') {
            const lastPath = `${window.location.pathname}${window.location.search}`;
            localStorage.setItem("onboarding_last_form", JSON.stringify({
              userId: session.user.id,
              path: lastPath,
              savedAt: new Date().toISOString(),
            }));
          }
        }
      } else {
        const error = await response.json();
        console.error('[SAVE] ❌ Save failed:', error);
        if (isCurrentForm) {
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 3000);
        }
      }
    } catch (error) {
      console.error('[SAVE] ❌ Save exception:', error);
      if (isCurrentForm) {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    }

    if (isCurrentForm && currentForm.requiresSignature && currentSignature) {
      await saveSignatureToDatabase(currentSignature);
    }
  };

  // Save button click
  const handleManualSaveClick = async () => {
    await handleManualSave();
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      sessionStorage.clear();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Continue to next form
  const handleContinue = async () => {
    const currentPdfBytes = getPdfBytesForForm();
    console.log('Continue clicked, pdfBytesRef:', currentPdfBytes ? 'has data' : 'null');
    setMissingRequiredFields([]);

    // Check if signature is required but not provided
    if (currentForm.requiresSignature && !currentSignature) {
      setValidationError('Please provide your signature in the signature box below before continuing.');
      setEmptyFieldPage(null);
      void handleManualSave();

      // Scroll to the signature section
      setTimeout(() => {
        const signatureSection = document.querySelector('h2');
        if (signatureSection && signatureSection.textContent === 'Signature Required') {
          signatureSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
      }, 100);

      return;
    }

    // Check if form doesn't require signature but user hasn't confirmed reading it
    if (!currentForm.requiresSignature && !hasReadForm) {
      alert('Please confirm that you have read and understood this document.');
      return;
    }

    // Validate required fields for ADP Direct Deposit
    if (formName === 'adp-deposit' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        const getFieldPage = (field: any) => {
          try {
            const widgets = field?.acroField?.getWidgets?.() || [];
            if (!widgets.length) return 1;
            const widget = widgets[0];
            const pageRef = widget?.P?.();
            if (!pageRef) return 1;
            const pages = pdfDoc.getPages();
            const pageIndex = pages.findIndex((page: any) => page.ref === pageRef);
            return pageIndex >= 0 ? pageIndex + 1 : 1;
          } catch {
            return 1;
          }
        };

        const requiredFields = [
          { name: 'Employee Name', friendly: 'Employee Name' },
          { name: 'Date', friendly: 'Date' },
          { name: 'Bank NameCityState', friendly: 'Bank Name/City/State' },
          { name: 'Account Number', friendly: 'Account Number' },
          { name: 'SSN1', friendly: 'SSN (part 1)' },
          { name: 'SSN2', friendly: 'SSN (part 2)' },
          { name: 'SSN3', friendly: 'SSN (part 3)' },
        ];

        for (const fieldInfo of requiredFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();
            if (!value || value.trim() === '') {
              const page = getFieldPage(field);
              const message = `Please fill in the required field: "${fieldInfo.friendly}" on page ${page} of the PDF`;
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(message);
              setEmptyFieldPage(page);
              void handleManualSave();

              setTimeout(() => {
                const canvas = document.querySelector(`canvas[data-page-number="${page}"]`);
                if (canvas) {
                  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating ADP Direct Deposit fields:', err);
      }
    }

    // Validate required fields for CA DE-4
    if (formName === 'fillable' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        const requiredFields = [
          { name: 'Name 1', page: 1, friendly: 'Name' },
          { name: 'Social Security Number 1', page: 1, friendly: 'Social Security Number' },
          { name: 'Address 1', page: 1, friendly: 'Address' },
          { name: 'City', page: 1, friendly: 'City' },
          { name: 'State', page: 1, friendly: 'State' },
          { name: 'ZIP Code', page: 1, friendly: 'ZIP Code' },
          { name: '1a', page: 1, friendly: '1a' },
          { name: '1b', page: 1, friendly: '1b' },
          { name: '1c', page: 1, friendly: '1c' },
          { name: 'Date Employee Signed', page: 1, friendly: 'Date Employee Signed' }
        ];

        for (const fieldInfo of requiredFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();

            if (!value || value.trim() === '') {
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${fieldInfo.page} of the PDF`);
              setEmptyFieldPage(fieldInfo.page);
              void handleManualSave();

              setTimeout(() => {
                const canvas = document.querySelector(`canvas[data-page-number="${fieldInfo.page}"]`);
                if (canvas) {
                  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        const filingStatusFields = [
          'Filing Status 1',
          'Filing Status 2',
          'Filing Status 3'
        ];

        let hasFilingStatus = false;
        for (const fieldName of filingStatusFields) {
          try {
            const field = form.getCheckBox(fieldName);
            if (field.isChecked()) {
              hasFilingStatus = true;
              break;
            }
          } catch (err) {
            console.warn(`Field ${fieldName} not found or error checking:`, err);
          }
        }

        if (!hasFilingStatus) {
          setMissingRequiredFields(filingStatusFields);
          setValidationError('Please select a Filing Status on page 1 of the PDF');
          setEmptyFieldPage(1);
          void handleManualSave();

          setTimeout(() => {
            const canvas = document.querySelector(`canvas[data-page-number="1"]`);
            if (canvas) {
              canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }, 100);

          return;
        }

        const worksheetAFields = [
          'WKsheetA_A',
          'WKsheetA_B',
          'WKsheetA_C',
          'WKsheetA_D',
          'WKsheetA_E',
          'WKsheetA_F'
        ];

        let hasWorksheetAValue = false;
        for (const fieldName of worksheetAFields) {
          try {
            const field = form.getTextField(fieldName);
            const value = field.getText();
            if (value && value.trim() !== '') {
              hasWorksheetAValue = true;
              break;
            }
          } catch (err) {
            console.warn(`Field ${fieldName} not found or error checking:`, err);
          }
        }

        if (!hasWorksheetAValue) {
          setMissingRequiredFields(worksheetAFields);
          setValidationError('Please fill in at least one Worksheet A field on page 3 of the PDF');
          setEmptyFieldPage(3);
          void handleManualSave();

          setTimeout(() => {
            const canvas = document.querySelector(`canvas[data-page-number="3"]`);
            if (canvas) {
              canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }, 100);

          return;
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating CA DE-4 fields:', err);
      }
    }
    // Validate required fields for Federal W-4
    if (formName === 'fw4' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        const requiredFields = [
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_01[0]', page: 1, friendly: 'First name and middle initial' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_02[0]', page: 1, friendly: 'Last name' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_03[0]', page: 1, friendly: 'Address' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_04[0]', page: 1, friendly: 'City, state, and ZIP code' },
          { name: 'topmostSubform[0].Page1[0].f1_05[0]', page: 1, friendly: 'Social Security number' },
          { name: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]', page: 1, friendly: 'Step 3: Qualifying children (under 17) amount' },
          { name: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]', page: 1, friendly: 'Step 3: Other dependents amount' },
          { name: 'topmostSubform[0].Page1[0].f1_09[0]', page: 1, friendly: 'Step 3: Total dependents amount' },
          { name: 'Employee Date', page: 1, friendly: 'Employee date' }
        ];

        for (const fieldInfo of requiredFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();

            if (!value || value.trim() === '') {
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${fieldInfo.page} of the PDF`);
              setEmptyFieldPage(fieldInfo.page);
              void handleManualSave();

              setTimeout(() => {
                const canvas = document.querySelector(`canvas[data-page-number="${fieldInfo.page}"]`);
                if (canvas) {
                  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        const filingStatusFields = [
          'topmostSubform[0].Page1[0].c1_1[0]',
          'topmostSubform[0].Page1[0].c1_1[1]',
          'topmostSubform[0].Page1[0].c1_1[2]'
        ];

        let hasFilingStatus = filingStatusFields.some((fieldName) =>
          isCheckboxCheckedInDom(fieldName)
        );

        if (!hasFilingStatus) {
          for (const fieldName of filingStatusFields) {
            try {
              const field = form.getCheckBox(fieldName);
              if (field.isChecked()) {
                hasFilingStatus = true;
                break;
              }
            } catch (err) {
              console.warn(`Field ${fieldName} not found or error checking:`, err);
            }
          }
        }

        if (!hasFilingStatus) {
          setMissingRequiredFields(filingStatusFields);
          setValidationError('Please select a filing status on page 1 of the PDF: Filing Status: Single / Married / Head of Household');
          setEmptyFieldPage(1);
          void handleManualSave();

          setTimeout(() => {
            const canvas = document.querySelector(`canvas[data-page-number="1"]`);
            if (canvas) {
              canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }, 100);

          return;
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating W-4 fields:', err);
      }
    }
    // Validate required fields for ADP Direct Deposit
    if (formName === 'adp-deposit' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        const requiredFields = [
          { name: 'Employee Name', page: 1, friendly: 'Employee Name' },
          { name: 'Date', page: 1, friendly: 'Date' },
          { name: 'Bank NameCityState', page: 1, friendly: 'Bank Name / City / State' },
          { name: 'Account Number', page: 1, friendly: 'Account Number' }
        ];

        for (const fieldInfo of requiredFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();

            if (!value || value.trim() === '') {
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${fieldInfo.page} of the PDF`);
              setEmptyFieldPage(fieldInfo.page);
              void handleManualSave();

              setTimeout(() => {
                const canvas = document.querySelector(`canvas[data-page-number="${fieldInfo.page}"]`);
                if (canvas) {
                  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        const ssnFields = ['SSN1', 'SSN2', 'SSN3'];
        const ssnValues = ssnFields.map((fieldName) => {
          try {
            const field = form.getTextField(fieldName);
            return (field.getText() || '').trim();
          } catch (err) {
            console.warn(`Field ${fieldName} not found or error checking:`, err);
            return '';
          }
        });

        if (ssnValues.some((value) => value === '')) {
          setMissingRequiredFields(ssnFields);
          setValidationError('Please fill in the required field: "Social Security # (XXX-XX-XXXX)" on page 1 of the PDF');
          setEmptyFieldPage(1);
          void handleManualSave();

          setTimeout(() => {
            const canvas = document.querySelector(`canvas[data-page-number="1"]`);
            if (canvas) {
              canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }, 100);

          return;
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating ADP Direct Deposit fields:', err);
      }
    }
    // Validate required fields for employee handbook
    if (formName === 'employee-handbook' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        // List of required fields in order from top to bottom with their page numbers
        const requiredFields = [
          { name: 'employee_name1', page: 77, friendly: 'Employee Name (Top of last page)' },
          { name: 'employee_initialsprev', page: 77, friendly: 'Initials (Section 1)' },
          { name: 'employee_initials2prev', page: 77, friendly: 'Initials (Section 2)' },
          { name: 'employee_initials3prev', page: 77, friendly: 'Initials (Section 3)' },
          { name: 'acknowledgment_date1', page: 77, friendly: 'Date (Section 1)' },
          { name: 'printedName1', page: 77, friendly: 'Printed Name (Section 1)' },
          { name: 'employee_name', page: 77, friendly: 'Employee Name (Middle section)' },
          { name: 'employee_initials', page: 77, friendly: 'Initials (Section 4)' },
          { name: 'employee_initials2', page: 77, friendly: 'Initials (Section 5)' },
          { name: 'employee_initials3', page: 77, friendly: 'Initials (Section 6)' },
          { name: 'acknowledgment_date', page: 77, friendly: 'Date (Section 2)' },
          { name: 'printedName', page: 77, friendly: 'Printed Name (Section 2)' },
          { name: 'date3', page: 77, friendly: 'Date (Section 3)' },
          { name: 'printedName3', page: 77, friendly: 'Printed Name (Section 3)' },
          { name: 'date4', page: 77, friendly: 'Date (Section 4)' },
          { name: 'date5', page: 77, friendly: 'Date (Section 5)' },
          { name: 'printedName4', page: 77, friendly: 'Printed Name (Section 4)' },
          { name: 'date6', page: 77, friendly: 'Date (Section 6)' },
        ];

        const resolveFieldScrollTarget = (fieldName: string) => {
          const selectorName =
            typeof CSS !== 'undefined' && typeof (CSS as any).escape === 'function'
              ? (CSS as any).escape(fieldName)
              : fieldName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const fieldElements = Array.from(
            document.querySelectorAll(`[data-field-name="${selectorName}"]`)
          ) as HTMLElement[];

          if (fieldElements.length === 0) {
            return { fieldElement: null as HTMLElement | null, scrollContainer: null as HTMLElement | null, fieldTop: null as number | null, pageNumber: null as number | null };
          }

          const findScrollableAncestor = (element: HTMLElement | null) => {
            let current = element?.parentElement || null;
            while (current) {
              const style = window.getComputedStyle(current);
              const overflowY = style.overflowY;
              const isScrollable =
                (overflowY === 'auto' || overflowY === 'scroll') &&
                current.scrollHeight > current.clientHeight;
              if (isScrollable) return current;
              current = current.parentElement;
            }
            return null;
          };

          const fieldElement = fieldElements.reduce((best, current) => {
            const bestRect = best.getBoundingClientRect();
            const currentRect = current.getBoundingClientRect();
            return currentRect.top < bestRect.top ? current : best;
          }, fieldElements[0]);

          const scrollContainer =
            findScrollableAncestor(fieldElement) ||
            (fieldElement.closest('[data-pdf-scroll-container="true"]') as HTMLElement | null);
          const containerRect = scrollContainer ? scrollContainer.getBoundingClientRect() : null;
          const fieldRect = fieldElement.getBoundingClientRect();
          const fieldTop = scrollContainer && containerRect
            ? fieldRect.top - containerRect.top + scrollContainer.scrollTop
            : window.scrollY + fieldRect.top;

          let pageNumber: number | null = null;
          const canvases = Array.from(document.querySelectorAll('canvas[data-page-number]')) as HTMLCanvasElement[];
          if (canvases.length) {
            for (const canvas of canvases) {
              const canvasRect = canvas.getBoundingClientRect();
              const canvasTop = scrollContainer && containerRect
                ? canvasRect.top - containerRect.top + scrollContainer.scrollTop
                : window.scrollY + canvasRect.top;
              const canvasBottom = canvasTop + canvasRect.height;

              if (fieldTop >= canvasTop && fieldTop <= canvasBottom) {
                pageNumber = Number(canvas.dataset.pageNumber);
                break;
              }
              if (fieldTop >= canvasTop) {
                pageNumber = Number(canvas.dataset.pageNumber);
              }
            }
          }

          return { fieldElement, scrollContainer, fieldTop, pageNumber };
        };

        // Check each required field
        for (const fieldInfo of requiredFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();

            if (!value || value.trim() === '') {
              // Found empty required field
              const scrollTarget = resolveFieldScrollTarget(fieldInfo.name);
              const displayPage = scrollTarget.pageNumber ?? fieldInfo.page;
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${displayPage} of the PDF`);
              setEmptyFieldPage(displayPage);
              void handleManualSave();

              // Scroll to the specific page in the PDF viewer
              setTimeout(() => {
                if (scrollTarget.fieldElement) {
                  scrollTarget.fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  if (scrollTarget.scrollContainer && typeof scrollTarget.fieldTop === 'number') {
                    scrollTarget.scrollContainer.scrollTo({ top: Math.max(scrollTarget.fieldTop - 160, 0), behavior: 'smooth' });
                  }
                  const input = scrollTarget.fieldElement.querySelector('input') as HTMLInputElement | null;
                  if (input) {
                    input.focus({ preventScroll: true });
                  }
                  return;
                }

                const canvas = document.querySelector(`canvas[data-page-number="${displayPage}"]`);
                if (canvas) {
                  const scrollContainer = document.querySelector('[data-pdf-scroll-container="true"]') as HTMLElement | null;
                  if (scrollContainer) {
                    const canvasRect = canvas.getBoundingClientRect();
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const targetTop = canvasRect.top - containerRect.top + scrollContainer.scrollTop;
                    scrollContainer.scrollTo({ top: Math.max(targetTop -160, 0), behavior: 'smooth' });
                  } else {
                    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                } else {
                  // Fallback to scroll to top if canvas not found
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              // Prevent continuing
              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        // Clear any previous validation errors if all fields are filled
        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating PDF fields:', err);
      }
    }

    // Validate required fields for Temporary Employment Commission Agreement
    if (formName === 'temp-employment-agreement' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();
        const lastPageNumber = pdfDoc.getPages().length;

        try {
          const field = form.getTextField('employee_signature_date');
          const value = field.getText();

          if (!value || value.trim() === '') {
            setMissingRequiredFields(['employee_signature_date']);
            setValidationError(`Please fill in the required field: "Date" on page ${lastPageNumber} of the PDF`);
            setEmptyFieldPage(lastPageNumber);
            void handleManualSave();

            setTimeout(() => {
              const canvas = document.querySelector(`canvas[data-page-number="${lastPageNumber}"]`);
              if (canvas) {
                canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }, 100);

            return;
          }
        } catch (err) {
          console.warn('Field employee_signature_date not found or error checking:', err);
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating Temp Employment Agreement fields:', err);
      }
    }

    // Validate required fields for Notice to Employee
    if (formName === 'notice-to-employee' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        const requiredFields = [
          { name: 'Employee Name', page: 1, friendly: 'Employee Name' },
          { name: 'PRINT NAME of Employee', page: 2, friendly: 'Printed Name (Employee)' },
          { name: 'Date_2', page: 2, friendly: 'Date (Employee)' }
        ];

        for (const fieldInfo of requiredFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();

            if (!value || value.trim() === '') {
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${fieldInfo.page} of the PDF`);
              setEmptyFieldPage(fieldInfo.page);
              void handleManualSave();

              setTimeout(() => {
                const canvas = document.querySelector(`canvas[data-page-number="${fieldInfo.page}"]`);
                if (canvas) {
                  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating Notice to Employee fields:', err);
      }
    }

    // Validate required fields for I-9
    if (formName === 'i9' && currentPdfBytes) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(currentPdfBytes);
        const form = pdfDoc.getForm();

        const requiredFields = [
          { name: 'Last Name (Family Name)', page: 1, friendly: 'Last Name (Family Name)' },
          { name: 'First Name Given Name', page: 1, friendly: 'First Name (Given Name)' },
          { name: 'Address Street Number and Name', page: 1, friendly: 'Address (Street Number and Name)' },
          { name: 'City or Town', page: 1, friendly: 'City or Town' },
          { name: 'ZIP Code', page: 1, friendly: 'ZIP Code' },
          { name: 'Date of Birth mmddyyyy', page: 1, friendly: 'Date of Birth (mm/dd/yyyy)' },
          { name: "Today's Date mmddyyy", page: 1, friendly: "Today's Date (mm/dd/yyyy)" },
          { name: 'US Social Security Number', page: 1, friendly: 'U.S. Social Security Number' },
          { name: 'Employees E-mail Address', page: 1, friendly: "Employee's Email Address" },
          { name: 'Telephone Number', page: 1, friendly: "Employee's Telephone Number" }
        ];

        const getFieldValue = (fieldName: string) => {
          const field = form.getField(fieldName) as any;
          if (field && typeof field.getText === 'function') {
            return field.getText() || '';
          }
          if (field && typeof field.getSelected === 'function') {
            const selected = field.getSelected();
            if (Array.isArray(selected)) {
              return selected.filter(Boolean).join(', ');
            }
            return selected || '';
          }
          return '';
        };

        for (const fieldInfo of requiredFields) {
          try {
            const value = getFieldValue(fieldInfo.name);

            if (!value || value.trim() === '') {
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${fieldInfo.page} of the PDF`);
              setEmptyFieldPage(fieldInfo.page);
              void handleManualSave();

              setTimeout(() => {
                const canvas = document.querySelector(`canvas[data-page-number="${fieldInfo.page}"]`);
                if (canvas) {
                  canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }, 100);

              return;
            }
          } catch (err) {
            console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
          }
        }

        const citizenshipFields = ['CB_1', 'CB_2', 'CB_3', 'CB_4'];
        let hasCitizenshipSelection = false;
        for (const fieldName of citizenshipFields) {
          try {
            const field = form.getCheckBox(fieldName);
            if (field.isChecked()) {
              hasCitizenshipSelection = true;
              break;
            }
          } catch (err) {
            console.warn(`Field ${fieldName} not found or error checking:`, err);
          }
        }

        if (!hasCitizenshipSelection) {
          setMissingRequiredFields(citizenshipFields);
          setValidationError('Please select your citizenship/immigration status on page 1 of the PDF: Filing Status: 1) U.S. citizen 2) Noncitizen national 3) Lawful permanent resident 4) Alien authorized to work');
          setEmptyFieldPage(1);
          void handleManualSave();

          setTimeout(() => {
            const canvas = document.querySelector(`canvas[data-page-number="1"]`);
            if (canvas) {
              canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }, 100);

          return;
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating I-9 fields:', err);
      }
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
    if (currentPdfBytes) {
      console.log('Saving before continue...');
      await handleManualSave(currentForm.formId);
      console.log('Save completed');
    } else {
      console.log('No PDF data to save, continuing anyway');
    }

    if (currentForm.requiresSignature && currentSignature) {
      console.log('[CONTINUE] Saving signature for form:', currentForm.formId);
      await saveSignatureToDatabase(currentSignature);
    } else {
      console.log('[CONTINUE] No signature save needed:', {
        requiresSignature: currentForm.requiresSignature,
        hasSignature: !!currentSignature,
        formId: currentForm.formId
      });
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

  const handleBack = async () => {
    const currentPdfBytes = getPdfBytesForForm();
    if (currentPdfBytes) {
      await handleManualSave(currentForm.formId);
    }

    if (currentForm.requiresSignature && currentSignature) {
      await saveSignatureToDatabase(currentSignature);
    }

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
      // Save signature for current form using form_id (not formName)
      // This ensures each form has its own signature in the database
      console.log('[SIGNATURE DRAW] Saving signature to Map with key:', currentForm.formId);
      setSignatures(prev => {
        const newSigs = new Map(prev);
        newSigs.set(currentForm.formId, dataUrl);
        console.log('[SIGNATURE DRAW] Map now contains keys:', Array.from(newSigs.keys()));
        return newSigs;
      });

      if (currentForm.requiresSignature) {
        void saveSignatureToDatabase(dataUrl);
      }
    }
  };

  // Function to save signature to database
  const saveSignatureToDatabase = async (signatureData: string) => {
    // Check if this exact signature was already saved for this form
    const signatureKey = `${currentForm.formId}_${signatureData}`;
    if (lastSavedSignatureRef.current === signatureKey) {
      console.log('[SIGNATURE] ⏭️ Signature already saved, skipping');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentPdfBytes = getPdfBytesForForm(currentForm.formId);

      console.log('[SIGNATURE] 💾 Saving signature for form:', currentForm.formId);

      const response = await fetch('/api/form-signatures/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          formId: currentForm.formId,
          formType: currentForm.display,
          signatureData: signatureData,
          formData: currentPdfBytes ? btoa(
            Array.from(currentPdfBytes)
              .map(byte => String.fromCharCode(byte))
              .join('')
          ) : undefined
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[SIGNATURE] ✅ Signature saved to database:', result);
        // Mark this signature as saved
        lastSavedSignatureRef.current = signatureKey;
      } else {
        const error = await response.json();
        console.error('[SIGNATURE] ❌ Failed to save signature:', error);
      }
    } catch (error) {
      console.error('[SIGNATURE] ❌ Exception saving signature:', error);
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
    // Remove signature for current form using form_id
    setSignatures(prev => {
      const newSigs = new Map(prev);
      newSigs.delete(currentForm.formId);
      return newSigs;
    });
    // Reset last saved signature reference
    lastSavedSignatureRef.current = null;
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
        console.error('[I9_UPLOAD] Server error:', error);
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

  // Load saved signatures from database
  const loadSavedSignatures = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch('/api/form-signatures/save', {
        method: 'GET',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      if (response.ok) {
        const result = await response.json();
        if (result.signatures) {
          // Convert signatures object to Map
          const sigMap = new Map<string, string>();
          Object.entries(result.signatures).forEach(([formId, sigData]: [string, any]) => {
            if (sigData?.signature_data) {
              sigMap.set(formId, sigData.signature_data);
            }
          });
          setSignatures(sigMap);
          console.log('[SIGNATURE] ✅ Loaded signatures from database:', sigMap.size);
        }
      }
    } catch (error) {
      console.error('[SIGNATURE] ❌ Error loading signatures:', error);
    }
  };

  // Load I-9 documents when on I-9 form
  useEffect(() => {
    if (formName === 'i9') {
      loadI9Documents();
    }
  }, [formName]);

  // Load signatures from database on mount
  useEffect(() => {
    loadSavedSignatures();
  }, []);

  // Load signature for current form and reset canvas when form changes
  useEffect(() => {
    console.log('[SIGNATURE LOAD] Form changed:', {
      formName,
      formId: currentForm.formId,
      availableSignatures: Array.from(signatures.keys()),
      hasSignatureForThisForm: signatures.has(currentForm.formId)
    });

    // Reset read confirmation when form changes
    setHasReadForm(false);

    // Reset last saved signature reference when form changes
    lastSavedSignatureRef.current = null;

    // IMPORTANT: Only load signature from database, not from the local signatures Map
    // This ensures each form has its own independent signature
    const savedSignature = signatures.get(currentForm.formId);
    console.log('[SIGNATURE LOAD] Looking for signature with key:', currentForm.formId, 'Found:', !!savedSignature);

    if (savedSignature && savedSignature.startsWith('data:image')) {
      console.log('[SIGNATURE LOAD] Loading saved signature for', currentForm.formId);
      setCurrentSignature(savedSignature);
      if (currentForm?.formId) {
        lastSavedSignatureRef.current = `${currentForm.formId}_${savedSignature}`;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
          }
        };
        img.src = savedSignature;
      }
    } else {
      // Clear signature for new form or when no signature exists for this specific form
      console.log('[SIGNATURE LOAD] No signature found, clearing canvas for', currentForm.formId);
      setCurrentSignature('');
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Aggressively clear the canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // Force a reset of the canvas state
          ctx.beginPath();
        }
      }
    }
  }, [formName, currentForm.formId, signatures]);

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
            <button
              type="button"
              onClick={handleLogout}
              style={{
                padding: '8px 16px',
                backgroundColor: '#f5f5f5',
                color: '#333',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '14px',
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#e0e0e0')}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
            >
              Logout
            </button>
          </div>
        </div>

      {/* Validation Error Banner */}
      {validationError && (
        <div style={{
          backgroundColor: '#ffebee',
          border: '3px solid #d32f2f',
          borderRadius: '12px',
          padding: '20px 28px',
          margin: '0 24px 0 24px',
          marginTop: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 4px 12px rgba(211, 47, 47, 0.3)',
          animation: 'slideDown 0.3s ease-out'
        }}>
          <svg style={{ width: '32px', height: '32px', fill: '#d32f2f', flexShrink: 0 }} viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: '#d32f2f', marginBottom: '8px', fontSize: '18px' }}>
              ⚠ Required Field Missing
            </div>
            <div style={{ color: '#c62828', fontSize: '15px', fontWeight: '500', marginBottom: '6px' }}>
              {validationError}
            </div>
            <div style={{ color: '#c62828', fontSize: '13px', backgroundColor: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ffcdd2' }}>
              📄 Please scroll down to <strong>page {emptyFieldPage}</strong> in the PDF below and fill in the required field before continuing.
            </div>
          </div>
        </div>
      )}

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
            requiredFieldNames={missingRequiredFields}
            showRequiredFieldErrors={missingRequiredFields.length > 0}
            continueUrl={continueUrl}
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
            marginBottom: '20px',
            order: formName === 'i9' ? 2 : 0
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
                  Signature captured
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
            marginBottom: '20px',
            order: 1
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
          marginTop: 'auto',
          order: formName === 'i9' ? 3 : 0
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
