import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '17. Discrimination-is-Against-the-Law-Brochure_ENG.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Discrimination_is_Against_the_Law.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });
  } catch (error: any) {
    console.error('Discrimination Law PDF error:', error);
    return NextResponse.json({ error: 'Failed to serve Discrimination Law PDF', details: error.message }, { status: 500 });
  }
}
