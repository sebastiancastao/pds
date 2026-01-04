import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '20. LGBTQ-Fact-Sheet_ENG.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="LGBTQ_Fact_Sheet.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });
  } catch (error: any) {
    console.error('LGBTQ Rights PDF error:', error);
    return NextResponse.json({ error: 'Failed to serve LGBTQ Rights PDF', details: error.message }, { status: 500 });
  }
}
