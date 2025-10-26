import { NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts, PDFArray } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '20. LGBTQ-Fact-Sheet_ENG.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const lastPageSize = lastPage.getSize();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // BACK BUTTON
    const backButtonX = 50, backButtonY = 100, backButtonWidth = 100, backButtonHeight = 32;
    lastPage.drawRectangle({ x: backButtonX, y: backButtonY - 2, width: backButtonWidth, height: backButtonHeight, color: rgb(0, 0, 0), opacity: 0.1 });
    lastPage.drawRectangle({ x: backButtonX, y: backButtonY, width: backButtonWidth, height: backButtonHeight, color: rgb(0.5, 0.5, 0.5), borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
    lastPage.drawText('<< Back', { x: backButtonX + 18, y: backButtonY + 12, size: 10, color: rgb(1, 1, 1), font: helveticaFont });
    const backLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight], Border: [0, 0, 0], C: [0.5, 0.5, 0.5], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('http://localhost:3000/payroll-packet-ca/military-rights') }) });

    // DONE BUTTON (Green - final form)
    const doneButtonX = lastPageSize.width - 150, doneButtonY = 100, doneButtonWidth = 120, doneButtonHeight = 32;
    lastPage.drawText('(Save this form before clicking)', { x: doneButtonX - 12, y: doneButtonY + doneButtonHeight + 12, size: 8, color: rgb(0.4, 0.4, 0.4), font: helveticaRegular });
    lastPage.drawRectangle({ x: doneButtonX, y: doneButtonY - 2, width: doneButtonWidth, height: doneButtonHeight, color: rgb(0, 0, 0), opacity: 0.1 });
    lastPage.drawRectangle({ x: doneButtonX, y: doneButtonY, width: doneButtonWidth, height: doneButtonHeight, color: rgb(0.2, 0.7, 0.4), borderColor: rgb(0.15, 0.6, 0.3), borderWidth: 1 });
    lastPage.drawText('Done', { x: doneButtonX + 35, y: doneButtonY + 12, size: 10, color: rgb(1, 1, 1), font: helveticaFont });
    lastPage.drawText('v', { x: doneButtonX + doneButtonWidth - 18, y: doneButtonY + 12, size: 11, color: rgb(1, 1, 1), font: helveticaFont });
    const doneLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [doneButtonX, doneButtonY, doneButtonX + doneButtonWidth, doneButtonY + doneButtonHeight], Border: [0, 0, 0], C: [0.2, 0.7, 0.4], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('http://localhost:3000/') }) });

    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) { annotsArray.push(pdfDoc.context.register(backLinkAnnot)); annotsArray.push(pdfDoc.context.register(doneLinkAnnot)); }
    else { lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([pdfDoc.context.register(backLinkAnnot), pdfDoc.context.register(doneLinkAnnot)])); }

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="LGBTQ_Fact_Sheet.pdf"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
  } catch (error: any) {
    console.error('LGBTQ Rights PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate LGBTQ Rights PDF', details: error.message }, { status: 500 });
  }
}
