import { NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts, PDFArray } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '11_Sexual-Harassment-Poster_ENG.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const lastPageSize = lastPage.getSize();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const backButtonX = 50, backButtonY = 100, backButtonWidth = 100, backButtonHeight = 32;
    lastPage.drawRectangle({ x: backButtonX, y: backButtonY - 2, width: backButtonWidth, height: backButtonHeight, color: rgb(0, 0, 0), opacity: 0.1 });
    lastPage.drawRectangle({ x: backButtonX, y: backButtonY, width: backButtonWidth, height: backButtonHeight, color: rgb(0.5, 0.5, 0.5), borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
    lastPage.drawText('<< Back', { x: backButtonX + 18, y: backButtonY + 12, size: 10, color: rgb(1, 1, 1), font: helveticaFont });
    const backLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight], Border: [0, 0, 0], C: [0.5, 0.5, 0.5], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('http://localhost:3000/payroll-packet-ca/paid-family-leave') }) });
    const continueButtonX = lastPageSize.width - 150, continueButtonY = 100, continueButtonWidth = 120, continueButtonHeight = 32;
    lastPage.drawText('(Save this form before clicking)', { x: continueButtonX - 12, y: continueButtonY + continueButtonHeight + 12, size: 8, color: rgb(0.4, 0.4, 0.4), font: helveticaRegular });
    lastPage.drawRectangle({ x: continueButtonX, y: continueButtonY - 2, width: continueButtonWidth, height: continueButtonHeight, color: rgb(0, 0, 0), opacity: 0.1 });
    lastPage.drawRectangle({ x: continueButtonX, y: continueButtonY, width: continueButtonWidth, height: continueButtonHeight, color: rgb(0.25, 0.53, 0.96), borderColor: rgb(0.2, 0.45, 0.85), borderWidth: 1 });
    lastPage.drawText('Continue', { x: continueButtonX + 18, y: continueButtonY + 12, size: 10, color: rgb(1, 1, 1), font: helveticaFont });
    lastPage.drawText('>>', { x: continueButtonX + continueButtonWidth - 18, y: continueButtonY + 12, size: 11, color: rgb(1, 1, 1), font: helveticaFont });
    const continueLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [continueButtonX, continueButtonY, continueButtonX + continueButtonWidth, continueButtonY + continueButtonHeight], Border: [0, 0, 0], C: [0.25, 0.53, 0.96], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('http://localhost:3000/payroll-packet-ca/survivors-rights') }) });
    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) { annotsArray.push(pdfDoc.context.register(backLinkAnnot)); annotsArray.push(pdfDoc.context.register(continueLinkAnnot)); }
    else { lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([pdfDoc.context.register(backLinkAnnot), pdfDoc.context.register(continueLinkAnnot)])); }
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Sexual_Harassment_Poster.pdf"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
  } catch (error: any) {
    console.error('Sexual Harassment PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate Sexual Harassment PDF', details: error.message }, { status: 500 });
  }
}
