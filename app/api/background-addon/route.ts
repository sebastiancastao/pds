import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // Load the Background Check Form #3 Add-on PDF
    const pdfPath = join(process.cwd(), 'Background check form #3 12.26.25 add on final approved (1).pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Get form and pages
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    console.log('[BACKGROUND ADDON] PDF loaded. Page dimensions:', { width, height });
    console.log('[BACKGROUND ADDON] No editable form fields added');

    console.log('[BACKGROUND ADDON] First page processed');

    // Add form fields to second page if it exists
    if (pages.length > 1) {
      const secondPage = pages[1];
      const { width: width2, height: height2 } = secondPage.getSize();

      console.log('[BACKGROUND ADDON] Second page processed. Dimensions:', { width: width2, height: height2 });
    }

    // Add form fields to third page if it exists
    if (pages.length > 2) {
      const thirdPage = pages[2];
      const { width: width3, height: height3 } = thirdPage.getSize();

      console.log('[BACKGROUND ADDON] Third page processed. Dimensions:', { width: width3, height: height3 });
    }

    // Keep form fields visible but update their appearance for proper rendering
    // This ensures that when flattened, the filled values will show up
    const allFields = form.getFields();
    console.log('[BACKGROUND ADDON] Processing', allFields.length, 'fields for appearance');

    // Update field appearances so they render properly when filled and flattened
    try {
      form.updateFieldAppearances();
      console.log('[BACKGROUND ADDON] Updated field appearances for proper flattening');
    } catch (err) {
      console.warn('[BACKGROUND ADDON] Could not update appearances:', err);
    }
    console.log('[BACKGROUND ADDON] Form setup complete');

    // Save and return the PDF with form fields
    const pdfBytes = await pdfDoc.save();
    console.log('[BACKGROUND ADDON] PDF saved, size:', pdfBytes.length, 'bytes');

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Background_Check_Form_3_Add_On.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('Background Add-on PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to load Background Add-on PDF', details: error.message },
      { status: 500 }

      
    );
  }
}
