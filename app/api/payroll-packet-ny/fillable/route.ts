import { NextResponse } from 'next/server';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

function loadNyBasePdf() {
  const primaryPath = join(process.cwd(), 'NY State 2025 W4 form.pdf');
  const secondaryPath = join(process.cwd(), 'NY State 2025 W4 form-1.pdf');
  const fallbackPath = join(process.cwd(), 'PDS NY Payroll Packet 2025 _1_.pdf');

  const candidates = [
    { path: primaryPath, label: 'primary NY 2025 W4 file' },
    { path: secondaryPath, label: 'alternate NY 2025 W4 file (-1)' },
  ];

  for (const candidate of candidates) {
    try {
      const stats = statSync(candidate.path);
      if (stats.size > 0) {
        return readFileSync(candidate.path);
      }
      console.warn(
        `[PAYROLL-PACKET-NY] ${candidate.label} exists but is empty, checking next option. (${candidate.path})`,
      );
    } catch (error) {
      console.warn(
        `[PAYROLL-PACKET-NY] ${candidate.label} unavailable, checking next option. (${candidate.path})`,
        error,
      );
    }
  }

  try {
    return readFileSync(fallbackPath);
  } catch (fallbackError: any) {
    throw new Error(`Unable to load NY state tax PDF: ${fallbackError.message}`);
  }
}

export async function GET() {
  try {
    const existingPdfBytes = loadNyBasePdf();
    return new NextResponse(Buffer.from(existingPdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="PDS_NY_Payroll_Packet_2025_Fillable.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fillable PDF', details: error.message },
      { status: 500 },
    );
  }
}
