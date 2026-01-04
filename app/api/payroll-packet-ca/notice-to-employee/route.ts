import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), 'LC_2810.5_Notice to Employee.pdf');
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="LC_2810.5_Notice_to_Employee.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    });
  } catch (error: any) {
    console.error('Notice to Employee PDF error:', error);
    return NextResponse.json({ error: 'Failed to serve Notice to Employee PDF', details: error.message }, { status: 500 });
  }
}
