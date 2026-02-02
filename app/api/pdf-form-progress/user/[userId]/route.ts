import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, PDFImage, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';
import { existsSync, promises as fsPromises } from 'fs';
import { join } from 'path';

// Disable caching and increase body size limit for large PDFs
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formDisplayNames: Record<string, string> = {
  // California
  'ca-de4': 'CA DE-4 State Tax Form',
  'fw4': 'Federal W-4',
  'i9': 'I-9 Employment Verification',
  'adp-deposit': 'ADP Direct Deposit',
  'ui-guide': 'UI Guide',
  'disability-insurance': 'Disability Insurance',
  'paid-family-leave': 'Paid Family Leave',
  'sexual-harassment': 'Sexual Harassment',
  'survivors-rights': 'Survivors Rights',
  'transgender-rights': 'Transgender Rights',
  'health-insurance': 'Health Insurance',
  'time-of-hire': 'Time of Hire Notice',
  'discrimination-law': 'Discrimination Law',
  'immigration-rights': 'Immigration Rights',
  'military-rights': 'Military Rights',
  'lgbtq-rights': 'LGBTQ Rights',
  'notice-to-employee': 'Notice to Employee',
  'meal-waiver-6hour': 'Meal Waiver (6 Hour)',
  'meal-waiver-10-12': 'Meal Waiver (10/12 Hour)',
  'employee-information': 'Employee Information',
  'state-tax': 'State Tax Form',
  // Prefixed state variants
  'ny-state-tax': 'NY State Tax Form',
  'wi-state-tax': 'WI State Tax Form',
  'az-state-tax': 'AZ State Tax Form',
};

type SignatureEntry = {
  signature_data: string;
  signature_type?: string | null;
  signed_at?: string | null;
};

type SignatureAuditEntry = {
  formName: string;
  normalizedFormName: string;
  displayName: string;
  signatureType: string | null;
  sourceForm: string;
  hasData: boolean;
  isDrawing: boolean;
  isValid: boolean;
  hasRealDrawing: boolean;
  reason: string;
};

const parseSignedAt = (value?: string | null): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

const normalizeSignatureData = (value?: string | null) => {
  if (!value) return '';
  return value.trim();
};

const hasDrawingSignature = (entry: SignatureEntry) => {
  const type = entry.signature_type?.toLowerCase();
  const data = entry.signature_data.toLowerCase();
  return (
    type === 'drawn' ||
    type === 'handwritten' ||
    data.startsWith('data:image/')
  );
};

const isBlankSignaturePng = (base64: string) => {
  try {
    if (!base64) return true;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return true;
    const png = PNG.sync.read(buffer);
    const data = png.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];

      if (a < 16) {
        continue;
      }

      if (r < 240 || g < 240 || b < 240) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

const getSignatureValidityInfo = (entry?: SignatureEntry | null) => {
  if (!entry?.signature_data) return { valid: false, reason: 'missing' };
  const data = entry.signature_data.trim();
  if (!data) return { valid: false, reason: 'empty/whitespace' };
  const isImage = data.toLowerCase().startsWith('data:image/');
  if (isImage) {
    const { format, base64 } = normalizeSignatureImage(data);
    if (!base64) return { valid: false, reason: 'missing image data' };
    if (format === 'png' && isBlankSignaturePng(base64)) {
      return { valid: false, reason: 'blank image' };
    }
    const base64Length = base64.length;
    if (base64Length <= 50) {
      return { valid: false, reason: `image too small (${base64Length} chars)` };
    }
  } else if (data.length < 2) {
    return { valid: false, reason: `typed too short (${data.length} chars)` };
  }
  return { valid: true, reason: 'valid' };
};

const isValidSignature = (entry: SignatureEntry | null | undefined): boolean => {
  return getSignatureValidityInfo(entry).valid;
};

const SIGNATURE_FALLBACK_PRIORITY = [
  'employee-handbook',
  'adp-deposit',
  'fw4',
  'i9',
  'ca-de4',
  'state-tax',
  'ny-state-tax',
  'wi-state-tax',
  'az-state-tax',
  'notice-to-employee',
  'meal-waiver-6hour',
  'meal-waiver-10-12',
];

const upsertSignatureEntry = (
  map: Map<string, SignatureEntry>,
  key: string,
  entry: SignatureEntry
) => {
  if (!key) return;
  const normalizedData = normalizeSignatureData(entry.signature_data);
  if (!normalizedData) return;

  const sanitizedEntry: SignatureEntry = {
    ...entry,
    signature_data: normalizedData,
  };

  const existing = map.get(key);
  if (existing) {
    const candidateDrawn = hasDrawingSignature(sanitizedEntry);
    const existingDrawn = hasDrawingSignature(existing);

    if (candidateDrawn && !existingDrawn) {
      map.set(key, sanitizedEntry);
      return;
    }

    if (!candidateDrawn && existingDrawn) {
      return;
    }

    const existingTime = parseSignedAt(existing.signed_at);
    const candidateTime = parseSignedAt(sanitizedEntry.signed_at);

    if (candidateTime === null) {
      return;
    }

    if (existingTime === null || candidateTime >= existingTime) {
      map.set(key, sanitizedEntry);
    }
    return;
  }

  map.set(key, sanitizedEntry);
};

const isMissingFormsSignatureTableError = (error: any) => {
  const message = (error?.message || '').toString().toLowerCase();
  return (
    message.includes('forms_signature') &&
    (message.includes('does not exist') || message.includes('could not find the table'))
  );
};

const STATE_CODE_PREFIXES = new Set(['ca', 'ny', 'wi', 'az', 'nv', 'tx']);
const FIRST_PAGE_SIGNATURE_FORMS = new Set(['fw4', 'i9', 'ca-de4', 'de4', 'wi-state-tax', 'state-tax']);
const BACKGROUND_CHECK_FORM_KEYS = new Set([
  'background-waiver',
  'background-disclosure',
  'background-addon',
]);
const MEAL_WAIVER_TITLES: Record<string, string> = {
  '6_hour': '6 Hour Meal Break Waiver',
  '10_hour': '10-12 Hour Break Waiver',
  '12_hour': '10-12 Hour Break Waiver',
};

const MEAL_WAIVER_NARRATIVES: Record<string, { heading: string; paragraphs: string[] }> = {
  '6_hour': {
    heading: '6 Hour Meal Break Waiver',
    paragraphs: [
      'I understand that my employer has provided me with an unpaid meal period of at least 30 minutes in length whenever I work more than 5 hours in a workday. Although I am entitled to take this meal period on any day I choose, I hereby confirm and request that on any day in which my work schedule lasts for more than 5 hours, but no more than 6 hours, I prefer and choose to voluntarily waive my 30-minute unpaid meal period, rather than taking the meal period and then extending my workday by another thirty minutes.',
      'I understand that my waiver of the meal period is only permissible if my shift will be no more than 6 hours. I confirm that my employer has not encouraged me to skip my meal period at any time, and that I have the opportunity to take my uninterrupted 30-minute meal period on any day I wish to take it.',
    ],
  },
  '10_hour': {
    heading: '10-12 Hour Break Waiver',
    paragraphs: [
      'I understand that when I work more than 10 hours in a workday, I am entitled to a second 30-minute unpaid meal period hours. Although I am entitled to take this second meal period on any day I choose, I hereby confirm and request that on any day in which my work schedule lasts for more than 10 hours, but less than 12 hours, I prefer and choose to voluntarily waive the second 30-minute unpaid meal period, rather than taking the meal period and then extending my workday by another thirty minutes.',
      'I understand that my waiver of the second meal period is only permissible if I have properly taken my first 30-minute meal period of the workday. I understand that my waiver of the second meal period is only permissible if my shift will be less than 12 hours.',
    ],
  },
  '12_hour': {
    heading: '10-12 Hour Break Waiver',
    paragraphs: [
      'I understand that when I work more than 10 hours in a workday, I am entitled to a second 30-minute unpaid meal period hours. Although I am entitled to take this second meal period on any day I choose, I hereby confirm and request that on any day in which my work schedule lasts for more than 10 hours, but less than 12 hours, I prefer and choose to voluntarily waive the second 30-minute unpaid meal period, rather than taking the meal period and then extending my workday by another thirty minutes.',
      'I understand that my waiver of the second meal period is only permissible if I have properly taken my first 30-minute meal period of the workday. I understand that my waiver of the second meal period is only permissible if my shift will be less than 12 hours.',
    ],
  },
};

const GENERAL_MEAL_WAIVER_TERMS: string[] = [
  'I further acknowledge and understand that notwithstanding these waivers, on any day I choose to take a meal period even though my shift will be more than 5 hours but less than 6 hours, or more than 10 hours but no more than 12 hours, I may do so on that day by informing my supervisor of my choice to take a meal period.',
  'I confirm that my employer has not encouraged me to skip my meals, and that I have the opportunity to take my 30-minute meal period on any day I wish to take it. I also acknowledge that I have read this waiver and understand it, and I am voluntarily agreeing to its provisions without coercion by my employer. I further acknowledge and understand that this meal period waiver may be revoked by me at any time.',
];

const wrapTextLines = (font: PDFFont, text: string, size: number, maxWidth: number) => {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const candidateWidth = font.widthOfTextAtSize(candidate, size);

    if (candidateWidth <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    lines.push(candidate);
    currentLine = '';
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};
const CACHE_FORMAT_VERSION = 'v2';
const SIGNATURE_AUDIT_HEADER = 'x-signature-audit';
const SIGNATURE_AUDIT_VERSION = '1';
const SIGNATURE_AUDIT_VERSION_HEADER = 'x-signature-audit-version';

const isBackgroundCheckFormName = (value?: string | null) => {
  if (!value) return false;
  return BACKGROUND_CHECK_FORM_KEYS.has(value.toLowerCase());
};

function toBase64(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  // Supabase may return Buffer-like or Uint8Array for BYTEA columns
  const uint =
    data instanceof Uint8Array
      ? data
      : Array.isArray(data)
      ? Uint8Array.from(data)
      : data?.data
      ? Uint8Array.from(data.data)
      : null;
  if (!uint) return '';
  let binary = '';
  for (let i = 0; i < uint.byteLength; i++) {
    binary += String.fromCharCode(uint[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function normalizeFormKey(formName: string) {
  const lower = formName.toLowerCase();
  const parts = lower.split('-');
  if (parts.length > 1 && STATE_CODE_PREFIXES.has(parts[0])) {
    return parts.slice(1).join('-');
  }
  return lower;
}

function normalizeSignatureImage(signatureData: string) {
  const match = signatureData.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/i);
  if (!match) {
    return { format: 'png', base64: signatureData };
  }
  return {
    format: match[1].toLowerCase(),
    base64: signatureData.slice(match[0].length),
  };
}

function displayNameForForm(formName: string) {
  if (formDisplayNames[formName]) return formDisplayNames[formName];
  // Fallback: prettify key
  return formName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const formatDateLabel = (value?: string | null) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US');
};

async function fetchMealWaiversForUser(userId: string) {
  try {
    const { data: waivers, error } = await supabaseAdmin
      .from('meal_waivers')
      .select('*')
      .eq('user_id', userId)
      .order('waiver_type', { ascending: true });

    if (error) {
      console.error('[PDF_FORMS] Error fetching meal waivers:', error);
      return { waivers: [], latestUpdate: null };
    }

    if (!waivers || waivers.length === 0) {
      console.log('[PDF_FORMS] No meal waivers found for user:', userId);
      return { waivers: [], latestUpdate: null };
    }

    const latestUpdate = waivers.reduce((max, waiver) => {
      const candidates = [waiver.updated_at, waiver.created_at, waiver.signature_date];
      const candidate = candidates.find(Boolean);
      if (!candidate) return max;
      return !max || candidate > max ? candidate : max;
    }, null as string | null);

    return { waivers, latestUpdate };
  } catch (error) {
    console.error('[PDF_FORMS] Error fetching meal waivers:', error);
    return { waivers: [], latestUpdate: null };
  }
}

async function addMealWaiversToMergedPdf(mergedPdf: PDFDocument, waivers: any[]) {
  if (!waivers || waivers.length === 0) return;
  try {
    const titleFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await mergedPdf.embedFont(StandardFonts.Helvetica);

    for (const waiver of waivers) {
      const title = MEAL_WAIVER_TITLES[waiver.waiver_type] || 'Meal Period Waiver';
      const page = mergedPdf.addPage([612, 792]);
      let cursorY = 720;

      page.drawText(title, {
        x: 50,
        y: cursorY,
        size: 20,
        font: titleFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 32;

      const drawRow = (label: string, value: string) => {
        page.drawText(`${label}:`, {
          x: 50,
          y: cursorY,
          size: 12,
          font: titleFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        page.drawText(value, {
          x: 210,
          y: cursorY,
          size: 12,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
        cursorY -= 20;
      };

      drawRow('Employee Name', waiver.employee_name || 'N/A');
      drawRow('Position', waiver.position || 'N/A');
      drawRow('Waiver Type', waiver.waiver_type || 'N/A');
      drawRow('Signature Date', formatDateLabel(waiver.signature_date));
      drawRow('Acknowledged Terms', waiver.acknowledges_terms ? 'Yes' : 'No');

      cursorY -= 10;
      page.drawText('Employee Signature:', {
        x: 50,
        y: cursorY,
        size: 12,
        font: titleFont,
        color: rgb(0.2, 0.2, 0.2),
      });

      const signatureBox = { x: 50, y: cursorY - 70, width: 200, height: 60 };
      const signatureValue = waiver.employee_signature || '';

      if (signatureValue.startsWith('data:image/')) {
        try {
          const { format, base64 } = normalizeSignatureImage(signatureValue);
          const imageBytes = Buffer.from(base64, 'base64');
          const signatureImage =
            format === 'jpg' || format === 'jpeg'
              ? await mergedPdf.embedJpg(imageBytes)
              : await mergedPdf.embedPng(imageBytes);

          const scale = Math.min(
            signatureBox.width / signatureImage.width,
            signatureBox.height / signatureImage.height,
            1
          );
          const drawWidth = signatureImage.width * scale;
          const drawHeight = signatureImage.height * scale;
          const x = signatureBox.x + (signatureBox.width - drawWidth) / 2;
          const y = signatureBox.y + (signatureBox.height - drawHeight) / 2;

          page.drawImage(signatureImage, { x, y, width: drawWidth, height: drawHeight });
        } catch (imgError) {
          console.error('[PDF_FORMS] Failed to embed meal waiver signature image', imgError);
          page.drawText('Signature on file', {
            x: signatureBox.x,
            y: signatureBox.y + 20,
            size: 12,
            font: bodyFont,
            color: rgb(0, 0, 0),
          });
        }
      } else if (signatureValue) {
        page.drawText(signatureValue, {
          x: signatureBox.x,
          y: signatureBox.y + 20,
          size: 12,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
      } else {
        page.drawText('No signature captured', {
          x: signatureBox.x,
          y: signatureBox.y + 20,
          size: 12,
          font: bodyFont,
          color: rgb(0.4, 0.4, 0.4),
        });
      }

      const narrative = MEAL_WAIVER_NARRATIVES[waiver.waiver_type];
      if (narrative) {
        const textStartY = signatureBox.y - 40;
        let textPage: PDFPage = page;
        let textCursor = textStartY;
        const textX = 50;
        const textMaxWidth = 512;
        const bodyFontSize = 10;
        const bodyLineHeight = 14;
        const headingFontSize = 16;
        const headingLineHeight = 18;
        const paragraphSpacing = 10;
        const minBottomMargin = 60;

        const ensureSpace = (blockHeight: number) => {
          if (textCursor - blockHeight < minBottomMargin) {
            textPage = mergedPdf.addPage([612, 792]);
            textCursor = 720;
          }
        };

        const drawWrappedBlock = (
          content: string,
          font: PDFFont,
          fontSize: number,
          lineHeight: number,
          spacingAfter: number
        ) => {
          const lines = wrapTextLines(font, content, fontSize, textMaxWidth);
          if (!lines.length) {
            textCursor -= spacingAfter;
            return;
          }
          const blockHeight = lines.length * lineHeight;
          ensureSpace(blockHeight + spacingAfter);
          for (const line of lines) {
            textPage.drawText(line, {
              x: textX,
              y: textCursor,
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
            });
            textCursor -= lineHeight;
          }
          textCursor -= spacingAfter;
        };

        drawWrappedBlock(narrative.heading, titleFont, headingFontSize, headingLineHeight, paragraphSpacing);
        narrative.paragraphs.forEach((paragraph) => {
          drawWrappedBlock(paragraph, bodyFont, bodyFontSize, bodyLineHeight, paragraphSpacing);
        });
        drawWrappedBlock('General Terms', titleFont, 14, 16, paragraphSpacing);
        GENERAL_MEAL_WAIVER_TERMS.forEach((paragraph) => {
          drawWrappedBlock(paragraph, bodyFont, bodyFontSize, bodyLineHeight, paragraphSpacing);
        });
      }
    }
  } catch (error) {
    console.error('[PDF_FORMS] Error adding meal waivers:', error);
  }
}

async function addI9DocumentsToMergedPdf(mergedPdf: PDFDocument, userId: string) {
  let i9Docs: any | null = null;

  try {
    const { data, error } = await supabaseAdmin
      .from('i9_documents')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      console.log('[PDF_FORMS] No I-9 documents found for user:', userId);
      return;
    }

    i9Docs = data;
  } catch (error) {
    console.error('[PDF_FORMS] Error fetching I-9 documents for user:', userId, error);
    return;
  }

  const documentsToProcess = [
    {
      url: i9Docs.additional_doc_url,
      filename: i9Docs.additional_doc_filename,
      label: 'I-9 List A Document',
    },
    {
      url: i9Docs.drivers_license_url,
      filename: i9Docs.drivers_license_filename,
      label: 'I-9 List B Document',
    },
    {
      url: i9Docs.ssn_document_url,
      filename: i9Docs.ssn_document_filename,
      label: 'I-9 List C Document',
    },
  ].filter((doc) => doc.url);

  for (const doc of documentsToProcess) {
    try {
      console.log('[PDF_FORMS] Processing I-9 document:', doc.label, doc.filename);

      const response = await fetch(doc.url!);
      if (!response.ok) {
        console.error('[PDF_FORMS] Failed to fetch I-9 document:', doc.url, response.status);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const docBytes = await response.arrayBuffer();

      if (contentType.includes('pdf')) {
        try {
          const docPdf = await PDFDocument.load(docBytes);
          const copiedPages = await mergedPdf.copyPages(docPdf, docPdf.getPageIndices());

          const headerPage = mergedPdf.addPage([612, 792]);
          headerPage.drawText(doc.label, {
            x: 50,
            y: 700,
            size: 24,
            color: rgb(0, 0, 0),
          });
          if (doc.filename) {
            headerPage.drawText(`Filename: ${doc.filename}`, {
              x: 50,
              y: 660,
              size: 14,
              color: rgb(0.3, 0.3, 0.3),
            });
          }

          copiedPages.forEach((page) => {
            mergedPdf.addPage(page);
          });
          console.log('[PDF_FORMS] ✅ Added I-9 PDF document:', doc.label);
        } catch (pdfError) {
          console.error('[PDF_FORMS] Error processing I-9 PDF:', pdfError);
        }
      } else if (contentType.includes('image')) {
        try {
          const imageBytes = Buffer.from(docBytes);
          let image;

          if (contentType.includes('jpeg') || contentType.includes('jpg')) {
            image = await mergedPdf.embedJpg(imageBytes);
          } else if (contentType.includes('png')) {
            image = await mergedPdf.embedPng(imageBytes);
          } else {
            try {
              image = await mergedPdf.embedPng(imageBytes);
            } catch {
              image = await mergedPdf.embedJpg(imageBytes);
            }
          }

          const page = mergedPdf.addPage([612, 792]);
          page.drawText(doc.label, {
            x: 50,
            y: 750,
            size: 18,
            color: rgb(0, 0, 0),
          });
          if (doc.filename) {
            page.drawText(`Filename: ${doc.filename}`, {
              x: 50,
              y: 725,
              size: 12,
              color: rgb(0.3, 0.3, 0.3),
            });
          }

          const maxWidth = 512;
          const maxHeight = 650;
          const imgWidth = image.width;
          const imgHeight = image.height;

          let drawWidth = imgWidth;
          let drawHeight = imgHeight;

          if (imgWidth > maxWidth || imgHeight > maxHeight) {
            const widthRatio = maxWidth / imgWidth;
            const heightRatio = maxHeight / imgHeight;
            const scale = Math.min(widthRatio, heightRatio);
            drawWidth = imgWidth * scale;
            drawHeight = imgHeight * scale;
          }

          const x = (612 - drawWidth) / 2;
          const y = 700 - drawHeight;

          page.drawImage(image, {
            x,
            y,
            width: drawWidth,
            height: drawHeight,
          });

          console.log('[PDF_FORMS] ✅ Added I-9 image document:', doc.label);
        } catch (imgError) {
          console.error('[PDF_FORMS] Error embedding I-9 image:', imgError);
        }
      }
    } catch (docError) {
      console.error('[PDF_FORMS] Error processing I-9 document:', doc.label, docError);
    }
  }
}

async function ensureFormFieldsVisible(doc: PDFDocument, label?: string) {
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    if (fields.length === 0) return;

    const pages = doc.getPages();
    let embeddedFont: any = null;
    try {
      embeddedFont = await doc.embedFont(StandardFonts.Helvetica);
    } catch (fontError) {
      console.warn('[PDF_FORMS] Could not embed Helvetica font for', label, fontError);
    }

    let renderedValues = 0;

    for (const field of fields) {
      const widgets = field?.acroField?.getWidgets?.() ?? [];
      const isText = typeof (field as any).getText === 'function';
      const isCheckbox = typeof (field as any).isChecked === 'function';
      const textValue = isText ? String((field as any).getText?.() ?? '').trim() : '';
      const checked = isCheckbox ? !!(field as any).isChecked?.() : false;

      for (const widget of widgets) {
        const rect = widget?.getRectangle?.();
        if (!rect) continue;

        const widgetPageRef = widget?.P?.()?.toString?.();
        const targetPage =
          pages.find((page) => page.ref?.toString?.() === widgetPageRef) ?? pages[0];
        if (!targetPage) continue;

        const width = typeof rect.width === 'number' ? rect.width : 0;
        const height = typeof rect.height === 'number' ? rect.height : 12;
        const fontSize = Math.max(6, Math.min(12, Math.max(6, height - 2)));
        const drawX = (typeof rect.x === 'number' ? rect.x : 0) + 2;
        const drawY =
          (typeof rect.y === 'number' ? rect.y : 0) +
          Math.max(1, (height - fontSize) / 2);

        if (isText && textValue) {
          const widthForText = Math.max(1, width - 4);
          const maxChars = widthForText > 0 ? Math.max(1, Math.floor(widthForText / (fontSize * 0.55))) : textValue.length;
          const clipped = textValue.replace(/\s+/g, ' ').slice(0, maxChars);
          targetPage.drawText(clipped, {
            x: drawX,
            y: drawY,
            size: fontSize,
            font: embeddedFont ?? undefined,
            color: rgb(0, 0, 0),
          });
          renderedValues++;
        } else if (isCheckbox && checked) {
          const checkSize = Math.max(8, Math.min(14, height));
          const checkX = drawX + Math.max(1, (width - checkSize) / 2);
          const checkY = drawY + Math.max(0, (height - checkSize) / 2);
          targetPage.drawText('X', {
            x: checkX,
            y: checkY,
            size: checkSize,
            font: embeddedFont ?? undefined,
            color: rgb(0, 0, 0),
          });
          renderedValues++;
        }
      }
    }

    try {
      form.flatten();
    } catch (flattenError) {
      console.warn(`[PDF_FORMS] Could not flatten form ${label ?? 'document'}:`, flattenError);
    }

    if (renderedValues === 0 && process.env.NODE_ENV !== 'production') {
      console.log(`[PDF_FORMS] No interactive field values rendered for ${label ?? 'form'}`);
    }
  } catch (error) {
    console.error('[PDF_FORMS] Failed to render form fields for', label, error);
  }
}

const CACHE_DIR = join(process.cwd(), 'tmp', 'pdf-cache');

async function ensureCacheDirectory() {
  try {
    await fsPromises.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.warn('[PDF_FORMS] Could not ensure cache directory', error);
  }
}

async function tryServeCachedPdf(userId: string, sourceTimestamp: string) {
  const cachePath = join(CACHE_DIR, `${userId}.pdf`);
  const metaPath = join(CACHE_DIR, `${userId}.json`);

  if (!existsSync(cachePath) || !existsSync(metaPath)) return null;

  try {
    const metaRaw = await fsPromises.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw);
    if (meta.sourceTimestamp !== sourceTimestamp) return null;
    console.log('[PDF_FORMS] Cache hit for user:', userId, 'timestamp:', sourceTimestamp);
    return await fsPromises.readFile(cachePath);
  } catch (error) {
    console.warn('[PDF_FORMS] Failed to read cached PDF', error);
    return null;
  }
}

async function cacheMergedPdf(userId: string, pdfBytes: Uint8Array, sourceTimestamp: string) {
  const cachePath = join(CACHE_DIR, `${userId}.pdf`);
  const metaPath = join(CACHE_DIR, `${userId}.json`);

  try {
    console.log('[PDF_FORMS] Caching merged PDF for user:', userId, 'timestamp:', sourceTimestamp);
    await fsPromises.writeFile(cachePath, pdfBytes);
    await fsPromises.writeFile(
      metaPath,
      JSON.stringify({
        sourceTimestamp,
        generatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn('[PDF_FORMS] Failed to write merged PDF cache', error);
  }
}

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  return values.reduce((max: string | null, value): string | null => {
    if (!value) return max;
    return !max || value > max ? value : max;
  }, null as string | null);
}

function logElapsed(label: string, startTime: number) {
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[PDF_FORMS] ${label} completed in ${elapsedSeconds}s`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = params.userId;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get the authenticated user
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify permissions: HR/Exec/Admin OR the employee themselves
    const { data: authUserData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const role = (authUserData?.role || '').toString().trim().toLowerCase();
    const isPrivileged = role === 'exec' || role === 'admin' || role === 'hr';
    const isSelf = user.id === userId;

    if (!isPrivileged && !isSelf) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Only HR or the employee can view onboarding forms.' },
        { status: 403 }
      );
    }

    const requestStart = Date.now();
    console.log('[PDF_FORMS] Fetching forms for user:', userId);
    const startTime = Date.now();

    const formsFetchStart = Date.now();

    // Retrieve all form progress for the user
    const { data: allForms, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_name, form_data, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }); // Most recent first

    console.log(`[PDF_FORMS] ⏱️ Forms fetch took ${Date.now() - startTime}ms`);

    if (error) {
      console.error('[PDF_FORMS] Error fetching forms:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve forms', details: error.message },
        { status: 500 }
      );
    }

    logElapsed('Fetched saved PDF progress', formsFetchStart);

    if (!allForms || allForms.length === 0) {
      return NextResponse.json(
        { error: 'No forms found for this user' },
        { status: 404 }
      );
    }

    // Minimum data threshold: forms with less data are considered empty/template
    const MIN_FORM_DATA_LENGTH = 1000;

    // Normalize form key to handle both naming conventions (with and without state prefix)
    // e.g., "wi-employee-handbook" and "employee-handbook" should be treated as the same form type
    const normalizeFormKeyForDedup = (formName: string): string => {
      const lower = formName.toLowerCase();
      const parts = lower.split('-');
      // If starts with a state code, extract the base form name
      if (parts.length > 1 && STATE_CODE_PREFIXES.has(parts[0])) {
        return parts.slice(1).join('-');
      }
      return lower;
    };

    // DEBUG: Track all handbook and i9 forms for WI state debugging
    const debugForms = allForms.filter((f) => {
      const name = (f.form_name || '').toLowerCase();
      return name.includes('handbook') || name.includes('i9') || name.startsWith('wi-');
    });

    if (debugForms.length > 0) {
      console.log('[PDF_FORMS] 🔍 DEBUG - Found', debugForms.length, 'WI/handbook/i9 forms:');
      debugForms.forEach((form, idx) => {
        const formDataStr = toBase64(form.form_data);
        const dataLength = formDataStr?.length || 0;
        const dataSizeKB = (dataLength / 1024).toFixed(2);
        const isEmpty = dataLength < MIN_FORM_DATA_LENGTH;
        const normalizedKey = normalizeFormKeyForDedup(form.form_name || '');
        console.log(`[PDF_FORMS]   ${idx + 1}. "${form.form_name}" (normalized: "${normalizedKey}") | Size: ${dataSizeKB} KB | Updated: ${form.updated_at} | Empty: ${isEmpty}`);
      });
    }

    // Deduplicate forms: keep only the most recent non-empty version of each form type
    // Use normalized key to merge forms with/without state prefix (e.g., "employee-handbook" and "wi-employee-handbook")
    const formsByNormalizedKey = new Map<string, typeof allForms[0]>();
    const skippedEmpty: string[] = [];
    const skippedDuplicates: string[] = [];

    for (const form of allForms) {
      const formKey = form.form_name || 'unknown';
      const normalizedKey = normalizeFormKeyForDedup(formKey);
      const formDataStr = toBase64(form.form_data);
      const formDataLength = formDataStr?.length || 0;
      const isHandbookOrI9 = normalizedKey.includes('handbook') || normalizedKey.includes('i9');

      // Skip forms with empty or very small data (likely empty/template PDFs)
      if (formDataLength < MIN_FORM_DATA_LENGTH) {
        if (isHandbookOrI9) {
          console.log(`[PDF_FORMS] 🔍 DEBUG - Skipping EMPTY "${formKey}" (${(formDataLength / 1024).toFixed(2)} KB < ${(MIN_FORM_DATA_LENGTH / 1024).toFixed(2)} KB threshold)`);
        }
        skippedEmpty.push(formKey);
        continue;
      }

      // Skip background check forms
      if (isBackgroundCheckFormName(formKey)) {
        continue;
      }

      // Keep only the first (most recent) non-empty entry for each normalized form type
      // This handles both "employee-handbook" and "wi-employee-handbook" as the same form
      if (!formsByNormalizedKey.has(normalizedKey)) {
        if (isHandbookOrI9) {
          console.log(`[PDF_FORMS] 🔍 DEBUG - KEEPING "${formKey}" (normalized: "${normalizedKey}") (${(formDataLength / 1024).toFixed(2)} KB, updated: ${form.updated_at})`);
        }
        formsByNormalizedKey.set(normalizedKey, form);
      } else {
        if (isHandbookOrI9) {
          const keptForm = formsByNormalizedKey.get(normalizedKey);
          console.log(`[PDF_FORMS] 🔍 DEBUG - Skipping DUPLICATE "${formKey}" (normalized: "${normalizedKey}") (${(formDataLength / 1024).toFixed(2)} KB, updated: ${form.updated_at}) - Already have "${keptForm?.form_name}" from ${keptForm?.updated_at}`);
        }
        skippedDuplicates.push(formKey);
      }
    }

    if (skippedEmpty.length > 0) {
      console.log('[PDF_FORMS] Skipped empty/small forms:', [...new Set(skippedEmpty)]);
    }

    if (skippedDuplicates.length > 0) {
      console.log('[PDF_FORMS] Skipped duplicate forms (kept most recent):', skippedDuplicates);
    }

    // DEBUG: Show final selected handbook/i9 forms
    const selectedDebugForms = Array.from(formsByNormalizedKey.values()).filter((f) => {
      const name = (f.form_name || '').toLowerCase();
      return name.includes('handbook') || name.includes('i9');
    });
    if (selectedDebugForms.length > 0) {
      console.log('[PDF_FORMS] 🔍 DEBUG - FINAL selected handbook/i9 forms:');
      selectedDebugForms.forEach((form) => {
        const formDataStr = toBase64(form.form_data);
        const dataSizeKB = ((formDataStr?.length || 0) / 1024).toFixed(2);
        console.log(`[PDF_FORMS]   ✅ "${form.form_name}" | Size: ${dataSizeKB} KB | Updated: ${form.updated_at}`);
      });
    }

    // Convert map back to array, maintaining order by form type
    const forms = Array.from(formsByNormalizedKey.values());

    if (forms.length === 0) {
      return NextResponse.json(
        { error: 'No valid forms found for this user (all forms were empty or duplicates)' },
        { status: 404 }
      );
    }

    console.log('[PDF_FORMS] Processing', forms.length, 'unique non-empty forms');

    const formsToProcess = forms;
    if (formsToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No onboarding forms available for download' },
        { status: 404 }
      );
    }

    const { data: targetUserData } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    const { data: targetProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.warn('[PDF_FORMS] Could not fetch profile state for user:', userId, profileError.message);
    }

    const normalizedUserState = (targetProfile?.state || '').toString().toLowerCase().trim();
    const isTargetStateWI = normalizedUserState === 'wi' || normalizedUserState === 'wisconsin';

    const latestFormTimestamp = maxTimestamp(forms.map((form) => form.updated_at));
    let mealWaiverLatestUpdate: string | null = null;

    const signatureSource = request.nextUrl.searchParams.get('signatureSource')?.toLowerCase() || '';
    const useFormSignatures = signatureSource === 'form_signatures' || signatureSource === 'forms_signature';
    const signatureByForm = new Map<string, SignatureEntry>();
    let latestSignatureTimestamp: string | null = null;
    let legacySignature: SignatureEntry | null = null;
    const signatureAuditEntries: SignatureAuditEntry[] = [];

    if (useFormSignatures) {
      const sigFetchStart = Date.now();
      const formIds = Array.from(new Set(formsToProcess.map((form) => form.form_name).filter(Boolean)));
      if (formIds.length > 0) {
        const tableCandidates =
          signatureSource === 'forms_signature'
            ? ['forms_signature', 'form_signatures']
            : ['form_signatures'];

        let signatures: Array<{
          form_id?: string | null;
          signature_data?: string | null;
          signature_type?: string | null;
          signed_at?: string | null;
        }> = [];
        let signatureError: any = null;
        let signatureTableUsed = 'form_signatures';

        for (const tableName of tableCandidates) {
          const { data: fetchedSignatures, error: fetchError } = await supabaseAdmin
            .from(tableName)
            .select('form_id, signature_data, signature_type, signed_at')
            .eq('user_id', userId)
            .eq('signature_role', 'employee')
            .in('form_id', formIds)
            .order('signed_at', { ascending: false });

          if (fetchError) {
            if (tableName === 'forms_signature' && isMissingFormsSignatureTableError(fetchError)) {
              console.warn('[PDF_FORMS] Table forms_signature not found, falling back to form_signatures', fetchError.message);
              continue;
            }
            signatureError = fetchError;
            break;
          }

          signatures = fetchedSignatures || [];
          signatureTableUsed = tableName;
          signatureError = null;
          break;
        }

        if (signatureError) {
          console.error('[PDF_FORMS] Error fetching form signatures:', signatureError);
          return NextResponse.json(
            { error: 'Failed to retrieve form signatures', details: signatureError.message },
            { status: 500 }
          );
        }

        if (signatures.length > 0) {
          console.log('[PDF_FORMS] Found', signatures.length, 'signatures for user', userId, `(table: ${signatureTableUsed})`);

          // Process signatures efficiently without logging each one
          signatures.forEach((signature) => {
            const formId = signature?.form_id;
            if (!formId || !signature.signature_data) return;
            const entry: SignatureEntry = {
              signature_data: signature.signature_data,
              signature_type: signature.signature_type,
              signed_at: signature.signed_at,
            };
            const normalizedFormId = normalizeFormKey(formId);
            upsertSignatureEntry(signatureByForm, formId, entry);
            if (normalizedFormId !== formId) {
              upsertSignatureEntry(signatureByForm, normalizedFormId, entry);
            }
          });
          console.log('[PDF_FORMS] Created signature map with', signatureByForm.size, 'unique form mappings');
          console.log('[PDF_FORMS] 🔍 SIGNATURE VALIDITY CHECK:');
          for (const [formKey, sigEntry] of signatureByForm.entries()) {
            const dataPreview = sigEntry.signature_data?.substring(0, 80) || '(empty)';
            const isImage = sigEntry.signature_data?.toLowerCase().startsWith('data:image/') || false;
            const reportedLength = isImage
              ? sigEntry.signature_data?.split(',')[1]?.length || 0
              : sigEntry.signature_data?.trim().length || 0;
            const validityInfo = getSignatureValidityInfo(sigEntry);
            console.log(
              `[PDF_FORMS]   "${formKey}": ${validityInfo.valid ? '✅ VALID' : '❌ INVALID'} | Type: ${
                sigEntry.signature_type || 'unknown'
              } | ${isImage ? `Image (${reportedLength} chars)` : `Text (${reportedLength} chars)`} | Reason: ${validityInfo.reason}`
            );
            if (!validityInfo.valid) {
              console.log(`[PDF_FORMS]     Preview: ${dataPreview}...`);
            }
          }
          console.log(`[PDF_FORMS] ⏱️ Signature fetch & processing took ${Date.now() - sigFetchStart}ms`);
        } else {
          console.log('[PDF_FORMS] No signatures found for user', userId, 'in table', signatureTableUsed);
          console.log(`[PDF_FORMS] ⏱️ Signature fetch took ${Date.now() - sigFetchStart}ms`);
        }
      }
    } else {
      // Legacy fallback: use the latest background check signature for all forms
      const { data: signatureData } = await supabaseAdmin
        .from('background_check_pdfs')
        .select('signature, signature_type')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (signatureData?.signature) {
        legacySignature = {
          signature_data: signatureData.signature,
          signature_type: signatureData.signature_type,
        };
      }
    }

    console.log(
      '[PDF_FORMS] Retrieved',
      formsToProcess.length,
      'forms (background check documents excluded)'
    );

    // Create a new merged PDF document
    const pdfCreateStart = Date.now();
    const mergedPdf = await PDFDocument.create();
    console.log(`[PDF_FORMS] ⏱️ PDF creation took ${Date.now() - pdfCreateStart}ms`);

    // Process each form and add to merged PDF
    const formProcessStart = Date.now();
    let totalSignatureTime = 0;
    let totalCopyTime = 0;

    for (const form of formsToProcess) {
      try {
        const base64Data = toBase64(form.form_data);
        if (!base64Data) {
          console.warn('[PDF_FORMS] Skipping form with no data:', form.form_name);
          logElapsed(`Skipped empty form ${form.form_name || 'unknown'}`, formProcessStart);
          continue;
        }

        const pdfBytes = Buffer.from(base64Data, 'base64');
        const formPdf = await PDFDocument.load(pdfBytes);

        // Flatten form fields to ensure they render consistently across all browsers
        // This converts editable form fields to static content
        const isHandbook = (form.form_name || '').toLowerCase().includes('handbook');
        try {
          const pdfForm = formPdf.getForm();
          const fields = pdfForm.getFields();

          if (fields.length > 0) {
            // For employee handbook, log field details with VALUES to debug
            if (isHandbook) {
              console.log(`[PDF_FORMS] Employee handbook has ${fields.length} form fields`);
              // Log ALL fields with their values
              fields.forEach((f, i) => {
                const name = f.getName();
                const type = f.constructor.name;
                let value = '';
                try {
                  if (type === 'PDFTextField') {
                    value = (f as any).getText() || '(empty)';
                  } else if (type === 'PDFCheckBox') {
                    value = (f as any).isChecked() ? 'checked' : 'unchecked';
                  } else if (type === 'PDFDropdown' || type === 'PDFOptionList') {
                    value = (f as any).getSelected()?.join(', ') || '(empty)';
                  }
                } catch {
                  value = '(could not read)';
                }
                console.log(`[PDF_FORMS]   Field ${i + 1}: "${name}" (${type}) = "${value}"`);
              });
            }

            // For employee handbook, manually draw text field values because
            // the standard flatten() doesn't render them properly
            if (isHandbook) {
              try {
                // Custom offset mapping for each field (in points)
                // Adjust these values to position each field correctly
                const fieldOffsets: Record<string, number> = {
                  'employee_name1': 7000,
                  'employee_initialsprev': 7000,
                  'employee_initials2prev': 7000,
                  'employee_initials3prev': 7000,
                  'acknowledgment_date1': 7000,
                  'printedName1': 7000,
                  'employee_name': 5450,
                  'employee_initials': 5450,
                  'employee_initials2': 5450,
                  'employee_initials3': 5450,
                  'acknowledgment_date': 5450,
                  'printedName': 5450,
                  'date3': 2345,
                  'printedName3': 2345,
                  'date4': 2330,
                  'date5': 7000,
                  'printedName4': 7000,
                  'date6': 7000,
                };

                const helveticaFont = await formPdf.embedFont(StandardFonts.Helvetica);
                const pages = formPdf.getPages();
                let drawnCount = 0;

                console.log(`[PDF_FORMS] Handbook has ${pages.length} pages, attempting to draw ${fields.length} fields`);

                for (const field of fields) {
                  try {
                    const fieldType = field.constructor.name;
                    const fieldName = field.getName();

                    if (fieldType === 'PDFTextField') {
                      const textField = field as any;
                      const currentValue = textField.getText();

                      if (currentValue) {
                        const widgets = textField.acroField?.getWidgets?.() || [];
                        console.log(`[PDF_FORMS] Field "${fieldName}": value="${currentValue}", widgets=${widgets.length}`);

                        for (const widget of widgets) {
                          try {
                            const rect = widget.getRectangle();
                            if (!rect) continue;

                            const widgetPageRef = widget.P?.();
                            let pageIndex = 0;
                            if (widgetPageRef) {
                              pageIndex = pages.findIndex((p: any) => p.ref === widgetPageRef);
                              if (pageIndex === -1) pageIndex = 0;
                            }

                            const page = pages[pageIndex];
                            if (!page) continue;

                            const { x, y, width, height } = rect;
                            const pageSize = page.getSize();

                            // Normalize Y coordinate if it exceeds page height
                            let normalizedY = y;
                            if (y > pageSize.height) {
                              normalizedY = y % pageSize.height;
                            }

                            const fontSize = Math.min(Math.max(height * 0.6, 8), 12);
                            const fieldOffset = fieldOffsets[fieldName] || 7000; // Use custom offset or default to 7000
                            let finalY = normalizedY + (height - fontSize) / 2 + fieldOffset;
                            let targetPage = page;
                            let targetPageIndex = pageIndex;

                            // Handle page overflow - move to previous page if Y exceeds page height
                            while (finalY > pageSize.height && targetPageIndex > 0) {
                              finalY -= pageSize.height;
                              targetPageIndex--;
                              targetPage = pages[targetPageIndex];
                            }

                            console.log(`[PDF_FORMS]   Drawing "${currentValue}" at page ${pageIndex} -> ${targetPageIndex}, x=${x}, y=${y} -> finalY=${finalY}, pageHeight=${pageSize.height}`);

                            targetPage.drawText(currentValue, {
                              x: x + 2,
                              y: finalY,
                              size: fontSize,
                              font: helveticaFont,
                              color: rgb(0, 0, 0),
                              maxWidth: width - 4,
                            });
                            drawnCount++;
                          } catch {
                            // Skip widget errors
                          }
                        }
                      }
                    }

                    if (fieldType === 'PDFCheckBox') {
                      const checkBox = field as any;
                      if (checkBox.isChecked()) {
                        const widgets = checkBox.acroField?.getWidgets?.() || [];
                        for (const widget of widgets) {
                          try {
                            const rect = widget.getRectangle();
                            if (!rect) continue;

                            const widgetPageRef = widget.P?.();
                            let pageIndex = 0;
                            if (widgetPageRef) {
                              pageIndex = pages.findIndex((p: any) => p.ref === widgetPageRef);
                              if (pageIndex === -1) pageIndex = 0;
                            }

                            const page = pages[pageIndex];
                            if (!page) continue;

                            const { x, y, width, height } = rect;
                            const pageSize = page.getSize();

                            let normalizedY = y;
                            if (y > pageSize.height) {
                              normalizedY = y % pageSize.height;
                            }

                            const checkSize = Math.min(width, height) * 0.7;
                            const fieldOffset = fieldOffsets[fieldName] || 7000; // Use custom offset or default to 7000
                            let finalY = normalizedY + (height - checkSize) / 2 + fieldOffset;
                            let targetPage = page;
                            let targetPageIndex = pageIndex;

                            // Handle page overflow - move to previous page if Y exceeds page height
                            while (finalY > pageSize.height && targetPageIndex > 0) {
                              finalY -= pageSize.height;
                              targetPageIndex--;
                              targetPage = pages[targetPageIndex];
                            }

                            targetPage.drawText('✓', {
                              x: x + (width - checkSize) / 2,
                              y: finalY,
                              size: checkSize,
                              font: helveticaFont,
                              color: rgb(0, 0, 0),
                            });
                            drawnCount++;
                          } catch {
                            // Skip
                          }
                        }
                      }
                    }
                  } catch {
                    // Ignore field errors
                  }
                }

                console.log(`[PDF_FORMS] Manually drew ${drawnCount} field values for employee handbook`);
              } catch (drawError) {
                console.log('[PDF_FORMS] Could not draw field values:', form.form_name, (drawError as Error).message);
              }
            }

            // Flatten form fields - for handbook this removes fields after manual draw,
            // for other forms this renders the values normally
            try {
              pdfForm.flatten();
            } catch {
              // Flatten may fail but continue
            }
            console.log('[PDF_FORMS] Flattened', fields.length, 'form fields for:', form.form_name);
          } else {
            console.log('[PDF_FORMS] No form fields found in:', form.form_name);
          }
        } catch (flattenError) {
          // Some PDFs may not have forms or flattening may fail - continue without flattening
          console.log('[PDF_FORMS] Could not flatten form (may not have editable fields):', form.form_name, (flattenError as Error).message);
        }

        const formPageCount = formPdf.getPageCount();

        const normalizedFormName = normalizeFormKey(form.form_name || '');
        const formNameLower = (form.form_name || '').toLowerCase();
        const directFormKey = form.form_name || normalizedFormName || 'unknown-form';
        let signatureForForm: SignatureEntry | null = null;
        let signatureSourceForm = directFormKey;

        if (useFormSignatures) {
          signatureForForm =
            signatureByForm.get(directFormKey) || signatureByForm.get(normalizedFormName) || null;
          if (signatureForForm) {
            signatureSourceForm = signatureByForm.has(directFormKey) ? directFormKey : normalizedFormName;
          }
        } else if (legacySignature) {
          signatureForForm = legacySignature;
          signatureSourceForm = 'legacy-background-check';
        }

        if (isHandbook && useFormSignatures && signatureByForm.size > 0 && !isValidSignature(signatureForForm)) {
          console.log('[PDF_FORMS] Employee handbook: signature missing or invalid, searching for fallback...');
          let foundValidSignature = false;

          for (const fallbackFormKey of SIGNATURE_FALLBACK_PRIORITY) {
            const candidateSignature = signatureByForm.get(fallbackFormKey);
            if (isValidSignature(candidateSignature)) {
              signatureForForm = candidateSignature!;
              signatureSourceForm = fallbackFormKey;
              console.log(`[PDF_FORMS] Employee handbook: using valid signature from "${fallbackFormKey}"`);
              foundValidSignature = true;
              break;
            }
          }

          if (!foundValidSignature) {
            for (const [formKey, candidateSignature] of signatureByForm.entries()) {
              if (!SIGNATURE_FALLBACK_PRIORITY.includes(formKey) && isValidSignature(candidateSignature)) {
                signatureForForm = candidateSignature;
                signatureSourceForm = formKey;
                console.log(`[PDF_FORMS] Employee handbook: using valid signature from "${formKey}" (not in priority list)`);
                foundValidSignature = true;
                break;
              }
            }
          }

          if (!foundValidSignature) {
            console.log('[PDF_FORMS] Employee handbook: no valid signature found in any form');
          }
        }

        const auditFormName = form.form_name || normalizedFormName || 'unknown-form';
        const validityInfo = getSignatureValidityInfo(signatureForForm);
        const hasData = !!signatureForForm?.signature_data?.trim();
        const isDrawing = !!signatureForForm && hasDrawingSignature(signatureForForm);
        signatureAuditEntries.push({
          formName: auditFormName,
          normalizedFormName,
          displayName: displayNameForForm(auditFormName),
          signatureType: signatureForForm?.signature_type || null,
          sourceForm: signatureSourceForm,
          hasData,
          isDrawing,
          isValid: validityInfo.valid,
          hasRealDrawing: validityInfo.valid && isDrawing,
          reason: validityInfo.reason,
        });

        console.log('[PDF_FORMS] Processing form:', form.form_name, '(', formPageCount, 'pages)');

        // If signature exists, embed it on the target page(s)
        if (signatureForForm?.signature_data) {
          const sigStart = Date.now();
          const pages = formPdf.getPages();
          const pageCount = pages.length;
          const defaultPageIndex = FIRST_PAGE_SIGNATURE_FORMS.has(normalizedFormName)
            ? 0
            : Math.max(pageCount - 1, 0);
          const isEmployeeHandbook = normalizedFormName.includes('handbook');
          const isStateTaxForm = normalizedFormName === 'state-tax' || formNameLower === 'state-tax';

          // For employee handbook, add signatures to the LAST 10 pages
          const handbookPageCount = Math.min(10, pageCount);
          const handbookEndIndex = pageCount - 1; // Last page (0-indexed)
          const handbookStartIndex = Math.max(0, pageCount - handbookPageCount); // 10 pages before the end

          // For state-tax form, place signature on the second-to-last page (previous page up)
          const stateTaxPageIndex = Math.max(pageCount - 2, 0);

          const signaturePageIndexes = isEmployeeHandbook && handbookPageCount > 0
            ? Array.from({ length: handbookPageCount }, (_, idx) => handbookStartIndex + idx)
            : isStateTaxForm
            ? [stateTaxPageIndex]
            : [defaultPageIndex];

          if (isEmployeeHandbook) {
            console.log(`[PDF_FORMS] Employee handbook (${pageCount} pages): Adding signatures to pages ${handbookStartIndex + 1}-${handbookEndIndex + 1} (last ${signaturePageIndexes.length} pages)`);
          }

          if (isStateTaxForm) {
            console.log(`[PDF_FORMS] State tax form (${pageCount} pages): Adding signature to page ${stateTaxPageIndex + 1} (second-to-last page)`);
          }

          try {
            const signatureValue = signatureForForm.signature_data;
            const signatureKind = (signatureForForm.signature_type || '').toString().toLowerCase();
            const isTyped = signatureKind === 'typed' || signatureKind === 'type';
            const isDataUrl = signatureValue.startsWith('data:image/');

            // Embed signature image once before the loop (more efficient for multi-page signatures like employee handbook)
            let signatureImage: PDFImage | null = null;
            if (!isTyped) {
              const { format, base64 } = normalizeSignatureImage(signatureValue);
              const imageBytes = Buffer.from(base64, 'base64');
              signatureImage =
                format === 'jpg' || format === 'jpeg'
                  ? await formPdf.embedJpg(imageBytes)
                  : await formPdf.embedPng(imageBytes);
            }

            const signatureWidth = 150;
            const signatureHeight = 15;
            const isI9Form = normalizedFormName === 'i9';
            const isFW4Form = normalizedFormName === 'fw4';
            const isNoticeToEmployee = normalizedFormName === 'notice-to-employee';
            const isCaDE4Form = normalizedFormName === 'ca-de4' || normalizedFormName === 'de4';
            const isWIStateTax =
              normalizedFormName === 'wi-state-tax' ||
              (normalizedFormName === 'state-tax' && isTargetStateWI) ||
              formNameLower === 'wi-state-tax';

            for (const pageIdx of signaturePageIndexes) {
              const page = pages[pageIdx];
              const { width, height } = page.getSize();

              const baseX = width - signatureWidth - 50;
              const baseY = isI9Form ? 100 : 50;
              const fw4OffsetX = isFW4Form ? -200 : 0;
              const fw4OffsetY = isFW4Form ? 70 : 0;
              const caDE4OffsetX = isCaDE4Form ? -300 : 0;
              const caDE4OffsetY = isCaDE4Form ? 320 : 0;
              const i9DateFieldY = Math.max(0, height - signatureHeight - 160);
              const i9OffsetX = isI9Form ? -400 : 0;
              const noticeToEmployeeOffsetX = isNoticeToEmployee ? -120 : 0;
              const noticeToEmployeeOffsetY = isNoticeToEmployee ? 180 : 0;
              const wiStateTaxOffsetX = isWIStateTax ? -450 : 0;
              const wiStateTaxOffsetY = isWIStateTax ? 480 : 0;
              const stateTaxOffsetX = isStateTaxForm && !isWIStateTax ? -200 : 0;
              const stateTaxOffsetY = isStateTaxForm && !isWIStateTax ? 400 : 0;
              const x = Math.max(
                0,
                baseX + fw4OffsetX + i9OffsetX + 30 + noticeToEmployeeOffsetX + wiStateTaxOffsetX + caDE4OffsetX + stateTaxOffsetX
              );
              const y = isI9Form
                ? Math.max(0, i9DateFieldY - 200)
                : Math.min(
                    height - signatureHeight,
                    baseY + fw4OffsetY + noticeToEmployeeOffsetY + wiStateTaxOffsetY + caDE4OffsetY + stateTaxOffsetY
                  );

              if (isTyped && !isDataUrl) {
                page.drawText(signatureValue, {
                  x,
                  y: y + signatureHeight / 2,
                  size: 10,
                });
              } else if (signatureImage) {
                page.drawImage(signatureImage, {
                  x,
                  y,
                  width: signatureWidth,
                  height: signatureHeight,
                });
              }

              page.drawText('Digitally Signed:', {
                x,
                y: y + signatureHeight + 5,
                size: 8,
              });
            }
          } catch (imgError) {
            console.error('[PDF_FORMS] ? Error embedding signature on form:', form.form_name, imgError);
          }
          totalSignatureTime += (Date.now() - sigStart);
        }

        // Copy all pages from this form to the merged PDF
        const copyStart = Date.now();
        const pageIndicesToCopy = formPdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(formPdf, pageIndicesToCopy);

        copiedPages.forEach((page, index) => {
          mergedPdf.addPage(page);
        });

        totalCopyTime += (Date.now() - copyStart);
        console.log('[PDF_FORMS] ✅ Added', copiedPages.length, 'pages from', form.form_name, '- Total:', mergedPdf.getPageCount(), 'pages');

      } catch (formError) {
        console.error('[PDF_FORMS] Error processing form:', form.form_name, formError);
        logElapsed(`Failed processing form ${form.form_name || 'unknown'}`, formProcessStart);
      }
    }

    console.log(`[PDF_FORMS] ⏱️ Form processing took ${Date.now() - formProcessStart}ms (Signatures: ${totalSignatureTime}ms, Copying: ${totalCopyTime}ms)`);

    // Add meal waivers to the merged PDF
    const mealWaiverStart = Date.now();
    console.log('[PDF_FORMS] Adding meal waivers for user:', userId);
    const { waivers: mealWaivers, latestUpdate } = await fetchMealWaiversForUser(userId);
    mealWaiverLatestUpdate = latestUpdate;
    await addMealWaiversToMergedPdf(mergedPdf, mealWaivers);
    console.log(`[PDF_FORMS] ⏱️ Meal waivers took ${Date.now() - mealWaiverStart}ms`);

    // Add I-9 supporting documents (List A, B, C) to the merged PDF
    const i9Start = Date.now();
    console.log('[PDF_FORMS] Adding I-9 supporting documents for user:', userId);
    await addI9DocumentsToMergedPdf(mergedPdf, userId);
    console.log(`[PDF_FORMS] ⏱️ I-9 documents took ${Date.now() - i9Start}ms`);

    // Save the merged PDF
    const latestSourceTimestamp =
      maxTimestamp([latestFormTimestamp, mealWaiverLatestUpdate, latestSignatureTimestamp]) ||
      new Date().toISOString();
    const saveStart = Date.now();
    const mergedPdfBytes = await mergedPdf.save();
    console.log(`[PDF_FORMS] ⏱️ PDF save took ${Date.now() - saveStart}ms, size: ${(mergedPdfBytes.length / 1024 / 1024).toFixed(2)} MB`);

    const cacheStart = Date.now();
    await cacheMergedPdf(userId, mergedPdfBytes, latestSourceTimestamp);
    logElapsed('Cached merged PDF', cacheStart);

    const userName = targetUserData?.full_name || 'User';
    const fileName = `${userName.replace(/\s+/g, '_')}_Onboarding_Documents.pdf`;

    // Return the merged PDF as a downloadable file
    const pdfBuffer = Buffer.from(mergedPdfBytes);

    const totalTime = Date.now() - startTime;
    console.log(`[PDF_FORMS] ✅ TOTAL TIME: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s) - Generated ${mergedPdf.getPageCount()} pages`);

    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pdfBuffer.length.toString(),
      'Cache-Control': 'no-store',
    };

    if (signatureAuditEntries.length > 0) {
      responseHeaders[SIGNATURE_AUDIT_HEADER] = Buffer.from(JSON.stringify(signatureAuditEntries)).toString('base64');
      responseHeaders[SIGNATURE_AUDIT_VERSION_HEADER] = SIGNATURE_AUDIT_VERSION;
    }

    return new NextResponse(pdfBuffer, {
      headers: responseHeaders,
      status: 200,
    });
  } catch (error: any) {
    console.error('[PDF_FORMS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
