const PDFJS_SCRIPT_SRC = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js';
const PDFJS_WORKER_SRC = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
// Shared vertical offset for redrawing the CA temp-agreement signature block.
// Lowering this value moves the rendered signature up on the page.
const TEMP_AGREEMENT_SIGNATURE_Y_OFFSET = 10;
const TEMP_AGREEMENT_SIGNATURE_X_OFFSET = 50;

export const LEGACY_TEMP_AGREEMENT_SIGNATURE_RECT = {
  x: 180,
  y: 110,
  width: 200,
  height: 10,
};

export type TempAgreementSignaturePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TempAgreementCleanupRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

declare global {
  interface Window {
    pdfjsLib?: any;
    __tempAgreementPdfJsPromise?: Promise<any>;
  }
}

const DEFAULT_PLACEMENT: TempAgreementSignaturePlacement = {
  x: 64 + TEMP_AGREEMENT_SIGNATURE_X_OFFSET,
  y: 452,
  width: 200,
  height: 40,
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

async function getPlacementFromFormFields(
  pdfBytes: Uint8Array
): Promise<TempAgreementSignaturePlacement | null> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const lastPage = pdfDoc.getPages().at(-1);
    if (!lastPage) return null;

    const { height } = lastPage.getSize();
    const form = pdfDoc.getForm();

    const getFieldRect = (fieldName: string) => {
      try {
        const field = form.getField(fieldName) as any;
        const widget = field?.acroField?.getWidgets?.()?.[0];
        return widget?.getRectangle?.() || null;
      } catch {
        return null;
      }
    };

    const dateRect = getFieldRect('employee_signature_date');
    if (!dateRect) return null;

    const printedNameBottomRect = getFieldRect('printed_name_bottom');
    const baseX = printedNameBottomRect
      ? Math.round(printedNameBottomRect.x)
      : Math.max(40, Math.round(dateRect.x - 180));
    const baseY = printedNameBottomRect
      ? Math.round(dateRect.y)
      : Math.round(dateRect.y - 20);

    return {
      x: baseX + TEMP_AGREEMENT_SIGNATURE_X_OFFSET,
      y: Math.min(
        Math.round(height - DEFAULT_PLACEMENT.height),
        baseY + TEMP_AGREEMENT_SIGNATURE_Y_OFFSET
      ),
      width: DEFAULT_PLACEMENT.width,
      height: DEFAULT_PLACEMENT.height,
    };
  } catch {
    return null;
  }
}

async function getCleanupRectFromFormFields(
  pdfBytes: Uint8Array
): Promise<TempAgreementCleanupRect | null> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    const getFieldRect = (fieldName: string) => {
      try {
        const field = form.getField(fieldName) as any;
        const widget = field?.acroField?.getWidgets?.()?.[0];
        return widget?.getRectangle?.() || null;
      } catch {
        return null;
      }
    };

    const dateRect = getFieldRect('employee_signature_date');
    const printedNameBottomRect = getFieldRect('printed_name_bottom');

    if (!dateRect || !printedNameBottomRect) {
      return null;
    }

    const labelTop = Math.round(dateRect.y - 2);
    const labelBottom = Math.round(printedNameBottomRect.y + printedNameBottomRect.height + 1);

    return {
      x: Math.max(0, Math.round(printedNameBottomRect.x - 4)),
      y: Math.max(0, labelBottom),
      width: 190,
      height: Math.max(14, labelTop - labelBottom),
    };
  } catch {
    return null;
  }
}

async function ensurePdfJsLib(): Promise<any> {
  if (typeof window === 'undefined') return null;

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    return window.pdfjsLib;
  }

  if (!window.__tempAgreementPdfJsPromise) {
    window.__tempAgreementPdfJsPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${PDFJS_SCRIPT_SRC}"]`);

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.pdfjsLib), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Failed to load PDF.js')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = PDFJS_SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve(window.pdfjsLib);
      script.onerror = () => reject(new Error('Failed to load PDF.js'));
      document.head.appendChild(script);
    });
  }

  const pdfjsLib = await window.__tempAgreementPdfJsPromise;
  if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  }
  return pdfjsLib;
}

export async function getTempAgreementSignaturePlacement(
  pdfBytes: Uint8Array
): Promise<TempAgreementSignaturePlacement> {
  const fieldPlacement = await getPlacementFromFormFields(pdfBytes);
  if (fieldPlacement) {
    return fieldPlacement;
  }

  const pdfjsLib = await ensurePdfJsLib();
  if (!pdfjsLib) return DEFAULT_PLACEMENT;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
    const pdfDoc = await loadingTask.promise;
    const lastPage = await pdfDoc.getPage(pdfDoc.numPages);
    const viewport = lastPage.getViewport({ scale: 1 });
    const textContent = await lastPage.getTextContent();

    const employeeSignatureLabel = textContent.items.find((item: any) => {
      const text = normalizeText(String(item?.str || ''));
      return text === 'employee signature';
    }) as any;

    if (!employeeSignatureLabel?.transform) {
      return DEFAULT_PLACEMENT;
    }

    const labelX = Number(employeeSignatureLabel.transform[4] || DEFAULT_PLACEMENT.x);
    const labelY = Number(employeeSignatureLabel.transform[5] || DEFAULT_PLACEMENT.y);

    return {
      x: Math.max(40, Math.round(labelX - 8 + TEMP_AGREEMENT_SIGNATURE_X_OFFSET)),
      y: Math.min(
        Math.round(viewport.height - DEFAULT_PLACEMENT.height),
        Math.round(labelY + 12 + TEMP_AGREEMENT_SIGNATURE_Y_OFFSET)
      ),
      width: DEFAULT_PLACEMENT.width,
      height: DEFAULT_PLACEMENT.height,
    };
  } catch (error) {
    console.warn('[TEMP_AGREEMENT] Failed to detect signature placement from PDF text', error);
    return DEFAULT_PLACEMENT;
  }
}

export async function getTempAgreementSignatureCleanupRect(
  pdfBytes: Uint8Array
): Promise<TempAgreementCleanupRect | null> {
  const fieldCleanupRect = await getCleanupRectFromFormFields(pdfBytes);
  if (fieldCleanupRect) {
    return fieldCleanupRect;
  }

  const pdfjsLib = await ensurePdfJsLib();
  if (!pdfjsLib) return null;

  try {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
    const pdfDoc = await loadingTask.promise;
    const lastPage = await pdfDoc.getPage(pdfDoc.numPages);
    const textContent = await lastPage.getTextContent();

    const employeeSignatureLabel = textContent.items.find((item: any) => {
      const text = normalizeText(String(item?.str || ''));
      return text === 'employee signature';
    }) as any;

    if (!employeeSignatureLabel?.transform) {
      return null;
    }

    const labelX = Number(employeeSignatureLabel.transform[4] || 0);
    const labelY = Number(employeeSignatureLabel.transform[5] || 0);
    const labelWidth = Number(employeeSignatureLabel.width || 150);
    const labelHeight = Number(employeeSignatureLabel.height || 12);

    return {
      x: Math.max(0, Math.round(labelX - 4)),
      y: Math.max(0, Math.round(labelY - 2)),
      width: Math.max(150, Math.round(labelWidth + 16)),
      height: Math.max(16, Math.round(labelHeight + 6)),
    };
  } catch (error) {
    console.warn('[TEMP_AGREEMENT] Failed to detect signature cleanup rect from PDF text', error);
    return null;
  }
}
