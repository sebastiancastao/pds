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
  skipButtonDetection?: boolean;
  requiredFieldNames?: string[];
  showRequiredFieldErrors?: boolean;
  continueUrl?: string;
}

interface FormField {
  id: string;
  baseName: string;
  originalFieldName?: string;
  type: string; // 'text' | 'checkbox'
  rect: number[];
  page: number;
  value: string;
  widgetIndex?: number;
  isRadioGroup?: boolean;
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
  'ny-notice-to-employee': {
    Date: 'Date_2',
    Date_2: 'Date',
  },
  i9: {
    'S2 Todays Date mmddyyyy': "Today's Date mmddyyy",
    "Today's Date mmddyyy": 'S2 Todays Date mmddyyyy',
  },
  'ny-i9': {
    'S2 Todays Date mmddyyyy': "Today's Date mmddyyy",
    "Today's Date mmddyyy": 'S2 Todays Date mmddyyyy',
  },
  'wi-i9': {
    'S2 Todays Date mmddyyyy': "Today's Date mmddyyy",
    "Today's Date mmddyyy": 'S2 Todays Date mmddyyyy',
  },
};

const getMirroredFieldName = (formId: string, fieldName: string) =>
  MIRRORED_FIELDS[formId]?.[fieldName];

const EXCLUSIVE_CHECKBOX_GROUPS: Record<string, string[][]> = {};

const getExclusiveCheckboxGroup = (formId: string, fieldName: string): string[] | null => {
  const groups = EXCLUSIVE_CHECKBOX_GROUPS[formId];
  if (!groups) return null;
  for (const group of groups) {
    if (group.includes(fieldName)) return group;
  }
  return null;
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

const MASKED_I9_FIELDS = new Set<string>([]);

const HIDDEN_NOTICE_TO_EMPLOYEE_FIELDS = new Set<string>(['PRINT NAME of Employer representative']);

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

const isAdpDepositForm = (formId: string) =>
  formId === 'adp-deposit' || formId.endsWith('-adp-deposit');

const isI9Form = (formId: string) => formId === 'i9' || formId.endsWith('-i9');

const isNoticeToEmployeeForm = (formId: string) =>
  formId === 'notice-to-employee' || formId.endsWith('-notice-to-employee');

const isWiNoticeToEmployeeForm = (formId: string) => formId === 'wi-notice-to-employee';

const isNyNoticeToEmployeeForm = (formId: string) => formId === 'ny-notice-to-employee';

const shouldMaskField = (formId: string, fieldName: string) =>
  isI9Form(formId) && MASKED_I9_FIELDS.has(fieldName);

const shouldHideField = (formId: string, fieldName: string) =>
  (isAdpDepositForm(formId) && HIDDEN_ADP_DEPOSIT_FIELDS.has(fieldName)) ||
  (isI9Form(formId) && HIDDEN_I9_FIELDS.has(fieldName)) ||
  (isNoticeToEmployeeForm(formId) && HIDDEN_NOTICE_TO_EMPLOYEE_FIELDS.has(fieldName)) ||
  (isWiNoticeToEmployeeForm(formId) && HIDDEN_WI_NOTICE_TO_EMPLOYEE_FIELDS.has(fieldName));

const ADP_NET_AMOUNT_SLOTS = [
  { name: 'adp_entire_net_amount_1', referenceField: 'Checking1', fallbackY: 241.745 },
  { name: 'adp_entire_net_amount_2', referenceField: 'Check Box9', fallbackY: 176.368 },
];

type PdfRect = { x: number; y: number; width: number; height: number };

const getWidgetRect = (field: any): PdfRect | null => {
  const widgets = field?.acroField?.getWidgets?.() || [];
  if (!widgets.length) return null;
  const rect = widgets[0].getRectangle?.();
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
      if (rect) rects.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
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
      // ignore
    }
  }

  let baseRect: PdfRect | null = null;
  try {
    const baseField = form.getCheckBox('Check Box16');
    baseRect = getWidgetRect(baseField);
  } catch {
    baseRect = null;
  }

  const defaultRect: PdfRect = baseRect || { x: 446.741, y: 106.149, width: 7.87, height: 6.659 };
  const existingRects = collectCheckboxRects(form);
  const page = pdfDoc.getPages()[0];

  for (const slot of ADP_NET_AMOUNT_SLOTS) {
    if (fieldNames.has(slot.name)) continue;

    let y = slot.fallbackY;
    try {
      const refField = form.getField(slot.referenceField);
      const refRect = getWidgetRect(refField);
      if (refRect) y = refRect.y;
    } catch {
      // keep fallback
    }

    const targetRect: PdfRect = { x: defaultRect.x, y, width: defaultRect.width, height: defaultRect.height };
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
    if (typeof commissionField.isChecked === 'function' && !commissionField.isChecked()) commissionField.check();
  } catch (error) {
    console.warn('[NOTICE_TO_EMPLOYEE] Failed to pre-check Commission checkbox for WI', error);
  }
};

const applyNyNoticeToEmployeeDefaults = (pdfDoc: any, formId: string) => {
  if (!isNyNoticeToEmployeeForm(formId)) return;
  try {
    const form = pdfDoc.getForm();
    const commissionField = form.getCheckBox('Commission');
    if (typeof commissionField.isChecked === 'function' && !commissionField.isChecked()) commissionField.check();
  } catch (error) {
    console.warn('[NOTICE_TO_EMPLOYEE] Failed to pre-check Commission checkbox for NY', error);
  }
};

// ✅ NY state tax radio: savedDoc wins ALWAYS; if no saved selection -> Off.
const clearNyStateTaxRadioDefaults = async (pdfDoc: any, formId: string, savedDoc: any | null) => {
  if (formId !== 'ny-state-tax') return;

  const { PDFName } = await import('pdf-lib');
  const form = pdfDoc.getForm();
  const radioFieldNames = ['Status', 'Resident', 'Resident of Yonkers'];
  const isOff = (v: string) => v === '' || v === 'Off' || v === '/Off';

  for (const fieldName of radioFieldNames) {
    try {
      const field = form.getField(fieldName);
      if (!field?.acroField) continue;

      if (savedDoc) {
        try {
          const savedForm = savedDoc.getForm();
          const savedField = savedForm.getField(fieldName);
          const savedValue = savedField?.acroField?.getValue?.()?.toString?.() ?? '';
          if (!isOff(savedValue)) {
            field.acroField.setValue(savedField.acroField.getValue());
            continue;
          }
        } catch {
          // ignore
        }
      }

      field.acroField.setValue(PDFName.of('Off'));
    } catch (err) {
      console.warn(`[NY STATE TAX] Could not process field ${fieldName}:`, err);
    }
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
  continueUrl,
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
  const [continueButtonRect, setContinueButtonRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const renderTaskRef = useRef<any>(null);
  const isLoadingRef = useRef(false);

  // progress
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
      const value = fieldValues.get(baseName) || '';
      if (field.type === 'checkbox') {
        if (value === 'true') filled += 1;
      } else if (String(value).trim().length > 0) {
        filled += 1;
      }
    }
    onProgress(filled / total);
  }, [formFields, fieldValues, onProgress]);

  useEffect(() => {
    loadPDF();

    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, formId]);

  const loadPDF = async () => {
    if (isLoadingRef.current) return;

    try {
      isLoadingRef.current = true;

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }

      setLoading(true);
      setError('');

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const getLocalProgress = () =>
        typeof localStorage !== 'undefined' ? localStorage.getItem(`pdf-progress-${formId}`) : null;

      let savedData: any = { found: false };
      if (!session?.access_token) {
        const local = getLocalProgress();
        if (local) savedData = { found: true, formData: local };
      } else {
        try {
          const savedResponse = await fetch(`/api/pdf-form-progress/retrieve?formName=${formId}`, {
            credentials: 'same-origin',
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (savedResponse.status === 401) {
            const local = getLocalProgress();
            if (local) savedData = { found: true, formData: local };
          } else {
            savedData = await savedResponse.json();
          }
        } catch {
          const local = getLocalProgress();
          if (local) savedData = { found: true, formData: local };
        }
      }

      let pdfBytes: ArrayBuffer;
      let savedPdfBytes: Uint8Array | null = null;
      let savedPdfDoc: any = null;
      let pdfLibDoc: any;
      let usedSavedBytesForLoad = false;

      if (savedData.found && savedData.formData) {
        try {
          const binaryString = atob(savedData.formData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          savedPdfBytes = bytes;
          pdfBytes = bytes.buffer;

          const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
          if (!header.startsWith('%PDF')) throw new Error('Invalid PDF header');
        } catch {
          savedPdfBytes = null;
          const response = await fetch(pdfUrl, {
            cache: 'no-store',
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          });
          if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          pdfBytes = await response.arrayBuffer();
        }
      } else {
        const response = await fetch(pdfUrl, {
          cache: 'no-store',
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        pdfBytes = await response.arrayBuffer();
      }

      const { PDFDocument, PDFName } = await import('pdf-lib');

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
        } catch {
          // ignore
        }
        return false;
      };

      const shouldUseSavedPdf = formId === 'adp-deposit';

      if (savedPdfBytes) {
        const savedDoc = await PDFDocument.load(savedPdfBytes);
        savedPdfDoc = savedDoc;

        const isXfaForm = detectXfaForm(savedDoc);
        if (!isXfaForm && !shouldUseSavedPdf) {
          let useSavedBytes = false;
          try {
            const templateResponse = await fetch(pdfUrl, {
              cache: 'no-store',
              headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
            });
            if (templateResponse.ok) {
              pdfBytes = await templateResponse.arrayBuffer();
            } else {
              useSavedBytes = true;
            }
          } catch {
            useSavedBytes = true;
          }

          if (useSavedBytes) {
            pdfBytes = new Uint8Array(savedPdfBytes).buffer;
            pdfLibDoc = savedDoc;
            usedSavedBytesForLoad = true;
          } else {
            pdfLibDoc = await PDFDocument.load(pdfBytes);

            // Merge saved values onto template (skip NY radios; handled later)
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
                  // ignore
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

                const nyStateTaxRadioFields = ['Status', 'Resident', 'Resident of Yonkers'];
                const isNyStateTaxRadio = formId === 'ny-state-tax' && nyStateTaxRadioFields.includes(fieldName);

                try {
                  if (
                    typeof (savedField as any).getText === 'function' &&
                    typeof (targetField as any).setText === 'function'
                  ) {
                    (targetField as any).setText((savedField as any).getText() || '');
                    copiedCount++;
                  } else if (typeof (savedField as any).isChecked === 'function') {
                    if (!isNyStateTaxRadio) {
                      const checked = (savedField as any).isChecked();
                      if (checked && typeof (targetField as any).check === 'function') (targetField as any).check();
                      if (!checked && typeof (targetField as any).uncheck === 'function')
                        (targetField as any).uncheck();
                      copiedCount++;
                    }
                  } else if (
                    typeof (savedField as any).getSelected === 'function' &&
                    typeof (targetField as any).select === 'function'
                  ) {
                    const selected = (savedField as any).getSelected();
                    const value = Array.isArray(selected) ? selected[0] : selected;
                    if (value) {
                      (targetField as any).select(value);
                      copiedCount++;
                    }
                  }
                } catch {
                  // ignore
                }
              }
            } catch {
              copyFailed = true;
            }

            if (copyFailed || copiedCount === 0) {
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

      if (!pdfLibDoc) pdfLibDoc = await PDFDocument.load(pdfBytes);

      ensureAdpNetAmountCheckboxes(pdfLibDoc, formId);
      applyWiNoticeToEmployeeDefaults(pdfLibDoc, formId);
      applyNyNoticeToEmployeeDefaults(pdfLibDoc, formId);
      await clearNyStateTaxRadioDefaults(pdfLibDoc, formId, savedPdfDoc);

      pdfLibDocRef.current = pdfLibDoc;

      // PDF.js load
      if (!window.pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load PDF.js from CDN'));
          document.head.appendChild(script);
        });
      }

      const pdfjsLib = window.pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';

      const pdfBytesCopy = pdfBytes.slice(0);
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytesCopy });
      const pdfDoc = await loadingTask.promise;

      pdfDocRef.current = pdfDoc;
      setNumPages(pdfDoc.numPages);

      // Extract fields
      let fields = await extractFormFields(pdfLibDoc);

      // Hide/mask
      const masked = fields.filter((field) => shouldMaskField(formId, field.baseName));
      fields = fields.filter((field) => !shouldHideField(formId, field.baseName));

      setFormFields(fields);
      setMaskedFields(masked);

      // ✅ normal behaviour: each rendered checkbox has a unique key.
      // (We also avoid rendering duplicates for multi-widget checkboxes — see extractFormFields)
      const initialValues = new Map<string, string>();
      for (const f of fields) {
        initialValues.set(f.baseName, f.value);
      }
      setFieldValues(initialValues);

      setLoading(false);

      await new Promise((resolve) => setTimeout(resolve, 100));
      await renderAllPages(pdfDoc.numPages);

      // Continue button
      if (!skipButtonDetection) {
        try {
          const lastPageNum = pdfDoc.numPages;
          const lastPage = await pdfDoc.getPage(lastPageNum);
          const annotations = await lastPage.getAnnotations();
          const linkAnnots = (annotations || []).filter(
            (annot: any) => annot?.subtype === 'Link' && annot?.url && annot?.rect
          );

          let targetAnnot = linkAnnots.find((annot: any) => annot.url === continueUrl);
          if (!targetAnnot && linkAnnots.length > 0) {
            targetAnnot = linkAnnots.reduce((best: any, current: any) =>
              current.rect[0] > best.rect[0] ? current : best
            );
          }

          if (targetAnnot?.rect) {
            const rect = targetAnnot.rect;
            if (Array.isArray(rect) && rect.length >= 4) {
              setContinueButtonRect({
                x: rect[0],
                y: rect[1],
                width: rect[2] - rect[0],
                height: rect[3] - rect[1],
              });
            }
          }
        } catch {
          // ignore
        }
      }

      const initialPdfBytes = usedSavedBytesForLoad && savedPdfBytes ? savedPdfBytes : await pdfLibDoc.save();
      if (onSave) onSave(initialPdfBytes);
    } catch (err: any) {
      setError(`Failed to load PDF: ${err.message}`);
      setLoading(false);
    } finally {
      isLoadingRef.current = false;
    }
  };

  /**
   * ✅ KEY FIX FOR YOUR ISSUE:
   * - RADIO fields: render one checkbox per widget (Status::radio::i)
   * - CHECKBOX fields: render ONLY ONE overlay per field (first widget only)
   *
   * If you render one overlay per widget for a checkbox field, all overlays share the same underlying field state
   * and your UI will look like "checking one checks all". This makes it behave "normal".
   */
  const extractFormFields = async (pdfDoc: any): Promise<FormField[]> => {
    const fields: FormField[] = [];

    const getAcroValueString = (f: any) => {
      try {
        return f?.acroField?.getValue?.()?.toString?.() ?? '';
      } catch {
        return '';
      }
    };
    const isOffValue = (v: string) => v === '' || v === 'Off' || v === '/Off';

    try {
      const form = pdfDoc.getForm();
      const all = form.getFields();

      for (const field of all) {
        let fieldName = '';
        try {
          fieldName = field.getName();
        } catch {
          continue;
        }

        if (!field?.acroField) continue;

        const widgets = field.acroField.getWidgets?.() || [];
        if (!widgets.length) continue;

        const acroValue = getAcroValueString(field);

        const isText = 'getText' in field;
        const isRadio = 'getSelected' in field && 'select' in field;
        const isCheckbox = 'isChecked' in field;

        if (isText) {
          // text: one overlay per widget (usually 1)
          const value = (field as any).getText?.() || '';
          for (let i = 0; i < widgets.length; i++) {
            const widget = widgets[i];
            const rect = widget?.getRectangle?.();
            if (!rect) continue;

            const pageIndex = pdfDoc.getPages().findIndex((p: any) => {
              const pageRef = p.ref;
              const widgetPage = widget.P?.();
              return pageRef && widgetPage && pageRef.toString() === widgetPage.toString();
            });

            fields.push({
              id: `${fieldName}::${i}`,
              baseName: fieldName,
              originalFieldName: fieldName,
              type: 'text',
              rect: [rect.x, rect.y, rect.width, rect.height],
              page: pageIndex >= 0 ? pageIndex + 1 : 1,
              value,
              widgetIndex: i,
              isRadioGroup: false,
            });
          }
          continue;
        }

        if (isRadio) {
          // radio: one overlay per widget, each unique key
          for (let i = 0; i < widgets.length; i++) {
            const widget = widgets[i];
            const rect = widget?.getRectangle?.();
            if (!rect) continue;

            const pageIndex = pdfDoc.getPages().findIndex((p: any) => {
              const pageRef = p.ref;
              const widgetPage = widget.P?.();
              return pageRef && widgetPage && pageRef.toString() === widgetPage.toString();
            });

            const onValue = widget.getOnValue?.()?.toString?.() ?? '';
            const selected = onValue && acroValue === onValue ? 'true' : 'false';

            fields.push({
              id: `${fieldName}::radio::${i}`,
              baseName: `${fieldName}::radio::${i}`,
              originalFieldName: fieldName,
              type: 'checkbox', // rendered as checkbox
              rect: [rect.x, rect.y, rect.width, rect.height],
              page: pageIndex >= 0 ? pageIndex + 1 : 1,
              value: selected,
              widgetIndex: i,
              isRadioGroup: true,
            });
          }
          continue;
        }

        if (isCheckbox) {
          // ✅ checkbox: ONLY ONE overlay per field (first widget)
          const widget = widgets[0];
          const rect = widget?.getRectangle?.();
          if (!rect) continue;

          const pageIndex = pdfDoc.getPages().findIndex((p: any) => {
            const pageRef = p.ref;
            const widgetPage = widget.P?.();
            return pageRef && widgetPage && pageRef.toString() === widgetPage.toString();
          });

          const checked = !isOffValue(acroValue) ? 'true' : 'false';

          fields.push({
            id: `${fieldName}::cb`,
            baseName: fieldName,
            originalFieldName: fieldName,
            type: 'checkbox',
            rect: [rect.x, rect.y, rect.width, rect.height],
            page: pageIndex >= 0 ? pageIndex + 1 : 1,
            value: checked,
            widgetIndex: 0,
            isRadioGroup: false,
          });
        }
      }
    } catch (err) {
      console.error('Error extracting form fields:', err);
    }

    return fields;
  };

  const renderAllPages = async (totalPages: number) => {
    if (!pdfDocRef.current) return;
    if (!canvasContainerRef.current) return;

    const viewports: any[] = [];
    while (canvasContainerRef.current.firstChild) {
      canvasContainerRef.current.removeChild(canvasContainerRef.current.firstChild);
    }

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdfDocRef.current.getPage(pageNum);
      const pageViewport = page.getViewport({ scale });
      viewports.push(pageViewport);

      const canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      canvas.style.marginBottom = '20px';
      canvas.style.backgroundColor = 'white';
      canvas.setAttribute('data-page-number', String(pageNum));
      canvasContainerRef.current.appendChild(canvas);

      const context = canvas.getContext('2d');
      if (!context) continue;

      canvas.height = pageViewport.height;
      canvas.width = pageViewport.width;

      const renderTask = page.render({ canvasContext: context, viewport: pageViewport });
      await renderTask.promise;
    }

    setPageViewports(viewports);
  };

  const handleFieldChange = useCallback(
    (fieldName: string, value: string) => {
      const isRadioField = fieldName.includes('::radio::');

      if (isRadioField && value === 'true') {
        const [originalFieldName, widgetIndexStr] = fieldName.split('::radio::');
        const widgetIndex = Number.parseInt(widgetIndexStr ?? '0', 10);

        setFieldValues((prev) => {
          const newValues = new Map(prev);
          for (const [key] of prev) {
            if (key.startsWith(`${originalFieldName}::radio::`)) newValues.set(key, 'false');
          }
          newValues.set(fieldName, 'true');
          return newValues;
        });

        updatePDFRadioField(originalFieldName, widgetIndex);

        if (onFieldChange) onFieldChange();
        return;
      }

      const mirrorFieldName = getMirroredFieldName(formId, fieldName);
      const exclusiveGroup = getExclusiveCheckboxGroup(formId, fieldName);

      setFieldValues((prev) => {
        const newValues = new Map(prev);
        newValues.set(fieldName, value);
        if (mirrorFieldName) newValues.set(mirrorFieldName, value);

        if (exclusiveGroup && value === 'true') {
          for (const otherField of exclusiveGroup) {
            if (otherField !== fieldName) newValues.set(otherField, 'false');
          }
        }
        return newValues;
      });

      const updates: Record<string, string> = { [fieldName]: value };
      if (mirrorFieldName) updates[mirrorFieldName] = value;

      if (exclusiveGroup && value === 'true') {
        for (const otherField of exclusiveGroup) {
          if (otherField !== fieldName) updates[otherField] = 'false';
        }
      }

      updatePDFFields(updates);
      if (onFieldChange) onFieldChange();
    },
    [formId, onFieldChange]
  );

  const updatePDFRadioField = async (originalFieldName: string, widgetIndex: number) => {
    if (!pdfLibDocRef.current) return;

    try {
      const form = pdfLibDocRef.current.getForm();
      const field = form.getField(originalFieldName);
      if (!field || !field.acroField) return;

      const widgets = field.acroField.getWidgets();
      if (!widgets || widgetIndex >= widgets.length) return;

      const widget = widgets[widgetIndex];
      const onValue = widget.getOnValue?.();

      if (onValue) field.acroField.setValue(onValue);
      else if ('check' in field) (field as any).check();

      const pdfBytes = await pdfLibDocRef.current.save();
      if (onSave) onSave(pdfBytes);
    } catch (err) {
      console.error('[RADIO UPDATE] Error updating radio field:', err);
    }
  };

  const updatePDFFields = async (updates: Record<string, string>) => {
    if (!pdfLibDocRef.current) return;

    try {
      const form = pdfLibDocRef.current.getForm();
      for (const [fieldName, value] of Object.entries(updates)) {
        const field = form.getField(fieldName);
        if (!field) continue;

        if ('setText' in field) {
          (field as any).setText(value);
        } else if ('check' in field || 'uncheck' in field) {
          if (value === 'true') (field as any).check();
          else (field as any).uncheck();
        }
      }

      const pdfBytes = await pdfLibDocRef.current.save();
      if (onSave) onSave(pdfBytes);
    } catch (err) {
      console.error('Error updating PDF field:', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', fontSize: '18px', color: '#666' }}>
        Loading PDF form...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '10px', height: '100%', fontSize: '16px', color: '#d32f2f', padding: '20px', textAlign: 'center' }}>
        <div>{error}</div>
        <div style={{ color: '#555', fontSize: '14px' }}>If the problem persists, please reload the page and try again.</div>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 14px', backgroundColor: '#1976d2', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
        >
          Reload Page
        </button>
      </div>
    );
  }

  const calculatePageOffsets = () => {
    const offsets: number[] = [];
    let cumulativeY = 0;
    pageViewports.forEach((viewport) => {
      offsets.push(cumulativeY);
      cumulativeY += viewport.height + 20;
    });
    return offsets;
  };

  const pageOffsets = calculatePageOffsets();
  const maskPadding = 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#525659', overflow: 'auto' }}>
      <div data-pdf-scroll-container="true" style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', padding: '20px', overflow: 'auto' }}>
        <div style={{ position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', backgroundColor: 'white', minHeight: '100%', display: 'inline-block', margin: '0 auto' }}>
          <div ref={canvasContainerRef} style={{ position: 'relative', minHeight: '1000px', minWidth: '800px' }} />

          {pageViewports.length > 0 &&
            maskedFields.map((field) => {
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
                    pointerEvents: 'none',
                  }}
                />
              );
            })}

          {pageViewports.length > 0 &&
            formFields.map((field) => {
              const pageIndex = field.page - 1;
              if (pageIndex < 0 || pageIndex >= pageViewports.length) return null;

              const viewport = pageViewports[pageIndex];
              const pageOffset = pageOffsets[pageIndex];
              const fieldValue = fieldValues.get(field.baseName) || '';

              const fieldNameToCheck = field.originalFieldName || field.baseName;
              const isInRequiredList =
                requiredFieldNames?.includes(field.baseName) || requiredFieldNames?.includes(fieldNameToCheck) || false;

              const isEmpty = field.type === 'checkbox' ? fieldValue !== 'true' : String(fieldValue).trim() === '';

              const isMissingRequired = Boolean(
                showRequiredFieldErrors && isInRequiredList && (field.type === 'checkbox' ? true : isEmpty)
              );

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
                    boxShadow: field.type === 'checkbox' && isMissingRequired ? '0 0 0 2px rgba(211,47,47,0.8)' : 'none',
                    borderRadius: field.type === 'checkbox' ? '3px' : '0',
                    backgroundColor: field.type === 'checkbox' && isMissingRequired ? 'rgba(211,47,47,0.08)' : 'transparent',
                  }}
                >
                  {field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={fieldValue === 'true'}
                      onChange={(e) => handleFieldChange(field.baseName, e.target.checked ? 'true' : 'false')}
                      style={{
                        width: '100%',
                        height: '100%',
                        cursor: 'pointer',
                        outline: isMissingRequired ? '2px solid #d32f2f' : 'none',
                        outlineOffset: '1px',
                        boxShadow: isMissingRequired ? '0 0 0 2px rgba(211,47,47,0.35)' : 'none',
                        accentColor: isMissingRequired ? '#d32f2f' : undefined,
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={fieldValue}
                      onChange={(e) => handleFieldChange(field.baseName, e.target.value)}
                      style={{
                        width: '100%',
                        height: '100%',
                        border: isMissingRequired ? '2px solid #d32f2f' : '1px solid rgba(0,0,255,0.3)',
                        backgroundColor: isMissingRequired ? 'rgba(211,47,47,0.08)' : 'rgba(255,255,255,0.9)',
                        fontSize: `${height * 0.6}px`,
                        padding: '2px 4px',
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>
              );
            })}

          {!skipButtonDetection && pageViewports.length > 0 && continueButtonRect && (
            <div
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (pdfLibDocRef.current && onSave) {
                  const pdfBytes = await pdfLibDocRef.current.save();
                  onSave(pdfBytes);
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }

                if (onContinue) onContinue();
              }}
              style={{
                position: 'absolute',
                left: `${continueButtonRect.x * scale}px`,
                top: `${
                  pageOffsets[pageOffsets.length - 1] +
                  (pageViewports[pageViewports.length - 1].height - (continueButtonRect.y + continueButtonRect.height) * scale)
                }px`,
                width: `${continueButtonRect.width * scale}px`,
                height: `${continueButtonRect.height * scale}px`,
                cursor: 'pointer',
                zIndex: 1000,
                backgroundColor: 'rgba(0,0,0,0)',
              }}
              title="Continue to next form"
            />
          )}
        </div>
      </div>
    </div>
  );
}

