import { createClient } from '@supabase/supabase-js';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

// Shared meal-waiver PDF rendering used by:
//  - app/api/pdf-form-progress/user/[userId]/route.ts (full onboarding packet download)
//  - app/api/pdf-form-progress/user-list/[userId]/route.ts (single onboarding-form entry
//    shown/downloaded from the Employees page)
//
// Keeping this in one place means the "accepted" vs "rejected" rendering always matches
// between the /onboarding combined download and the per-employee onboarding form list.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type MealWaiverDecision = 'waived' | 'rejected';

export type MealWaiverRecord = {
  waiver_type: '6_hour' | '10_hour' | '12_hour';
  employee_name?: string | null;
  position?: string | null;
  signature_date?: string | null;
  employee_signature?: string | null;
  acknowledges_terms?: boolean | null;
  decision?: MealWaiverDecision | null;
  rejection_reason?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  [key: string]: any;
};

export const MEAL_WAIVER_TITLES: Record<string, string> = {
  '6_hour': '6 Hour Meal Break Waiver',
  '10_hour': '10-12 Hour Break Waiver',
  '12_hour': '10-12 Hour Break Waiver',
};

export const MEAL_WAIVER_NARRATIVES: Record<string, { heading: string; paragraphs: string[] }> = {
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

export const GENERAL_MEAL_WAIVER_TERMS: string[] = [
  'I further acknowledge and understand that notwithstanding these waivers, on any day I choose to take a meal period even though my shift will be more than 5 hours but less than 6 hours, or more than 10 hours but no more than 12 hours, I may do so on that day by informing my supervisor of my choice to take a meal period.',
  'I confirm that my employer has not encouraged me to skip my meals, and that I have the opportunity to take my 30-minute meal period on any day I wish to take it. I also acknowledge that I have read this waiver and understand it, and I am voluntarily agreeing to its provisions without coercion by my employer. I further acknowledge and understand that this meal period waiver may be revoked by me at any time.',
];

const REJECTION_HEADING = 'Meal Period Waiver Declined';

const rejectionParagraphs = (typeLabel: string): string[] => [
  `I do NOT waive my right to the ${typeLabel}. I have elected to take my full, uninterrupted meal period as provided by company policy and applicable law.`,
  'I understand that I may complete a new meal period waiver form at any time in the future if I choose to voluntarily waive this meal period.',
];

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

const formatDateLabel = (value?: string | null) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US');
};

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

/**
 * Fetch every meal waiver row saved for a user (both accepted/waived and rejected/declined).
 */
export async function fetchMealWaiversForUser(userId: string) {
  try {
    const { data: waivers, error } = await supabaseAdmin
      .from('meal_waivers')
      .select('*')
      .eq('user_id', userId)
      .order('waiver_type', { ascending: true });

    if (error) {
      console.error('[MEAL_WAIVER_PDF] Error fetching meal waivers:', error);
      return { waivers: [] as MealWaiverRecord[], latestUpdate: null as string | null };
    }

    if (!waivers || waivers.length === 0) {
      return { waivers: [] as MealWaiverRecord[], latestUpdate: null as string | null };
    }

    const latestUpdate = waivers.reduce((max: string | null, waiver: MealWaiverRecord) => {
      const candidates = [waiver.updated_at, waiver.created_at, waiver.signature_date];
      const candidate = candidates.find(Boolean);
      if (!candidate) return max;
      return !max || candidate > max ? candidate : max;
    }, null as string | null);

    return { waivers: waivers as MealWaiverRecord[], latestUpdate };
  } catch (error) {
    console.error('[MEAL_WAIVER_PDF] Error fetching meal waivers:', error);
    return { waivers: [] as MealWaiverRecord[], latestUpdate: null as string | null };
  }
}

/**
 * Draw one page (plus overflow pages, if needed) per waiver row onto the given PDF
 * document. Shared by the full onboarding packet merge and the standalone single-form
 * renderer used on the Employees page.
 */
export async function addMealWaiversToMergedPdf(mergedPdf: PDFDocument, waivers: MealWaiverRecord[]) {
  if (!waivers || waivers.length === 0) return;
  try {
    const titleFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await mergedPdf.embedFont(StandardFonts.Helvetica);

    for (const waiver of waivers) {
      const isRejected = waiver.decision === 'rejected';
      const baseTitle = MEAL_WAIVER_TITLES[waiver.waiver_type] || 'Meal Period Waiver';
      const title = isRejected ? `${baseTitle} — DECLINED` : baseTitle;
      const page = mergedPdf.addPage([612, 792]);
      let cursorY = 720;

      page.drawText(title, {
        x: 50,
        y: cursorY,
        size: 20,
        font: titleFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 26;

      if (isRejected) {
        page.drawText('STATUS: DECLINED — MEAL PERIOD NOT WAIVED', {
          x: 50,
          y: cursorY,
          size: 11,
          font: titleFont,
          color: rgb(0.7, 0.1, 0.1),
        });
        cursorY -= 22;
      } else {
        cursorY -= 6;
      }

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
      drawRow(
        'Decision',
        isRejected ? 'Declined — meal period will be taken' : 'Waived — meal period voluntarily given up'
      );
      if (!isRejected) {
        drawRow('Acknowledged Terms', waiver.acknowledges_terms ? 'Yes' : 'No');
      }

      cursorY -= 10;
      page.drawText(isRejected ? 'Employee Signature (declining):' : 'Employee Signature:', {
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
          console.error('[MEAL_WAIVER_PDF] Failed to embed meal waiver signature image', imgError);
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
      const typeLabelForRejection =
        waiver.waiver_type === '6_hour'
          ? '6-hour meal period'
          : 'second (10-12 hour) meal period';

      let textPage: PDFPage = page;
      let textCursor = signatureBox.y - 40;
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
        spacingAfter: number,
        color = rgb(0, 0, 0)
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
            color,
          });
          textCursor -= lineHeight;
        }
        textCursor -= spacingAfter;
      };

      if (isRejected) {
        drawWrappedBlock(REJECTION_HEADING, titleFont, headingFontSize, headingLineHeight, paragraphSpacing, rgb(0.7, 0.1, 0.1));
        rejectionParagraphs(typeLabelForRejection).forEach((paragraph) => {
          drawWrappedBlock(paragraph, bodyFont, bodyFontSize, bodyLineHeight, paragraphSpacing);
        });
        if (waiver.rejection_reason && waiver.rejection_reason.trim()) {
          drawWrappedBlock('Reason for Declining', titleFont, 12, 15, 4);
          drawWrappedBlock(waiver.rejection_reason.trim(), bodyFont, bodyFontSize, bodyLineHeight, paragraphSpacing);
        }
      } else if (narrative) {
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
    console.error('[MEAL_WAIVER_PDF] Error adding meal waivers:', error);
  }
}

/**
 * Render a standalone PDF containing just the given meal waiver row(s). Used to show/
 * download the meal waiver as its own onboarding form entry (e.g. on the Employees page)
 * instead of only as part of the full merged onboarding packet.
 */
export async function renderMealWaiversPdf(waivers: MealWaiverRecord[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  await addMealWaiversToMergedPdf(pdfDoc, waivers);
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
