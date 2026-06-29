import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from 'pdf-lib';
import { decrypt, isEncrypted } from '@/lib/encryption';

export type EmployeeInformationPdfRecord = {
  first_name?: string | null;
  last_name?: string | null;
  middle_initial?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  ssn?: string | null;
  position?: string | null;
  department?: string | null;
  manager?: string | null;
  start_date?: string | null;
  employee_id?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
  acknowledgements?: boolean | null;
  signature?: string | null;
  updated_at?: string | null;
};

type EmployeeInformationPdfOptions = {
  externalSignatureData?: string | null;
  externalSignatureType?: string | null;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 48;
const PAGE_TOP_Y = 742;
const PAGE_BOTTOM_Y = 56;
const LABEL_WIDTH = 170;
const VALUE_WIDTH = 338;
const BODY_FONT_SIZE = 11;
const BODY_LINE_HEIGHT = 14;
const ROW_GAP = 10;
const SECTION_GAP = 18;

function normalizeValue(value?: string | null) {
  return (value || '').toString().trim();
}

function formatDateValue(value?: string | null) {
  const normalized = normalizeValue(value);
  if (!normalized) return '';

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }

  return parsed.toLocaleDateString('en-US');
}

function decryptSsn(value?: string | null) {
  const normalized = normalizeValue(value);
  if (!normalized) return '';

  try {
    return isEncrypted(normalized) ? decrypt(normalized) : normalized;
  } catch {
    return normalized;
  }
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number) {
  const normalized = normalizeValue(text);
  if (!normalized) return [''];

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
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

  return lines.length ? lines : [''];
}

function isImageSignature(value: string) {
  return /^data:image\/([a-zA-Z0-9.+-]+);base64,/i.test(value);
}

async function embedSignatureImage(pdfDoc: PDFDocument, signatureData: string) {
  const match = signatureData.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;

  const format = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');

  if (!bytes.length) return null;
  if (format === 'jpg' || format === 'jpeg') {
    return pdfDoc.embedJpg(bytes);
  }
  return pdfDoc.embedPng(bytes);
}

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size = BODY_FONT_SIZE,
) {
  const lines = wrapText(font, text, size, maxWidth);

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * BODY_LINE_HEIGHT,
      size,
      font,
      color: rgb(0, 0, 0),
      maxWidth,
    });
  });

  return lines.length * BODY_LINE_HEIGHT;
}

export async function buildEmployeeInformationPdf(
  record: EmployeeInformationPdfRecord,
  options: EmployeeInformationPdfOptions = {},
) {
  const pdfDoc = await PDFDocument.create();
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_TOP_Y;

  const addPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    cursorY = PAGE_TOP_Y;
  };

  const ensureSpace = (heightNeeded: number) => {
    if (cursorY - heightNeeded < PAGE_BOTTOM_Y) {
      addPage();
    }
  };

  const drawTitle = () => {
    page.drawText('Employee Information Submission', {
      x: PAGE_MARGIN_X,
      y: cursorY,
      size: 22,
      font: titleFont,
      color: rgb(0.12, 0.12, 0.18),
    });
    cursorY -= 24;

    const updatedLabel = formatDateValue(record.updated_at) || 'N/A';
    page.drawText(`Last updated: ${updatedLabel}`, {
      x: PAGE_MARGIN_X,
      y: cursorY,
      size: 10,
      font: bodyFont,
      color: rgb(0.35, 0.35, 0.4),
    });
    cursorY -= 24;
  };

  const drawSection = (title: string) => {
    ensureSpace(32);
    page.drawText(title, {
      x: PAGE_MARGIN_X,
      y: cursorY,
      size: 14,
      font: titleFont,
      color: rgb(0.16, 0.2, 0.26),
    });
    cursorY -= 18;
    page.drawLine({
      start: { x: PAGE_MARGIN_X, y: cursorY },
      end: { x: PAGE_WIDTH - PAGE_MARGIN_X, y: cursorY },
      thickness: 0.75,
      color: rgb(0.82, 0.84, 0.88),
    });
    cursorY -= 12;
  };

  const drawRow = (label: string, value?: string | null) => {
    const normalized = normalizeValue(value);
    const displayValue = normalized || 'N/A';
    const lineCount = wrapText(bodyFont, displayValue, BODY_FONT_SIZE, VALUE_WIDTH).length;
    const rowHeight = Math.max(BODY_LINE_HEIGHT, lineCount * BODY_LINE_HEIGHT);
    ensureSpace(rowHeight + ROW_GAP);

    page.drawText(label, {
      x: PAGE_MARGIN_X,
      y: cursorY,
      size: BODY_FONT_SIZE,
      font: titleFont,
      color: rgb(0.18, 0.18, 0.2),
    });

    drawWrappedText(page, bodyFont, displayValue, PAGE_MARGIN_X + LABEL_WIDTH, cursorY, VALUE_WIDTH);
    cursorY -= rowHeight + ROW_GAP;
  };

  drawTitle();

  drawSection('Personal Details');
  drawRow('First Name', record.first_name);
  drawRow('Last Name', record.last_name);
  drawRow('Middle Initial', record.middle_initial);
  drawRow('Street Address', record.address);
  drawRow('City, State ZIP', [record.city, record.state, record.zip].map(normalizeValue).filter(Boolean).join(', '));
  drawRow('Phone', record.phone);
  drawRow('Email', record.email);
  drawRow('Date of Birth', formatDateValue(record.date_of_birth));
  drawRow('Social Security', decryptSsn(record.ssn));

  cursorY -= SECTION_GAP;
  drawSection('Employment Details');
  drawRow('Position', record.position);
  drawRow('Department', record.department);
  drawRow('Manager', record.manager);
  drawRow('Start Date', formatDateValue(record.start_date));
  drawRow('Employee ID', record.employee_id);

  cursorY -= SECTION_GAP;
  drawSection('Emergency Contact');
  drawRow('Name', record.emergency_contact_name);
  drawRow('Relationship', record.emergency_contact_relationship);
  drawRow('Phone', record.emergency_contact_phone);

  cursorY -= SECTION_GAP;
  drawSection('Acknowledgement');
  drawRow('Acknowledged', record.acknowledgements ? 'Yes' : 'No');

  const storedSignature = normalizeValue(record.signature);
  const externalSignature = normalizeValue(options.externalSignatureData);
  const signatureType = normalizeValue(options.externalSignatureType).toLowerCase();
  const signatureValue = storedSignature || externalSignature;
  const shouldDrawImageSignature =
    isImageSignature(signatureValue) ||
    ((signatureType === 'drawn' || signatureType === 'handwritten') && isImageSignature(externalSignature));

  if (shouldDrawImageSignature) {
    ensureSpace(110);
    page.drawText('Signature', {
      x: PAGE_MARGIN_X,
      y: cursorY,
      size: BODY_FONT_SIZE,
      font: titleFont,
      color: rgb(0.18, 0.18, 0.2),
    });

    const signatureImage = await embedSignatureImage(pdfDoc, signatureValue);
    if (signatureImage) {
      const maxWidth = 220;
      const maxHeight = 56;
      const scale = Math.min(maxWidth / signatureImage.width, maxHeight / signatureImage.height, 1);
      const width = signatureImage.width * scale;
      const height = signatureImage.height * scale;
      page.drawRectangle({
        x: PAGE_MARGIN_X + LABEL_WIDTH,
        y: cursorY - 8,
        width: maxWidth + 12,
        height: maxHeight + 16,
        borderColor: rgb(0.82, 0.84, 0.88),
        borderWidth: 0.75,
        color: rgb(1, 1, 1),
      });
      page.drawImage(signatureImage as PDFImage, {
        x: PAGE_MARGIN_X + LABEL_WIDTH + 6,
        y: cursorY + 16 - height,
        width,
        height,
      });
      cursorY -= 92;
    } else {
      drawRow('Signature', signatureValue);
    }
  } else {
    drawRow('Signature', signatureValue);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
