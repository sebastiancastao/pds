'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// Declare PDF.js types on window
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

interface PDFFormEditorProps {
  pdfUrl: string;
  formId: string;
  onSave?: (pdfBytes: Uint8Array) => void;
  onFieldChange?: () => void;
  onContinue?: () => void;
  onProgress?: (progress: number) => void; // 0.0 - 1.0
  skipButtonDetection?: boolean; // Skip detecting and overlaying embedded PDF buttons
  requiredFieldNames?: string[];
  showRequiredFieldErrors?: boolean;
  continueUrl?: string;
}

interface FormField {
  id: string;
  baseName: string;
  type: string;
  rect: number[];
  page: number;
  value: string;
  widgetValue?: string;
}

const MIRRORED_FIELDS: Record<string, Record<string, string>> = {
  'employee-handbook': {
    date5: 'date6',
    date6: 'date5',
    date3: 'date4',
    date4: 'date3',
  },
  'notice-to-employee': {
    Date: 'Date_2',
    Date_2: 'Date',
  },
  'wi-notice-to-employee': {
    Date: 'Date_2',
    Date_2: 'Date',
  },
  i9: {
    'S2 Todays Date mmddyyyy': "Today's Date mmddyyy",
    "Today's Date mmddyyy": 'S2 Todays Date mmddyyyy',
  },
  'wi-i9': {
    'S2 Todays Date mmddyyyy': "Today's Date mmddyyy",
    "Today's Date mmddyyy": 'S2 Todays Date mmddyyyy',
  },
};

const getMirroringKey = (formId: string) => {
  if (MIRRORED_FIELDS[formId]) {
    return formId;
  }
  if (formId.endsWith('-notice-to-employee')) {
    return 'notice-to-employee';
  }
  return formId;
};

const getMirroredFieldName = (formId: string, fieldName: string) => {
  const mirrorKey = getMirroringKey(formId);
  return MIRRORED_FIELDS[mirrorKey]?.[fieldName];
};


const HIDDEN_ADP_DEPOSIT_FIELDS = new Set<string>([
  'Company Code',
  'Company Name',
  'Employee File Number',
  'Employee Signature',
  'Payroll Mgr Name',
  'Payroll Mgr Signature',
]);

const HIDDEN_I9_FIELDS = new Set<string>([
  'Signature of Employer or AR',
  'Signature of Employee',
  'Last Name First Name and Title of Employer or Authorized Representative',
  'Employers Business or Org Name',
  'Employers Business or Org Address',
]);

const MASKED_I9_FIELDS = new Set<string>([
]);

const HIDDEN_NOTICE_TO_EMPLOYEE_FIELDS = new Set<string>([
  'PRINT NAME of Employer representative',
]);

const HIDDEN_WI_NOTICE_TO_EMPLOYEE_FIELDS = new Set<string>([
  'Rates of Pay',
  'Overtime Rates of Pay',
  'Other provide specifics',
  'Rate by check box',
  'Hour',
  'Shift',
  'Day',
  'Week',
  'Salary',
  'Piece rate',
]);

const HIDDEN_STATE_TAX_FIELDS = new Set<string>([
  "Employer's name and address",
  "Employer's name and address-2",
  'EIN',
]);

const isAdpDepositForm = (formId: string) =>
  formId === 'adp-deposit' || formId.endsWith('-adp-deposit');

const isI9Form = (formId: string) =>
  formId === 'i9' || formId.endsWith('-i9');

const isNoticeToEmployeeForm = (formId: string) =>
  formId === 'notice-to-employee' || formId.endsWith('-notice-to-employee');

const isWiNoticeToEmployeeForm = (formId: string) =>
  formId === 'wi-notice-to-employee';

const shouldMaskField = (formId: string, fieldName: string) =>
  isI9Form(formId) && MASKED_I9_FIELDS.has(fieldName);

const isStateTaxForm = (formId: string) =>
  formId === 'state-tax' || formId.endsWith('-state-tax');

const shouldHideField = (formId: string, fieldName: string) =>
  (isAdpDepositForm(formId) && HIDDEN_ADP_DEPOSIT_FIELDS.has(fieldName)) ||
  (isI9Form(formId) && HIDDEN_I9_FIELDS.has(fieldName)) ||
  (isNoticeToEmployeeForm(formId) && HIDDEN_NOTICE_TO_EMPLOYEE_FIELDS.has(fieldName)) ||
  (isWiNoticeToEmployeeForm(formId) && HIDDEN_WI_NOTICE_TO_EMPLOYEE_FIELDS.has(fieldName)) ||
  (isStateTaxForm(formId) && HIDDEN_STATE_TAX_FIELDS.has(fieldName));

const ADP_NET_AMOUNT_SLOTS = [
  { name: 'adp_entire_net_amount_1', referenceField: 'Checking1', fallbackY: 241.745 },
  { name: 'adp_entire_net_amount_2', referenceField: 'Check Box9', fallbackY: 176.368 },
];

type PdfRect = { x: number; y: number; width: number; height: number };

const getWidgetRect = (field: any): PdfRect | null => {
  const widgets = field?.acroField?.getWidgets?.() || [];
  if (!widgets.length) return null;
  const rect = widgets[0].getRectangle();
  if (!rect) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

const collectCheckboxRects = (form: any): PdfRect[] => {
  const rects: PdfRect[] = [];
  for (const field of form.getFields()) {
    if (!('isChecked' in field)) continue;
    const widgets = field?.acroField?.getWidgets?.() || [];
    for (const widget of widgets) {
      const rect = widget?.getRectangle?.();
      if (rect) {
        rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
    }
  }
  return rects;
};

const rectNear = (a: PdfRect, b: PdfRect, tolerance = 1.5) =>
  Math.abs(a.x - b.x) <= tolerance &&
  Math.abs(a.y - b.y) <= tolerance &&
  Math.abs(a.width - b.width) <= tolerance &&
  Math.abs(a.height - b.height) <= tolerance;

const ensureAdpNetAmountCheckboxes = (pdfDoc: any, formId: string) => {
  if (!isAdpDepositForm(formId)) return;

  const form = pdfDoc.getForm();
  const fieldNames = new Set<string>();
  for (const field of form.getFields()) {
    try {
      fieldNames.add(field.getName());
    } catch {
      // Ignore malformed field names.
    }
  }

  let baseRect: PdfRect | null = null;
  try {
    const baseField = form.getCheckBox('Check Box16');
    baseRect = getWidgetRect(baseField);
  } catch {
    baseRect = null;
  }

  const defaultRect: PdfRect = baseRect || {
    x: 446.741,
    y: 106.149,
    width: 7.87,
    height: 6.659,
  };

  const existingRects = collectCheckboxRects(form);
  const page = pdfDoc.getPages()[0];

  for (const slot of ADP_NET_AMOUNT_SLOTS) {
    if (fieldNames.has(slot.name)) continue;

    let y = slot.fallbackY;
    try {
      const refField = form.getField(slot.referenceField);
      const refRect = getWidgetRect(refField);
      if (refRect) {
        y = refRect.y;
      }
    } catch {
      // Keep fallback position when reference field is missing.
    }

    const targetRect: PdfRect = {
      x: defaultRect.x,
      y,
      width: defaultRect.width,
      height: defaultRect.height,
    };

    if (existingRects.some((rect) => rectNear(rect, targetRect))) continue;

    const checkbox = form.createCheckBox(slot.name);
    checkbox.addToPage(page, targetRect);
    existingRects.push(targetRect);
  }
};

const applyWiNoticeToEmployeeDefaults = (pdfDoc: any, formId: string) => {
  if (!isWiNoticeToEmployeeForm(formId)) return;

  try {
    const form = pdfDoc.getForm();
    const commissionField = form.getCheckBox('Commission');
    if (typeof commissionField.isChecked === 'function' && !commissionField.isChecked()) {
      commissionField.check();
    }
  } catch (error) {
    console.warn('[NOTICE_TO_EMPLOYEE] Failed to pre-check Commission checkbox for WI', error);
  }
};

export default function PDFFormEditor({
  pdfUrl,
  formId,
  onSave,
  onFieldChange,
  onContinue,
  onProgress,
  skipButtonDetection,
  requiredFieldNames,
  showRequiredFieldErrors,
  continueUrl
}: PDFFormEditorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [maskedFields, setMaskedFields] = useState<FormField[]>([]);
  const [fieldValues, setFieldValues] = useState<Map<string, string>>(new Map());
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  const pdfLibDocRef = useRef<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [pageViewports, setPageViewports] = useState<any[]>([]);
  const [continueButtonRect, setContinueButtonRect] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const renderTaskRef = useRef<any>(null);
  const isLoadingRef = useRef(false);

  const getFieldValueByBaseName = (baseName: string) => {
    const fieldForBase = formFields.find((field) => field.baseName === baseName);
    if (!fieldForBase) return '';
    return fieldValues.get(fieldForBase.id) || '';
  };

  // Report completion progress to parent whenever fields/values change
  useEffect(() => {
    if (!onProgress) return;
    const uniqueBaseNames = Array.from(new Set(formFields.map((f) => f.baseName)));
    const total = uniqueBaseNames.length;
    if (total === 0) {
      onProgress(0);
      return;
    }
    let filled = 0;
    for (const baseName of uniqueBaseNames) {
      const field = formFields.find((f) => f.baseName === baseName);
      if (!field) continue;
      const value = getFieldValueByBaseName(baseName);
      if (field.type === 'checkbox') {
        if (value !== 'false' && value !== '') filled += 1;
      } else if (String(value).trim().length > 0) {
        filled += 1;
      }
    }
    onProgress(filled / total);
  }, [formFields, fieldValues, onProgress]);

  useEffect(() => {
    loadPDF();

    // Cleanup on unmount
    return () => {
      console.log('[CLEANUP] Component unmounting, canceling any active renders');
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfUrl, formId]);

  const loadPDF = async () => {
    // Prevent multiple simultaneous loads
    if (isLoadingRef.current) {
      console.log('[LOAD] Already loading, skipping duplicate load');
      return;
    }

    try {
      isLoadingRef.current = true;
      console.log('=== PDFFormEditor loadPDF START ===');
      console.log('PDF URL:', pdfUrl);
      console.log('Form ID:', formId);

      // Cancel any ongoing render
      if (renderTaskRef.current) {
        console.log('[LOAD] Canceling previous render task');
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      // Destroy previous PDF document
      if (pdfDocRef.current) {
        console.log('[LOAD] Destroying previous PDF document');
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }

      setLoading(true);
      setError('');

      // Get session for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('Session check:', {
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        sessionError: sessionError?.message,
        userId: session?.user?.id
      });

      // Check for saved progress
      console.log('Step 1: Checking for saved progress...');
      const getLocalProgress = () =>
        typeof localStorage !== 'undefined' ? localStorage.getItem(`pdf-progress-${formId}`) : null;

      let savedData: any = { found: false };
      if (!session?.access_token) {
        const local = getLocalProgress();
        if (local) {
          savedData = { found: true, formData: local };
          console.log('[LOAD] No session; using local fallback progress for', formId);
        }
      } else {
        try {
          const savedResponse = await fetch(`/api/pdf-form-progress/retrieve?formName=${formId}`, {
            credentials: 'same-origin', // Include cookies with request
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          });
          console.log('Saved response status:', savedResponse.status);
          if (savedResponse.status === 401) {
            const local = getLocalProgress();
            if (local) {
              savedData = { found: true, formData: local };
              console.log('[LOAD] Using local fallback progress after 401 for', formId);
            }
          } else {
            savedData = await savedResponse.json();
          }
        } catch (err) {
          console.warn('[LOAD] Retrieve failed, trying local fallback', err);
          const local = getLocalProgress();
          if (local) {
            savedData = { found: true, formData: local };
          }
        }
      }
      console.log('Saved data:', savedData);

      let pdfBytes: ArrayBuffer;
      let savedPdfBytes: Uint8Array | null = null;
      let pdfLibDoc: any;
      let usedSavedBytesForLoad = false;

      if (savedData.found && savedData.formData) {
        console.log('Step 2: Attempting to load saved PDF from database');
        try {
          const base64Data = savedData.formData;
          console.log('Base64 data preview:', base64Data.substring(0, 50));

          const binaryString = atob(base64Data);
          console.log('Binary string length:', binaryString.length);
          console.log('First bytes:', binaryString.substring(0, 10).split('').map(c => c.charCodeAt(0)));

          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          savedPdfBytes = bytes;
          pdfBytes = bytes.buffer;

          // Verify it's a valid PDF (should start with %PDF = [37, 80, 68, 70])
          const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
          console.log('PDF header:', header);
          if (!header.startsWith('%PDF')) {
            console.warn('ÔÜá´©Å Saved PDF is corrupted (invalid header), fetching fresh PDF instead');
            throw new Error('Invalid PDF header');
          }
          console.log('Ô£à Saved PDF loaded successfully, size:', pdfBytes.byteLength, 'bytes');
        } catch (loadErr: any) {
          console.error('ÔØî Error loading saved PDF:', loadErr.message);
          console.log('­ƒôÑ Fetching fresh PDF from URL:', pdfUrl);
          savedPdfBytes = null;
          const response = await fetch(pdfUrl, {
            cache: 'no-store',
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
          });
          console.log('PDF fetch response status:', response.status);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          }
          pdfBytes = await response.arrayBuffer();
          console.log('Fresh PDF loaded, size:', pdfBytes.byteLength, 'bytes');
        }
      } else {
        console.log('Step 2: Fetching fresh PDF from URL:', pdfUrl);
        const response = await fetch(pdfUrl, {
          cache: 'no-store',
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
        });
        console.log('PDF fetch response status:', response.status);
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }
        pdfBytes = await response.arrayBuffer();
        console.log('Fresh PDF loaded, size:', pdfBytes.byteLength, 'bytes');
      }

      // Load pdf-lib early so we can decide whether to use saved bytes or a fresh template.
      console.log('Step 2b: Loading pdf-lib library...');
      const { PDFDocument, PDFName } = await import('pdf-lib');
      console.log('pdf-lib loaded successfully');

      const detectXfaForm = (doc: any) => {
        try {
          const catalog =
            (doc as any).catalog ||
            (doc?.context?.trailerInfo?.Root
              ? doc.context.lookup(doc.context.trailerInfo.Root)
              : undefined);
          const acroFormRef = catalog?.get?.(PDFName.of('AcroForm'));
          if (acroFormRef) {
            const acroForm = doc.context.lookup(acroFormRef);
            const xfa = acroForm?.get?.(PDFName.of('XFA'));
            return !!xfa;
          }
        } catch (xfaErr) {
          console.warn('[LOAD] Failed to detect XFA form', xfaErr);
        }
        return false;
      };

      const shouldUseSavedPdf = formId === 'adp-deposit';

      if (savedPdfBytes) {
        console.log('Step 2c: Parsing saved PDF with pdf-lib...');
        const savedDoc = await PDFDocument.load(savedPdfBytes);
        const isXfaForm = detectXfaForm(savedDoc);

        if (!isXfaForm && !shouldUseSavedPdf) {
          let useSavedBytes = false;
          try {
            console.log('Step 2d: Fetching fresh PDF template to replace saved PDF bytes...');
            const templateResponse = await fetch(pdfUrl, {
              cache: 'no-store',
              headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
            });
            console.log('Template fetch response status:', templateResponse.status);
            if (templateResponse.ok) {
              pdfBytes = await templateResponse.arrayBuffer();
              console.log('Fresh PDF template loaded, size:', pdfBytes.byteLength, 'bytes');
            } else {
              console.warn(`[LOAD] Template fetch failed (${templateResponse.status}). Continuing with saved PDF bytes.`);
              useSavedBytes = true;
            }
          } catch (templateErr: any) {
            console.warn('[LOAD] Template fetch exception. Continuing with saved PDF bytes.', templateErr?.message);
            useSavedBytes = true;
          }

          if (useSavedBytes) {
            pdfBytes = new Uint8Array(savedPdfBytes).buffer;
            pdfLibDoc = savedDoc;
            usedSavedBytesForLoad = true;
            } else {
              console.log('Step 2e: Parsing PDF template with pdf-lib...');
              pdfLibDoc = await PDFDocument.load(pdfBytes);
              console.log('pdf-lib template loaded successfully');

              console.log('Step 2f: Re-applying saved form field values onto fresh template (non-XFA)...');
              let copiedCount = 0;
              let copyFailed = false;
              try {
                const savedForm = savedDoc.getForm();
                const targetForm = pdfLibDoc.getForm();

              const targetFieldsByName = new Map<string, any>();
              for (const targetField of targetForm.getFields()) {
                try {
                  targetFieldsByName.set(targetField.getName(), targetField);
                } catch {
                  // Ignore malformed fields
                  }
                }

                for (const savedField of savedForm.getFields()) {
                  let fieldName = '';
                  try {
                    fieldName = savedField.getName();
                  } catch {
                  continue;
                }

                const targetField = targetFieldsByName.get(fieldName);
                if (!targetField) continue;

                try {
                  if (typeof (savedField as any).getText === 'function' && typeof (targetField as any).setText === 'function') {
                    (targetField as any).setText((savedField as any).getText() || '');
                    copiedCount++;
                  } else if (typeof (savedField as any).isChecked === 'function') {
                    const checked = (savedField as any).isChecked();
                    if (checked && typeof (targetField as any).check === 'function') (targetField as any).check();
                    if (!checked && typeof (targetField as any).uncheck === 'function') (targetField as any).uncheck();
                    copiedCount++;
                  } else if (typeof (savedField as any).getSelected === 'function' && typeof (targetField as any).select === 'function') {
                    const selected = (savedField as any).getSelected();
                    const value = Array.isArray(selected) ? selected[0] : selected;
                    if (value) {
                      (targetField as any).select(value);
                      copiedCount++;
                    }
                  }
                } catch (copyErr: any) {
                  console.warn(`[LOAD] Failed to copy value for field "${fieldName}"`, copyErr?.message);
                }
                }

                console.log(`Step 2f: Copied ${copiedCount} saved field values`);
              } catch (mergeErr: any) {
                copyFailed = true;
                console.warn('[LOAD] Failed to merge saved field values onto template', mergeErr?.message);
              }

              if (copyFailed || copiedCount === 0) {
                console.warn('[LOAD] Falling back to saved PDF bytes after merge failure/zero matches');
                pdfBytes = new Uint8Array(savedPdfBytes).buffer;
                pdfLibDoc = savedDoc;
                usedSavedBytesForLoad = true;
              }
            }
          } else {
            pdfBytes = new Uint8Array(savedPdfBytes).buffer;
          pdfLibDoc = savedDoc;
          usedSavedBytesForLoad = true;
        }
      }

      if (!pdfLibDoc) {
        console.log('Step 2c: Parsing PDF with pdf-lib...');
        pdfLibDoc = await PDFDocument.load(pdfBytes);
        console.log('pdf-lib document loaded successfully');
      }
      ensureAdpNetAmountCheckboxes(pdfLibDoc, formId);
      applyWiNoticeToEmployeeDefaults(pdfLibDoc, formId);
      pdfLibDocRef.current = pdfLibDoc;

      // Load with PDF.js for rendering - use UNPKG CDN
      console.log('Step 3: Loading PDF.js from UNPKG...');

      // Load PDF.js from CDN if not already loaded
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js';
          script.onload = resolve;
          script.onerror = (err) => {
            console.error('Script loading error:', err);
            reject(new Error('Failed to load PDF.js from CDN'));
          };
          document.head.appendChild(script);
        });
        console.log('PDF.js loaded from UNPKG');
      }

      const pdfjsLib = window.pdfjsLib;
      console.log('PDF.js version:', pdfjsLib.version);

      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
      console.log('PDF.js worker configured');

      // Create a copy of pdfBytes for PDF.js (to avoid detached ArrayBuffer issue)
      const pdfBytesCopy = pdfBytes.slice(0);

      console.log('Step 4: Loading PDF with PDF.js...');
      try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytesCopy });
        const pdfDoc = await loadingTask.promise;
        console.log('PDF.js document loaded successfully');
        console.log('Number of pages:', pdfDoc.numPages);
        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
      } catch (pdfLoadErr: any) {
        console.error('Failed to load PDF with PDF.js:', pdfLoadErr);
        throw new Error(`PDF.js document loading failed: ${pdfLoadErr.message}`);
      }

      // pdf-lib is loaded earlier to keep saved form data intact on revisits.

      // Extract form fields
      console.log('Step 7: Extracting form fields...');
      let fields = await extractFormFields(pdfLibDoc);
      // Hide employer-only fields on the ADP direct deposit and I-9 forms.
      const masked = fields.filter((field) => shouldMaskField(formId, field.baseName));
      fields = fields.filter((field) => !shouldHideField(formId, field.baseName));
      console.log('Extracted', fields.length, 'form fields');
      setFormFields(fields);
      setMaskedFields(masked);

      const initialValues = new Map<string, string>();
      fields.forEach(field => {
        initialValues.set(field.id, field.value);
      });
      setFieldValues(initialValues);

      // Set loading to false first to render the canvas container
      setLoading(false);

      // Wait for next tick to ensure canvas container is mounted
      console.log('Step 8: Waiting for canvas container to mount...');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Render all pages
      console.log('Step 8b: Rendering all pages...');
      try {
        const totalPages = pdfDocRef.current?.numPages || 0;
        console.log(`Total pages from ref: ${totalPages}`);
        await renderAllPages(totalPages);
        console.log('Ô£à All pages rendered successfully');
      } catch (renderError: any) {
        console.error('ÔØî Error rendering pages:', renderError);
        console.error('Stack:', renderError?.stack);
        throw renderError; // Re-throw to see in main error handler
      }

      // Extract Continue button position from last page annotations
      // Skip button detection for read-only/informational PDFs
      if (!skipButtonDetection) {
        console.log('Step 9: Extracting Continue button annotations...');
        try {
          if (pdfDocRef.current) {
            const lastPageNum = pdfDocRef.current.numPages;
            console.log('Getting last page:', lastPageNum);
            const lastPage = await pdfDocRef.current.getPage(lastPageNum);
            console.log('Last page retrieved successfully');

            const annotations = await lastPage.getAnnotations();
            console.log('Annotations found:', annotations ? annotations.length : 0);

            if (annotations && Array.isArray(annotations)) {
              const linkAnnots = annotations.filter(
                (annot) => annot?.subtype === 'Link' && annot?.url && annot?.rect
              );

              linkAnnots.forEach((annot, index) => {
                console.log(`Annotation ${index}:`, {
                  subtype: annot?.subtype,
                  hasUrl: !!annot?.url,
                  hasRect: !!annot?.rect,
                  url: annot?.url
                });
              });

              let targetAnnot = linkAnnots.find((annot) => annot.url === continueUrl);
              if (!targetAnnot && linkAnnots.length > 0) {
                targetAnnot = linkAnnots.reduce((best, current) =>
                  current.rect[0] > best.rect[0] ? current : best
                );
              }

              if (targetAnnot?.rect) {
                const rect = targetAnnot.rect;
                console.log('Link annotation rect:', rect);
                if (Array.isArray(rect) && rect.length >= 4) {
                  const buttonRect = {
                    x: rect[0],
                    y: rect[1],
                    width: rect[2] - rect[0],
                    height: rect[3] - rect[1]
                  };
                  console.log('Continue button found:', buttonRect);
                  setContinueButtonRect(buttonRect);
                }
              }
            }
            console.log('Annotation extraction completed');
          }
        } catch (annotError: any) {
          console.warn('Error extracting button annotations:', annotError);
          console.warn('Stack:', annotError?.stack);
          // Continue without button interception - user can still use manual navigation
        }
      } else {
        console.log('Step 9: Skipping button detection (skipButtonDetection=true)');
      }

      // Provide initial PDF bytes
      console.log('Step 10: Saving initial PDF bytes...');
      const initialPdfBytes = usedSavedBytesForLoad && savedPdfBytes
        ? savedPdfBytes
        : await pdfLibDoc.save();
      console.log('Initial PDF bytes saved, size:', initialPdfBytes.length);
      if (onSave) {
        onSave(initialPdfBytes);
      }

      console.log('=== PDFFormEditor loadPDF SUCCESS ===');
      // Note: setLoading(false) is now called earlier (before rendering) to ensure canvas is mounted
    } catch (err: any) {
      console.error('=== PDFFormEditor loadPDF ERROR ===');
      console.error('Error object:', err);
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      console.error('Error name:', err.name);
      setError(`Failed to load PDF: ${err.message}`);
      setLoading(false);
    } finally {
      isLoadingRef.current = false;
    }
  };

  const extractFormFields = async (pdfDoc: any): Promise<FormField[]> => {
    const fields: FormField[] = [];
    console.log('extractFormFields: Starting...');

    try {
      console.log('extractFormFields: Getting form...');
      const form = pdfDoc.getForm();
      console.log('extractFormFields: Form retrieved:', !!form);

      console.log('extractFormFields: Getting form fields...');
      const formFields = form.getFields();
      console.log('extractFormFields: Found', formFields?.length || 0, 'fields');

      for (let fieldIndex = 0; fieldIndex < formFields.length; fieldIndex++) {
        const field = formFields[fieldIndex];
        console.log(`extractFormFields: Processing field ${fieldIndex}/${formFields.length}`);

        try {
          const fieldName = field.getName();
          console.log(`  Field name: ${fieldName}`);
          let fieldType = 'text';
          let fieldValue = '';

          if ('getText' in field) {
            fieldType = 'text';
            fieldValue = field.getText() || '';
            console.log(`  Field type: text, value: "${fieldValue}"`);
          } else if ('isChecked' in field) {
            fieldType = 'checkbox';
            const checked = field.isChecked();
            if (checked) {
              const value = field.getValue?.();
              fieldValue = value || 'true';
            } else {
              fieldValue = 'false';
            }
            console.log(`  Field type: checkbox, value: ${fieldValue}`);
          }

          // Check if acroField exists before accessing it
          console.log(`  Checking acroField...`, !!field.acroField);
          if (!field.acroField) {
            console.warn(`  Field ${fieldName} has no acroField, skipping`);
            continue;
          }

          console.log(`  Getting widgets...`);
          const widgets = field.acroField.getWidgets();
          console.log(`  Widgets count:`, widgets?.length || 0);
          if (!widgets || widgets.length === 0) {
            console.warn(`  Field ${fieldName} has no widgets, skipping`);
            continue;
          }

          for (let i = 0; i < widgets.length; i++) {
            const widget = widgets[i];
            console.log(`    Processing widget ${i}...`);
            if (!widget) {
              console.warn(`    Widget ${i} is null/undefined, skipping`);
              continue;
            }

            console.log(`    Getting rectangle...`);
            const rect = widget.getRectangle();
            if (!rect) {
              console.warn(`    Widget ${i} has no rectangle, skipping`);
              continue;
            }
            console.log(`    Rectangle:`, rect);

            console.log(`    Finding page index...`);
            const pageIndex = pdfDoc.getPages().findIndex((p: any) => {
              const pageRef = p.ref;
              const widgetPage = widget.P();
              return pageRef && widgetPage && pageRef.toString() === widgetPage.toString();
            });
            console.log(`    Page index: ${pageIndex}`);

            const widgetValue = widget.getOnValue?.() || '';
            const appearanceState = widget.getAppearanceState?.();
            const isWidgetChecked = appearanceState && appearanceState !== 'Off' && widgetValue
              ? appearanceState === widgetValue
              : false;
            const numericId = `${fieldName}::${i}`;
            const value = fieldType === 'checkbox'
              ? (isWidgetChecked ? widgetValue : 'false')
              : fieldValue;
            const fieldData = {
              id: numericId,
              baseName: fieldName,
              type: fieldType,
              rect: [rect.x, rect.y, rect.width, rect.height],
              page: pageIndex >= 0 ? pageIndex + 1 : 1,
              value,
              widgetValue
            };
            console.log(`    Adding field:`, fieldData);
            fields.push(fieldData);
          }
        } catch (fieldError: any) {
          console.error(`Error processing field:`, fieldError);
          console.error(`Field error stack:`, fieldError?.stack);
        }
      }
    } catch (err: any) {
      console.error('Error extracting form fields:', err);
      console.error('Extract error stack:', err?.stack);
    }

    console.log('extractFormFields: Completed, total fields:', fields.length);
    return fields;
  };

  const renderAllPages = async (totalPages: number) => {
    console.log(`[RENDER] Starting render for all pages (${totalPages} pages)`);

    if (!pdfDocRef.current) {
      console.error('[RENDER] ÔØî pdfDocRef.current is null!');
      return;
    }

    if (!canvasContainerRef.current) {
      console.error('[RENDER] ÔØî canvasContainerRef.current is null!');
      return;
    }

    try {
      const viewports: any[] = [];

      // Clear existing canvases
      while (canvasContainerRef.current.firstChild) {
        canvasContainerRef.current.removeChild(canvasContainerRef.current.firstChild);
      }

      console.log('[RENDER] Canvas container cleared, rendering', totalPages, 'pages');

      // Render each page
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        console.log(`[RENDER] Rendering page ${pageNum}...`);
        const page = await pdfDocRef.current.getPage(pageNum);
        const pageViewport = page.getViewport({ scale });
        viewports.push(pageViewport);

        // Create canvas for this page
        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.marginBottom = '20px';
        canvas.style.backgroundColor = 'white';
        canvas.setAttribute('data-page-number', String(pageNum));
        canvasContainerRef.current.appendChild(canvas);

        const context = canvas.getContext('2d');
        if (!context) {
          console.error(`[RENDER] Failed to get 2d context for page ${pageNum}`);
          continue;
        }

        canvas.height = pageViewport.height;
        canvas.width = pageViewport.width;

        console.log(`[RENDER] Canvas ${pageNum} dimensions:`, canvas.width, 'x', canvas.height);

        const renderContext = {
          canvasContext: context,
          viewport: pageViewport
        };

        const renderTask = page.render(renderContext);
        await renderTask.promise;
        console.log(`[RENDER] Page ${pageNum} rendered successfully to canvas`);
        console.log(`[RENDER] Canvas ${pageNum} is in DOM:`, document.body.contains(canvas));
      }

      setPageViewports(viewports);
      console.log('[RENDER] All pages rendered successfully');
    } catch (err: any) {
      console.error('[RENDER] Error rendering pages:', err);
      console.error('[RENDER] Stack:', err?.stack);
      throw err;
    }
  };

  type FieldUpdate = {
    fieldName: string;
    value: string;
    widgetValue?: string;
  };

  const handleFieldChange = useCallback(
    (fieldId: string, fieldName: string, value: string, widgetValue?: string) => {
      const mirrorFieldName = getMirroredFieldName(formId, fieldName);

      setFieldValues((prev) => {
        const newValues = new Map(prev);
        newValues.set(fieldId, value);
        if (mirrorFieldName && mirrorFieldName !== fieldName) {
          const mirrorField = formFields.find((f) => f.baseName === mirrorFieldName);
          if (mirrorField) {
            newValues.set(mirrorField.id, value);
          }
        }
        return newValues;
      });

      const updates: FieldUpdate[] = [{ fieldName, value, widgetValue }];
      if (mirrorFieldName && mirrorFieldName !== fieldName) {
        updates.push({ fieldName: mirrorFieldName, value });
      }
      updatePDFFields(updates);

      if (onFieldChange) {
        onFieldChange();
      }
    },
    [formFields, formId, onFieldChange],
  );

  const updatePDFFields = async (updates: FieldUpdate[]) => {
    if (!pdfLibDocRef.current) return;

    try {
      const form = pdfLibDocRef.current.getForm();
      for (const update of updates) {
        const { fieldName, value, widgetValue } = update;
        console.log(`[UPDATE FIELD] Updating field "${fieldName}" with value "${value}"`);
        const field = form.getField(fieldName);

        if ('setText' in field) {
          field.setText(value);
          console.log(`[UPDATE FIELD] Text field updated: "${fieldName}" = "${value}"`);
        } else if ('check' in field || 'uncheck' in field) {
          if (value === 'false') {
            field.uncheck();
          } else if (widgetValue) {
            field.check(widgetValue);
          } else if (value === 'true') {
            field.check();
          } else {
            field.check();
          }
          console.log(
            `[UPDATE FIELD] Checkbox updated: "${fieldName}" = ${value} (widget: ${widgetValue || 'default'})`
          );
        }
      }

      console.log('[UPDATE FIELD] Saving PDF with updated field...');
      const pdfBytes = await pdfLibDocRef.current.save();
      console.log(`[UPDATE FIELD] PDF saved, size: ${pdfBytes.length} bytes`);

      if (onSave) {
        console.log('[UPDATE FIELD] Calling onSave callback...');
        onSave(pdfBytes);
      }
    } catch (err) {
      console.error('Error updating PDF field:', err);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        fontSize: '18px',
        color: '#666'
      }}>
        Loading PDF form...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '10px',
        height: '100%',
        fontSize: '16px',
        color: '#d32f2f',
        padding: '20px',
        textAlign: 'center'
      }}>
        <div>{error}</div>
        <div style={{ color: '#555', fontSize: '14px' }}>
          If the problem persists, please reload the page and try again.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 14px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Reload Page
        </button>
      </div>
    );
  }

  // Calculate cumulative Y offset for each page
  const calculatePageOffsets = () => {
    const offsets: number[] = [];
    let cumulativeY = 0;

    pageViewports.forEach((viewport, index) => {
      offsets.push(cumulativeY);
      cumulativeY += viewport.height + 20; // 20px margin between pages
    });

    return offsets;
  };

  const pageOffsets = calculatePageOffsets();
  const maskPadding = 2;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#525659',
        overflow: 'auto'
      }}
    >
      {/* PDF Canvas with Overlaid Inputs */}
      <div
        data-pdf-scroll-container="true"
        style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', padding: '20px', overflow: 'auto' }}
      >
        <div style={{
          position: 'relative',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          backgroundColor: 'white',
          minHeight: '100%',
          display: 'inline-block',
          margin: '0 auto'
        }}>
          {/* Canvas container - for PDF rendering */}
          <div
            ref={canvasContainerRef}
            style={{
              position: 'relative',
              minHeight: '1000px',
              minWidth: '800px'
            }}
          >
            {/* Canvases are added here via DOM manipulation */}
          </div>

          {/* Mask I-9 employer fields to keep the area blank */}
          {pageViewports.length > 0 && maskedFields.map((field) => {
            const pageIndex = field.page - 1;
            if (pageIndex < 0 || pageIndex >= pageViewports.length) return null;

            const viewport = pageViewports[pageIndex];
            const pageOffset = pageOffsets[pageIndex];

            const x = field.rect[0] * scale;
            const y = pageOffset + (viewport.height - (field.rect[1] + field.rect[3]) * scale);
            const width = field.rect[2] * scale;
            const height = field.rect[3] * scale;

            return (
              <div
                key={`mask-${field.id}`}
                style={{
                  position: 'absolute',
                  left: `${x - maskPadding}px`,
                  top: `${y - maskPadding}px`,
                  width: `${width + maskPadding * 2}px`,
                  height: `${height + maskPadding * 2}px`,
                  backgroundColor: '#fff',
                  pointerEvents: 'none'
                }}
              />
            );
          })}

          {/* Overlay form fields on all pages */}
          {pageViewports.length > 0 && formFields.map((field, index) => {
            const pageIndex = field.page - 1;
            if (pageIndex < 0 || pageIndex >= pageViewports.length) return null;

            const viewport = pageViewports[pageIndex];
            const pageOffset = pageOffsets[pageIndex];
            const fieldValue = fieldValues.get(field.id) || '';
            const isChecked = field.type === 'checkbox'
              ? field.widgetValue
                ? fieldValue === field.widgetValue
                : fieldValue === 'true'
              : false;
            const isMissingRequired = Boolean(
              showRequiredFieldErrors &&
              requiredFieldNames?.includes(field.baseName) &&
              (field.type === 'checkbox'
                ? !isChecked
                : String(fieldValue).trim() === '')
            );

            // Convert PDF coordinates to canvas coordinates
            const x = field.rect[0] * scale;
            const y = pageOffset + (viewport.height - (field.rect[1] + field.rect[3]) * scale);
            const width = field.rect[2] * scale;
            const height = field.rect[3] * scale;

            return (
              <div
                key={field.id}
                data-field-name={field.baseName}
                data-field-id={field.id}
                data-field-page={field.page}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  pointerEvents: 'auto',
                  boxShadow:
                    field.type === 'checkbox' && isMissingRequired
                      ? '0 0 0 2px rgba(211,47,47,0.8)'
                      : 'none',
                  borderRadius: field.type === 'checkbox' ? '3px' : '0',
                  backgroundColor:
                    field.type === 'checkbox' && isMissingRequired
                      ? 'rgba(211,47,47,0.08)'
                      : 'transparent'
                }}
              >
                {field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      const widgetValue = field.widgetValue;
                      const newValue = e.target.checked ? (widgetValue || 'true') : 'false';
                      handleFieldChange(field.id, field.baseName, newValue, widgetValue);
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      cursor: 'pointer',
                      outline: isMissingRequired ? '2px solid #d32f2f' : 'none',
                      outlineOffset: '1px',
                      boxShadow: isMissingRequired ? '0 0 0 2px rgba(211,47,47,0.35)' : 'none',
                      accentColor: isMissingRequired ? '#d32f2f' : undefined
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={fieldValue}
                    onChange={(e) => handleFieldChange(field.id, field.baseName, e.target.value)}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: isMissingRequired ? '2px solid #d32f2f' : '1px solid rgba(0,0,255,0.3)',
                      backgroundColor: isMissingRequired ? 'rgba(211,47,47,0.08)' : 'rgba(255,255,255,0.9)',
                      fontSize: `${height * 0.6}px`,
                      padding: '2px 4px',
                      boxSizing: 'border-box'
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Overlay Continue button interceptor on last page */}
          {!skipButtonDetection && pageViewports.length > 0 && continueButtonRect && (
            <div
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Continue button clicked - saving before navigation');

                // Save current PDF state
                if (pdfLibDocRef.current && onSave) {
                  const pdfBytes = await pdfLibDocRef.current.save();
                  onSave(pdfBytes);

                  // Wait a moment for save to complete
                  await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Navigate to next form
                if (onContinue) {
                  onContinue();
                }
              }}
              style={{
                position: 'absolute',
                left: `${continueButtonRect.x * scale}px`,
                top: `${pageOffsets[pageOffsets.length - 1] + (pageViewports[pageViewports.length - 1].height - (continueButtonRect.y + continueButtonRect.height) * scale)}px`,
                width: `${continueButtonRect.width * scale}px`,
                height: `${continueButtonRect.height * scale}px`,
                cursor: 'pointer',
                zIndex: 1000,
                // Transparent overlay
                backgroundColor: 'rgba(0,0,0,0)'
              }}
              title="Continue to next form"
            />
          )}
        </div>
      </div>
    </div>
  );
}
