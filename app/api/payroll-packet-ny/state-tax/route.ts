import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

export async function GET() {
  try {
    // Read the NY State W4 PDF
    const pdfPath = path.join(process.cwd(), 'pdfs', 'NY State 2025 W4 form.pdf');
    const pdfBytes = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();

    // Clear any default selections on radio button groups
    const radioFieldsToClear = ['Status', 'Resident', 'Resident of Yonkers'];

    for (const fieldName of radioFieldsToClear) {
      try {
        const field = form.getField(fieldName);
        if (field && field.acroField) {
          // Clear the selection by setting value to /Off (standard PDF way to deselect radio buttons)
          try {
            // Get the PDFName for /Off
            const { PDFName } = await import('pdf-lib');
            (field.acroField as any).setValue(PDFName.of('Off'));
            console.log(`[NY STATE TAX API] Cleared default selection for ${fieldName} using PDFName.of('Off')`);
          } catch (e1) {
            console.warn(`[NY STATE TAX API] PDFName method failed for ${fieldName}:`, e1);
            // Try alternative: uncheck if it's a checkbox-like field
            try {
              if ('uncheck' in field) {
                (field as any).uncheck();
                console.log(`[NY STATE TAX API] Cleared ${fieldName} using uncheck()`);
              }
            } catch (e2) {
              console.warn(`[NY STATE TAX API] uncheck method failed for ${fieldName}:`, e2);
            }
          }
        }
      } catch (err) {
        console.warn(`[NY STATE TAX API] Could not clear field ${fieldName}:`, err);
      }
    }

    // Save and return the modified PDF
    const modifiedPdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(modifiedPdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="NY_State_Tax_Form.pdf"',
      },
    });
  } catch (error) {
    console.error('[NY STATE TAX API] Error processing PDF:', error);
    return NextResponse.json(
      { error: 'Failed to process NY State Tax form' },
      { status: 500 }
    );
  }
}
