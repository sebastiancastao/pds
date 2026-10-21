import { NextRequest, NextResponse } from 'next/server';
import { renderBlankMealWaiverPdf, type BlankMealWaiverType } from '@/lib/meal-waiver-pdf';

// Blank (unsigned) meal waiver PDFs for the /california-forms page.
//   /api/meal-waiver/blank?type=6-hour
//   /api/meal-waiver/blank?type=10-12-hour
// Public on purpose, like the other blank packet routes: nothing about the
// caller is read or stamped on the form.

export const dynamic = 'force-dynamic';

const BLANK_TYPES: Record<string, { waiverType: BlankMealWaiverType; fileName: string }> = {
  '6-hour': { waiverType: '6_hour', fileName: 'Meal_Waiver_6_Hour.pdf' },
  '10-12-hour': { waiverType: '10_hour', fileName: 'Meal_Waiver_10_12_Hour.pdf' },
};

function bufferToBodyInit(buffer: Buffer) {
  const view = new Uint8Array(buffer);
  const arrayBuffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(arrayBuffer).set(view);
  return arrayBuffer;
}

export async function GET(request: NextRequest) {
  const type = (request.nextUrl.searchParams.get('type') || '').trim().toLowerCase();
  const config = BLANK_TYPES[type];
  if (!config) {
    return NextResponse.json(
      { error: 'Unknown meal waiver type. Use type=6-hour or type=10-12-hour.' },
      { status: 400 },
    );
  }

  try {
    const buffer = await renderBlankMealWaiverPdf(config.waiverType);
    return new NextResponse(bufferToBodyInit(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${config.fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('[MEAL-WAIVER BLANK] PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate blank meal waiver PDF', details: error?.message },
      { status: 500 },
    );
  }
}
