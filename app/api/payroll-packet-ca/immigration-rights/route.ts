import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '18. Immigration-Rights-Fact-Sheet_ENG.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Immigration_Rights_Fact_Sheet.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error: any) {
    console.error('Immigration Rights PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate Immigration Rights PDF', details: error.message }, { status: 500 });
  }
}
