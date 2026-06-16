import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';

export type StateTaxCode = 'az' | 'ca' | 'ny' | 'wi';

type StateTaxSignatureLayout = {
  pageIndex: number;
  lineY: number;
  x1: number;
  x2: number;
  maxHeight: number;
};

type DrawStateTaxSignatureOptions = {
  pdfDoc: PDFDocument;
  stateCode: StateTaxCode;
  signatureData?: string | null;
  signatureType?: string | null;
};

const STATE_TAX_SIGNATURE_LAYOUTS: Record<StateTaxCode, StateTaxSignatureLayout> = {
  ca: {
    pageIndex: 0,
    x1: 135.873,
    x2: 431,
    lineY: 373.3882,
    maxHeight: 22,
  },
  az: {
    pageIndex: 0,
    x1: 90,
    x2: 398.25,
    lineY: 451.3003,
    maxHeight: 28,
  },
  wi: {
    pageIndex: 0,
    x1: 68.4,
    x2: 295.2,
    lineY: 510.48,
    maxHeight: 22,
  },
  ny: {
    pageIndex: 0,
    x1: 110,
    x2: 410,
    lineY: 444.5,
    maxHeight: 18,
  },
};

const STATE_NAME_TO_CODE: Record<string, StateTaxCode> = {
  arizona: 'az',
  california: 'ca',
  'new york': 'ny',
  wisconsin: 'wi',
};

function normalizeStateCode(value?: string | null): StateTaxCode | null {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'az' || normalized === 'ca' || normalized === 'ny' || normalized === 'wi') {
    return normalized;
  }
  return STATE_NAME_TO_CODE[normalized] || null;
}

export function resolveStateTaxCode(
  formName?: string | null,
  preferredState?: string | null,
): StateTaxCode | null {
  const normalizedFormName = (formName || '').trim().toLowerCase();

  if (normalizedFormName === 'ca-de4' || normalizedFormName === 'de4') {
    return 'ca';
  }

  const prefixedMatch = normalizedFormName.match(/^(az|ca|ny|wi)-state-tax$/);
  if (prefixedMatch) {
    return prefixedMatch[1] as StateTaxCode;
  }

  if (normalizedFormName === 'state-tax') {
    return normalizeStateCode(preferredState);
  }

  return null;
}

export function detectStateTaxCodeFromPdf(pdfDoc: PDFDocument): StateTaxCode | null {
  try {
    const fieldNames = new Set(pdfDoc.getForm().getFields().map((field) => field.getName()));

    if (fieldNames.has('azFirstName')) return 'az';
    if (fieldNames.has('wiFirstName')) return 'wi';
    if (fieldNames.has('Date Employee Signed') && fieldNames.has('Name 1')) return 'ca';
    if (fieldNames.has('First name and middle initial') && fieldNames.has('Your SSN')) return 'ny';
  } catch {
    // Flat or malformed PDFs cannot be identified from form fields.
  }

  return null;
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

function cropPngToVisibleInk(imageBytes: Buffer): Buffer {
  try {
    const source = PNG.sync.read(imageBytes);
    let minX = source.width;
    let minY = source.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const offset = (source.width * y + x) * 4;
        const alpha = source.data[offset + 3];
        const isVisibleInk =
          alpha > 12 &&
          (source.data[offset] < 245 ||
            source.data[offset + 1] < 245 ||
            source.data[offset + 2] < 245);

        if (!isVisibleInk) continue;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) return imageBytes;

    const padding = Math.max(4, Math.round(Math.min(source.width, source.height) * 0.025));
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(source.width - 1, maxX + padding);
    maxY = Math.min(source.height - 1, maxY + padding);

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width === source.width && height === source.height) return imageBytes;

    const cropped = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
      const sourceStart = ((minY + y) * source.width + minX) * 4;
      const sourceEnd = sourceStart + width * 4;
      source.data.copy(cropped.data, y * width * 4, sourceStart, sourceEnd);
    }

    return PNG.sync.write(cropped);
  } catch {
    return imageBytes;
  }
}

export async function drawStateTaxSignature(
  options: DrawStateTaxSignatureOptions,
): Promise<boolean> {
  const signatureValue = (options.signatureData || '').trim();
  if (!signatureValue) return false;

  await prepareStateTaxFieldsForExport(options.pdfDoc, options.stateCode);

  const layout = STATE_TAX_SIGNATURE_LAYOUTS[options.stateCode];
  const page = options.pdfDoc.getPages()[layout.pageIndex];
  if (!page) return false;

  const lineWidth = layout.x2 - layout.x1;
  const signatureKind = (options.signatureType || '').trim().toLowerCase();
  const isImageDataUrl = signatureValue.toLowerCase().startsWith('data:image/');
  const isTyped = signatureKind === 'typed' || signatureKind === 'type' || !isImageDataUrl;

  if (isTyped) {
    const font = await options.pdfDoc.embedFont(StandardFonts.Helvetica);
    let fontSize = 11;
    while (fontSize > 8 && font.widthOfTextAtSize(signatureValue, fontSize) > lineWidth - 4) {
      fontSize -= 0.5;
    }

    page.drawText(signatureValue, {
      x: layout.x1 + 2,
      y: layout.lineY + 2,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: lineWidth - 4,
    });
    return true;
  }

  const { format, base64 } = normalizeSignatureImage(signatureValue);
  const decodedImageBytes = Buffer.from(base64, 'base64');
  const imageBytes =
    format === 'jpg' || format === 'jpeg'
      ? decodedImageBytes
      : cropPngToVisibleInk(decodedImageBytes);
  const image =
    format === 'jpg' || format === 'jpeg'
      ? await options.pdfDoc.embedJpg(imageBytes)
      : await options.pdfDoc.embedPng(imageBytes);

  const scale = Math.min((lineWidth - 4) / image.width, layout.maxHeight / image.height, 1);
  const width = Math.max(1, image.width * scale);
  const height = Math.max(1, image.height * scale);

  page.drawImage(image, {
    x: layout.x1 + 2,
    y: layout.lineY - 1,
    width,
    height,
  });
  return true;
}

export async function prepareStateTaxFieldsForExport(
  pdfDoc: PDFDocument,
  stateCode: StateTaxCode,
): Promise<void> {
  if (stateCode !== 'az' && stateCode !== 'wi') return;

  try {
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    if (!fields.length) return;

    for (const field of fields) {
      const widgets = (field as any)?.acroField?.getWidgets?.() || [];
      for (const widget of widgets) {
        widget.getBorderStyle?.()?.setWidth?.(0);
        widget.dict?.set?.(PDFName.of('Border'), pdfDoc.context.obj([0, 0, 0]));
      }
      form.markFieldAsDirty(field.ref);
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
  } catch (error) {
    console.warn('[STATE_TAX_LAYOUT] Failed to remove generated field borders', {
      stateCode,
      error: error instanceof Error ? error.message : error,
    });
  }
}
