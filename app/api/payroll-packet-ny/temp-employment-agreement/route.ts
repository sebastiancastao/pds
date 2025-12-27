import { NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts, PDFArray } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf');
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
    const backLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight], Border: [0, 0, 0], C: [0.5, 0.5, 0.5], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('http://localhost:3000/payroll-packet-ny/form-viewer?form=notice-to-employee') }) });

    // CONTINUE BUTTON (Blue - continues to next form)
    const continueButtonX = lastPageSize.width - 150, continueButtonY = 100, continueButtonWidth = 120, continueButtonHeight = 32;
    lastPage.drawText('(Save this form before clicking)', { x: continueButtonX - 12, y: continueButtonY + continueButtonHeight + 12, size: 8, color: rgb(0.4, 0.4, 0.4), font: helveticaRegular });
    lastPage.drawRectangle({ x: continueButtonX, y: continueButtonY - 2, width: continueButtonWidth, height: continueButtonHeight, color: rgb(0, 0, 0), opacity: 0.1 });
    lastPage.drawRectangle({ x: continueButtonX, y: continueButtonY, width: continueButtonWidth, height: continueButtonHeight, color: rgb(0.1, 0.46, 0.82), borderColor: rgb(0.08, 0.38, 0.7), borderWidth: 1 });
    lastPage.drawText('Continue', { x: continueButtonX + 25, y: continueButtonY + 12, size: 10, color: rgb(1, 1, 1), font: helveticaFont });
    lastPage.drawText('>>', { x: continueButtonX + continueButtonWidth - 22, y: continueButtonY + 12, size: 10, color: rgb(1, 1, 1), font: helveticaFont });
    const continueLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [continueButtonX, continueButtonY, continueButtonX + continueButtonWidth, continueButtonY + continueButtonHeight], Border: [0, 0, 0], C: [0.1, 0.46, 0.82], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('http://localhost:3000/payroll-packet-ny/form-viewer?form=meal-waiver-6hour') }) });

    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) { annotsArray.push(pdfDoc.context.register(backLinkAnnot)); annotsArray.push(pdfDoc.context.register(continueLinkAnnot)); }
    else { lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([pdfDoc.context.register(backLinkAnnot), pdfDoc.context.register(continueLinkAnnot)])); }

    // Add signature fields to the last page
    const form = pdfDoc.getForm();

    // Employee signature field
    const employeeSignatureField = form.createTextField('employee_signature');
    employeeSignatureField.addToPage(lastPage, {
      x: 50,
      y: lastPageSize.height - 100,
      width: 200,
      height: 20,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Employee signature date field
    const employeeSignatureDateField = form.createTextField('employee_signature_date');
    employeeSignatureDateField.addToPage(lastPage, {
      x: 270,
      y: lastPageSize.height - 100,
      width: 100,
      height: 20,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Add labels for signature fields
    lastPage.drawText('Employee Signature:', { x: 50, y: lastPageSize.height - 85, size: 10, color: rgb(0, 0, 0), font: helveticaRegular });
    lastPage.drawText('Date:', { x: 270, y: lastPageSize.height - 85, size: 10, color: rgb(0, 0, 0), font: helveticaRegular });

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="NY_Temporary_Employment_Services_Agreement.pdf"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
  } catch (error: any) {
    console.error('NY Temp Employment Agreement PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate NY Temp Employment Agreement PDF', details: error.message }, { status: 500 });
  }
}
