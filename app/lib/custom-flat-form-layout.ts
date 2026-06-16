import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFName,
  PDFObjectCopier,
  PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import {
  HOME_VENUE_SIGNATURE_RECT,
  stampHomeVenueAssignmentLayout,
} from '@/app/lib/home-venue-pdf-layout';

export type KnownCustomFlatFormLayout =
  | 'attestation'
  | 'meal-break'
  | 'home-venue-letter'
  | 'home-venue-acknowledgment';

type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RenderKnownCustomFlatFormOptions = {
  savedPdfBytes: Uint8Array;
  templateBytes?: Uint8Array | null;
  layout: KnownCustomFlatFormLayout;
  employeeName?: string | null;
  venueName?: string | null;
  dateText?: string | null;
  signatureData?: string | null;
  signatureType?: string | null;
};

const GENERIC_LEGACY_SIGNATURE_RECT: PdfRect = {
  x: 40,
  y: 40,
  width: 200,
  height: 60,
};

const ATTESTATION_SIGNATURE_RECT: PdfRect = {
  x: 184,
  y: 305,
  width: 352,
  height: 24,
};

const MEAL_BREAK_SIGNATURE_RECT: PdfRect = {
  x: 207,
  y: 380,
  width: 130,
  height: 22,
};

const HOME_VENUE_ACK_SIGNATURE_RECT: PdfRect = {
  x: 122,
  y: 122,
  width: 136,
  height: 22,
};

function normalizeDescriptor(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getKnownCustomFlatFormLayout(
  ...descriptors: Array<string | null | undefined>
): KnownCustomFlatFormLayout | null {
  const combined = descriptors.map(normalizeDescriptor).filter(Boolean).join(' ');
  if (!combined) return null;

  if (/\battestation\b/.test(combined)) {
    return 'attestation';
  }

  if (/\bhome venue\b/.test(combined)) {
    return /\backnowledg(?:e)?ment\b/.test(combined)
      ? 'home-venue-acknowledgment'
      : 'home-venue-letter';
  }

  const mentionsMeal = /\bmeal(?:time)?\b|\bmealtime\b/.test(combined);
  const mentionsBreak = /\bbreak(?:time)?\b|\brest\b/.test(combined);
  if (mentionsMeal && mentionsBreak) {
    return 'meal-break';
  }

  return null;
}

function fitFontSize(
  font: PDFFont,
  value: string,
  maxWidth: number,
  preferredSize = 10,
  minSize = 7,
) {
  let size = preferredSize;
  while (size > minSize && font.widthOfTextAtSize(value, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

function drawTextOnPrintedLine(
  page: PDFPage,
  font: PDFFont,
  value: string,
  line: { x1: number; x2: number; y: number },
) {
  const trimmed = value.trim();
  if (!trimmed) return;

  const x = line.x1 + 4;
  const maxWidth = Math.max(10, line.x2 - x - 2);
  const size = fitFontSize(font, trimmed, maxWidth);
  page.drawText(trimmed, {
    x,
    y: line.y + 3,
    size,
    font,
    color: rgb(0, 0, 0),
    maxWidth,
  });
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

async function drawSignature(
  pdfDoc: PDFDocument,
  page: PDFPage,
  rect: PdfRect,
  signatureData: string,
  signatureType?: string | null,
) {
  const value = signatureData.trim();
  if (!value) return false;

  const normalizedType = (signatureType || '').toLowerCase();
  const isImageDataUrl = value.toLowerCase().startsWith('data:image/');
  const isTyped = normalizedType === 'typed' || normalizedType === 'type' || !isImageDataUrl;

  if (isTyped) {
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const size = fitFontSize(font, value, rect.width - 4, 12, 8);
    page.drawText(value, {
      x: rect.x + 2,
      y: rect.y + 2,
      size,
      font,
      color: rgb(0, 0, 0),
      maxWidth: rect.width - 4,
    });
    return true;
  }

  const { format, base64 } = normalizeSignatureImage(value);
  const imageBytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const signatureImage =
    format === 'jpg' || format === 'jpeg'
      ? await pdfDoc.embedJpg(imageBytes)
      : await pdfDoc.embedPng(imageBytes);
  const scale = Math.min(rect.width / signatureImage.width, rect.height / signatureImage.height);
  const width = signatureImage.width * scale;
  const height = signatureImage.height * scale;

  page.drawImage(signatureImage, {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y,
    width,
    height,
  });
  return true;
}

async function drawLegacyEmbeddedSignature(
  targetDoc: PDFDocument,
  savedDoc: PDFDocument,
  targetPage: PDFPage,
  targetRect: PdfRect,
) {
  try {
    const imageCandidate = savedDoc.context
      .enumerateIndirectObjects()
      .map(([ref, object]) => ({ ref, object: object as any }))
      .find(({ object }) => {
        const dict = object?.dict;
        if (!dict || dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') return false;

        const width = Number(dict.get(PDFName.of('Width'))?.toString() || 0);
        const height = Number(dict.get(PDFName.of('Height'))?.toString() || 0);
        const colorSpace = dict.get(PDFName.of('ColorSpace'))?.toString();
        const hasSoftMask = Boolean(dict.get(PDFName.of('SMask')));
        return (
          colorSpace === '/DeviceRGB' &&
          hasSoftMask &&
          width >= 200 &&
          height >= 40 &&
          width / Math.max(1, height) >= 2
        );
      });

    if (imageCandidate) {
      const copiedImageRef =
        targetDoc === savedDoc
          ? imageCandidate.ref
          : targetDoc.context.register(
              PDFObjectCopier.for(savedDoc.context, targetDoc.context).copy(
                imageCandidate.object,
              ),
            );
      const width = Number(
        imageCandidate.object.dict.get(PDFName.of('Width'))?.toString() || 1,
      );
      const height = Number(
        imageCandidate.object.dict.get(PDFName.of('Height'))?.toString() || 1,
      );
      const copiedImage = Object.create(PDFImage.prototype) as PDFImage;
      Object.defineProperties(copiedImage, {
        ref: { value: copiedImageRef },
        doc: { value: targetDoc },
        width: { value: width },
        height: { value: height },
      });

      const scale = Math.min(targetRect.width / width, targetRect.height / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      targetPage.drawImage(copiedImage, {
        x: targetRect.x + (targetRect.width - drawWidth) / 2,
        y: targetRect.y,
        width: drawWidth,
        height: drawHeight,
      });
      return true;
    }
  } catch (error) {
    console.warn('[CUSTOM_FLAT_FORM] Could not copy legacy signature image object', error);
  }

  const sourcePage = savedDoc.getPages().at(-1);
  if (!sourcePage) return false;

  try {
    const crop = await targetDoc.embedPage(sourcePage, {
      left: GENERIC_LEGACY_SIGNATURE_RECT.x,
      bottom: GENERIC_LEGACY_SIGNATURE_RECT.y,
      right: GENERIC_LEGACY_SIGNATURE_RECT.x + GENERIC_LEGACY_SIGNATURE_RECT.width,
      top: GENERIC_LEGACY_SIGNATURE_RECT.y + GENERIC_LEGACY_SIGNATURE_RECT.height,
    });
    const scale = Math.min(
      targetRect.width / GENERIC_LEGACY_SIGNATURE_RECT.width,
      targetRect.height / GENERIC_LEGACY_SIGNATURE_RECT.height,
    );
    const width = GENERIC_LEGACY_SIGNATURE_RECT.width * scale;
    const height = GENERIC_LEGACY_SIGNATURE_RECT.height * scale;

    targetPage.drawPage(crop, {
      x: targetRect.x + (targetRect.width - width) / 2,
      y: targetRect.y,
      width,
      height,
    });
    return true;
  } catch (error) {
    console.warn('[CUSTOM_FLAT_FORM] Could not recover legacy embedded signature', error);
    return false;
  }
}

async function clearLegacyGenericFooter(
  pdfDoc: PDFDocument,
  layout: KnownCustomFlatFormLayout,
) {
  if (layout === 'home-venue-letter') return;

  const page = pdfDoc.getPages().at(-1);
  if (!page) return;

  page.drawRectangle({
    x: 35,
    y: 28,
    width: 542,
    height: 190,
    color: rgb(1, 1, 1),
  });

  const footerY =
    layout === 'attestation'
      ? 156
      : layout === 'meal-break'
        ? 80
        : 22;
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const company = 'Print & Design Solutions';
  const details = '6161 S. Rainbow Blvd, Suite 100 & 105, Las Vegas NV 89118  Phone: (702) 846-5302';
  const companySize = 8;
  page.drawText(company, {
    x: 80,
    y: footerY,
    size: companySize,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  page.drawText(details, {
    x: 80 + boldFont.widthOfTextAtSize(company, companySize) + 6,
    y: footerY,
    size: 7.5,
    font,
    color: rgb(0, 0, 0),
  });
}

function getSignatureTarget(
  layout: KnownCustomFlatFormLayout,
  pages: PDFPage[],
): { page: PDFPage; rect: PdfRect } | null {
  if (!pages.length) return null;

  if (layout === 'home-venue-letter' || layout === 'home-venue-acknowledgment') {
    return {
      page: pages[0],
      rect:
        layout === 'home-venue-letter'
          ? HOME_VENUE_SIGNATURE_RECT
          : HOME_VENUE_ACK_SIGNATURE_RECT,
    };
  }

  const page = pages.at(-1)!;
  if (layout === 'attestation') {
    return { page, rect: ATTESTATION_SIGNATURE_RECT };
  }
  if (layout === 'meal-break') {
    return { page, rect: MEAL_BREAK_SIGNATURE_RECT };
  }
  return null;
}

async function stampKnownLines(
  pdfDoc: PDFDocument,
  layout: KnownCustomFlatFormLayout,
  options: Pick<RenderKnownCustomFlatFormOptions, 'employeeName' | 'venueName' | 'dateText'>,
) {
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const lastPage = pages.at(-1);
  if (!firstPage || !lastPage) return;

  if (layout === 'home-venue-letter') {
    await stampHomeVenueAssignmentLayout(pdfDoc, options);
    return;
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const employeeName = options.employeeName?.trim() || '';
  const venueName = options.venueName?.trim() || '';
  const dateText = options.dateText?.trim() || '';

  if (layout === 'attestation') {
    drawTextOnPrintedLine(lastPage, font, employeeName, { x1: 237, x2: 537, y: 331 });
    drawTextOnPrintedLine(lastPage, font, dateText, { x1: 101, x2: 294, y: 276 });
    return;
  }

  if (layout === 'meal-break') {
    drawTextOnPrintedLine(lastPage, font, employeeName, { x1: 215, x2: 347, y: 403 });
    drawTextOnPrintedLine(lastPage, font, dateText, { x1: 131, x2: 263, y: 352 });
    return;
  }

  drawTextOnPrintedLine(firstPage, font, employeeName, { x1: 80, x2: 200, y: 523 });
  drawTextOnPrintedLine(firstPage, font, venueName, { x1: 234, x2: 371, y: 172 });
  drawTextOnPrintedLine(firstPage, font, employeeName, { x1: 169, x2: 306, y: 146 });
  drawTextOnPrintedLine(firstPage, font, dateText, { x1: 99, x2: 236, y: 94 });
}

export async function renderKnownCustomFlatForm(
  options: RenderKnownCustomFlatFormOptions,
): Promise<Uint8Array> {
  const savedDoc = await PDFDocument.load(options.savedPdfBytes, { ignoreEncryption: true });
  const outputDoc = options.templateBytes?.length
    ? await PDFDocument.load(options.templateBytes, { ignoreEncryption: true })
    : savedDoc;

  if (!options.templateBytes?.length) {
    await clearLegacyGenericFooter(outputDoc, options.layout);
  }
  await stampKnownLines(outputDoc, options.layout, options);

  const signatureTarget = getSignatureTarget(options.layout, outputDoc.getPages());
  if (signatureTarget) {
    const signatureDrawn = options.signatureData?.trim()
      ? await drawSignature(
          outputDoc,
          signatureTarget.page,
          signatureTarget.rect,
          options.signatureData,
          options.signatureType,
        )
      : false;

    if (!signatureDrawn) {
      await drawLegacyEmbeddedSignature(
        outputDoc,
        savedDoc,
        signatureTarget.page,
        signatureTarget.rect,
      );
    }
  }

  return outputDoc.save();
}
