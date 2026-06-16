import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

// The employee signature sits on the signature line drawn below "Sincerely,".
export const HOME_VENUE_SIGNATURE_RECT = {
  x: 72,
  y: 137,
  width: 200,
  height: 28,
};

type HomeVenueLayoutOptions = {
  employeeName?: string | null;
  venueName?: string | null;
  dateText?: string | null;
};

function fitFontSize(font: PDFFont, value: string, preferredSize: number, minSize: number, maxWidth: number) {
  let size = preferredSize;
  while (size > minSize && font.widthOfTextAtSize(value, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

// The Home Venue Assignment Acknowledgment is a letter with an "I, ____" blank
// near the top and a large empty area below "Sincerely,". We fill the name into
// that blank and build the venue / signature / date block in the empty closing
// space (rather than inside the body) so nothing collides with the printed text.
export async function stampHomeVenueAssignmentLayout(
  pdfDoc: PDFDocument,
  options: HomeVenueLayoutOptions
) {
  const page = pdfDoc.getPages()[0];
  if (!page) return;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const employeeName = options.employeeName?.trim() || '';
  const venueName = options.venueName?.trim() || '';
  const dateText = options.dateText?.trim() || '';

  // Fill the employee name onto the "I, ______" acknowledgement blank.
  if (employeeName) {
    const size = fitFontSize(font, employeeName, 10.5, 8, 150);
    page.drawText(employeeName, { x: 84, y: 525, size, font, color: rgb(0, 0, 0) });
  }

  // ── Closing block, in the empty space below "Sincerely," (baseline y≈216) ──

  // Clear any legacy generated footer content (older exports stamped a Print
  // Name / Date block here) without touching "Sincerely," (y≈216) or the printed
  // page footer (y≈22). The area is otherwise blank, so this is safe.
  page.drawRectangle({ x: 40, y: 36, width: 512, height: 164, color: rgb(1, 1, 1) });

  // Assigned home venue.
  if (venueName) {
    const venueSize = fitFontSize(font, venueName, 10, 8, 320);
    page.drawText('Assigned Home Venue:', { x: 72, y: 185, size: 10, font: boldFont, color: rgb(0, 0, 0) });
    page.drawText(venueName, { x: 196, y: 185, size: venueSize, font, color: rgb(0, 0, 0) });
  }

  // Employee signature line (signature image is drawn on it by the caller).
  page.drawLine({ start: { x: 72, y: 135 }, end: { x: 300, y: 135 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
  page.drawText('Employee Signature', { x: 72, y: 121, size: 8, font, color: rgb(0.4, 0.4, 0.4) });

  // Date line.
  page.drawLine({ start: { x: 360, y: 135 }, end: { x: 540, y: 135 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
  page.drawText('Date', { x: 360, y: 121, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  if (dateText) {
    const dateSize = fitFontSize(font, dateText, 10, 8, 170);
    page.drawText(dateText, { x: 360, y: 140, size: dateSize, font, color: rgb(0, 0, 0) });
  }
}
