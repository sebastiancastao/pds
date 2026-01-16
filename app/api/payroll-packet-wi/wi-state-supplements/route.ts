import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // Load the WI State Supplements PDF (root file provided by the business team).
    const pdfPath = join(
      process.cwd(),
      'WI State Supplements to Employee Handbook(4020941.1)-1.pdf',
    );
    const pdfBytes = readFileSync(pdfPath);

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="WI State Supplements to Employee Handbook(4020941.1)-1.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('WI State Supplements PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to load WI State Supplements PDF', details: error.message },
      { status: 500 }
    );
  }
}
