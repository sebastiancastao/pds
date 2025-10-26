import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFTextField, PDFCheckBox, rgb, degrees, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // Note: Saved progress is handled by PDFFormEditor component via /api/pdf-form-progress/retrieve
    // This route returns a fresh PDF template with navigation buttons
    const pdfPath = join(process.cwd(), 'de4_State Tax Form.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Helper to support robust rotation on all viewers
    const addRotatedField = (field: PDFTextField | PDFCheckBox, options: any) => {
      field.addToPage(firstPage, {
        ...options,
        rotate: degrees(0),
      });
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0) {
        const widget = widgets[widgets.length - 1];
        widget.dict.set(PDFName.of('R'), PDFNumber.of(90));
      }
    };

    // DEMO FIELDS for CA - expand as needed after validation/testing

    // Save and return the PDF with editable fields
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="CA_DE4_State_Tax_Form_Fillable.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('CA PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fillable CA Payroll Packet PDF', details: error.message },
      { status: 500 }
    );
  }
}
