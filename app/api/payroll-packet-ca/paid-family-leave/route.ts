import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '10_Paid Family Leave_de2511d.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Paid_Family_Leave.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });
  } catch (error: any) {
    console.error('Paid Family Leave PDF error:', error);
    return NextResponse.json({ error: 'Failed to serve Paid Family Leave PDF', details: error.message }, { status: 500 });
  }
}
