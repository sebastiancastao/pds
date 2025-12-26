import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFArray } from 'pdf-lib';
import { extractPayrollDataWithLLM } from '@/app/lib/llm-extraction';

export const dynamic = 'force-dynamic';

const PDF_HEADER_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function findPdfHeaderOffset(bytes: Uint8Array) {
  for (let i = 0; i <= bytes.length - PDF_HEADER_BYTES.length; i++) {
    let matches = true;
    for (let j = 0; j < PDF_HEADER_BYTES.length; j++) {
      if (bytes[i + j] !== PDF_HEADER_BYTES[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}

type PayrollData = Record<string, any>;

type ExtractResponse = {
  text?: string;
  payrollData?: PayrollData;
  payrollDataByPage?: Array<{
    pageNumber: number;
    text: string;
    payrollData: PayrollData;
    extractionMethod?: 'llm' | 'regex' | 'hybrid';
  }>;
  metadata?: {
    pageCount?: number;
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
  };
  debug?: {
    textLength?: number;
    isImageBased?: boolean;
    pagesWithData?: number;
    hasEmployeeInfo?: boolean;
    hasEarnings?: boolean;
    hasHours?: boolean;
    allExtractedDataCount?: number;
    ocrPerformed?: boolean;
    ocrSuccess?: boolean;
    ocrError?: string;
  };
};

type PdfStatus = 'pending' | 'extracting' | 'done' | 'error';

type PdfProcessItem = {
  id: string;
  file: File;
  status: PdfStatus;
  extracted: ExtractResponse | null;
  error: string | null;
};

const formatCurrency = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `$${value.toFixed(2)}`;
};

type DeductionBucket = 'statutoryDeductions' | 'voluntaryDeductions';

type DeductionDefinition = {
  key: string;
  label: string;
  bucket: DeductionBucket;
  keywords: string[];
  stateCode?: 'CA' | 'WI';
};

const DEDUCTION_DEFS: DeductionDefinition[] = [
  {
    key: 'federalIncome',
    label: 'Federal income',
    bucket: 'statutoryDeductions',
    keywords: ['federal income', 'federal income tax'],
    stateCode: undefined,
  },
  {
    key: 'socialSecurity',
    label: 'Social security',
    bucket: 'statutoryDeductions',
    keywords: [
      'social security',
      'social security tax',
      'social security deduction',
      'ss tax',
      'sst',
      'social security withholding',
      'fica ss',
      'oasdi',
      'social sec',
      'soc sec',
    ],
    stateCode: undefined,
  },
  {
    key: 'medicare',
    label: 'Medicare',
    bucket: 'statutoryDeductions',
    keywords: [
      'medicare',
      'medicare tax',
      'medicare deduction',
      'medicare withholding',
      'medicare premium',
      'med tax',
      'medicare ee',
      'fica medicare',
      'fica med',
      'med',
      'medi tax',
      'medicare employee',
      'med ee',
      'medicaree',
    ],
    stateCode: undefined,
  },
  {
    key: 'californiaStateIncome',
    label: 'CA State Income',
    bucket: 'statutoryDeductions',
    keywords: ['california state income', 'ca state income', 'state income', 'state tax', 'state income tax'],
    stateCode: 'CA',
  },
  {
    key: 'californiaStateDI',
    label: 'CA State DI',
    bucket: 'statutoryDeductions',
    keywords: [
      'california state di',
      'ca state di',
      'state di',
      'disability insurance',
      'state disability insurance',
      'state di premium',
    ],
    stateCode: 'CA',
  },
  {
    key: 'wisconsinStateIncome',
    label: 'WI State Income',
    bucket: 'statutoryDeductions',
    keywords: ['wisconsin state income', 'wi state income', 'wisconsin state tax', 'wi state tax', 'state income tax'],
    stateCode: 'WI',
  },
  {
    key: 'wisconsinStateDI',
    label: 'WI State DI',
    bucket: 'statutoryDeductions',
    keywords: [
      'wisconsin state di',
      'wisconsin state disability',
      'wi state di',
      'wi disability insurance',
      'state di premium',
    ],
    stateCode: 'WI',
  },
  {
    key: 'miscNonTaxableDeduction',
    label: 'Misc Non Taxable',
    bucket: 'voluntaryDeductions',
    keywords: ['misc non taxable', 'misc non taxable deduction'],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MEDICARE_OCR_VARIANTS = [
  'vadeare',
  'vedeare',
  'vedicare',
  'vedeicare',
  'medeare',
  'medeicare',
  'medecare',
  'medicaree',
  'medicar',
  'medicre',
  'medcar',
  'medicore',
  'medicarea',
  'medicarey',
  'medicarei',
  'meicare',
  'madicare',
];

const OCR_DEDUCTION_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\bSocial\s+Securit(?:y)?\b/gi,
    replacement: 'Social Security',
  },
  {
    pattern: new RegExp(
      `\\b(?:${MEDICARE_OCR_VARIANTS.map((variant) => escapeRegExp(variant)).join('|')})\\b`,
      'gi'
    ),
    replacement: 'Medicare',
  },
  {
    pattern: /\bMed\s+Care\b/gi,
    replacement: 'Medicare',
  },
];

function applyOcrDeductionCorrections(text: string): string {
  if (!text) return text;
  return OCR_DEDUCTION_CORRECTIONS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, replacement),
    text
  );
}

// Helper function to clean employee name by removing unwanted text
function cleanEmployeeName(name: string): string {
  if (!name) return name;

  // Remove "Federal" and everything after it (case-insensitive)
  const federalIndex = name.toLowerCase().indexOf('federal');
  if (federalIndex !== -1) {
    return name.substring(0, federalIndex).trim();
  }

  return name.trim();
}

const NAME_BLACKLIST_PATTERN = /\b(federal|gross|net|pay(period)?|deduction|hours|total|page|tax|income|ssn|number|address|state|company|phone|account|check|period|ytd)\b/i;
const NAME_LABELS_PATTERN = /^(?:employee|vendor|candidate|applicant|associate|worker|team member|owner|name|staff)[:\s-]*/i;
const NAME_LOOKBACK = 4;
const SSN_LOOKBACK = 4;

function sanitizeCandidateLine(rawLine: string): string | null {
  const normalized = rawLine.replace(/\s+/g, ' ').trim();
  if (normalized.length < 4) return null;

  const stripped = normalized.replace(NAME_LABELS_PATTERN, '').trim();
  if (stripped.length < 4) return null;

  const cleaned = stripped.replace(/[^A-Za-z\s.'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 4) return null;

  if (NAME_BLACKLIST_PATTERN.test(cleaned.toLowerCase())) return null;

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  if (!words.some((word) => /^[A-Z][a-z]+$/.test(word) || /^[A-Z]{2,}$/.test(word))) return null;
  if (words.some((word) => /\d/.test(word))) return null;

  return cleaned;
}

function chooseCandidate(chunk: string[], requireNoDigits: boolean): string | undefined {
  for (const rawLine of chunk) {
    const cleaned = sanitizeCandidateLine(rawLine);
    if (!cleaned) continue;
    if (requireNoDigits && /\d/.test(rawLine)) continue;
    return cleanEmployeeName(cleaned);
  }
  return undefined;
}

function guessNameFromLines(lines: string[]): string | undefined {
  const orderedLines = [...lines].reverse();
  for (let i = 0; i < orderedLines.length; i++) {
    const chunk = orderedLines.slice(i, i + NAME_LOOKBACK);
    if (!chunk.length) break;

    const noDigitsCandidate = chooseCandidate(chunk, true);
    if (noDigitsCandidate) return noDigitsCandidate;

    const fallbackCandidate = chooseCandidate(chunk, false);
    if (fallbackCandidate) return fallbackCandidate;
  }

  return undefined;
}

function evaluateSsnLine(rawLine: string): string | undefined {
  const match = rawLine.match(/([0-9X*]{3}[-\s][0-9X*]{2}[-\s][0-9X*]{4})/);
  if (!match) return undefined;
  return match[1].replace(/\s+/g, '-');
}

function guessSsnFromLines(lines: string[]): string | undefined {
  const orderedLines = [...lines].reverse();
  for (let i = 0; i < orderedLines.length; i++) {
    const chunk = orderedLines.slice(i, i + SSN_LOOKBACK);
    if (!chunk.length) break;

    for (const rawLine of chunk) {
      const candidate = evaluateSsnLine(rawLine);
      if (candidate) return candidate;
    }
  }

  return undefined;
}

const DEDUCTION_LOOKBACK = 4;

function parseCurrencyFromLine(rawLine: string): number | undefined {
  // Enhanced pattern to match various currency formats
  // Matches: $1,234.56, 1234.56, (123.45), -123.45, $1234, etc.
  const matches = rawLine.match(/-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\(\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\)/g);
  if (!matches || matches.length === 0) return undefined;

  const token = matches[0];
  const hasParenNegative = token.includes('(') && token.includes(')');
  let sanitized = token.replace(/[\$,()]/g, '').trim();
  const parsed = parseFloat(sanitized);
  if (Number.isNaN(parsed)) return undefined;
  return hasParenNegative ? -Math.abs(parsed) : parsed;
}

function guessDeductionValue(lines: string[], def: DeductionDefinition): number | undefined {
  const orderedLines = [...lines].reverse();

  // First pass: standard lookback
  for (let i = 0; i < orderedLines.length; i++) {
    const chunk = orderedLines.slice(i, i + DEDUCTION_LOOKBACK);
    if (!chunk.length) break;

    for (let j = 0; j < chunk.length; j++) {
      const line = chunk[j];
      const lower = line.toLowerCase();
      if (!def.keywords.some((keyword) => lower.includes(keyword))) continue;

      const amount = parseCurrencyFromLine(line);
      if (typeof amount === 'number' && amount > 0) return amount;

      const nextLine = chunk[j + 1];
      if (nextLine) {
        const nextAmount = parseCurrencyFromLine(nextLine);
        if (typeof nextAmount === 'number' && nextAmount > 0) return nextAmount;
      }
    }
  }

  // Second pass for Medicare and Social Security: more aggressive search (look 3 lines above and below)
  if (def.key === 'medicare' || def.key === 'socialSecurity') {
    const label = def.key === 'medicare' ? 'MEDICARE' : 'SOCIAL SECURITY';
    console.log(`[${label} FALLBACK] Starting aggressive search through`, lines.length, 'lines');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Check if line contains any keyword
      if (def.keywords.some((keyword) => lower.includes(keyword))) {
        console.log(`[${label} FALLBACK] Found keyword at line`, i, ':', line);

        // Try to extract from this line
        const amount = parseCurrencyFromLine(line);
        if (typeof amount === 'number' && amount > 0) {
          console.log(`[${label} FALLBACK] ✓ Found amount on same line:`, amount);
          return amount;
        }

        // Collect all amounts from surrounding lines (3 above, 3 below)
        const surroundingAmounts: number[] = [];
        for (let offset = -3; offset <= 3; offset++) {
          if (offset === 0) continue; // Already checked current line
          const targetIndex = i + offset;
          if (targetIndex >= 0 && targetIndex < lines.length) {
            const targetAmount = parseCurrencyFromLine(lines[targetIndex]);
            if (typeof targetAmount === 'number' && targetAmount > 0) {
              surroundingAmounts.push(targetAmount);
              console.log(`[${label} FALLBACK] Found candidate amount at offset`, offset, ':', targetAmount, '(line:', lines[targetIndex], ')');
            }
          }
        }

        // If we found amounts, return the first reasonable one
        if (surroundingAmounts.length > 0) {
          // Prefer amounts in a typical range for these deductions ($10-$500 for Medicare, $50-$1500 for SS)
          const typicalMin = def.key === 'medicare' ? 5 : 20;
          const typicalMax = def.key === 'medicare' ? 1000 : 3000;
          const typicalAmount = surroundingAmounts.find(amt => amt >= typicalMin && amt <= typicalMax);

          const selectedAmount = typicalAmount || surroundingAmounts[0];
          console.log(`[${label} FALLBACK] ✓ Selected amount:`, selectedAmount, '(from', surroundingAmounts.length, 'candidates)');
          return selectedAmount;
        }
      }
    }
    console.log(`[${label} FALLBACK] ✗ No amount found after searching all lines`);
  }

  return undefined;
}

function guessMissingDeductions(payrollData: PayrollData, lines: string[]) {
  DEDUCTION_DEFS.forEach((def) => {
    const bucket = payrollData[def.bucket] || (payrollData[def.bucket] = {});
    const existingValue = bucket[def.key]?.thisPeriod;
    if (typeof existingValue === 'number') return;

    const guessedValue = guessDeductionValue(lines, def);
    if (typeof guessedValue === 'number') {
      bucket[def.key] = { thisPeriod: guessedValue };
      if (def.key === 'medicare') {
        console.log('[MEDICARE FALLBACK] ✓ Applied guessed value:', guessedValue);
      }
    }
  });
}

const getDeductionValues = (data?: PayrollData, text?: string) => {
  const values: Record<string, number | undefined> = {};
  const normalizedText = text ? applyOcrDeductionCorrections(text) : '';
  const lines = normalizedText
    ? normalizedText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
    : null;
  if (!data) return values;
  DEDUCTION_DEFS.forEach((def) => {
    const bucket = (data as any)[def.bucket];
    const amount = bucket?.[def.key]?.thisPeriod;
    if (typeof amount === 'number') {
      values[def.key] = amount;
      return;
    }

    if (lines) {
      const guessed = guessDeductionValue(lines, def);
      values[def.key] = typeof guessed === 'number' ? guessed : undefined;
    } else {
      values[def.key] = undefined;
    }
  });
  return values;
};

// Lightweight client-side payroll parser (mirrors server logic)
function extractPayrollData(text: string) {
  text = applyOcrDeductionCorrections(text);
  const payrollData: any = {
    statutoryDeductions: {},
    voluntaryDeductions: {},
    netPayAdjustments: {},
    employeeInfo: {},
    earnings: {},
    hours: {},
    allExtractedData: {},
  };

  // Extract vendor name
  let nameFound = false;

  // Split text into lines and filter out empty lines
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  // PRIMARY METHOD: Try third-to-last line first (most reliable for paystubs)
  if (lines.length >= 3) {
    const thirdLastLine = lines[lines.length - 3];
    if (thirdLastLine && /[A-Za-z]/.test(thirdLastLine) && thirdLastLine.length > 2 && thirdLastLine.length < 100) {
      const cleanedName = thirdLastLine.replace(/[^\w\s.-]/g, '').trim();
      // Reject if name contains any digits (likely an address or ID)
      if (cleanedName.length > 0 && !/\d/.test(cleanedName)) {
        payrollData.employeeInfo.name = cleanEmployeeName(cleanedName);
        nameFound = true;
      }
    }
  }

  // Fallback: Try "Tax Override:" pattern
  if (!nameFound) {
    const taxOverridePattern = /Tax Override:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]*)+)/i;
    const taxOverrideMatch = text.match(taxOverridePattern);
    if (taxOverrideMatch && taxOverrideMatch[1]) {
      const candidateName = taxOverrideMatch[1];
      // Reject if name contains any digits (likely an address or ID)
      if (!/\d/.test(candidateName)) {
        payrollData.employeeInfo.name = cleanEmployeeName(candidateName);
        nameFound = true;
      }
    }
  }

  // Fallback to traditional patterns
  if (!nameFound) {
    const namePatterns = [
      /Vendor[:\s]+([^\n]+)/i,
      /Employee Name[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /Name[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /Employee[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length > 3) {
        const candidateName = match[1];
        // Reject if name contains any digits (likely an address or ID)
        if (!/\d/.test(candidateName)) {
          payrollData.employeeInfo.name = cleanEmployeeName(candidateName);
          break;
        }
      }
    }
  }

  if (!payrollData.employeeInfo.name) {
    const fallbackName = guessNameFromLines(lines);
    if (fallbackName) {
      payrollData.employeeInfo.name = fallbackName;
      nameFound = true;
    }
  }

  // Extract SSN - multiple patterns for better coverage
  const ssnPatterns = [
    // With labels - comprehensive label matching
    /(?:SSN|Social Security Number|Social Security|SS#|SS Number)[:\s]*([X\d]{3}[-\s]?[X\d]{2}[-\s]?\d{4})/i,
    // Standalone SSN formats without labels (both masked and full)
    /\b([X\d]{3}[-\s][X\d]{2}[-\s]\d{4})\b/,
    /\b(\d{3}[-\s]\d{2}[-\s]\d{4})\b/,
    // Masked SSN (XXX-XX-1234 or ***-**-1234)
    /\b([X*]{3}[-\s][X*]{2}[-\s]\d{4})\b/i,
    // SSN with "Number:" label
    /Number[:\s]*([X\d]{3}[-\s]?[X\d]{2}[-\s]?\d{4})/i,
    // More flexible spacing (captures three separate groups)
    /(?:SSN|SS)[:\s]*([X\d]{3})\s*([X\d]{2})\s*(\d{4})/i,
  ];

  for (const pattern of ssnPatterns) {
    const match = text.match(pattern);
    if (match) {
      // If pattern captures multiple groups (flexible spacing), concatenate them
      if (match.length > 3 && match[2] && match[3]) {
        payrollData.employeeInfo.ssn = `${match[1]}-${match[2]}-${match[3]}`;
      } else if (match[1]) {
        payrollData.employeeInfo.ssn = match[1];
      }
      break;
    }
  }

  if (!payrollData.employeeInfo.ssn) {
    const fallbackSsn = guessSsnFromLines(lines);
    if (fallbackSsn) {
      payrollData.employeeInfo.ssn = fallbackSsn;
    }
  }

  // Extract Employee ID (if different from SSN)
  const empIdPattern = /(?:Employee ID|EMP ID|ID)[:\s]*(\d+)/i;
  const empIdMatch = text.match(empIdPattern);
  if (empIdMatch) {
    payrollData.employeeInfo.employeeId = empIdMatch[1];
  }

  // Extract address
  const addressPattern = /Address[:\s]+([^\n]+)/i;
  const addressMatch = text.match(addressPattern);
  if (addressMatch) {
    payrollData.employeeInfo.address = addressMatch[1].trim();
  }

  // Extract Federal Income Tax
  const federalPattern = /Federal Income\s+(?:Tax)?\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const federalMatch = text.match(federalPattern);
  if (federalMatch) {
    payrollData.statutoryDeductions.federalIncome = {
      thisPeriod: parseFloat(federalMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(federalMatch[2].replace(/,/g, '')),
    };
  }

  // Helper function to parse amounts (handles parentheses as negative)
  const parseAmount = (amt: string) => {
    // Handle parentheses as negative
    const isNegative = amt.includes('(') && amt.includes(')');
    const cleaned = amt.replace(/[\$,()]/g, '');
    const value = parseFloat(cleaned);
    return isNaN(value) ? 0 : (isNegative ? -Math.abs(value) : value);
  };

  // Extract Social Security - try multiple patterns for reliability
  let socialSecurityMatch = null;
  let ssExtractionMethod = '';

  // Pattern 1: Social Security with amounts on same line
  const ssPattern1 = /Social\s+Security\s*:?\s*([-\d,.()]+)\s+([-\d,.()]+)/i;
  socialSecurityMatch = text.match(ssPattern1);
  if (socialSecurityMatch) ssExtractionMethod = 'SS Pattern 1 (standard)';

  // Pattern 2: SS Tax or SST variations
  if (!socialSecurityMatch) {
    const ssPattern2 = /(?:SS|SST|Social\s+Sec(?:urity)?)\s+(?:Tax|Withholding)?\s*:?\s*([-\d,.()]+)\s+([-\d,.()]+)/i;
    socialSecurityMatch = text.match(ssPattern2);
    if (socialSecurityMatch) ssExtractionMethod = 'SS Pattern 2 (variations)';
  }

  // Pattern 3: FICA SS or OASDI
  if (!socialSecurityMatch) {
    const ssPattern3 = /(?:FICA\s+SS|OASDI)\s*:?\s*([-\d,.()]+)\s+([-\d,.()]+)/i;
    socialSecurityMatch = text.match(ssPattern3);
    if (socialSecurityMatch) ssExtractionMethod = 'SS Pattern 3 (FICA/OASDI)';
  }

  // Pattern 4: Line-by-line scan for Social Security
  if (!socialSecurityMatch) {
    const ssKeywords = ['social security', 'ss tax', 'sst', 'fica ss', 'oasdi', 'social sec'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (ssKeywords.some(kw => line.includes(kw))) {
        // Check this line and next 3 lines for amounts
        const searchLines = lines.slice(Math.max(0, i - 1), i + 4).join(' ');
        const amounts = searchLines.match(/([-\d,.()]+)\s+([-\d,.()]+)/);
        if (amounts && amounts[1] && amounts[2]) {
          const val1 = parseAmount(amounts[1]);
          const val2 = parseAmount(amounts[2]);
          if (!isNaN(val1) && !isNaN(val2) && val1 > 0 && val2 >= val1) {
            socialSecurityMatch = amounts;
            ssExtractionMethod = `SS Pattern 4 (line scan: line ${i})`;
            break;
          }
        }
      }
    }
  }

  if (socialSecurityMatch) {
    const thisPeriod = parseAmount(socialSecurityMatch[1]);
    const yearToDate = parseAmount(socialSecurityMatch[2]);

    payrollData.statutoryDeductions.socialSecurity = {
      thisPeriod,
      yearToDate,
    };

    console.log(`[SOCIAL SECURITY EXTRACTION] ✓ Success via ${ssExtractionMethod}:`, { thisPeriod, yearToDate });
  } else {
    console.log('[SOCIAL SECURITY EXTRACTION] ✗ No match after 4 patterns, will rely on fallback guess');
  }

  // Extract Medicare - try multiple patterns for reliability
  let medicareMatch = null;
  let extractionMethod = '';

  // Pattern 1: Medicare with optional colon/separator, two amounts on same line
  const medicarePattern1 = /Medicare\s*:?\s*([-\d,.()]+)\s+([-\d,.()]+)/i;
  medicareMatch = text.match(medicarePattern1);
  if (medicareMatch) extractionMethod = 'Pattern 1 (standard)';

  // Pattern 2: Medicare tax/withholding with amounts
  if (!medicareMatch) {
    const medicarePattern2 = /Medicare\s+(?:Tax|Withholding|Deduction)\s*:?\s*([-\d,.()]+)\s+([-\d,.()]+)/i;
    medicareMatch = text.match(medicarePattern2);
    if (medicareMatch) extractionMethod = 'Pattern 2 (tax/withholding)';
  }

  // Pattern 3: Medicare followed by amount on next line or with more flexible spacing
  if (!medicareMatch) {
    const medicarePattern3 = /Medicare[^\n]*?\s+([-\d,.()]+)\s+([-\d,.()]+)/i;
    medicareMatch = text.match(medicarePattern3);
    if (medicareMatch) extractionMethod = 'Pattern 3 (flexible)';
  }

  // Pattern 4: FICA Med or Med Tax variations
  if (!medicareMatch) {
    const medicarePattern4 = /(?:FICA\s+)?Med(?:icare)?\s+(?:Tax|EE)?\s*:?\s*([-\d,.()]+)\s+([-\d,.()]+)/i;
    medicareMatch = text.match(medicarePattern4);
    if (medicareMatch) extractionMethod = 'Pattern 4 (FICA/Med)';
  }

  // Pattern 5: Multi-line scan - Medicare keyword on one line, amounts nearby
  if (!medicareMatch) {
    const medicareKeywords = ['medicare', 'med tax', 'fica med', 'medicare ee', 'medicare tax'];
    for (const keyword of medicareKeywords) {
      const regex = new RegExp(keyword + '[^\\n]*', 'i');
      const keywordMatch = text.match(regex);
      if (keywordMatch) {
        const startIdx = keywordMatch.index || 0;
        const searchRange = text.substring(startIdx, startIdx + 200);
        // Look for two consecutive currency amounts
        const amountPattern = /([-\d,.()]+)\s+([-\d,.()]+)/;
        const amounts = searchRange.match(amountPattern);
        if (amounts && amounts[1] && amounts[2]) {
          // Validate these look like currency amounts
          const val1 = parseAmount(amounts[1]);
          const val2 = parseAmount(amounts[2]);
          if (!isNaN(val1) && !isNaN(val2) && val1 > 0 && val2 >= val1) {
            medicareMatch = amounts;
            extractionMethod = `Pattern 5 (multi-line: ${keyword})`;
            break;
          }
        }
      }
    }
  }

  // Pattern 6: Line-by-line scan for Medicare + amount extraction (check lines before and after)
  if (!medicareMatch) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/medicare|med tax|fica med|med\s+ee|medicare\s+ee/i.test(line)) {
        // Check 1 line before and 3 lines after for amounts
        const searchLines = lines.slice(Math.max(0, i - 1), i + 4).join(' ');
        const amounts = searchLines.match(/([-\d,.()]+)\s+([-\d,.()]+)/);
        if (amounts && amounts[1] && amounts[2]) {
          const val1 = parseAmount(amounts[1]);
          const val2 = parseAmount(amounts[2]);
          if (!isNaN(val1) && !isNaN(val2) && val1 > 0 && val2 >= val1) {
            medicareMatch = amounts;
            extractionMethod = `Pattern 6 (line scan: line ${i})`;
            break;
          }
        }
      }
    }
  }

  if (medicareMatch) {
    const thisPeriod = parseAmount(medicareMatch[1]);
    const yearToDate = parseAmount(medicareMatch[2]);

    payrollData.statutoryDeductions.medicare = {
      thisPeriod,
      yearToDate,
    };

    console.log(`[MEDICARE EXTRACTION] ✓ Success via ${extractionMethod}:`, { thisPeriod, yearToDate });
  } else {
    console.log('[MEDICARE EXTRACTION] ✗ No match after 6 patterns, will rely on fallback guess');
  }

  // Extract California State Income
  const caStatePattern = /California State Income\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const caStateMatch = text.match(caStatePattern);
  if (caStateMatch) {
    payrollData.statutoryDeductions.californiaStateIncome = {
      thisPeriod: parseFloat(caStateMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(caStateMatch[2].replace(/,/g, '')),
    };
  }

  // Extract California State DI
  const caDIPattern = /California State DI\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const caDIMatch = text.match(caDIPattern);
  if (caDIMatch) {
    payrollData.statutoryDeductions.californiaStateDI = {
      thisPeriod: parseFloat(caDIMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(caDIMatch[2].replace(/,/g, '')),
    };
  }

  // Extract Misc Non Taxable Deduction
  const miscNonTaxPattern = /Misc Non Taxable Deduction\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const miscNonTaxMatch = text.match(miscNonTaxPattern);
  if (miscNonTaxMatch) {
    payrollData.voluntaryDeductions.miscNonTaxableDeduction = {
      thisPeriod: parseFloat(miscNonTaxMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(miscNonTaxMatch[2].replace(/,/g, '')),
    };
  }

  // Extract Misc reimbursement
  const miscReimbPattern = /Misc reimbursement\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const miscReimbMatch = text.match(miscReimbPattern);
  if (miscReimbMatch) {
    payrollData.netPayAdjustments.miscReimbursement = {
      thisPeriod: parseFloat(miscReimbMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(miscReimbMatch[2].replace(/,/g, '')),
    };
  }

  // Extract gross pay
  const grossPattern = /Gross Pay[:\s]+([-\d,.]+)/i;
  const grossMatch = text.match(grossPattern);
  if (grossMatch) {
    payrollData.employeeInfo.grossPay = parseFloat(grossMatch[1].replace(/,/g, ''));
  }

  // Extract net pay
  const netPattern = /Net Pay[:\s]+([-\d,.]+)/i;
  const netMatch = text.match(netPattern);
  if (netMatch) {
    payrollData.employeeInfo.netPay = parseFloat(netMatch[1].replace(/,/g, ''));
  }

  // Extract pay period dates
  const periodPattern = /(?:Pay Period|Period)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-)?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})?/i;
  const periodMatch = text.match(periodPattern);
  if (periodMatch) {
    payrollData.employeeInfo.payPeriod = {
      start: periodMatch[1],
      end: periodMatch[2] || periodMatch[1],
    };
  }

  // Extract pay date
  const payDatePattern = /(?:Pay Date|Check Date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
  const payDateMatch = text.match(payDatePattern);
  if (payDateMatch) {
    payrollData.employeeInfo.payDate = payDateMatch[1];
  }

  // Extract check number
  const checkNumPattern = /(?:Check|Check #|Check Number)[:\s]+(\d+)/i;
  const checkNumMatch = text.match(checkNumPattern);
  if (checkNumMatch) {
    payrollData.employeeInfo.checkNumber = checkNumMatch[1];
  }

  // Extract hours worked - Regular, Overtime, Double Time
  const regularHoursPattern = /Regular\s+(?:Hours)?\s*([-\d,.]+)\s*(?:hrs?)?/i;
  const regularHoursMatch = text.match(regularHoursPattern);
  if (regularHoursMatch) {
    payrollData.hours.regular = parseFloat(regularHoursMatch[1].replace(/,/g, ''));
  }

  const overtimeHoursPattern = /(?:Overtime|OT)\s+(?:Hours)?\s*([-\d,.]+)\s*(?:hrs?)?/i;
  const overtimeHoursMatch = text.match(overtimeHoursPattern);
  if (overtimeHoursMatch) {
    payrollData.hours.overtime = parseFloat(overtimeHoursMatch[1].replace(/,/g, ''));
  }

  const doubleTimeHoursPattern = /(?:Double Time|DT)\s+(?:Hours)?\s*([-\d,.]+)\s*(?:hrs?)?/i;
  const doubleTimeHoursMatch = text.match(doubleTimeHoursPattern);
  if (doubleTimeHoursMatch) {
    payrollData.hours.doubleTime = parseFloat(doubleTimeHoursMatch[1].replace(/,/g, ''));
  }

  // Extract total hours
  const totalHoursPattern = /Total\s+Hours[:\s]+([-\d,.]+)/i;
  const totalHoursMatch = text.match(totalHoursPattern);
  if (totalHoursMatch) {
    payrollData.hours.total = parseFloat(totalHoursMatch[1].replace(/,/g, ''));
  }

  // Extract earnings - Regular, Overtime, Double Time
  const regularPayPattern = /Regular\s+(?:Pay|Earnings)\s*([-\d,.]+)/i;
  const regularPayMatch = text.match(regularPayPattern);
  if (regularPayMatch) {
    payrollData.earnings.regular = parseFloat(regularPayMatch[1].replace(/,/g, ''));
  }

  const overtimePayPattern = /(?:Overtime|OT)\s+(?:Pay|Earnings)\s*([-\d,.]+)/i;
  const overtimePayMatch = text.match(overtimePayPattern);
  if (overtimePayMatch) {
    payrollData.earnings.overtime = parseFloat(overtimePayMatch[1].replace(/,/g, ''));
  }

  const doubleTimePayPattern = /(?:Double Time|DT)\s+(?:Pay|Earnings)\s*([-\d,.]+)/i;
  const doubleTimePayMatch = text.match(doubleTimePayPattern);
  if (doubleTimePayMatch) {
    payrollData.earnings.doubleTime = parseFloat(doubleTimePayMatch[1].replace(/,/g, ''));
  }

  // Extract hourly rate
  const hourlyRatePattern = /(?:Rate|Hourly Rate|Pay Rate)[:\s]+\$?([-\d,.]+)/i;
  const hourlyRateMatch = text.match(hourlyRatePattern);
  if (hourlyRateMatch) {
    payrollData.employeeInfo.hourlyRate = parseFloat(hourlyRateMatch[1].replace(/,/g, ''));
  }

  // Extract YTD gross
  const ytdGrossPattern = /YTD\s+Gross[:\s]+([-\d,.]+)/i;
  const ytdGrossMatch = text.match(ytdGrossPattern);
  if (ytdGrossMatch) {
    payrollData.employeeInfo.ytdGross = parseFloat(ytdGrossMatch[1].replace(/,/g, ''));
  }

  // Extract YTD net
  const ytdNetPattern = /YTD\s+Net[:\s]+([-\d,.]+)/i;
  const ytdNetMatch = text.match(ytdNetPattern);
  if (ytdNetMatch) {
    payrollData.employeeInfo.ytdNet = parseFloat(ytdNetMatch[1].replace(/,/g, ''));
  }

  // Extract all dollar amounts with labels for comprehensive data capture
  const allAmountsPattern = /([A-Za-z\s]+?)\s+([-\d,.]+)\s+([-\d,.]+)/g;
  let match;
  while ((match = allAmountsPattern.exec(text)) !== null) {
    const label = match[1].trim();
    const thisPeriod = match[2];
    const yearToDate = match[3];

    // Skip if this looks like a page header or doesn't have valid numbers
    if (thisPeriod && yearToDate && /^\d/.test(thisPeriod)) {
      const key = label.toLowerCase().replace(/\s+/g, '_');
      payrollData.allExtractedData[key] = {
        label: label,
        thisPeriod: parseFloat(thisPeriod.replace(/,/g, '')),
        yearToDate: parseFloat(yearToDate.replace(/,/g, '')),
      };
    }
  }

  guessMissingDeductions(payrollData, lines);

  return payrollData;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File;

    if (!pdfFile) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
    }

    const arrayBuffer = await pdfFile.arrayBuffer();
    if (arrayBuffer.byteLength < PDF_HEADER_BYTES.length) {
      return NextResponse.json({ error: 'File is empty or too small to be a valid PDF' }, { status: 400 });
    }

    let pdfBytes = new Uint8Array(arrayBuffer);
    const headerOffset = findPdfHeaderOffset(pdfBytes);
    if (headerOffset === -1) {
      return NextResponse.json(
        { error: 'This file does not appear to be a valid PDF (missing %PDF- header).' },
        { status: 400 }
      );
    }

    if (headerOffset > 0) {
      console.log(`[EXTRACT_PDF] PDF header found at offset ${headerOffset}, trimming leading bytes...`);
      pdfBytes = pdfBytes.subarray(headerOffset);
    }

    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    } catch (e: any) {
      const message = e?.message ? String(e.message) : String(e);
      if (message.includes('Failed to parse PDF document') || message.includes('No PDF header found')) {
        return NextResponse.json(
          { error: 'Invalid PDF file. Please re-download or re-export the PDF and try again.' },
          { status: 400 }
        );
      }
      throw e;
    }

    const pageCount = pdfDoc.getPageCount();
    const title = pdfDoc.getTitle();
    const author = pdfDoc.getAuthor();
    const creator = pdfDoc.getCreator();
    const producer = pdfDoc.getProducer();
    const creationDate = pdfDoc.getCreationDate();

    const textParts: string[] = [];
    let extractedText = '';
    const pageDataArray: any[] = [];

    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      const formEntries: string[] = [];

      fields.forEach((field) => {
        const fieldName = field.getName();
        try {
          const fieldType = field.constructor.name;
          let value = '';
          if (fieldType === 'PDFTextField') {
            value = (field as any).getText?.() || '';
          } else if (fieldType === 'PDFCheckBox') {
            value = (field as any).isChecked?.() ? 'Yes' : 'No';
          } else if (fieldType === 'PDFDropdown') {
            value = (field as any).getSelected?.()?.join(', ') || '';
          } else if (fieldType === 'PDFRadioGroup') {
            value = (field as any).getSelected?.() || '';
          }
          if (value) {
            formEntries.push(`${fieldName}: ${value}`);
          }
        } catch (fieldError) {
          console.error(`Error extracting field ${fieldName}:`, fieldError);
        }
      });

      if (formEntries.length > 0) {
        textParts.push('=== Form Fields ===\n' + formEntries.join('\n'));
      }
    } catch (formError) {
      console.log('No form fields found or error extracting:', formError);
    }

    try {
      const pages = pdfDoc.getPages();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { width, height } = page.getSize();
        const pageTextParts: string[] = [];
        const pageHeader = `\n=== Page ${i + 1} (${width.toFixed(0)}x${height.toFixed(0)}) ===`;
        pageTextParts.push(pageHeader);

        try {
          const contentStream = page.node.Contents();

          if (contentStream) {
            let content = '';

            if (contentStream instanceof PDFArray) {
              const array = contentStream.asArray();
              for (let j = 0; j < array.length; j++) {
                const stream = array[j];
                try {
                  content += stream.toString() + '\n';
                } catch (streamError) {
                  console.error(`Error reading content stream ${j} on page ${i + 1}:`, streamError);
                }
              }
            } else {
              content = contentStream.toString();
            }

            const textMatches = content.match(/\(([^)]+)\)/g);
            if (textMatches) {
              const extractedStrings = textMatches.map((match) => {
                let text = match.slice(1, -1);
                text = text.replace(/\n/g, '\n');
                text = text.replace(/\r/g, '\r');
                text = text.replace(/\t/g, '\t');
                text = text.replace(/\\\\/g, '\\');
                text = text.replace(/\\\(/g, '(');
                text = text.replace(/\\\)/g, ')');
                return text;
              });
              pageTextParts.push(extractedStrings.join(' '));
            }
          }
        } catch (pageError) {
          console.error(`Error extracting text from page ${i + 1}:`, pageError);
          pageTextParts.push('[Error extracting text from this page]');
        }

        const pageText = pageTextParts.join('\n');
        textParts.push(pageText);

        // Log extracted text for debugging
        const cleanedText = pageText.replace(/===.*===/g, '').trim();
        console.log(`[EXTRACT_PDF] Page ${i + 1}: Extracted ${cleanedText.length} characters`);
        if (cleanedText.length > 50) {
          console.log(`[EXTRACT_PDF] Page ${i + 1}: First 200 chars:`, cleanedText.substring(0, 200));
        } else if (cleanedText.length > 0) {
          console.log(`[EXTRACT_PDF] Page ${i + 1}: Full text:`, cleanedText);
        } else {
          console.log(`[EXTRACT_PDF] Page ${i + 1}: ⚠️ No text extracted - may be image-based PDF`);
        }

        let pagePayrollData;
        let usedLLM = false;
        let usedHybrid = false;

        try {
          pagePayrollData = await extractPayrollDataWithLLM(pageText);
          usedLLM = true;
          console.log(`[EXTRACT_PDF] Page ${i + 1}: Used LLM extraction`);

          // Check if critical deductions are missing (Medicare or Social Security)
          const hasMedicare = pagePayrollData.statutoryDeductions?.medicare?.thisPeriod;
          const hasSocialSecurity = pagePayrollData.statutoryDeductions?.socialSecurity?.thisPeriod;

          if (!hasMedicare || !hasSocialSecurity) {
            console.log(`[EXTRACT_PDF] Page ${i + 1}: LLM missing critical deductions (Medicare: ${!!hasMedicare}, SS: ${!!hasSocialSecurity}), running regex extraction`);
            const regexData = extractPayrollData(pageText);

            // Merge regex results into LLM data for missing fields
            if (!hasMedicare && regexData.statutoryDeductions?.medicare) {
              pagePayrollData.statutoryDeductions.medicare = regexData.statutoryDeductions.medicare;
              console.log(`[EXTRACT_PDF] Page ${i + 1}: ✓ Recovered Medicare from regex:`, regexData.statutoryDeductions.medicare.thisPeriod);
            }
            if (!hasSocialSecurity && regexData.statutoryDeductions?.socialSecurity) {
              pagePayrollData.statutoryDeductions.socialSecurity = regexData.statutoryDeductions.socialSecurity;
              console.log(`[EXTRACT_PDF] Page ${i + 1}: ✓ Recovered Social Security from regex:`, regexData.statutoryDeductions.socialSecurity.thisPeriod);
            }
            usedHybrid = true;
          }
        } catch (llmError: any) {
          console.log(`[EXTRACT_PDF] Page ${i + 1}: LLM extraction failed, using regex fallback`);
          pagePayrollData = extractPayrollData(pageText);
        }

        const hasData =
          pagePayrollData.employeeInfo?.name ||
          pagePayrollData.employeeInfo?.ssn ||
          Object.keys(pagePayrollData.statutoryDeductions || {}).length > 0 ||
          Object.keys(pagePayrollData.voluntaryDeductions || {}).length > 0;

        if (hasData) {
          pageDataArray.push({
            pageNumber: i + 1,
            text: pageText,
            payrollData: pagePayrollData,
            extractionMethod: usedHybrid ? 'hybrid' : (usedLLM ? 'llm' : 'regex'),
          });
        }
      }
    } catch (pageExtractionError) {
      console.error('Error during text extraction:', pageExtractionError);
      textParts.push('[Error during text extraction]');
    }

    extractedText = textParts.join('\n');
    const meaningfulText = extractedText.replace(/===.*===/g, '').trim();
    const isImageBased = meaningfulText.length < 100;

    if (isImageBased) {
      console.log('[EXTRACT_PDF] Minimal text extracted. PDF appears to be image-based.');
      extractedText += '\n\n=== IMAGE-BASED PDF DETECTED ===\n';
      extractedText += 'This PDF appears to contain scanned images rather than selectable text.\n\n';
      extractedText += 'RECOMMENDATIONS:\n';
      extractedText += '1. Request the original PDF with selectable text from the sender\n';
      extractedText += '2. Use a dedicated OCR tool (Adobe Acrobat, Google Drive, etc.) to convert the PDF first\n';
      extractedText += '3. For automated processing, consider cloud OCR services:\n';
      extractedText += '   - Google Cloud Vision API\n';
      extractedText += '   - AWS Textract\n';
      extractedText += '   - Azure Computer Vision\n';
      extractedText += '4. Manually re-type the data (if it\'s a small amount)\n';
    }

    const payrollData = extractPayrollData(extractedText);

    console.log('[EXTRACT_PDF] Raw text length:', extractedText.length);
    console.log('[EXTRACT_PDF] Image-based:', isImageBased);
    console.log('[EXTRACT_PDF] Pages with data:', pageDataArray.length);
    console.log('[EXTRACT_PDF] First 500 chars:', extractedText.substring(0, 500));

    // Log extraction success summary
    if (pageDataArray.length > 0) {
      const pagesWithMedicare = pageDataArray.filter(p => p.payrollData.statutoryDeductions?.medicare?.thisPeriod).length;
      const pagesWithSS = pageDataArray.filter(p => p.payrollData.statutoryDeductions?.socialSecurity?.thisPeriod).length;
      const pagesWithBoth = pageDataArray.filter(p =>
        p.payrollData.statutoryDeductions?.medicare?.thisPeriod &&
        p.payrollData.statutoryDeductions?.socialSecurity?.thisPeriod
      ).length;

      console.log(`[EXTRACT_PDF] ========== EXTRACTION SUMMARY ==========`);
      console.log(`[EXTRACT_PDF] Total pages with data: ${pageDataArray.length}`);
      console.log(`[EXTRACT_PDF] Pages with Medicare: ${pagesWithMedicare}/${pageDataArray.length} (${Math.round(pagesWithMedicare/pageDataArray.length*100)}%)`);
      console.log(`[EXTRACT_PDF] Pages with Social Security: ${pagesWithSS}/${pageDataArray.length} (${Math.round(pagesWithSS/pageDataArray.length*100)}%)`);
      console.log(`[EXTRACT_PDF] Pages with BOTH: ${pagesWithBoth}/${pageDataArray.length} (${Math.round(pagesWithBoth/pageDataArray.length*100)}%)`);
      console.log(`[EXTRACT_PDF] ========================================`);
    }

    return NextResponse.json({
      text: extractedText,
      payrollData,
      payrollDataByPage: pageDataArray,
      metadata: {
        pageCount,
        title: title || undefined,
        author: author || undefined,
        creator: creator || undefined,
        producer: producer || undefined,
        creationDate: creationDate?.toString() || undefined,
      },
      debug: {
        textLength: extractedText.length,
        isImageBased,
        pagesWithData: pageDataArray.length,
        hasStatutoryDeductions: Object.keys(payrollData.statutoryDeductions || {}).length > 0,
        hasVoluntaryDeductions: Object.keys(payrollData.voluntaryDeductions || {}).length > 0,
        hasNetPayAdjustments: Object.keys(payrollData.netPayAdjustments || {}).length > 0,
        hasEmployeeInfo: Object.keys(payrollData.employeeInfo || {}).length > 0,
        hasEarnings: Object.keys(payrollData.earnings || {}).length > 0,
        hasHours: Object.keys(payrollData.hours || {}).length > 0,
        allExtractedDataCount: Object.keys(payrollData.allExtractedData || {}).length,
      },
    });
  } catch (err: any) {
    console.error('[EXTRACT_PDF] Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to extract PDF data' },
      { status: 500 }
    );
  }
}

