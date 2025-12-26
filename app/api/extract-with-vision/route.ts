import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type DeductionData = {
  thisPeriod: number | null;
  yearToDate: number | null;
};

type PayrollData = {
  employeeName: string | null;
  ssn: string | null;
  address: string | null;
  accountNumber: string | null;
  detectedState: string | null;
  payPeriod: { start: string; end: string } | null;
  payDate: string | null;
  deductions: {
    federalIncome: DeductionData;
    socialSecurity: DeductionData;
    medicare: DeductionData;
    stateIncome: DeductionData;
    stateDI: DeductionData;
  };
  grossPay: number | null;
  netPay: number | null;
};

const VISION_EXTRACTION_PROMPT = `You are an expert at extracting payroll data from paystub images. Analyze this paystub image and extract ALL deduction data with extreme precision.

CRITICAL INSTRUCTIONS:
1. FIRST: Identify the STATE from the employee address (look for city, state zip code format like "Phoenix, AZ 85001" or state abbreviations)
2. ALSO: Check state tax deduction labels (e.g., "CA State Income", "WI State Tax", "AZ State Tax") to confirm the state
3. Look for PAY PERIOD dates - they may be labeled as:
   - "Pay Period: MM/DD/YYYY to MM/DD/YYYY"
   - "Period Starting: MM/DD/YYYY" and "Period Ending: MM/DD/YYYY"
   - "Start Date: MM/DD/YYYY" and "End Date: MM/DD/YYYY"
   - "Period: MM/DD/YYYY - MM/DD/YYYY"
4. Look for EVERY deduction line item - Federal Income, Social Security, Medicare, State taxes, etc.
5. Each deduction typically has TWO amounts: Current Period and Year-to-Date
6. Social Security and Medicare are MANDATORY on all US paystubs - search thoroughly
7. State Income Tax detection rules:
   - States with NO state income tax: NV, WY, SD, TX, FL, AK, TN, NH, WA
   - If the state is exempt (listed above), stateIncome will be null - this is CORRECT
   - For all other states, search thoroughly for state income tax deductions
   - State income may be labeled as: "State Income Tax", "State Tax", "State Withholding", "[STATE] Income", "[STATE] State Tax"
7. Handle OCR errors: "Soc. Sec." might appear as "Soc Sec", "Medicare" as "Medicaree", etc.
8. Look in typical locations: deduction tables, tax withholding sections, earnings statements

Return a JSON object with this EXACT structure:
{
  "employeeName": "Full Name",
  "ssn": "XXX-XX-XXXX",
  "address": "Full employee address with city and state",
  "accountNumber": "Account number if present (look for 'Account', 'Account #', 'Account Number', 'Acct')",
  "detectedState": "Two-letter state code (e.g., CA, WI, AZ, TX) - MUST be uppercase",
  "payPeriod": {"start": "MM/DD/YYYY", "end": "MM/DD/YYYY"},
  "payDate": "MM/DD/YYYY",
  "deductions": {
    "federalIncome": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "socialSecurity": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "medicare": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "stateIncome": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "stateDI": {"thisPeriod": 0.00, "yearToDate": 0.00}
  },
  "grossPay": 0.00,
  "netPay": 0.00
}

EXTRACTION RULES:
- Return null for fields not found
- Amounts should be numbers (not strings)
- Be thorough - check every section of the paystub
- If you see "SS Tax" or similar, that's Social Security
- If you see "Med" or "Medicare Tax", that's Medicare
- For detectedState: Return the 2-letter state abbreviation in UPPERCASE (e.g., "CA", "WI", "AZ", "TX")
- State income tax may be labeled as "State Tax", "CA State Income", "WI State Tax", "AZ State Tax", etc.
- California also has State DI (disability insurance) - look for "CA State DI", "State Disability"
- Wisconsin does NOT have State DI
- Return ONLY valid JSON with no markdown formatting`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, pageNumber } = body;

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      );
    }

    console.log(`[VISION-EXTRACTION] Processing page ${pageNumber || 1}...`);

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: image,
              },
            },
            {
              type: 'text',
              text: VISION_EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude Vision');
    }

    const responseText = content.text;
    console.log('[VISION-EXTRACTION] Raw response:', responseText.substring(0, 500));

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
      console.log('[VISION-EXTRACTION] Found JSON in markdown code block');
    }

    const payrollData: PayrollData = JSON.parse(jsonText);

    // If we have Period End but no Period Start, calculate start as 13 days before end
    if (payrollData.payPeriod && payrollData.payPeriod.end && !payrollData.payPeriod.start) {
      try {
        const endDate = new Date(payrollData.payPeriod.end);
        if (!isNaN(endDate.getTime())) {
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 13);
          const month = String(startDate.getMonth() + 1).padStart(2, '0');
          const day = String(startDate.getDate()).padStart(2, '0');
          const year = startDate.getFullYear();
          payrollData.payPeriod.start = `${month}/${day}/${year}`;
          console.log('[VISION-EXTRACTION] ℹ️ Calculated Period Start (13 days before end):', payrollData.payPeriod.start);
        }
      } catch (err) {
        console.log('[VISION-EXTRACTION] ⚠️ Failed to calculate start date from end date');
      }
    }

    // Validation and logging
    console.log('[VISION-EXTRACTION] ✓ Successfully extracted data');
    console.log('[VISION-EXTRACTION] Employee Name:', payrollData.employeeName || 'NOT FOUND');
    console.log('[VISION-EXTRACTION] Detected State:', payrollData.detectedState || 'NOT FOUND');
    console.log('[VISION-EXTRACTION] Pay Period:', payrollData.payPeriod ? `${payrollData.payPeriod.start} - ${payrollData.payPeriod.end}` : 'NOT FOUND');
    console.log('[VISION-EXTRACTION] Federal Income:', payrollData.deductions.federalIncome.thisPeriod || 'NOT FOUND');
    console.log('[VISION-EXTRACTION] Social Security:', payrollData.deductions.socialSecurity.thisPeriod || 'NOT FOUND');
    console.log('[VISION-EXTRACTION] Medicare:', payrollData.deductions.medicare.thisPeriod || 'NOT FOUND');
    console.log('[VISION-EXTRACTION] State Income:', payrollData.deductions.stateIncome.thisPeriod || 'NOT FOUND');

    // Warn if Medicare or SS missing
    if (!payrollData.deductions.socialSecurity.thisPeriod) {
      console.warn('[VISION-EXTRACTION] ⚠️ WARNING: Social Security not extracted!');
    }
    if (!payrollData.deductions.medicare.thisPeriod) {
      console.warn('[VISION-EXTRACTION] ⚠️ WARNING: Medicare not extracted!');
    }

    return NextResponse.json({
      payrollData,
      success: true,
      extractionMethod: 'claude-vision',
    });
  } catch (error: any) {
    console.error('[VISION-EXTRACTION] Error:', error);
    return NextResponse.json(
      {
        error: 'Vision extraction failed',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
