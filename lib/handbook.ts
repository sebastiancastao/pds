import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { existsSync, promises as fsPromises } from 'fs';
import { join } from 'path';

const HANDBOOK_TEMPLATE_PATH = join(process.cwd(), 'pds-employee-handbook-2026.pdf');

const HANDBOOK_NAME_FIELDS = new Set([
  'employee_name1',
  'printedName1',
  'employee_name',
  'printedName',
  'printedName3',
  'printedName4',
]);

const HANDBOOK_INITIAL_FIELDS = new Set([
  'employee_initialsprev',
  'employee_initials2prev',
  'employee_initials3prev',
  'employee_initials',
  'employee_initials2',
  'employee_initials3',
]);

const HANDBOOK_DATE_FIELDS = new Set([
  'acknowledgment_date1',
  'acknowledgment_date',
  'date3',
  'date4',
  'date5',
  'date6',
]);

type FieldType = 'name' | 'initials' | 'date';

type HandbookOverlayTarget = {
  label: string;
  type: FieldType;
  page: number; // 0-indexed page number
  x: number;
  y: number; // Y coordinate from bottom of page
};

// Coordinates are now per-page (y measured from bottom of each page)
// For a standard US Letter page, height is ~792 points
// Y=0 is bottom of page, Y=792 is top of page
// page: -1 means "last page" (dynamically resolved)
// Field positions based on original fieldOffsets mapping
const HANDBOOK_OVERLAY_TARGETS: HandbookOverlayTarget[] = [
  // Page 1 (index 0) - First acknowledgment section (moved down 150 points)
  { label: 'employee_name1', type: 'name', page: 0, x: 150, y: 250 },
  { label: 'employee_initialsprev', type: 'initials', page: 0, x: 400, y: 200 },
  { label: 'employee_initials2prev', type: 'initials', page: 0, x: 400, y: 150 },
  { label: 'employee_initials3prev', type: 'initials', page: 0, x: 400, y: 100 },
  { label: 'printedName1', type: 'name', page: 0, x: 150, y: 50 },
  { label: 'acknowledgment_date1', type: 'date', page: 0, x: 350, y: 50 },
  // Page 2 (index 1) - Second acknowledgment section (moved down 150 points)
  { label: 'employee_name', type: 'name', page: 1, x: 150, y: 250 },
  { label: 'employee_initials', type: 'initials', page: 1, x: 400, y: 200 },
  { label: 'employee_initials2', type: 'initials', page: 1, x: 400, y: 150 },
  { label: 'employee_initials3', type: 'initials', page: 1, x: 400, y: 100 },
  { label: 'printedName', type: 'name', page: 1, x: 150, y: 50 },
  { label: 'acknowledgment_date', type: 'date', page: 1, x: 350, y: 50 },
  // Page 3 (index 2) - Third section (moved down 150 points)
  { label: 'printedName3', type: 'name', page: 2, x: 150, y: 250 },
  { label: 'date3', type: 'date', page: 2, x: 350, y: 250 },
  { label: 'date4', type: 'date', page: 2, x: 350, y: 200 },
  // Page 4 (index 3) - Last page signatures (moved down 150 points)
  { label: 'printedName4', type: 'name', page: 3, x: 150, y: 250 },
  { label: 'date5', type: 'date', page: 3, x: 350, y: 250 },
  { label: 'date6', type: 'date', page: 3, x: 350, y: 200 },
];

export type HandbookFillValues = {
  fullName: string;
  initials: string;
  dateString: string;
};

const formatDateForHandbook = (isoTimestamp: string): string => {
  try {
    const parsed = new Date(isoTimestamp);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }
    return parsed.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  const first = parts[0][0] ?? '';
  const last = parts[parts.length - 1][0] ?? '';
  return `${first}${last}`.toUpperCase();
};

export const buildHandbookFillValues = (
  fullName: string,
  primaryDate?: string | null,
  fallbackDate?: string | null
): HandbookFillValues => {
  const dateSource = primaryDate || fallbackDate || new Date().toISOString();
  return {
    fullName: fullName.trim(),
    initials: getInitials(fullName),
    dateString: formatDateForHandbook(dateSource),
  };
};

export const normalizeBase64 = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  let normalized = value.trim();
  const base64Marker = 'base64,';
  const markerIndex = normalized.indexOf(base64Marker);
  if (markerIndex >= 0) {
    normalized = normalized.substring(markerIndex + base64Marker.length);
  }
  return normalized.replace(/\s+/g, '');
};

let cachedTemplateBase64: string | null | undefined;
export const loadHandbookTemplateBase64 = async (): Promise<string | null> => {
  // Always re-check if file exists (don't cache null values from path errors)
  if (!existsSync(HANDBOOK_TEMPLATE_PATH)) {
    console.warn('[Handbook Fill] Handbook template not found:', HANDBOOK_TEMPLATE_PATH);
    return null;
  }
  if (cachedTemplateBase64) {
    console.log('[Handbook Fill] Using cached template');
    return cachedTemplateBase64;
  }
  console.log('[Handbook Fill] Loading template from:', HANDBOOK_TEMPLATE_PATH);
  const file = await fsPromises.readFile(HANDBOOK_TEMPLATE_PATH);
  cachedTemplateBase64 = file.toString('base64');
  console.log('[Handbook Fill] Template loaded:', (cachedTemplateBase64.length / 1024).toFixed(2), 'KB');
  return cachedTemplateBase64;
};

const shouldFillTextField = (value?: string | null): boolean => {
  if (!value) return true;
  return value.trim().length === 0;
};

const getHandbookFieldValue = (fieldName: string, values: HandbookFillValues): string | undefined => {
  if (HANDBOOK_NAME_FIELDS.has(fieldName) && values.fullName) {
    return values.fullName;
  }
  if (HANDBOOK_INITIAL_FIELDS.has(fieldName) && values.initials) {
    return values.initials;
  }
  if (HANDBOOK_DATE_FIELDS.has(fieldName) && values.dateString) {
    return values.dateString;
  }
  return undefined;
};

const drawHandbookOverlay = async (pdfDoc: PDFDocument, values: HandbookFillValues): Promise<boolean> => {
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    return false;
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const drawnEntries: string[] = [];

  console.log(`[Handbook Fill] ========== OVERLAY DRAWING DEBUG ==========`);
  console.log(`[Handbook Fill] PDF has ${pages.length} pages`);
  console.log(`[Handbook Fill] Values: name="${values.fullName}", initials="${values.initials}", date="${values.dateString}"`);

  // Draw overlay text for each target position
  for (const target of HANDBOOK_OVERLAY_TARGETS) {
    const value =
      target.type === 'name'
        ? values.fullName
        : target.type === 'initials'
          ? values.initials
          : values.dateString;

    const trimmedValue = value?.trim();
    if (!trimmedValue) continue;

    const pageIndex = target.page === -1 ? pages.length - 1 : target.page;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const targetPage = pages[pageIndex];
    console.log(`[Handbook Fill] >>> OVERLAY: Drawing "${trimmedValue}" for ${target.label} on page ${pageIndex + 1} at x=${target.x}, y=${target.y}`);

    targetPage.drawText(trimmedValue, {
      x: target.x,
      y: target.y,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });

    drawnEntries.push(`${target.label} on page ${pageIndex + 1}`);
  }

  if (drawnEntries.length > 0) {
    console.log(
      '[Handbook Fill] Drew overlay text for:',
      drawnEntries.join(', ')
    );
    return true;
  }

  return false;
};

export const fillHandbookFields = async (
  base64Data: string,
  values: HandbookFillValues
): Promise<string | null> => {
  try {
    console.log('[Handbook Fill] fillHandbookFields values:', values);
    const pdfDoc = await PDFDocument.load(Buffer.from(base64Data, 'base64'));
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    let updated = false;

    console.log(`[Handbook Fill] PDF has ${fields.length} form fields`);
    if (fields.length > 0) {
      console.log('[Handbook Fill] Form field names:', fields.map(f => f.getName()).join(', '));
    }

    if (fields.length === 0) {
      console.log('[Handbook Fill] PDF has no editable fields, falling back to overlay drawing');
      const overlayApplied = await drawHandbookOverlay(pdfDoc, values);
      if (!overlayApplied) {
        console.log('[Handbook Fill] Overlay drawing did not render any values');
        return null;
      }
      updated = true;
    } else {
      for (const field of fields) {
        const fieldName = field.getName?.();
        if (!fieldName) continue;
        // Check if this is a text field by trying to access getText
        const isTextField = typeof (field as any).getText === 'function';
        if (!isTextField) {
          continue;
        }

        const desiredValue = getHandbookFieldValue(fieldName, values);
        if (!desiredValue) {
          continue;
        }

        let currentValue = '';
        try {
          currentValue = field.getText?.() ?? '';
        } catch {
          currentValue = '';
        }

        if (!shouldFillTextField(currentValue)) {
          continue;
        }

        try {
          field.setText(desiredValue);
          console.log(`[Handbook Fill] Set "${fieldName}" -> "${desiredValue}"`);
          updated = true;
        } catch (setError) {
          console.warn('[Handbook Fill] Unable to set field value', fieldName, (setError as Error).message);
        }
      }
    }

    if (!updated) {
      return null;
    }

    try {
      form.flatten();
    } catch {
      // Flatten may fail but continue
    }

    const saved = await pdfDoc.save();
    const resultBase64 = Buffer.from(saved).toString('base64');
    console.log(`[Handbook Fill] Saved PDF: ${saved.length} bytes, base64 length: ${resultBase64.length}`);
    return resultBase64;
  } catch (error) {
    console.error('[Handbook Fill] Error filling handbook fields:', error);
    return null;
  }
};
