import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // Note: Saved progress is handled by PDFFormEditor component via /api/pdf-form-progress/retrieve
    // This route returns a fresh PDF template with navigation buttons
    const pdfPath = join(process.cwd(), 'i-9.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Save and return the PDF
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="I-9_Employment_Eligibility_Verification.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('I-9 PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate I-9 PDF', details: error.message },
      { status: 500 }
    );
  }
}

