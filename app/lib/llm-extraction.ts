import Anthropic from '@anthropic-ai/sdk';

type PayrollData = {
  employeeInfo: {
    name?: string;
    ssn?: string;
    employeeId?: string;
    address?: string;
    grossPay?: number;
    netPay?: number;
    hourlyRate?: number;
    ytdGross?: number;
    ytdNet?: number;
    payPeriod?: { start: string; end: string };
    payDate?: string;
    checkNumber?: string;
  };
  statutoryDeductions: {
    federalIncome?: { thisPeriod: number; yearToDate: number };
    socialSecurity?: { thisPeriod: number; yearToDate: number };
    medicare?: { thisPeriod: number; yearToDate: number };
    californiaStateIncome?: { thisPeriod: number; yearToDate: number };
    californiaStateDI?: { thisPeriod: number; yearToDate: number };
    wisconsinStateIncome?: { thisPeriod: number; yearToDate: number };
    wisconsinStateDI?: { thisPeriod: number; yearToDate: number };
    arizonaStateIncome?: { thisPeriod: number; yearToDate: number };
  };
  voluntaryDeductions: {
    miscNonTaxableDeduction?: { thisPeriod: number; yearToDate: number };
  };
  netPayAdjustments: {
    miscReimbursement?: { thisPeriod: number; yearToDate: number };
  };
  earnings: {
    regular?: number;
    overtime?: number;
    doubleTime?: number;
  };
  hours: {
    regular?: number;
    overtime?: number;
    doubleTime?: number;
    total?: number;
  };
  allExtractedData?: Record<string, any>;
};

const EXTRACTION_PROMPT = `You are an expert payroll data extraction system. Your job is to carefully scan paystub text and extract EVERY piece of data.

CRITICAL INSTRUCTIONS FOR PAY PERIOD DATES:
- **Pay Period**: Search for pay period dates with ANY of these variations:
  - "Pay Period: MM/DD/YYYY to MM/DD/YYYY"
  - "Period Starting: MM/DD/YYYY" and "Period Ending: MM/DD/YYYY"
  - "Period Start: MM/DD/YYYY" and "Period End: MM/DD/YYYY"
  - "Start Date: MM/DD/YYYY" and "End Date: MM/DD/YYYY"
  - "Period: MM/DD/YYYY - MM/DD/YYYY"
- Extract both start and end dates carefully

CRITICAL INSTRUCTIONS FOR MANDATORY DEDUCTIONS:
- **Medicare**: Search for ANY variation: "Medicare", "Med", "Med Tax", "FICA Med", "Medicare EE", "Medicare Employee", "FICA Medicare", etc.
- **Social Security**: Search for ANY variation: "Social Security", "SS Tax", "OASDI", "Soc Sec", etc.
- **Federal Income Tax**: Search for: "Federal Income", "Fed Income Tax", "FIT", "Federal Withholding", etc.
- **State Income Tax**: MANDATORY for most states (except those listed below)
  - First identify the STATE from employee address or pay location
  - States with NO state income tax (exempt): NV, WY, SD, TX, FL, AK, TN, NH, WA
  - If state is one of the exempt states above, state income tax will be ABSENT - this is CORRECT
  - If state is NOT exempt, search exhaustively for state income tax: "State Tax", "CA State Income", "WI State Tax", "AZ State Tax", "State Withholding", etc.
  - State tax is critical - search thoroughly if not an exempt state

SEARCH STRATEGY:
1. Scan the ENTIRE text line by line
2. Look for deduction labels (Federal, Social Security, Medicare, State, etc.)
3. Look for currency amounts ($50.00 or 50.00 or (50.00) for negative)
4. Match labels to their amounts (usually on same line or next line)
5. Amounts typically come in pairs: Current Period, then Year to Date

Return a JSON object with this EXACT structure:

{
  "employeeInfo": {
    "name": "Full employee name",
    "ssn": "XXX-XX-XXXX format",
    "employeeId": "employee ID",
    "address": "full address",
    "accountNumber": "account number if present",
    "grossPay": 0.00,
    "netPay": 0.00,
    "hourlyRate": 0.00,
    "ytdGross": 0.00,
    "ytdNet": 0.00,
    "payPeriod": {"start": "MM/DD/YYYY", "end": "MM/DD/YYYY"},
    "payDate": "MM/DD/YYYY",
    "checkNumber": "check number"
  },
  "statutoryDeductions": {
    "federalIncome": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "socialSecurity": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "medicare": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "californiaStateIncome": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "californiaStateDI": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "wisconsinStateIncome": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "wisconsinStateDI": {"thisPeriod": 0.00, "yearToDate": 0.00},
    "arizonaStateIncome": {"thisPeriod": 0.00, "yearToDate": 0.00}
  },
  "voluntaryDeductions": {
    "miscNonTaxableDeduction": {"thisPeriod": 0.00, "yearToDate": 0.00}
  },
  "netPayAdjustments": {
    "miscReimbursement": {"thisPeriod": 0.00, "yearToDate": 0.00}
  },
  "earnings": {
    "regular": 0.00,
    "overtime": 0.00,
    "doubleTime": 0.00
  },
  "hours": {
    "regular": 0.0,
    "overtime": 0.0,
    "doubleTime": 0.0,
    "total": 0.0
  }
}

EXTRACTION RULES:
1. **Medicare is MANDATORY** - Search the entire text exhaustively for any Medicare variation
2. **Social Security is MANDATORY** - Search the entire text exhaustively
3. **Federal Income Tax is MANDATORY** - Search the entire text exhaustively
4. **State Income Tax is MANDATORY (except exempt states)** - Identify the state first
   - Exempt states (no income tax): NV, WY, SD, TX, FL, AK, TN, NH, WA
   - If state is NOT exempt, search exhaustively for state income tax
5. Extract BOTH amounts: thisPeriod (current pay period) AND yearToDate (YTD cumulative)
6. Negative amounts: (50.00) or -50.00 both mean -50.00
7. If field not found, use null for strings, 0 for numbers
8. SSN formats: Handle XXX-XX-XXXX, ***-**-1234, etc.
9. Dates: Be flexible with MM/DD/YYYY, MM/DD/YY, etc.
10. Return ONLY valid JSON - no markdown, no explanations, no comments

PAYSTUB TEXT:
`;

export async function extractPayrollDataWithLLM(text: string): Promise<PayrollData> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

  if (!apiKey) {
    console.warn('[LLM EXTRACTION] ANTHROPIC_API_KEY not set, falling back to regex extraction');
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const client = new Anthropic({
    apiKey,
  });

  try {
    console.log('[LLM EXTRACTION] Starting extraction with Claude...');

    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT + '\n\n' + text,
        },
      ],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const responseText = content.text;
    console.log('[LLM EXTRACTION] Raw response length:', responseText.length);

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
      console.log('[LLM EXTRACTION] Found JSON in markdown code block');
    }

    const extracted = JSON.parse(jsonText);

    // If we have Period End but no Period Start, calculate start as 13 days before end
    if (extracted.employeeInfo?.payPeriod?.end && !extracted.employeeInfo?.payPeriod?.start) {
      try {
        const endDate = new Date(extracted.employeeInfo.payPeriod.end);
        if (!isNaN(endDate.getTime())) {
          const startDate = new Date(endDate);
          startDate.setDate(startDate.getDate() - 13);
          const month = String(startDate.getMonth() + 1).padStart(2, '0');
          const day = String(startDate.getDate()).padStart(2, '0');
          const year = startDate.getFullYear();
          extracted.employeeInfo.payPeriod.start = `${month}/${day}/${year}`;
          console.log('[LLM EXTRACTION] ℹ️ Calculated Period Start (13 days before end):', extracted.employeeInfo.payPeriod.start);
        }
      } catch (err) {
        console.log('[LLM EXTRACTION] ⚠️ Failed to calculate start date from end date');
      }
    }

    // Validation and logging
    console.log('[LLM EXTRACTION] ✓ Successfully extracted data');
    console.log('[LLM EXTRACTION] Employee Name:', extracted.employeeInfo?.name || 'NOT FOUND');
    console.log('[LLM EXTRACTION] Pay Period:', extracted.employeeInfo?.payPeriod ? `${extracted.employeeInfo.payPeriod.start} - ${extracted.employeeInfo.payPeriod.end}` : 'NOT FOUND');
    console.log('[LLM EXTRACTION] Federal Income:', extracted.statutoryDeductions?.federalIncome || 'NOT FOUND');
    console.log('[LLM EXTRACTION] Social Security:', extracted.statutoryDeductions?.socialSecurity || 'NOT FOUND');
    console.log('[LLM EXTRACTION] Medicare:', extracted.statutoryDeductions?.medicare || '⚠️ NOT FOUND');

    // Warn if Medicare is missing
    if (!extracted.statutoryDeductions?.medicare?.thisPeriod) {
      console.warn('[LLM EXTRACTION] ⚠️ WARNING: Medicare not extracted! This may indicate an issue.');
      console.warn('[LLM EXTRACTION] Input text preview:', text.substring(0, 500));
    }

    return extracted as PayrollData;
  } catch (error: any) {
    console.error('[LLM EXTRACTION] Error:', error.message);
    throw error;
  }
}

// Helper function to merge LLM extraction with fallback regex extraction
export function mergeLLMWithFallback(
  llmData: PayrollData | null,
  fallbackData: PayrollData
): PayrollData {
  if (!llmData) return fallbackData;

  // LLM data is generally more reliable, but use fallback for missing fields
  return {
    employeeInfo: {
      ...fallbackData.employeeInfo,
      ...llmData.employeeInfo,
    },
    statutoryDeductions: {
      ...fallbackData.statutoryDeductions,
      ...llmData.statutoryDeductions,
    },
    voluntaryDeductions: {
      ...fallbackData.voluntaryDeductions,
      ...llmData.voluntaryDeductions,
    },
    netPayAdjustments: {
      ...fallbackData.netPayAdjustments,
      ...llmData.netPayAdjustments,
    },
    earnings: {
      ...fallbackData.earnings,
      ...llmData.earnings,
    },
    hours: {
      ...fallbackData.hours,
      ...llmData.hours,
    },
    allExtractedData: fallbackData.allExtractedData,
  };
}
