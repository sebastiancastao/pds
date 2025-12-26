import { NextRequest, NextResponse } from 'next/server';
import { extractPayrollDataWithLLM } from '@/app/lib/llm-extraction';

export const dynamic = 'force-dynamic';

/**
 * Extract payroll data from plain text using LLM
 * Used for OCR-extracted text from client-side
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, pageNumber } = body;

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    console.log(`[EXTRACT-TEXT] Processing ${pageNumber ? `page ${pageNumber}` : 'text'}...`);
    console.log(`[EXTRACT-TEXT] Text length: ${text.length} characters`);

    // Try LLM extraction first
    let payrollData;
    let extractionMethod = 'llm';

    try {
      payrollData = await extractPayrollDataWithLLM(text);
      console.log(`[EXTRACT-TEXT] ✓ LLM extraction successful`);
    } catch (llmError: any) {
      console.log(`[EXTRACT-TEXT] LLM extraction failed: ${llmError.message}`);
      return NextResponse.json(
        {
          error: 'LLM extraction failed',
          details: llmError.message,
          fallbackAvailable: false
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      payrollData,
      extractionMethod,
      success: true,
    });
  } catch (err: any) {
    console.error('[EXTRACT-TEXT] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to extract text data' },
      { status: 500 }
    );
  }
}
