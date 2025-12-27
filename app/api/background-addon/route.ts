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

    // Make all form fields invisible - remove their appearance streams
    // The HTML overlay will provide the visual interface
    const allFields = form.getFields();
    console.log('[BACKGROUND ADDON] Processing', allFields.length, 'fields to make invisible');

    allFields.forEach((field: any) => {
      try {
        if (field.acroField) {
          const widgets = field.acroField.getWidgets();
          widgets.forEach((widget: any) => {
            // Remove the AP (appearance) dictionary entirely
            widget.dict.delete(pdfDoc.context.obj('AP'));

            // Set the widget to have no border
            const bs = pdfDoc.context.obj({ W: 0 });
            widget.dict.set(pdfDoc.context.obj('BS'), bs);

            // Make background fully transparent
            const mk = pdfDoc.context.obj({});
            widget.dict.set(pdfDoc.context.obj('MK'), mk);
          });
        }
      } catch (err) {
        console.warn('[BACKGROUND ADDON] Could not update field:', field.getName(), err);
      }
    });

    console.log('[BACKGROUND ADDON] Made all form fields invisible');
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
