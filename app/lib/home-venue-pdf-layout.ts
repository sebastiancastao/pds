import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

export const HOME_VENUE_SIGNATURE_RECT = {
  x: 220,
  y: 210,
  width: 170,
  height: 18,
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

export async function stampHomeVenueAssignmentLayout(
  pdfDoc: PDFDocument,
  options: HomeVenueLayoutOptions
) {
  const pages = pdfDoc.getPages();
  const page = pages[0];
  if (!page) return;

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const employeeName = options.employeeName?.trim() || '';
  const venueName = options.venueName?.trim() || '';
  const dateText = options.dateText?.trim() || '';

  // Remove the legacy generated footer fields without covering the printed footer.
  page.drawRectangle({
    x: 35,
    y: 150,
    width: 445,
    height: 58,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
  page.drawRectangle({
    x: 325,
    y: 28,
    width: 195,
    height: 85,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });

  if (employeeName) {
    const openingSize = fitFontSize(font, employeeName, 10.5, 8, 120);
    page.drawRectangle({
      x: 78,
      y: 519,
      width: 124,
      height: 18,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
    page.drawText(employeeName, {
      x: 80,
      y: 525,
      size: openingSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  if (venueName) {
    const venueSize = fitFontSize(font, venueName, 9.5, 7.5, 280);
    page.drawRectangle({
      x: 70,
      y: 382,
      width: 470,
      height: 18,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
    page.drawText('Assigned Home Venue:', {
      x: 72,
      y: 386,
      size: 9.5,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    page.drawText(venueName, {
      x: 185,
      y: 386,
      size: venueSize,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: 185, y: 383 },
      end: { x: 470, y: 383 },
      thickness: 0.5,
      color: rgb(0.55, 0.55, 0.55),
    });
  }

  page.drawLine({
    start: { x: HOME_VENUE_SIGNATURE_RECT.x, y: 208 },
    end: { x: HOME_VENUE_SIGNATURE_RECT.x + HOME_VENUE_SIGNATURE_RECT.width, y: 208 },
    thickness: 0.5,
    color: rgb(0.55, 0.55, 0.55),
  });
  page.drawText('Employee Signature', {
    x: HOME_VENUE_SIGNATURE_RECT.x,
    y: 194,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  page.drawLine({
    start: { x: 410, y: 208 },
    end: { x: 530, y: 208 },
    thickness: 0.5,
    color: rgb(0.55, 0.55, 0.55),
  });
  page.drawText('Date', {
    x: 410,
    y: 194,
    size: 8,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  if (dateText) {
    const dateSize = fitFontSize(font, dateText, 10, 8, 120);
    page.drawText(dateText, {
      x: 410,
      y: 214,
      size: dateSize,
      font,
      color: rgb(0, 0, 0),
    });
  }
}
