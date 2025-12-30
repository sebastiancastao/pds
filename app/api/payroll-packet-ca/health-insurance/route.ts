import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '15. health-insurance-marketplace-coverage-options-complete.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Health_Insurance_Marketplace.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error: any) {
    console.error('Health Insurance PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate Health Insurance PDF', details: error.message }, { status: 500 });
  }
}
