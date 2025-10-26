import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // Note: Saved progress is handled by PDFFormEditor component via /api/pdf-form-progress/retrieve
    // This route returns a fresh PDF template with navigation buttons
    const pdfPath = join(process.cwd(), 'fw4.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Save and return the PDF
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="FW4_Federal_Tax_Form.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('FW4 PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate FW4 PDF', details: error.message },
      { status: 500 }
    );
  }
}
