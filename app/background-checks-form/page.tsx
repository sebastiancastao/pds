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

type BackgroundFormId = 'background-disclosure' | 'background-waiver' | 'background-addon';

type RequiredFieldConfig = {
  friendly: string;
  name: string;
  type?: 'checkbox' | 'text';
};

type MissingRequiredFields = Record<BackgroundFormId, string[]>;

type RequiredFieldGroup = {
  fields: RequiredFieldConfig[];
  friendly: string;
};

const getEmptyMissingRequiredFields = (): MissingRequiredFields => ({
  'background-disclosure': [],
  'background-waiver': [],
  'background-addon': [],
});

const REQUIRED_DISCLOSURE_FIELDS: RequiredFieldConfig[] = [
  { name: 'name', friendly: 'Full Name' },
  { name: 'address', friendly: 'Address' },
  { name: 'city', friendly: 'City' },
  { name: 'state', friendly: 'State' },
  { name: 'zip', friendly: 'ZIP Code' },
  { name: 'cellPhone', friendly: 'Cell Phone' },
  { name: 'ssn', friendly: 'Social Security Number' },
  { name: 'dateOfBirth', friendly: 'Date of Birth' },
  { name: 'driversLicense', friendly: "Driver's License Number" },
  { name: 'dlState', friendly: "Driver's License State" },
  { name: 'signatureDate', friendly: 'Date' },
];

const REQUIRED_WAIVER_FIELDS: RequiredFieldConfig[] = [
  { name: 'checkbox', friendly: 'Authorization Checkbox', type: 'checkbox' },
  { name: 'fullName', friendly: 'Full Name' },
  { name: 'date', friendly: 'Date' },
  { name: 'dateOfBirth', friendly: 'Date of Birth' },
  { name: 'ssn', friendly: 'Social Security Number' },
  { name: 'driversLicense', friendly: "Driver's License Number" },
  { name: 'state', friendly: 'State' },
  { name: 'full name', friendly: 'Current Full Name' },
  { name: 'adress', friendly: 'Current Address' },
  { name: 'cityStateZip', friendly: 'Current City / State / ZIP' },
  { name: 'phone', friendly: 'Current Phone Number' },
  { name: 'reference1Name', friendly: 'Reference Name' },
  { name: 'reference1Phone', friendly: 'Reference Phone' },
  { name: 'ref1cityStateZip', friendly: 'Reference City / State / ZIP' },
];

const WAIVER_PREVIOUS_ADDRESS_GROUPS: RequiredFieldGroup[] = [
  {
    friendly: 'Previous Address Row 1',
    fields: [
      { name: 'previousEmployer1', friendly: 'Previous Address' },
      { name: 'datefrom1', friendly: 'From Date' },
      { name: 'datefto1', friendly: 'To Date' },
    ],
  },
  {
    friendly: 'Previous Address Row 2',
    fields: [
      { name: 'previousEmployer2', friendly: 'Previous Address' },
      { name: 'datefrom2', friendly: 'From Date' },
      { name: 'datefto2', friendly: 'To Date' },
    ],
  },
  {
    friendly: 'Previous Address Row 3',
    fields: [
      { name: 'previousEmployer3', friendly: 'Previous Address' },
      { name: 'datefrom3', friendly: 'From Date' },
      { name: 'datefto3', friendly: 'To Date' },
    ],
  },
];

const WAIVER_PREVIOUS_EMPLOYMENT_GROUPS: RequiredFieldGroup[] = [
  {
    friendly: 'Previous Employment Row 1',
    fields: [
      { name: 'previousPosition1', friendly: 'Previous Employment' },
      { name: 'pdatefrom1', friendly: 'From Date' },
      { name: 'pdatefto1', friendly: 'To Date' },
    ],
  },
  {
    friendly: 'Previous Employment Row 2',
    fields: [
      { name: 'previousPosition2', friendly: 'Previous Employment' },
      { name: 'pdatefrom2', friendly: 'From Date' },
      { name: 'pdatefto2', friendly: 'To Date' },
    ],
  },
  {
    friendly: 'Previous Employment Row 3',
    fields: [
      { name: 'previousPosition3', friendly: 'Previous Employment' },
      { name: 'pdatefrom3', friendly: 'From Date' },
      { name: 'pdatefto3', friendly: 'To Date' },
    ],
  },
];

export default function BackgroundChecksForm() {
  const router = useRouter();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoSavePendingRef = useRef(false);
  const pdfBytesRef = useRef<Uint8Array | null>(null);
  const waiverBytesRef = useRef<Uint8Array | null>(null);
  const disclosureBytesRef = useRef<Uint8Array | null>(null);
  const addonBytesRef = useRef<Uint8Array | null>(null);
  const [signatures, setSignatures] = useState<Map<string, string>>(new Map());
  const [currentSignature, setCurrentSignature] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<string>('');
  const [waiverProgress, setWaiverProgress] = useState(0);
  const [disclosureProgress, setDisclosureProgress] = useState(0);
  const [addonProgress, setAddonProgress] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [checkingApproval, setCheckingApproval] = useState(false);
  const disclosureSectionRef = useRef<HTMLDivElement | null>(null);
  const waiverSectionRef = useRef<HTMLDivElement | null>(null);
  const addonSectionRef = useRef<HTMLDivElement | null>(null);
  const signatureSectionRef = useRef<HTMLDivElement | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [emptyFieldPage, setEmptyFieldPage] = useState<number | null>(null);
  const [missingRequiredFields, setMissingRequiredFields] = useState<MissingRequiredFields>(() =>
    getEmptyMissingRequiredFields()
  );

  const getPostOnboardingRoute = (role?: string) => {
    const normalized = (role ?? '').toString().trim().toLowerCase();
    if (normalized === 'exec') {
      return '/global-calendar';
    }
    if (normalized === 'hr') {
      return '/hr-dashboard';
    }
    if (normalized === 'manager') {
      return '/dashboard';
    }
    if (normalized === 'worker' || normalized === 'vendor') {
      return '/time-keeping';
    }
    if (normalized === 'backgroundchecker' || normalized === 'background-checker') {
      return '/background-checks';
    }
    return '/dashboard';
  };

  const continueDisabled = saveStatus === 'saving';

  const clearValidation = () => {
    setValidationError(null);
    setEmptyFieldPage(null);
    setMissingRequiredFields(getEmptyMissingRequiredFields());
  };

  const getFormSectionRef = (formId: BackgroundFormId) => {
    if (formId === 'background-disclosure') return disclosureSectionRef;
    if (formId === 'background-waiver') return waiverSectionRef;
    return addonSectionRef;
  };

  const scrollToValidationTarget = (formId: BackgroundFormId | 'signature', page?: number | null) => {
    if (formId === 'signature') {
      signatureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const section = getFormSectionRef(formId).current;
    if (!section) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const target =
      page != null
        ? section.querySelector(`canvas[data-page-number="${page}"]`)
        : section;

    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showValidationError = ({
    formId,
    message,
    missingFields = [],
    page = null,
  }: {
    formId: BackgroundFormId | 'signature';
    message: string;
    missingFields?: string[];
    page?: number | null;
  }) => {
    const nextMissingFields = getEmptyMissingRequiredFields();
    if (formId !== 'signature') {
      nextMissingFields[formId] = missingFields;
    }

    setValidationError(message);
    setEmptyFieldPage(page);
    setMissingRequiredFields(nextMissingFields);

    window.setTimeout(() => {
      scrollToValidationTarget(formId, page);
    }, 100);
  };

  const getFieldPage = (pdfDoc: any, field: any) => {
    try {
      const widgets = field?.acroField?.getWidgets?.() || [];
      if (!widgets.length) return 1;
      const pageRef = widgets[0]?.P?.();
      if (!pageRef) return 1;
      const pages = pdfDoc.getPages();
      const pageIndex = pages.findIndex((page: any) => page.ref === pageRef);
      return pageIndex >= 0 ? pageIndex + 1 : 1;
    } catch {
      return 1;
    }
  };

  const validateFormFields = async (
    formId: BackgroundFormId,
    pdfBytes: Uint8Array | null,
    requiredFields: RequiredFieldConfig[],
  ) => {
    if (!pdfBytes) return null;

    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const formLabel =
      formId === 'background-disclosure'
        ? 'Background Check Disclosure and Authorization'
        : 'Background Check Waiver';

    for (const fieldInfo of requiredFields) {
      try {
        if (fieldInfo.type === 'checkbox') {
          const field = form.getCheckBox(fieldInfo.name);
          if (!field.isChecked()) {
            const page = getFieldPage(pdfDoc, field);
            return {
              formId,
              page,
              message: `Please complete "${fieldInfo.friendly}" in the ${formLabel} form before submitting.`,
              missingFields: [fieldInfo.name],
            };
          }
          continue;
        }

        const field = form.getTextField(fieldInfo.name);
        const value = field.getText();
        if (!value || value.trim() === '') {
          const page = getFieldPage(pdfDoc, field);
          return {
            formId,
            page,
            message: `Please fill in "${fieldInfo.friendly}" in the ${formLabel} form before submitting.`,
            missingFields: [fieldInfo.name],
          };
        }
      } catch (error) {
        console.warn(`[BACKGROUND CHECK] Validation skipped for field "${fieldInfo.name}"`, error);
      }
    }

    if (formId === 'background-waiver') {
      const validateGroupedRowRequirement = (
        groups: RequiredFieldGroup[],
        message: string,
      ) => {
        const rows = groups.map((group, index) => {
          const fields = group.fields.map((fieldInfo) => {
            const field = form.getTextField(fieldInfo.name);
            const value = field.getText();
            return {
              ...fieldInfo,
              filled: Boolean(value && value.trim() !== ''),
              page: getFieldPage(pdfDoc, field),
            };
          });

          return {
            ...group,
            fields,
            index,
            filledCount: fields.filter((field) => field.filled).length,
          };
        });

        const totalFieldsFilled = rows.reduce(
          (total, row) => total + row.filledCount,
          0,
        );

        if (totalFieldsFilled >= 3) {
          return null;
        }

        const preferredRow = rows.reduce((best, current) => {
            if (!best) return current;
            if (current.filledCount > best.filledCount) return current;
            if (current.filledCount === best.filledCount && current.index < best.index) return current;
            return best;
          }, rows[0]);

        const missingFields = preferredRow.fields
          .filter((field) => !field.filled)
          .map((field) => field.name);

        return {
          formId,
          page: preferredRow.fields[0]?.page ?? 1,
          message,
          missingFields: missingFields.length > 0 ? missingFields : preferredRow.fields.map((field) => field.name),
        };
      };

      try {
        const previousAddressValidation = validateGroupedRowRequirement(
          WAIVER_PREVIOUS_ADDRESS_GROUPS,
          'Please fill at least 3 of the 9 previous address fields in the Background Check Waiver. Completing one row is preferred.',
        );

        if (previousAddressValidation) {
          return previousAddressValidation;
        }
      } catch (error) {
        console.warn('[BACKGROUND CHECK] Validation skipped for previous address fields', error);
      }

      try {
        const previousEmploymentValidation = validateGroupedRowRequirement(
          WAIVER_PREVIOUS_EMPLOYMENT_GROUPS,
          'Please fill at least 3 of the 9 previous employment fields in the Background Check Waiver. Completing one row is preferred.',
        );

        if (previousEmploymentValidation) {
          return previousEmploymentValidation;
        }
      } catch (error) {
        console.warn('[BACKGROUND CHECK] Validation skipped for previous employment fields', error);
      }

      try {
        const yesCrimeField = form.getCheckBox('yesCrime');
        const noCrimeField = form.getCheckBox('noCrime');
        const hasCrimeSelection = yesCrimeField.isChecked() || noCrimeField.isChecked();

        if (!hasCrimeSelection) {
          const page = getFieldPage(pdfDoc, yesCrimeField);
          return {
            formId,
            page,
            message: 'Please answer the criminal history question in the Background Check Waiver before submitting.',
            missingFields: ['yesCrime', 'noCrime'],
          };
        }
      } catch (error) {
        console.warn('[BACKGROUND CHECK] Validation skipped for criminal history selection', error);
      }
    }

    return null;
  };

  const scheduleAutoSave = () => {
    autoSavePendingRef.current = true;
    if (autoSaveTimerRef.current) {
      return;
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (!autoSavePendingRef.current) {
        return;
      }
      autoSavePendingRef.current = false;
      void handleManualSave();
    }, 30000);
  };

  // Safe Uint8Array -> base64 converter (avoids call-stack overflow on large arrays)
  const uint8ToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunkSize = 0x8000; // 32KB per chunk to keep apply() arguments small
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk) as any);
    }
    return btoa(binary);
  };

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
        .select('background_check_completed, role')
        .eq('id', session.user.id)
        .single() as any);

      if (userError) {
        console.error('[BACKGROUND CHECK PAGE] Error fetching user data:', userError);
      }

      console.log('[BACKGROUND CHECK PAGE] User data:', userData);
      console.log('[BACKGROUND CHECK PAGE] background_check_completed value:', userData?.background_check_completed);
      const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
      setUserRole(normalizedRole);

      if (userData?.background_check_completed === true) {
        // Already completed - redirect based on role
        const destination = getPostOnboardingRoute(userData?.role);
        console.log(`[BACKGROUND CHECK PAGE] ƒo. Background check already completed, redirecting to ${destination}`);
        router.push(destination);
        return;
      }

      // Authorized to access (background check not completed)
      console.log('[BACKGROUND CHECK PAGE] ⚠️ Background check not completed - ALLOWING ACCESS');
      console.log('[BACKGROUND CHECK PAGE] User can now complete the form');
      setIsAuthorized(true);
    };

    checkAccess();
  }, [router]);

  // Handle PDF save from editor (legacy single-arg) - route through unified combiner
  const handlePDFSave = (pdfBytes: Uint8Array) => {
    console.log(`[BACKGROUND CHECK FORM] onSave called with ${pdfBytes.length} bytes`);
    pdfBytesRef.current = pdfBytes;
    console.log('[BACKGROUND CHECK FORM] pdfBytesRef.current updated');
    scheduleAutoSave();
  };

  // New: Save handlers per form that also attempt to merge and persist all three
  const handlePDFSaveFor = (formId: 'background-waiver' | 'background-disclosure' | 'background-addon') => async (pdfBytes: Uint8Array) => {
    if (formId === 'background-waiver') {
      waiverBytesRef.current = pdfBytes;
    } else if (formId === 'background-disclosure') {
      disclosureBytesRef.current = pdfBytes;
    } else if (formId === 'background-addon') {
      addonBytesRef.current = pdfBytes;
    }
    try {
      scheduleAutoSave();
    } catch (e) {
      console.error('[BACKGROUND CHECK FORM] Merge/save error:', e);
      setSaveStatus('error');
    }
  };

  // Handle field change - schedule auto-save every 30 seconds while editing
  const handleFieldChange = () => {
    clearValidation();
    scheduleAutoSave();
  };

  const saveFormProgress = async (
    formId: 'background-waiver' | 'background-disclosure' | 'background-addon',
    pdfBytes: Uint8Array | null,
    accessToken?: string
  ) => {
    if (!pdfBytes) return;

    try {
      const base64 = uint8ToBase64(pdfBytes);
      await fetch('/api/pdf-form-progress/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        credentials: 'same-origin',
        body: JSON.stringify({ formName: formId, formData: base64 })
      });
    } catch (pErr) {
      console.warn('[BACKGROUND CHECK FORM] Progress save failed (non-fatal):', pErr);
    }
  };

  // Manual save function - saves to background_check_pdfs table
  const handleManualSave = async () => { 
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    autoSavePendingRef.current = false;

    let accessToken: string | undefined;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token;
    } catch (pErr) {
      console.warn('[BACKGROUND CHECK FORM] Progress save session failed (non-fatal):', pErr);
    }

    await Promise.all([
      saveFormProgress('background-waiver', waiverBytesRef.current, accessToken),
      saveFormProgress('background-disclosure', disclosureBytesRef.current, accessToken),
      saveFormProgress('background-addon', addonBytesRef.current, accessToken),
    ]);

    return combineAndSave();
  };

  const combineAndSave = async () => {
    try {
      setSaveStatus('saving');

      let waiver = (typeof waiverBytesRef !== 'undefined') ? waiverBytesRef.current : null;
      let disclosure = (typeof disclosureBytesRef !== 'undefined') ? disclosureBytesRef.current : null;
      let addon = (typeof addonBytesRef !== 'undefined') ? addonBytesRef.current : null;

      // If any doc bytes are missing, fetch raw source PDFs as fallback to ensure all columns are saved
      if (!waiver) {
        try {
          const res = await fetch('/api/background-waiver');
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            waiver = buf;
          }
        } catch {}
      }
      if (!disclosure) {
        try {
          const res = await fetch('/api/background-disclosure');
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            disclosure = buf;
          }
        } catch {}
      }
      if (!addon) {
        try {
          const res = await fetch('/api/background-addon');
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            addon = buf;
          }
        } catch {}
      }

      if (!waiver && !disclosure && !addon) {
        console.warn('[SAVE] No PDF data to save');
        setSaveStatus('idle');
        return;
      }

      const { PDFDocument, rgb } = await import('pdf-lib');

      // Helper: embed signature on last page of a document
      const stampSignatureOnDoc = async (bytes: Uint8Array): Promise<Uint8Array> => {
        if (!currentSignature) return bytes;
        try {
          const doc = await PDFDocument.load(bytes);
          const pages = doc.getPages();
          if (pages.length === 0) return bytes;

          const lastPage = pages[pages.length - 1];
          const signatureX = 100;
          const signatureY = 100;
          const signatureWidth = 200;
          const signatureHeight = 50;

          if (currentSignature.startsWith('data:image')) {
            const base64Data = currentSignature.split(',')[1];
            const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            const image = await doc.embedPng(imageBytes);
            lastPage.drawImage(image, {
              x: signatureX,
              y: signatureY,
              width: signatureWidth,
              height: signatureHeight,
            });
          } else {
            lastPage.drawText(currentSignature, {
              x: signatureX,
              y: signatureY,
              size: 24,
              color: rgb(0, 0, 0),
            });
            lastPage.drawLine({
              start: { x: signatureX, y: signatureY - 5 },
              end: { x: signatureX + signatureWidth, y: signatureY - 5 },
              thickness: 1,
              color: rgb(0, 0, 0),
            });
          }

          const signatureDate = new Date().toLocaleDateString();
          lastPage.drawText(`Date: ${signatureDate}`, {
            x: signatureX,
            y: signatureY - 20,
            size: 10,
            color: rgb(0, 0, 0),
          });

          const stamped = await doc.save();
          return stamped;
        } catch (e) {
          console.warn('[SAVE] Failed to stamp signature on doc, using original bytes', e);
          return bytes;
        }
      };

      // Stamp individual docs; we will store them separately
      const waiverStamped = waiver ? await stampSignatureOnDoc(waiver) : null;
      const disclosureStamped = disclosure ? await stampSignatureOnDoc(disclosure) : null;
      const addonStamped = addon ? await stampSignatureOnDoc(addon) : null;

      // Get session for authentication
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.error('[SAVE] No session found');
        setSaveStatus('error');
        return;
      }

      // Convert Uint8Array to base64 per document (chunked)
      const waiverBase64 = waiverStamped ? uint8ToBase64(waiverStamped) : null;
      const disclosureBase64 = disclosureStamped ? uint8ToBase64(disclosureStamped) : null;
      const addonBase64 = addonStamped ? uint8ToBase64(addonStamped) : null;
      console.log('[SAVE] Prepared payload sizes:', {
        waiver: waiverBase64?.length || 0,
        disclosure: disclosureBase64?.length || 0,
        addon: addonBase64?.length || 0
      });

      // Determine signature type (always draw since we removed type option)
      const signatureType = currentSignature ? 'draw' : null;

      // Save to background_check_pdfs table
      console.log(`[SAVE] Saving to background_check_pdfs table`);
      console.log(`[SAVE] Signature type:`, signatureType);

      // Save all three PDFs in a single request
      const response = await fetch('/api/background-waiver/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          waiverPdfData: waiverBase64,
          disclosurePdfData: disclosureBase64,
          addonPdfData: addonBase64,
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

  // Check approval status
  const checkApprovalStatus = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return false;

      // First get the profile_id
      const { data: profileData, error: profileError } = await (supabase
        .from('profiles')
        .select('id')
        .eq('user_id', session.user.id)
        .single() as unknown as Promise<{ data: { id: string } | null; error: any }>);

      if (profileError || !profileData) {
        console.error('[APPROVAL CHECK] Profile error:', profileError);
        return false;
      }

      // Then check vendor_background_checks using profile_id
      const { data, error } = await (supabase
        .from('vendor_background_checks')
        .select('background_check_completed')
        .eq('profile_id', profileData.id)
        .single() as unknown as Promise<{ data: { background_check_completed: boolean } | null; error: any }>);

      if (error) {
        console.error('[APPROVAL CHECK] Error:', error);
        return false;
      }

      return data?.background_check_completed === true;
    } catch (error) {
      console.error('[APPROVAL CHECK] Exception:', error);
      return false;
    }
  };

  // Start polling for approval
  const startApprovalCheck = async () => {
    setCheckingApproval(true);
    const maxAttempts = 600; // Check for up to 1 hour (600 * 6 seconds)
    let attempts = 0;

    const checkInterval = setInterval(async () => {
      attempts++;
      const approved = await checkApprovalStatus();

      if (approved) {
        clearInterval(checkInterval);
        setIsApproved(true);
        setCheckingApproval(false);

        // Clear the new user onboarding flag
        sessionStorage.removeItem('new_user_onboarding');

        // Navigate to the role-specific landing page
        const destination = getPostOnboardingRoute(userRole);
        setTimeout(() => {
          router.push(destination);
        }, 2000);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        setCheckingApproval(false);
        alert('Approval check timed out. Please refresh the page or contact HR.');
      }
    }, 6000); // Check every 6 seconds
  };

  // Continue to next step (dashboard or next form)
  const handleContinue = async () => {
    console.log('Continue clicked');
    clearValidation();

    const disclosureValidation = await validateFormFields(
      'background-disclosure',
      disclosureBytesRef.current,
      REQUIRED_DISCLOSURE_FIELDS,
    );
    if (disclosureValidation) {
      showValidationError(disclosureValidation);
      void handleManualSave();
      return;
    }

    const waiverValidation = await validateFormFields(
      'background-waiver',
      waiverBytesRef.current,
      REQUIRED_WAIVER_FIELDS,
    );
    if (waiverValidation) {
      showValidationError(waiverValidation);
      void handleManualSave();
      return;
    }

    // Check if signature is required but not provided
    if (!currentSignature) {
      showValidationError({
        formId: 'signature',
        message: 'Please provide your signature before submitting the background check forms.',
      });
      void handleManualSave();
      return;
    }

    setSaveStatus('saving');

    try {
      // Always save before continuing (covers waiver/disclosure refs)
      console.log('Saving before continue...');
      await handleManualSave();
      console.log('Save completed');

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
        let errDetail = '';
        try {
          const error = await response.json();
          errDetail = error?.error || error?.details || JSON.stringify(error);
        } catch {
          try { errDetail = await response.text(); } catch {}
        }
        console.error('[BACKGROUND CHECK] Failed to mark as completed:', errDetail || response.status);
        alert(`Failed to complete background check.\n${errDetail || `Status: ${response.status}`}`);
        setSaveStatus('error');
        return;
      }

      console.log('[BACKGROUND CHECK] ✅ Forms submitted successfully');

      // Clear the new user onboarding flag
      sessionStorage.removeItem('new_user_onboarding');

      setSaveStatus('saved');

      // Show success message and redirect to login
      alert('Background check forms submitted successfully!');
      router.push('/login');

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
    clearValidation();
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
    clearValidation();
  };

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

  // Show approval waiting screen if submitted but not approved
  if (isSubmitted && !isApproved) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{
          textAlign: 'center',
          padding: '40px',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          maxWidth: '500px'
        }}>
          {checkingApproval ? (
            <>
              <h2 style={{ margin: '0 0 12px 0', fontSize: '24px', color: '#333' }}>
                Waiting for Approval
              </h2>
              <p style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#666' }}>
                Your background check forms have been submitted successfully.
              </p>
              <p style={{ margin: '0', fontSize: '14px', color: '#999' }}>
                Please wait while HR reviews and approves your submission.
              </p>
              <p style={{ margin: '16px 0 0 0', fontSize: '12px', color: '#999' }}>
                You may close this window and check back later.
              </p>
            </>
          ) : (
            <>
              <div style={{
                width: '60px',
                height: '60px',
                backgroundColor: '#4caf50',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px'
              }}>
                <svg style={{ width: '36px', height: '36px', fill: 'white' }} viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              </div>
              <h2 style={{ margin: '0 0 12px 0', fontSize: '24px', color: '#333' }}>
                Completed!
              </h2>
              <p style={{ margin: '0', fontSize: '16px', color: '#666' }}>
                Your background check has been completed. Redirecting...
              </p>
            </>
          )}
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
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold' }}>Background Check Forms</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#666' }}>
            Please review and sign all three background check forms below. Your progress is automatically saved.
          </p>
          <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#555' }}>
            Note: You must complete all three forms and provide your signature to continue.
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

      {/* PDF Editors */}
      <div style={{
        flex: 1,
        padding: '24px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {validationError && (
          <div style={{
            backgroundColor: '#ffebee',
            border: '2px solid #d32f2f',
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '20px',
            color: '#b71c1c',
            boxShadow: '0 2px 8px rgba(211,47,47,0.15)'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '6px', fontSize: '16px' }}>
              Required information is missing
            </div>
            <div style={{ fontSize: '14px' }}>{validationError}</div>
            {emptyFieldPage != null && (
              <div style={{ marginTop: '8px', fontSize: '13px' }}>
                Please review page {emptyFieldPage} in the highlighted form section.
              </div>
            )}
          </div>
        )}

        {/* Form 1: Background Disclosure */}
        <div ref={disclosureSectionRef} style={{ marginBottom: '32px' }}>
          <h2 style={{
            margin: '0 0 16px 0',
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#333'
          }}>
            1. Background Check Disclosure and Authorization
          </h2>
          <div style={{ margin: '6px 0 12px 0', fontSize: '13px', color: '#555' }}>
            Completed: {Math.round(disclosureProgress * 100)}%
          </div>
          <div style={{ marginBottom: '20px' }}>
            <PDFFormEditor
              key="background-disclosure"
              pdfUrl="/api/background-disclosure"
              formId="background-disclosure"
              onSave={handlePDFSaveFor('background-disclosure')}
              onFieldChange={handleFieldChange}
              onContinue={handleContinue}
              onProgress={setDisclosureProgress}
              requiredFieldNames={missingRequiredFields['background-disclosure']}
              showRequiredFieldErrors={missingRequiredFields['background-disclosure'].length > 0}
            />
          </div>
          {/* Garbled rendering advisory for Disclosure form */}
          <div style={{
            backgroundColor: '#e7f3ff',
            border: '1px solid #b6daff',
            color: '#0c5280',
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '13px'
          }}>
            If this PDF looks garbled or shows strange characters, please reload the page. Your progress is saved.
            <button
              onClick={() => window.location.reload()}
              style={{
                marginLeft: '10px',
                padding: '6px 10px',
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>

        {/* Form 2: Background Waiver */}
        <div ref={waiverSectionRef} style={{ marginBottom: '32px' }}>
          <h2 style={{
            margin: '0 0 16px 0',
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#333'
          }}>
            2. Background Check Waiver
          </h2>
          <div style={{ margin: '6px 0 12px 0', fontSize: '13px', color: '#555' }}>
            Completed: {Math.round(waiverProgress * 100)}%
          </div>
          <div style={{ marginBottom: '20px' }}>
            <PDFFormEditor
              key="background-waiver"
              pdfUrl="/api/background-waiver"
              formId="background-waiver"
              onSave={handlePDFSaveFor('background-waiver')}
              onFieldChange={handleFieldChange}
              onContinue={handleContinue}
              onProgress={setWaiverProgress}
              requiredFieldNames={missingRequiredFields['background-waiver']}
              showRequiredFieldErrors={missingRequiredFields['background-waiver'].length > 0}
            />
          </div>
        </div>

        {/* Form 3: Background Add-on */}
        <div ref={addonSectionRef} style={{ marginBottom: '32px' }}>
          <h2 style={{
            margin: '0 0 16px 0',
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#333'
          }}>
            3. Background Check Form 
          </h2>
          <div style={{ margin: '6px 0 12px 0', fontSize: '13px', color: '#555' }}>
            Completed: {Math.round(addonProgress * 100)}%
          </div>
          <div style={{ marginBottom: '20px' }}>
            <PDFFormEditor
              key="background-addon"
              pdfUrl="/api/background-addon"
              formId="background-addon"
              onSave={handlePDFSaveFor('background-addon')}
              onFieldChange={handleFieldChange}
              onContinue={handleContinue}
              onProgress={setAddonProgress}
            />
          </div>
        </div>

        {/* Signature Section */}
        <div ref={signatureSectionRef} style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
              Signature Required
            </h2>
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

          {/* Draw Signature Canvas */}
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
            ← Back to Login
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
              disabled={continueDisabled}
              title={continueDisabled ? 'Saving...' : 'Submit'}
              style={{
                padding: '12px 24px',
                backgroundColor: continueDisabled ? '#ccc' : '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: continueDisabled ? 'not-allowed' : 'pointer',
                fontSize: '16px'
              }}
              onMouseOver={(e) => {
                if (!continueDisabled) {
                  e.currentTarget.style.backgroundColor = '#1565c0';
                }
              }}
              onMouseOut={(e) => {
                if (!continueDisabled) {
                  e.currentTarget.style.backgroundColor = '#1976d2';
                }
              }}
            >
              Submit →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
