import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    console.log('[ADP-DEPOSIT] Starting PDF generation...');
    // Note: Saved progress is handled by PDFFormEditor component via /api/pdf-form-progress/retrieve
    // This route returns a fresh PDF template with navigation buttons
    const pdfPath = join(process.cwd(), 'ADP-Employee-Direct-Deposit-Form (1).pdf');
    console.log('[ADP-DEPOSIT] PDF path:', pdfPath);
    const existingPdfBytes = readFileSync(pdfPath);
    console.log('[ADP-DEPOSIT] PDF file read, size:', existingPdfBytes.length, 'bytes');
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    console.log('[ADP-DEPOSIT] PDF loaded successfully');

    // Save and return the PDF
    console.log('[ADP-DEPOSIT] Saving PDF...');
    const pdfBytes = await pdfDoc.save();
    console.log('[ADP-DEPOSIT] PDF saved, size:', pdfBytes.length, 'bytes');
    console.log('[ADP-DEPOSIT] Returning PDF response');
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="ADP_Direct_Deposit_Form.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('[ADP-DEPOSIT] ❌ Error:', error);
    console.error('[ADP-DEPOSIT] Stack:', error.stack);
    return NextResponse.json(
      { error: 'Failed to generate ADP Deposit PDF', details: error.message },
      { status: 500 }
    );
  }
}

