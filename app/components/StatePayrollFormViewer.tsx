'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import { supabase } from '@/lib/supabase';

const PDFFormEditor = dynamicImport(() => import('@/app/components/PDFFormEditor'), {
  ssr: false,
  loading: () => <div style={{ padding: '20px', textAlign: 'center' }}>Loading PDF editor...</div>,
});

export type FormSpec = {
  id: string;
  display: string;
  requiresSignature?: boolean;
  apiOverride?: string;
  formId?: string;
};

const DEFAULT_FORMS: FormSpec[] = [
  { id: 'adp-deposit', display: 'ADP Direct Deposit', requiresSignature: true },
  { id: 'marketplace', display: 'Marketplace Notice' },
  { id: 'health-insurance', display: 'Health Insurance Marketplace' },
  { id: 'time-of-hire', display: 'Time of Hire Notice' },
  { id: 'employee-information', display: 'Employee Information' },
  { id: 'fw4', display: 'Federal W-4', requiresSignature: true },
  { id: 'i9', display: 'I-9 Employment Verification', requiresSignature: true },
  { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee', requiresSignature: true },
  { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
  { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
  { id: 'state-tax', display: 'State Tax Form', requiresSignature: true },
  { id: 'handbook', display: 'Employee Handbook (Pending)' },
];

const STATE_FORM_API_OVERRIDES: Record<string, Record<string, string>> = {
  az: {
    'state-tax': '/api/payroll-packet-az/fillable',
  },
};

type FormConfigEntry = {
  display: string;
  api: string;
  formId: string;
  next?: string;
  requiresSignature?: boolean;
};

interface StatePayrollFormViewerProps {
  stateCode: string;
  stateName: string;
  forms?: FormSpec[];
  startFormId?: string;
}

const escapeFieldNameForSelector = (fieldName: string) => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(fieldName);
  }
  return fieldName.replace(/([^\w-])/g, '\\\\$1');
};

const isCheckboxCheckedInDom = (fieldName: string) => {
  if (typeof document === 'undefined') return false;
  const selector = `input[data-field-name="${escapeFieldNameForSelector(fieldName)}"]`;
  const input = document.querySelector<HTMLInputElement>(selector);
  return Boolean(input?.checked);
};

function buildFormConfig(stateCode: string, forms?: FormSpec[]) {
  const sequence = forms && forms.length > 0 ? forms : DEFAULT_FORMS;
  const formOrder = sequence.map((f) => f.id);
  const config = sequence.reduce<Record<string, FormConfigEntry>>((acc, form, index) => {
    const apiOverride =
      form.apiOverride ||
      (stateCode === 'az' && form.id === 'state-tax' ? '/api/payroll-packet-az/fillable' : undefined) ||
      STATE_FORM_API_OVERRIDES[stateCode]?.[form.id];
    acc[form.id] = {
      display: form.display,
      api: apiOverride || `/api/payroll-packet-common/${form.id}?state=${stateCode}`,
      formId: form.formId || `${stateCode}-${form.id}`,
      next: sequence[index + 1]?.id,
      requiresSignature: form.requiresSignature,
    };
    return acc;
  }, {});

  return {
    config,
    formOrder,
    firstFormId: formOrder[0],
  };
}

function ViewerShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>}>
      {children}
    </Suspense>
  );
}

export default function StatePayrollFormViewer({
  stateCode,
  stateName,
  forms,
  startFormId,
}: StatePayrollFormViewerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { config: formConfig, formOrder, firstFormId } = buildFormConfig(stateCode, forms);
  const selectedForm = searchParams.get('form') || startFormId || firstFormId;
  const currentFormBase = formConfig[selectedForm] || formConfig[firstFormId];
  const isAzStateTax = stateCode === 'az' && currentFormBase?.formId?.includes('state-tax');
  const isNyStateTax = stateCode === 'ny' && currentFormBase?.formId?.includes('state-tax');
  const isWiStateTax = stateCode === 'wi' && currentFormBase?.formId?.includes('state-tax');
  const currentForm = isAzStateTax
    ? { ...currentFormBase, api: '/api/payroll-packet-az/fillable' }
    : isNyStateTax
      ? { ...currentFormBase, api: '/api/payroll-packet-common/state-tax?state=ny' }
      : isWiStateTax
        ? { ...currentFormBase, api: '/api/payroll-packet-wi/fillable' }
        : currentFormBase;

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const [signatures, setSignatures] = useState<Map<string, string>>(new Map());
  const [currentSignature, setCurrentSignature] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [i9Mode, setI9Mode] = useState<'A' | 'BC'>('A');
  const [i9Selections, setI9Selections] = useState<{ listA?: string; listB?: string; listC?: string }>({});
  const [i9Documents, setI9Documents] = useState<{
    listA?: { url: string; filename: string };
    listB?: { url: string; filename: string };
    listC?: { url: string; filename: string };
  }>({});
  const [uploadingDoc, setUploadingDoc] = useState<'i9_list_a' | 'i9_list_b' | 'i9_list_c' | null>(null);
  const [healthInsuranceAcknowledged, setHealthInsuranceAcknowledged] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [emptyFieldPage, setEmptyFieldPage] = useState<number | null>(null);
  const [missingRequiredFields, setMissingRequiredFields] = useState<string[]>([]);
  const lastSavedSignatureRef = useRef<string | null>(null);

  const basePath = `/payroll-packet-${stateCode}`;
  const isWiOrNv = stateCode === 'wi' || stateCode === 'nv';

  useEffect(() => {
    if (!formConfig[selectedForm]) {
      router.replace(`${basePath}/form-viewer?form=${firstFormId}`);
    }
  }, [basePath, firstFormId, formConfig, router, selectedForm]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Load saved signatures from database on mount
  useEffect(() => {
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

    loadSavedSignatures();
  }, []);

  useEffect(() => {
    const loadI9Documents = async () => {
      if (selectedForm !== 'i9') return;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

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
            if (result.documents.list_a_url) {
              docs.listA = { url: result.documents.list_a_url, filename: result.documents.list_a_filename };
            }
            if (result.documents.list_b_url) {
              docs.listB = { url: result.documents.list_b_url, filename: result.documents.list_b_filename };
            }
            if (result.documents.list_c_url) {
              docs.listC = { url: result.documents.list_c_url, filename: result.documents.list_c_filename };
            }
            setI9Documents(docs);
          }
        }
      } catch (err) {
        console.warn('[I9_UPLOAD] load error', err);
      }
    };

    loadI9Documents();
  }, [selectedForm]);

  // Load signature for current form and reset canvas when form changes
  useEffect(() => {
    // Reset last saved signature reference when form changes
    lastSavedSignatureRef.current = null;

    // Load existing drawn signature for this form if it exists
    const signatureKey = currentForm?.formId || selectedForm;
    const savedSignature = signatures.get(signatureKey);
    if (savedSignature && savedSignature.startsWith('data:image')) {
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

    // Reset health insurance acknowledgment when form changes
    setHealthInsuranceAcknowledged(false);
    setMissingRequiredFields([]);
  }, [currentForm?.formId, selectedForm, signatures]);

  const handlePDFSave = (pdfBytes: Uint8Array) => {
    console.log(`[FORM VIEWER] onSave called with ${pdfBytes.length} bytes`);
    pdfBytesRef.current = pdfBytes;
    console.log('[FORM VIEWER] pdfBytesRef.current updated');
  };

  const handleFieldChange = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      handleManualSave();
    }, 30000); // Auto-save 30 seconds after user stops typing
  };

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
      console.log('[SAVE] Session check:', {
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        userId: session?.user?.id,
        tokenPreview: session?.access_token?.substring(0, 20) + '...'
      });

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
      if (selectedForm === 'i9') {
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

        if (session?.user?.id && typeof window !== 'undefined') {
          const lastPath = `${window.location.pathname}${window.location.search}`;
          localStorage.setItem("onboarding_last_form", JSON.stringify({
            userId: session.user.id,
            path: lastPath,
            savedAt: new Date().toISOString(),
          }));
        }
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

    if (currentForm?.requiresSignature && currentSignature) {
      await saveSignatureToDatabase(currentSignature);
    }
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

  const handleDocumentUpload = async (
    documentType: 'i9_list_a' | 'i9_list_b' | 'i9_list_c',
    file: File,
  ) => {
    try {
      setUploadingDoc(documentType);
      const {
        data: { session },
      } = await supabase.auth.getSession();

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

      const parseResponseBody = async () => {
        const clone = response.clone();
        try {
          return await response.json();
        } catch {
          return await clone.text();
        }
      };

      const responseBody = await parseResponseBody();

      if (!response.ok) {
        const errorMessage =
          typeof responseBody === 'string'
            ? responseBody
            : (responseBody as any)?.error || 'Upload failed';
        throw new Error(errorMessage);
      }

      if (!responseBody || typeof responseBody === 'string') {
        throw new Error('Upload succeeded but returned an unexpected response.');
      }

      const result = responseBody;
      const toKey = documentType === 'i9_list_a' ? 'listA' : documentType === 'i9_list_b' ? 'listB' : 'listC';
      setI9Documents((prev) => ({
        ...prev,
        [toKey]: { url: result.url, filename: result.filename },
      }));
      alert('Document uploaded successfully!');
    } catch (error) {
      console.error('[I9_UPLOAD] Error:', error);
      alert(`Failed to upload: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleContinue = async () => {
    console.log('[VALIDATION] handleContinue called, selectedForm:', selectedForm);
    console.log('[VALIDATION] currentForm:', currentForm);
    console.log('[VALIDATION] currentSignature:', currentSignature);
    setMissingRequiredFields([]);
    const shouldSaveOnMissing = stateCode === 'ny' || stateCode === 'nv';

    // Check if signature is required but not provided
    if (currentForm?.requiresSignature && !currentSignature) {
      console.log('[VALIDATION] Signature required but missing');
      setValidationError('Please provide your signature in the signature box below before continuing.');
      setEmptyFieldPage(null);

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

    if (selectedForm === 'health-insurance' && !healthInsuranceAcknowledged) {
      alert('Please acknowledge that you have read the Health Insurance Marketplace notice before continuing.');
      return;
    }

    // Validate required fields for ADP Direct Deposit
    if (selectedForm === 'adp-deposit' && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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

    // Validate required fields for WI state tax form
    if (selectedForm === 'state-tax' && stateCode === 'wi' && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'wiFirstName', friendly: 'Employee Legal Name' },
          { name: 'wiSSN', friendly: 'Social Security Number' },
          { name: 'homeAddress', friendly: 'Employee Address' },
          { name: 'DOB', friendly: 'Date of Birth' },
          { name: 'city', friendly: 'City' },
          { name: 'state', friendly: 'State' },
          { name: 'zip', friendly: 'ZIP Code' },
          { name: 'total', friendly: 'Total' },
          { name: 'date', friendly: 'Date Signed' },
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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

        const exemptionFields = [
          { name: 'exemptionYS', friendly: 'Exemption (Self)' },
          { name: 'exemptionSpouse', friendly: 'Exemption (Spouse)' },
          { name: 'exemptionDependents', friendly: 'Exemption (Dependents)' },
        ];

        const exemptionValues = exemptionFields.map(({ name }) => {
          try {
            const field = form.getTextField(name);
            return (field.getText() || '').trim();
          } catch (err) {
            console.warn(`Field ${name} not found or error checking:`, err);
            return '';
          }
        });

        if (exemptionValues.every((value) => value === '')) {
          let page = 1;
          try {
            const field = form.getTextField(exemptionFields[0].name);
            page = getFieldPage(field);
          } catch {
            page = 1;
          }
          const message =
            'Please fill in at least one exemption field (Self, Spouse, or Dependents) on page ' +
            `${page} of the PDF`;
          setMissingRequiredFields(exemptionFields.map((field) => field.name));
          setValidationError(message);
          setEmptyFieldPage(page);

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

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating WI state tax fields:', err);
      }
    }

    // Validate required fields for AZ state tax form
    if (selectedForm === 'state-tax' && stateCode === 'az' && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'azFirstName', friendly: 'Employee Legal Name' },
          { name: 'azSSN', friendly: 'Social Security Number' },
          { name: 'homeAdress', friendly: 'Employee Address' },
          { name: 'city', friendly: 'City' },
          { name: 'state', friendly: 'State' },
          { name: 'zip', friendly: 'ZIP Code' },
          { name: 'date', friendly: 'Date Signed' },
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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

        const withholdingCheckboxes = [
          'OneCheckBox',
          'pointFiveCheckBox ',
          'onePercentCheckBox',
          'onePointFiveCheckBox',
          'twoPercentCheckBox',
          'twoPointFiveCheckBox',
          'threePercentCheckBox',
          'threePointFiveCheckBox',
          'extraAmmountCheckBox',
          'twoCheckBox',
        ];

        let hasWithholdingSelection = false;
        let extraAmountSelected = false;
        for (const fieldName of withholdingCheckboxes) {
          try {
            const field = form.getCheckBox(fieldName);
            if (field.isChecked()) {
              hasWithholdingSelection = true;
              if (fieldName === 'extraAmmountCheckBox') {
                extraAmountSelected = true;
              }
            }
          } catch (err) {
            console.warn(`Field ${fieldName} not found or error checking:`, err);
          }
        }

        if (!hasWithholdingSelection) {
          let page = 1;
          try {
            const field = form.getCheckBox(withholdingCheckboxes[0]);
            page = getFieldPage(field);
          } catch {
            page = 1;
          }
          const message = `Please select a withholding percentage or additional amount option on page ${page} of the PDF`;
          setMissingRequiredFields(withholdingCheckboxes);
          setValidationError(message);
          setEmptyFieldPage(page);

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

        if (extraAmountSelected) {
          try {
            const field = form.getTextField('extraAmmount');
            const value = field.getText();
            if (!value || value.trim() === '') {
              const page = getFieldPage(field);
              const message = `Please enter the additional withholding amount on page ${page} of the PDF`;
              setMissingRequiredFields(['extraAmmount']);
              setValidationError(message);
              setEmptyFieldPage(page);

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
            console.warn('Field extraAmmount not found or error checking:', err);
          }
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating AZ state tax fields:', err);
      }
    }

    // Validate required fields for NY state tax form
    if (selectedForm === 'state-tax' && stateCode === 'ny' && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'First name and middle initial', friendly: 'First name & middle initial' },
          { name: 'Last name', friendly: 'Last name' },
          { name: 'Permanent mailing address', friendly: 'Permanent home address' },
          { name: 'City, village or post office', friendly: 'City' },
          { name: 'State', friendly: 'State' },
          { name: 'ZIP code', friendly: 'ZIP code' },
          { name: 'Your SSN', friendly: 'Social Security Number' },
          { name: 'Date', friendly: 'Date' },
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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

        const getFieldValue = (name: string) => {
          try {
            return (form.getTextField(name)?.getText() || '').trim();
          } catch {
            return '';
          }
        };

        const checkAtLeastOneFilled = (names: string[], friendly: string) => {
          const values = names.map(getFieldValue);
          if (values.every((value) => !value)) {
            const sampleField = form.getTextField(names[0]) || form.getTextField(names[1]);
            const page = getFieldPage(sampleField);
            const message = `Please fill in at least one of the ${friendly} fields on page ${page}`;
            setMissingRequiredFields(names);
            setValidationError(message);
            setEmptyFieldPage(page);
            if (shouldSaveOnMissing) {
              void handleManualSave();
            }
            setTimeout(() => {
              const canvas = document.querySelector(`canvas[data-page-number="${page}"]`);
              if (canvas) {
                canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }, 100);
            return true;
          }
          return false;
        };

        if (checkAtLeastOneFilled(['line 1', 'line 2'], '"line 1" or "line 2"')) {
          return;
        }
        if (checkAtLeastOneFilled(['line 3', 'line 4', 'line 5'], '"line 3", "line 4", or "line 5"')) {
          return;
        }

        try {
          const statusField = form.getCheckBox('Status');
          if (!statusField.isChecked()) {
            const page = getFieldPage(statusField);
            const message = `Please select a filing status option on page ${page} of the PDF`;
            setMissingRequiredFields(['Status']);
            setValidationError(message);
            setEmptyFieldPage(page);
            if (shouldSaveOnMissing) {
              void handleManualSave();
            }
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
          console.warn('Status checkbox validation failed:', err);
        }
      } catch (err) {
        console.error('Error validating NY state tax fields:', err);
      }
    }

    // Validate required fields for WI Notice to Employee
    if (selectedForm === 'notice-to-employee' && (stateCode === 'wi' || stateCode === 'nv') && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'PRINT NAME of Employee', friendly: 'Printed Name (Employee)' },
          { name: 'Date', friendly: 'Date (Employee)' },
          { name: 'Date_2', friendly: 'Date (Employee)' },
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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
        console.error('Error validating WI Notice to Employee fields:', err);
      }
    }

    // Validate required fields for AZ/NY Notice to Employee
    if (selectedForm === 'notice-to-employee' && (stateCode === 'az' || stateCode === 'ny') && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'PRINT NAME of Employee', friendly: 'Printed Name (Employee)' },
          { name: 'Date_2', friendly: 'Date (Employee)' },
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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
        console.error('Error validating AZ Notice to Employee fields:', err);
      }
    }

    // Validate required fields for WI Temporary Employment Agreement
    if (selectedForm === 'temp-employment-agreement' && (stateCode === 'wi' || stateCode === 'nv') && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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

        const requiredField = { name: 'employee_signature_date', friendly: 'Date' };

        try {
          const field = form.getTextField(requiredField.name);
          const value = field.getText();
          if (!value || value.trim() === '') {
            const page = getFieldPage(field);
            const message = `Please fill in the required field: "${requiredField.friendly}" on page ${page} of the PDF`;
            setMissingRequiredFields([requiredField.name]);
            setValidationError(message);
            setEmptyFieldPage(page);

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
          console.warn(`Field ${requiredField.name} not found or error checking:`, err);
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating WI Temp Employment Agreement fields:', err);
      }
    }

    // Validate required fields for AZ/NY Temporary Employment Agreement
    if (selectedForm === 'temp-employment-agreement' && (stateCode === 'az' || stateCode === 'ny') && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
        const form = pdfDoc.getForm();
        const lastPageNumber = pdfDoc.getPages().length;

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

        const requiredField = { name: 'employee_signature_date', friendly: 'Date' };

        try {
          const field = form.getTextField(requiredField.name);
          const value = field.getText();
          if (!value || value.trim() === '') {
            const page = stateCode === 'ny' ? lastPageNumber : getFieldPage(field);
            const message = `Please fill in the required field: "${requiredField.friendly}" on page ${page} of the PDF`;
            setMissingRequiredFields([requiredField.name]);
            setValidationError(message);
            setEmptyFieldPage(page);

            if (shouldSaveOnMissing) {
              void handleManualSave();
            }

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
          console.warn(`Field ${requiredField.name} not found or error checking:`, err);
        }

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating AZ Temp Employment Agreement fields:', err);
      }
    }

    // Validate required fields for WI W-4 (Step 1 a/b and filing status).
    if (selectedForm === 'fw4' && stateCode === 'wi' && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_01[0]', friendly: 'Step 1(a) First name and middle initial (employee)' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_02[0]', friendly: 'Step 1(b) Last name (employee)' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_03[0]', friendly: 'Step 1(c) Address (employee)' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_04[0]', friendly: 'Step 1(d) City or town, state, and ZIP code (employee)' },
          { name: 'topmostSubform[0].Page1[0].f1_05[0]', friendly: 'Social Security number (employee)' },
          { name: 'Employee Date', friendly: 'Employee date' },
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

        const step1cFilingStatusFields = [
          'topmostSubform[0].Page1[0].c1_1[0]',
          'topmostSubform[0].Page1[0].c1_1[1]',
          'topmostSubform[0].Page1[0].c1_1[2]',
        ];

        let hasFilingStatus = step1cFilingStatusFields.some((fieldName) =>
          isCheckboxCheckedInDom(fieldName)
        );

        if (!hasFilingStatus) {
          for (const fieldName of step1cFilingStatusFields) {
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
          let page = 1;
          try {
            const field = form.getCheckBox(step1cFilingStatusFields[0]);
            page = getFieldPage(field);
          } catch {
            page = 1;
          }
          const message = 'Please select at least one filing status option in Step 1(c) on page 1 of the PDF';
          setMissingRequiredFields(step1cFilingStatusFields);
          setValidationError(message);
          setEmptyFieldPage(page);

          
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

        const step3Fields = [
          { name: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]', label: 'Qualifying children amount' },
          { name: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]', label: 'Other dependents amount' },
        ];

        const step3Values = step3Fields.map(({ name }) => {
          try {
            const field = form.getTextField(name);
            return (field.getText() || '').trim();
          } catch (err) {
            console.warn(`Field ${name} not found or error checking:`, err);
            return '';
          }
        });

        if (step3Values.every((value) => value === '')) {
          let page = 1;
          try {
            const field = form.getTextField(step3Fields[0].name);
            page = getFieldPage(field);
          } catch {
            page = 1;
          }
          const message =
            'Please fill in at least one Step 3 field (Qualifying children or Other dependents) on page 1 of the PDF';
          setMissingRequiredFields(step3Fields.map((field) => field.name));
          setValidationError(message);
          setEmptyFieldPage(page);

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

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating WI W-4 fields:', err);
      }
    }

    // Validate required fields for AZ/NY W-4
    if (selectedForm === 'fw4' && (stateCode === 'az' || stateCode === 'ny') && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_01[0]', friendly: 'First name and middle initial' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_02[0]', friendly: 'Last name' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_03[0]', friendly: 'Address' },
          { name: 'topmostSubform[0].Page1[0].Step1a[0].f1_04[0]', friendly: 'City, state, and ZIP code' },
          { name: 'topmostSubform[0].Page1[0].f1_05[0]', friendly: 'Social Security number' },
          { name: 'Employee Date', friendly: 'Employee date' },
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

              if (shouldSaveOnMissing) {
                void handleManualSave();
              }

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

        const filingStatusFields = [
          'topmostSubform[0].Page1[0].c1_1[0]',
          'topmostSubform[0].Page1[0].c1_1[1]',
          'topmostSubform[0].Page1[0].c1_1[2]',
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
          let page = 1;
          try {
            const field = form.getCheckBox(filingStatusFields[0]);
            page = getFieldPage(field);
          } catch {
            page = 1;
          }
          const message =
            'Please select at least one filing status option in Step 1(c) on page 1 of the PDF';
          setMissingRequiredFields(filingStatusFields);
          setValidationError(message);
          setEmptyFieldPage(page);

          if (shouldSaveOnMissing) {
            void handleManualSave();
          }

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

        const step3Fields = [
          { name: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_06[0]', label: 'Qualifying children amount' },
          { name: 'topmostSubform[0].Page1[0].Step3_ReadOrder[0].f1_07[0]', label: 'Other dependents amount' },
        ];

        const step3Values = step3Fields.map(({ name }) => {
          try {
            const field = form.getTextField(name);
            return (field.getText() || '').trim();
          } catch (err) {
            console.warn(`Field ${name} not found or error checking:`, err);
            return '';
          }
        });

        if (step3Values.every((value) => value === '')) {
          let page = 1;
          try {
            const field = form.getTextField(step3Fields[0].name);
            page = getFieldPage(field);
          } catch {
            page = 1;
          }
          const message =
            'Please fill in at least one Step 3 field (Qualifying children or Other dependents) on page 1 of the PDF';
          setMissingRequiredFields(step3Fields.map((field) => field.name));
          setValidationError(message);
          setEmptyFieldPage(page);

          if (shouldSaveOnMissing) {
            void handleManualSave();
          }

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

        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating AZ/NY W-4 fields:', err);
      }
    }

    // Validate required dates for NV W-4
    if (selectedForm === 'fw4' && stateCode === 'nv' && pdfBytesRef.current) {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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

        const requiredDateFields = [
          { name: 'Employee Date', friendly: 'Employee date' },
          { name: 'First Date of Employment', friendly: 'First date of employment' },
        ];

        for (const fieldInfo of requiredDateFields) {
          try {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();
            if (!value || value.trim() === '') {
              const page = getFieldPage(field);
              const message = `Please fill in the required field: "${fieldInfo.friendly}" on page ${page} of the PDF`;
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(message);
              setEmptyFieldPage(page);

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
        console.error('Error validating NV W-4 dates:', err);
      }
    }

    // Validate required fields for employee handbook
    if (selectedForm === 'employee-handbook' && pdfBytesRef.current) {
      console.log('[VALIDATION] Employee handbook validation starting...');
      console.log('[VALIDATION] pdfBytesRef.current exists:', !!pdfBytesRef.current);
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
        const form = pdfDoc.getForm();
        console.log('[VALIDATION] PDF form loaded successfully');

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
          { name: 'date6', page: 77, friendly: 'Date (Section 6)' }
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
            console.log(`[VALIDATION] Checking field ${fieldInfo.name}:`, value);

            if (!value || value.trim() === '') {
              // Found empty required field
              const scrollTarget = resolveFieldScrollTarget(fieldInfo.name);
              const displayPage = scrollTarget.pageNumber ?? fieldInfo.page;
              setMissingRequiredFields([fieldInfo.name]);
              setValidationError(`Please fill in the required field: "${fieldInfo.friendly}" on page ${displayPage} of the PDF`);
              setEmptyFieldPage(displayPage);
              void handleManualSave();

              // Scroll to the specific field in the PDF viewer
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
                    scrollContainer.scrollTo({ top: Math.max(targetTop - 160, 0), behavior: 'smooth' });
                  } else {
                    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                } else {
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
        setMissingRequiredFields([]);
        setValidationError(null);
        setEmptyFieldPage(null);
      } catch (err) {
        console.error('Error validating PDF fields:', err);
      }
    }

    if (selectedForm === 'i9') {
      if (isWiOrNv && pdfBytesRef.current) {
        try {
          const { PDFDocument } = await import('pdf-lib');
          const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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

          const requireFirstPageOnly = stateCode === 'nv' || stateCode === 'wi';
          const requiredFields = [
            { name: 'Last Name Family Name from Section 1', friendly: 'Last Name', type: 'text' },
            { name: 'First Name Given Name from Section 1', friendly: 'First Name', type: 'text' },
            { name: 'Address Street Number and Name', friendly: 'Address', type: 'text' },
            { name: 'City or Town', friendly: 'City or Town', type: 'text' },
            { name: 'ZIP Code', friendly: 'ZIP Code', type: 'text' },
            { name: 'Date of Birth mmddyyyy', friendly: 'Date of Birth', type: 'text' },
            { name: 'US Social Security Number', friendly: 'U.S. Social Security Number', type: 'text' },
            { name: 'Employees E-mail Address', friendly: "Employee's Email Address", type: 'text' },
            { name: 'Telephone Number', friendly: "Employee's Telephone Number", type: 'text' },
            { name: "Today's Date mmddyyy", friendly: "Today's Date", type: 'text' },
          ];

          const missingFields: string[] = [];
          let firstMissing: { friendly: string; page: number } | null = null;

          for (const fieldInfo of requiredFields) {
            try {
              const field = form.getField(fieldInfo.name) as any;
              let value = '';
              if (fieldInfo.type === 'dropdown' && typeof field.getSelected === 'function') {
                const selected = field.getSelected();
                value = Array.isArray(selected) ? selected.join('') : String(selected ?? '');
              } else if (typeof field.getText === 'function') {
                value = field.getText() || '';
              }
              if (!value || value.trim() === '') {
                const page = getFieldPage(field);
                if (requireFirstPageOnly && page !== 1) {
                  continue;
                }
                if (!firstMissing) {
                  firstMissing = { friendly: fieldInfo.friendly, page };
                }
                missingFields.push(fieldInfo.name);
              }
            } catch (err) {
              console.warn(`Field ${fieldInfo.name} not found or error checking:`, err);
            }
          }

          if (missingFields.length > 0 && firstMissing) {
            const message = `Please fill in the required field: "${firstMissing.friendly}" on page ${firstMissing.page} of the PDF`;
            setMissingRequiredFields(missingFields);
            setValidationError(message);
            setEmptyFieldPage(firstMissing.page);

            setTimeout(() => {
              const canvas = document.querySelector(`canvas[data-page-number="${firstMissing.page}"]`);
              if (canvas) {
                canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }, 100);

            return;
          }

          const statusCheckboxes = ['CB_1', 'CB_2', 'CB_3', 'CB_4'];
          const statusFieldsForValidation: { name: string; page: number }[] = [];
          for (const fieldName of statusCheckboxes) {
            try {
              const field = form.getCheckBox(fieldName);
              const page = getFieldPage(field);
              if (requireFirstPageOnly && page !== 1) {
                continue;
              }
              statusFieldsForValidation.push({ name: fieldName, page });
            } catch (err) {
              console.warn(`Field ${fieldName} not found or error checking:`, err);
            }
          }

          if (statusFieldsForValidation.length > 0) {
            let hasStatus = false;
            for (const { name } of statusFieldsForValidation) {
              try {
                const field = form.getCheckBox(name);
                if (field.isChecked()) {
                  hasStatus = true;
                  break;
                }
              } catch (err) {
                console.warn(`Field ${name} not found or error checking:`, err);
              }
            }

            if (!hasStatus) {
              const page = statusFieldsForValidation[0].page;
              const message = `Please select at least one work authorization status checkbox in Section 1 on page ${page} of the PDF`;
              setMissingRequiredFields(statusFieldsForValidation.map((field) => field.name));
              setValidationError(message);
              setEmptyFieldPage(page);

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
          }

          setValidationError(null);
          setEmptyFieldPage(null);
        } catch (err) {
          console.error('Error validating I-9 fields:', err);
        }
      }

      if ((stateCode === 'az' || stateCode === 'ny') && pdfBytesRef.current) {
        try {
          const { PDFDocument } = await import('pdf-lib');
          const pdfDoc = await PDFDocument.load(pdfBytesRef.current);
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
            { name: 'Last Name (Family Name)', friendly: 'Last Name (Family Name)' },
            { name: 'First Name Given Name', friendly: 'First Name (Given Name)' },
            { name: 'Address Street Number and Name', friendly: 'Address (Street Number and Name)' },
            { name: 'City or Town', friendly: 'City or Town' },
            { name: 'ZIP Code', friendly: 'ZIP Code' },
            { name: 'Date of Birth mmddyyyy', friendly: 'Date of Birth (mm/dd/yyyy)' },
            { name: "Today's Date mmddyyy", friendly: "Today's Date (mm/dd/yyyy)" },
            { name: 'US Social Security Number', friendly: 'U.S. Social Security Number' },
            { name: 'Employees E-mail Address', friendly: "Employee's Email Address" },
            { name: 'Telephone Number', friendly: "Employee's Telephone Number" },
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
                let page = 1;
                try {
                  const field = form.getField(fieldInfo.name) as any;
                  page = getFieldPage(field);
                } catch {
                  page = 1;
                }
                const message = `Please fill in the required field: "${fieldInfo.friendly}" on page ${page} of the PDF`;
                setMissingRequiredFields([fieldInfo.name]);
                setValidationError(message);
                setEmptyFieldPage(page);

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
            let page = 1;
            try {
              const field = form.getCheckBox(citizenshipFields[0]);
              page = getFieldPage(field);
            } catch {
              page = 1;
            }
            const message =
              'Please select your citizenship/immigration status on page 1 of the PDF: 1) U.S. citizen 2) Noncitizen national 3) Lawful permanent resident 4) Alien authorized to work';
            setMissingRequiredFields(citizenshipFields);
            setValidationError(message);
            setEmptyFieldPage(page);

            if (shouldSaveOnMissing) {
              void handleManualSave();
            }

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

          setValidationError(null);
          setEmptyFieldPage(null);
        } catch (err) {
          console.error('Error validating AZ I-9 fields:', err);
        }
      }

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
        if (!i9Selections.listC) {
          alert('Please choose a List C document type.');
          return;
        }
        if (!i9Documents.listB || !i9Documents.listC) {
          alert('Please upload your List B and List C documents.');
          return;
        }
      }
    }

    if (pdfBytesRef.current) {
      await handleManualSave();
    }

    if (currentForm?.requiresSignature && currentSignature) {
      await saveSignatureToDatabase(currentSignature);
    }

    if (currentForm?.next) {
      router.push(`${basePath}/form-viewer?form=${currentForm.next}`);
    } else {
      // Last form completed - mark onboarding as completed and redirect to login
      console.log('[FORM VIEWER] No next form, completing onboarding workflow');
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
            form: `payroll-packet-${stateCode}`,
            trigger: 'save-finish',
          }),
        });

        if (!response.ok) {
          console.error('[FORM VIEWER] Failed to send onboarding notification');
        } else {
          console.log('[FORM VIEWER] Onboarding notification sent successfully');
        }
      } catch (error) {
        console.error('[FORM VIEWER] Error sending onboarding notification:', error);
      }

      // Redirect to login regardless of notification success
      router.push('/login');
    }
  };

  const handleBack = () => {
    const currentIndex = formOrder.indexOf(selectedForm);
    if (currentIndex > 0) {
      const prevForm = formOrder[currentIndex - 1];
      router.push(`${basePath}/form-viewer?form=${prevForm}`);
    } else {
      router.push(basePath);
    }
  };

  // Signature helpers
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
      setCurrentSignature(dataUrl);
      const signatureKey = currentForm?.formId || selectedForm;
      // Save signature for current form
      setSignatures(prev => {
        const newSigs = new Map(prev);
        newSigs.set(signatureKey, dataUrl);
        return newSigs;
      });

      if (currentForm?.requiresSignature) {
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
          formData: pdfBytesRef.current ? btoa(
            Array.from(pdfBytesRef.current)
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
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    setCurrentSignature('');
    const signatureKey = currentForm?.formId || selectedForm;
    // Remove signature for current form
    setSignatures(prev => {
      const newSigs = new Map(prev);
      newSigs.delete(signatureKey);
      return newSigs;
    });
  };

  if (!currentForm) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h1>Form not found</h1>
        <p>The form "{selectedForm}" does not exist.</p>
        <button
          onClick={() => router.push(`${basePath}/form-viewer?form=${firstFormId}`)}
          style={{
            padding: '12px 24px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginTop: '20px',
          }}
        >
          Go to first form
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f5f5f5' }}>
      <div
        style={{
          backgroundColor: 'white',
          padding: '16px 24px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>{currentForm.display}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}>
          {saveStatus === 'saving' && <span style={{ color: '#1976d2' }}>💾 Saving...</span>}
          {saveStatus === 'saved' && <span style={{ color: '#2e7d32' }}>✓ Saved</span>}
          {saveStatus === 'error' && <span style={{ color: '#d32f2f' }}>⚠ Save failed</span>}
          {lastSaved && <span style={{ color: '#666', fontSize: '12px' }}>Last saved: {lastSaved.toLocaleTimeString()}</span>}
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

      <div style={{ flex: 1, padding: '24px', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Validation Error Banner */}
        {validationError && (
          <div style={{
            backgroundColor: '#ffebee',
            border: '3px solid #d32f2f',
            borderRadius: '12px',
            padding: '20px 28px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 4px 12px rgba(211, 47, 47, 0.3)',
            animation: 'slideDown 0.3s ease-out'
          }}>
            <svg style={{ width: '32px', height: '32px', fill: '#d32f2f', flexShrink: 0 }} viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', color: '#d32f2f', marginBottom: '8px', fontSize: '18px' }}>
                ⚠ Required Field Missing
              </div>
              <div style={{ color: '#c62828', fontSize: '15px', fontWeight: '500', marginBottom: '6px' }}>
                {validationError}
              </div>
              {emptyFieldPage && (
                <div style={{ color: '#c62828', fontSize: '13px', backgroundColor: '#fff', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ffcdd2' }}>
                  📄 Please scroll down to <strong>page {emptyFieldPage}</strong> in the PDF below and fill in the required field before continuing.
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ flex: 1, marginBottom: '20px' }}>
          <PDFFormEditor
            key={`${currentForm.formId}-${selectedForm}-${currentForm.api}`}
            pdfUrl={currentForm.api}
            formId={currentForm.formId}
            onSave={handlePDFSave}
            onFieldChange={handleFieldChange}
            onContinue={handleContinue}
            skipButtonDetection={!currentForm.requiresSignature}
            requiredFieldNames={missingRequiredFields}
            showRequiredFieldErrors={missingRequiredFields.length > 0}
          />
        </div>

        {currentForm.requiresSignature && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '20px',
            order: selectedForm === 'i9' ? 2 : 0
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

        {selectedForm === 'i9' && (
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '20px',
            }}
          >
            <h2 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 'bold' }}>
              Identity & Employment Verification (Form I-9)
            </h2>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#555' }}>
              Choose one of the following: provide a List A document, or provide one from List B and one from List C.
            </p>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="radio" name="i9mode" checked={i9Mode === 'A'} onChange={() => setI9Mode('A')} />
                <span>Use List A (one document)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="radio" name="i9mode" checked={i9Mode === 'BC'} onChange={() => setI9Mode('BC')} />
                <span>Use List B + List C (two documents)</span>
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 'bold' }}>List A Document</h3>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
                  Select document type {i9Mode === 'A' && <span style={{ color: '#d32f2f' }}>*</span>}
                </label>
                <select
                  value={i9Selections.listA || ''}
                  onChange={(e) => setI9Selections((prev) => ({ ...prev, listA: e.target.value || undefined }))}
                  style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 6 }}
                  disabled={i9Mode !== 'A'}
                >
                  <option value="">— Select —</option>
                  <option>U.S. Passport or U.S. Passport Card</option>
                  <option>Permanent Resident Card (Form I-551)</option>
                  <option>Employment Authorization Document with Photo (Form I-766)</option>
                  <option>Foreign Passport with Form I-94 indicating work authorization</option>
                  <option>Passport from Micronesia/Marshall Islands with Form I-94</option>
                </select>
              </div>
              {i9Mode === 'A' && (
                <I9UploadSlot
                  documentType="i9_list_a"
                  uploadingDoc={uploadingDoc}
                  onUpload={(file) => handleDocumentUpload('i9_list_a', file)}
                  current={i9Documents.listA}
                />
              )}
            </div>

            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 'bold' }}>List B Document</h3>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
                  Select document type {i9Mode === 'BC' && <span style={{ color: '#d32f2f' }}>*</span>}
                </label>
                <select
                  value={i9Selections.listB || ''}
                  onChange={(e) => setI9Selections((prev) => ({ ...prev, listB: e.target.value || undefined }))}
                  style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 6 }}
                  disabled={i9Mode !== 'BC'}
                >
                  <option value="">— Select —</option>
                  <option>Driver’s license or State ID (with photo or info)</option>
                  <option>ID card issued by federal/state/local agency (with photo/info)</option>
                  <option>School ID card with photograph</option>
                  <option>Voter’s registration card</option>
                  <option>U.S. military card or draft record</option>
                  <option>Military dependent’s ID card</option>
                  <option>U.S. Coast Guard Merchant Mariner Card</option>
                  <option>Native American tribal document</option>
                  <option>Driver’s license issued by Canadian authority</option>
                </select>
              </div>
              {i9Mode === 'BC' && (
                <I9UploadSlot
                  documentType="i9_list_b"
                  uploadingDoc={uploadingDoc}
                  onUpload={(file) => handleDocumentUpload('i9_list_b', file)}
                  current={i9Documents.listB}
                />
              )}
            </div>

            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 'bold' }}>List C Document</h3>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
                  Select document type {i9Mode === 'BC' && <span style={{ color: '#d32f2f' }}>*</span>}
                </label>
                <select
                  value={i9Selections.listC || ''}
                  onChange={(e) => setI9Selections((prev) => ({ ...prev, listC: e.target.value || undefined }))}
                  style={{ width: '100%', padding: '10px', border: '1px solid #ddd', borderRadius: 6 }}
                  disabled={i9Mode !== 'BC'}
                >
                  <option value="">— Select —</option>
                  <option>U.S. Social Security Card (unrestricted)</option>
                  <option>Certification of Birth Abroad (Form FS-545)</option>
                  <option>Certification of Report of Birth (Form DS-1350)</option>
                  <option>Original or certified Birth Certificate</option>
                  <option>Native American tribal document</option>
                  <option>U.S. Citizen ID Card (Form I-197)</option>
                  <option>ID Card for Resident Citizen in the U.S. (Form I-179)</option>
                  <option>Employment Authorization Document issued by DHS</option>
                </select>
              </div>
              {i9Mode === 'BC' && (
                <I9UploadSlot
                  documentType="i9_list_c"
                  uploadingDoc={uploadingDoc}
                  onUpload={(file) => handleDocumentUpload('i9_list_c', file)}
                  current={i9Documents.listC}
                />
              )}
            </div>
          </div>
        )}

        {selectedForm === 'health-insurance' && (
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '20px',
            }}
          >
            <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold' }}>
              Acknowledgment Required
            </h2>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                cursor: 'pointer',
                padding: '16px',
                backgroundColor: healthInsuranceAcknowledged ? '#e8f5e9' : '#f9f9f9',
                border: healthInsuranceAcknowledged ? '2px solid #4caf50' : '2px solid #ddd',
                borderRadius: '6px',
                transition: 'all 0.2s ease',
              }}
            >
              <input
                type="checkbox"
                checked={healthInsuranceAcknowledged}
                onChange={(e) => setHealthInsuranceAcknowledged(e.target.checked)}
                style={{
                  width: '20px',
                  height: '20px',
                  cursor: 'pointer',
                  marginTop: '2px',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '15px', lineHeight: '1.5', color: '#333' }}>
                I acknowledge that I have read and understand the Health Insurance Marketplace notice.{' '}
                <span style={{ color: '#d32f2f' }}>*</span>
              </span>
            </label>
            {healthInsuranceAcknowledged && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '12px',
                  backgroundColor: '#e8f5e9',
                  border: '1px solid #4caf50',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ color: '#2e7d32', fontWeight: 'bold', fontSize: '14px' }}>
                  ✓ Acknowledgment received
                </span>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginTop: 'auto',
            order: selectedForm === 'i9' ? 3 : 0,
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
                fontSize: '16px',
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
                fontSize: '16px',
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
              {currentForm.next ? 'Save & Continue' : 'Save & Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function I9UploadSlot({
  documentType,
  uploadingDoc,
  onUpload,
  current,
}: {
  documentType: 'i9_list_a' | 'i9_list_b' | 'i9_list_c';
  uploadingDoc: 'i9_list_a' | 'i9_list_b' | 'i9_list_c' | null;
  onUpload: (file: File) => void;
  current?: { url: string; filename: string };
}) {
  if (current) {
    return (
      <div
        style={{
          border: '2px solid #4caf50',
          borderRadius: 6,
          padding: 12,
          background: '#e8f5e9',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ color: '#2e7d32', fontWeight: 700 }}>Uploaded</div>
            <div style={{ fontSize: 13, color: '#555' }}>{current.filename}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '8px 12px',
                background: '#1976d2',
                color: '#fff',
                borderRadius: 6,
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              View
            </a>
            <label
              style={{
                padding: '8px 12px',
                background: '#666',
                color: '#fff',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Replace
              <input
                type="file"
                accept="image/*,application/pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                }}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <label
      style={{
        display: 'block',
        border: '2px dashed #ddd',
        borderRadius: 6,
        padding: 20,
        textAlign: 'center',
        cursor: 'pointer',
        backgroundColor: uploadingDoc === documentType ? '#f5f5f5' : '#fff',
      }}
    >
      <input
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        disabled={uploadingDoc === documentType}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      <div style={{ marginBottom: 8, color: '#666' }}>
        {uploadingDoc === documentType ? 'Uploading…' : 'Click to upload or drag & drop'}
      </div>
      <div style={{ fontSize: 12, color: '#888' }}>JPG, PNG, WEBP, or PDF (max 10MB)</div>
    </label>
  );
}

export function StatePayrollFormViewerWithSuspense(props: StatePayrollFormViewerProps) {
  return (
    <ViewerShell>
      <StatePayrollFormViewer {...props} />
    </ViewerShell>
  );
}
