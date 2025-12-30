import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), '8_de2320_UI Guide.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="UI_Guide.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error: any) {
    console.error('UI Guide PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate UI Guide PDF', details: error.message }, { status: 500 });
  }
}
