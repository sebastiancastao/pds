// Shared PDF payroll extraction pipeline.
//
// Moved verbatim out of app/pdf-reader/page.tsx so other pages (currently
// /adp-ytd-import) read PDFs exactly the way /pdf-reader does: server text
// extraction via /api/extract-pdf, and for scanned / image-based PDFs a
// client-side OCR pass (PDF.js from CDN + Tesseract) with LLM, regex and
// AI-vision fallbacks. Browser-only: import it from client components.

import Tesseract from 'tesseract.js';

export type OcrProgress = { page: number; progress: number; total: number };

export type OcrHooks = {
  onOcrStart?: () => void;
  onOcrProgress?: (progress: OcrProgress) => void;
  onOcrEnd?: () => void;
};

export const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
export const PDFJS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfJsLoadPromise: Promise<void> | null = null;

/**
 * Loads PDF.js from the CDN once (same version /pdf-reader uses). Resolves
 * immediately when window.pdfjsLib is already present.
 */
export function ensurePdfJsLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('PDF.js can only load in the browser'));
  if (window.pdfjsLib) return Promise.resolve();
  if (pdfJsLoadPromise) return pdfJsLoadPromise;

  pdfJsLoadPromise = new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
        resolve();
      } else {
        pdfJsLoadPromise = null;
        reject(new Error('PDF.js loaded but window.pdfjsLib is missing'));
      }
    };
    const onError = () => {
      pdfJsLoadPromise = null;
      reject(new Error('Failed to load PDF.js from CDN'));
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PDFJS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', onLoad, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = PDFJS_SRC;
    script.async = true;
    script.onload = onLoad;
    script.onerror = onError;
    document.head.appendChild(script);
  });

  return pdfJsLoadPromise;
}

// Extend window type to include PDF.js global
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

export type PayrollData = Record<string, any>;

export type ExtractResponse = {
  text?: string;
  payrollData?: PayrollData;
  payrollDataByPage?: Array<{
    pageNumber: number;
    text: string;
    payrollData: PayrollData;
    extractionMethod?: 'llm' | 'regex' | 'vision' | 'hybrid';
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

export type DeductionBucket = 'statutoryDeductions' | 'voluntaryDeductions';

export type DeductionDefinition = {
  key: string;
  label: string;
  bucket: DeductionBucket;
  keywords: string[];
  stateCode?: 'CA' | 'WI' | 'AZ';
};

export const DEDUCTION_DEFS: DeductionDefinition[] = [
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
      'social security withholding',
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
    keywords: [
      'wisconsin state income',
      'wi state income',
      'wisconsin state tax',
      'wi state tax',
      'wisconsin income',
      'wi income',
    ],
    stateCode: 'WI',
  },
  {
    key: 'arizonaStateIncome',
    label: 'AZ State Income',
    bucket: 'statutoryDeductions',
    keywords: [
      'arizona state income',
      'az state income',
      'arizona state tax',
      'az state tax',
      'arizona income',
      'az income',
    ],
    stateCode: 'AZ',
  },
  {
    key: 'miscNonTaxableDeduction',
    label: 'Misc Non Taxable',
    bucket: 'voluntaryDeductions',
    keywords: ['misc non taxable', 'misc non taxable deduction'],
  },
  {
    key: 'calSaversRothRet',
    label: 'CalSavers Roth Ret',
    bucket: 'voluntaryDeductions',
    keywords: ['calsavers roth ret', 'cal savers roth ret', 'calsavers roth', 'roth ret'],
    stateCode: 'CA',
  },
];

export const EARNINGS_EXPORT_DEFS: Array<{ label: string; key: string }> = [
  { label: 'Regular', key: 'regular' },
  { label: 'Overtime', key: 'overtime' },
  { label: 'Double Time', key: 'doubleTime' },
  { label: 'Commission', key: 'commission' },
  { label: 'Variable Incentive', key: 'variableIncentive' },
  { label: 'Credit Card Tips', key: 'creditCardTips' },
  { label: 'Rest Break Pay', key: 'restBreakPay' },
  { label: 'Travel Pay', key: 'travelPay' },
  { label: 'Bonus', key: 'bonus' },
  { label: 'Sick Pay', key: 'sickPay' },
  { label: 'Meal Premium', key: 'mealPremium' },
  // Last so older exports keep their column order. Some employees have ADP
  // Holiday pay in their YTD; /paystub-generator reads "Holiday Pay YTD".
  { label: 'Holiday Pay', key: 'holidayPay' },
];

export const NET_PAY_ADJ_EXPORT_DEFS: Array<{ label: string; key: string }> = [
  { label: 'Equipment Reimbursement', key: 'equipmentReimbursement' },
  { label: 'Mileage Reimbursement', key: 'mileageReimbursement' },
  { label: 'Misc Reimbursement', key: 'miscReimbursement' },
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
  const matches = rawLine.match(/-?\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return undefined;
  const token = matches[0];
  const hasParenNegative = token.includes('(') && token.includes(')');
  let sanitized = token.replace(/[\$,]/g, '').replace(/[()]/g, '');
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

  // Second pass for Medicare: more aggressive search
  if (def.key === 'medicare') {
    console.log('[MEDICARE FALLBACK] Starting aggressive search through', lines.length, 'lines');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Check if line contains any Medicare keyword
      if (def.keywords.some((keyword) => lower.includes(keyword))) {
        console.log('[MEDICARE FALLBACK] Found keyword at line', i, ':', line);

        // Try to extract from this line
        const amount = parseCurrencyFromLine(line);
        if (typeof amount === 'number' && amount > 0) {
          console.log('[MEDICARE FALLBACK] ✓ Found amount on same line:', amount);
          return amount;
        }

        // Look at next 5 lines for amounts
        for (let offset = 1; offset <= 5; offset++) {
          if (i + offset < lines.length) {
            const nextAmount = parseCurrencyFromLine(lines[i + offset]);
            if (typeof nextAmount === 'number' && nextAmount > 0) {
              console.log('[MEDICARE FALLBACK] ✓ Found amount at offset +', offset, ':', nextAmount);
              return nextAmount;
            }
          }
        }
      }
    }
    console.log('[MEDICARE FALLBACK] ✗ No amount found');
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

export const getDeductionValues = (data?: PayrollData, text?: string) => {
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

export const getDeductionYtdValues = (data?: PayrollData) => {
  const values: Record<string, number | undefined> = {};
  if (!data) return values;
  DEDUCTION_DEFS.forEach((def) => {
    const bucket = (data as any)[def.bucket];
    const amount = bucket?.[def.key]?.yearToDate;
    values[def.key] = typeof amount === 'number' ? amount : undefined;
  });
  return values;
};

// Lightweight client-side payroll parser (mirrors server logic)
export function extractPayrollData(text: string) {
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

  // Extract Social Security
  const ssPattern = /Social Security\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const ssMatch = text.match(ssPattern);
  if (ssMatch) {
    payrollData.statutoryDeductions.socialSecurity = {
      thisPeriod: parseFloat(ssMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(ssMatch[2].replace(/,/g, '')),
    };
  }

  // Extract Medicare - try multiple patterns for reliability
  const parseAmount = (amt: string) => {
    // Handle parentheses as negative
    const isNegative = amt.includes('(') && amt.includes(')');
    const cleaned = amt.replace(/[\$,()]/g, '');
    const value = parseFloat(cleaned);
    return isNaN(value) ? 0 : (isNegative ? -Math.abs(value) : value);
  };

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

  // Pattern 6: Line-by-line scan for Medicare + amount extraction
  if (!medicareMatch) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/medicare|med tax|fica med/i.test(line)) {
        // Check this line and next 3 lines for amounts
        const searchLines = lines.slice(i, i + 4).join(' ');
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

  // Extract Wisconsin State Income - multiple patterns for flexibility
  const wiStatePatterns = [
    /Wisconsin State Income\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /WI State Income\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /Wisconsin State Tax\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /WI State Tax\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /Wisconsin State Income[^\n]*?\s+([-\d,.]+)\s+([-\d,.]+)/i,
    /WI State[^\n]*?\s+([-\d,.]+)\s+([-\d,.]+)/i,
  ];

  let wiStateExtracted = false;
  for (const pattern of wiStatePatterns) {
    const wiStateMatch = text.match(pattern);
    if (wiStateMatch) {
      payrollData.statutoryDeductions.wisconsinStateIncome = {
        thisPeriod: parseFloat(wiStateMatch[1].replace(/,/g, '')),
        yearToDate: parseFloat(wiStateMatch[2].replace(/,/g, '')),
      };
      console.log('[WI STATE EXTRACTION] ✓ Found via regex:', {
        thisPeriod: wiStateMatch[1],
        yearToDate: wiStateMatch[2],
      });
      wiStateExtracted = true;
      break;
    }
  }

  // Fallback: Line-by-line scan for Wisconsin State Income
  if (!wiStateExtracted) {
    const wiKeywords = ['wisconsin state income', 'wi state income', 'wisconsin state tax', 'wi state tax', 'wisconsin income'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (wiKeywords.some(keyword => lower.includes(keyword))) {
        console.log('[WI STATE EXTRACTION] Found keyword at line', i, ':', line);

        // Try to extract from this line
        const amounts = line.match(/([-\d,.]+)\s+([-\d,.]+)/);
        if (amounts && amounts[1] && amounts[2]) {
          const val1 = parseFloat(amounts[1].replace(/,/g, ''));
          const val2 = parseFloat(amounts[2].replace(/,/g, ''));
          if (!isNaN(val1) && !isNaN(val2) && val1 > 0) {
            payrollData.statutoryDeductions.wisconsinStateIncome = {
              thisPeriod: val1,
              yearToDate: val2,
            };
            console.log('[WI STATE EXTRACTION] ✓ Found via line scan:', { thisPeriod: val1, yearToDate: val2 });
            wiStateExtracted = true;
            break;
          }
        }

        // Look at next 3 lines for amounts
        for (let offset = 1; offset <= 3; offset++) {
          if (i + offset < lines.length) {
            const nextLine = lines[i + offset];
            const nextAmounts = nextLine.match(/([-\d,.]+)\s+([-\d,.]+)/);
            if (nextAmounts && nextAmounts[1] && nextAmounts[2]) {
              const val1 = parseFloat(nextAmounts[1].replace(/,/g, ''));
              const val2 = parseFloat(nextAmounts[2].replace(/,/g, ''));
              if (!isNaN(val1) && !isNaN(val2) && val1 > 0) {
                payrollData.statutoryDeductions.wisconsinStateIncome = {
                  thisPeriod: val1,
                  yearToDate: val2,
                };
                console.log('[WI STATE EXTRACTION] ✓ Found at offset +', offset, ':', { thisPeriod: val1, yearToDate: val2 });
                wiStateExtracted = true;
                break;
              }
            }
          }
        }

        if (wiStateExtracted) break;
      }
    }

    if (!wiStateExtracted) {
      console.log('[WI STATE EXTRACTION] ✗ No match found, will rely on fallback guess');
    }
  }

  // Extract Arizona State Income - multiple patterns for flexibility
  const azStatePatterns = [
    /Arizona State Income\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /AZ State Income\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /Arizona State Tax\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /AZ State Tax\s*([-\d,.]+)\s*([-\d,.]+)/i,
    /Arizona State Income[^\n]*?\s+([-\d,.]+)\s+([-\d,.]+)/i,
    /Arizona State[^\n]*?\s+([-\d,.]+)\s+([-\d,.]+)/i,
    /AZ State[^\n]*?\s+([-\d,.]+)\s+([-\d,.]+)/i,
    /Arizona[^\n]*?Income[^\n]*?\s+([-\d,.]+)\s+([-\d,.]+)/i,
  ];

  let azStateExtracted = false;
  for (const pattern of azStatePatterns) {
    const azStateMatch = text.match(pattern);
    if (azStateMatch) {
      payrollData.statutoryDeductions.arizonaStateIncome = {
        thisPeriod: parseFloat(azStateMatch[1].replace(/,/g, '')),
        yearToDate: parseFloat(azStateMatch[2].replace(/,/g, '')),
      };
      console.log('[AZ STATE EXTRACTION] ✓ Found via regex:', {
        thisPeriod: azStateMatch[1],
        yearToDate: azStateMatch[2],
      });
      azStateExtracted = true;
      break;
    }
  }

  // Fallback: Line-by-line scan for Arizona State Income (similar to Medicare)
  if (!azStateExtracted) {
    const azKeywords = ['arizona state income', 'az state income', 'arizona state tax', 'az state tax', 'arizona income'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (azKeywords.some(keyword => lower.includes(keyword))) {
        console.log('[AZ STATE EXTRACTION] Found keyword at line', i, ':', line);

        // Try to extract from this line
        const amounts = line.match(/([-\d,.]+)\s+([-\d,.]+)/);
        if (amounts && amounts[1] && amounts[2]) {
          const val1 = parseFloat(amounts[1].replace(/,/g, ''));
          const val2 = parseFloat(amounts[2].replace(/,/g, ''));
          if (!isNaN(val1) && !isNaN(val2) && val1 > 0) {
            payrollData.statutoryDeductions.arizonaStateIncome = {
              thisPeriod: val1,
              yearToDate: val2,
            };
            console.log('[AZ STATE EXTRACTION] ✓ Found via line scan:', { thisPeriod: val1, yearToDate: val2 });
            azStateExtracted = true;
            break;
          }
        }

        // Look at next 3 lines for amounts
        for (let offset = 1; offset <= 3; offset++) {
          if (i + offset < lines.length) {
            const nextLine = lines[i + offset];
            const nextAmounts = nextLine.match(/([-\d,.]+)\s+([-\d,.]+)/);
            if (nextAmounts && nextAmounts[1] && nextAmounts[2]) {
              const val1 = parseFloat(nextAmounts[1].replace(/,/g, ''));
              const val2 = parseFloat(nextAmounts[2].replace(/,/g, ''));
              if (!isNaN(val1) && !isNaN(val2) && val1 > 0) {
                payrollData.statutoryDeductions.arizonaStateIncome = {
                  thisPeriod: val1,
                  yearToDate: val2,
                };
                console.log('[AZ STATE EXTRACTION] ✓ Found at offset +', offset, ':', { thisPeriod: val1, yearToDate: val2 });
                azStateExtracted = true;
                break;
              }
            }
          }
        }

        if (azStateExtracted) break;
      }
    }

    if (!azStateExtracted) {
      console.log('[AZ STATE EXTRACTION] ✗ No match found, will rely on fallback guess');
    }
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

  // Extract CalSavers Roth Ret % — matches "CalSavers Roth Ret %", "CalSavers Roth Ret", "Cal Savers Roth Ret %"
  const calSaversPattern = /Cal\s*Savers?\s+Roth\s+Ret\s*%?/i;
  const calSaversMatch = text.match(new RegExp(calSaversPattern.source + '\\s*([-\\d,.]+)\\s+([-\\d,.]+)', 'i'));
  if (calSaversMatch) {
    payrollData.voluntaryDeductions.calSaversRothRet = {
      thisPeriod: parseFloat(calSaversMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(calSaversMatch[2].replace(/,/g, '')),
    };
  }

  // Extract gross pay - multiple patterns for better coverage
  const grossPatterns = [
    /Gross Pay[:\s]+([-\d,.]+)/i,
    /Gross[:\s]+([-\d,.]+)/i,
    /Total Gross[:\s]+([-\d,.]+)/i,
    /Gross Earnings[:\s]+([-\d,.]+)/i,
  ];

  let grossExtracted = false;
  for (const pattern of grossPatterns) {
    const grossMatch = text.match(pattern);
    if (grossMatch) {
      payrollData.employeeInfo.grossPay = parseFloat(grossMatch[1].replace(/,/g, ''));
      console.log('[GROSS PAY EXTRACTION] ✓ Found via regex:', payrollData.employeeInfo.grossPay);
      grossExtracted = true;
      break;
    }
  }

  // Fallback: Line-by-line scan for Gross Pay
  if (!grossExtracted) {
    const grossKeywords = ['gross pay', 'gross', 'total gross', 'gross earnings'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (grossKeywords.some(keyword => lower.includes(keyword))) {
        console.log('[GROSS PAY EXTRACTION] Found keyword at line', i, ':', line);

        // Try to extract from this line
        const amounts = line.match(/([-\d,.]+)/g);
        if (amounts && amounts.length > 0) {
          // Take the last amount on the line (usually the current period)
          const val = parseFloat(amounts[amounts.length - 1].replace(/,/g, ''));
          if (!isNaN(val) && val > 0) {
            payrollData.employeeInfo.grossPay = val;
            console.log('[GROSS PAY EXTRACTION] ✓ Found via line scan:', val);
            grossExtracted = true;
            break;
          }
        }

        // Look at next 2 lines for amounts
        for (let offset = 1; offset <= 2; offset++) {
          if (i + offset < lines.length) {
            const nextLine = lines[i + offset];
            const nextAmounts = nextLine.match(/([-\d,.]+)/g);
            if (nextAmounts && nextAmounts.length > 0) {
              const val = parseFloat(nextAmounts[0].replace(/,/g, ''));
              if (!isNaN(val) && val > 0) {
                payrollData.employeeInfo.grossPay = val;
                console.log('[GROSS PAY EXTRACTION] ✓ Found at offset +', offset, ':', val);
                grossExtracted = true;
                break;
              }
            }
          }
        }

        if (grossExtracted) break;
      }
    }

    if (!grossExtracted) {
      console.log('[GROSS PAY EXTRACTION] ✗ No match found');
    }
  }

  // Extract net pay - multiple patterns for better coverage
  const netPatterns = [
    /Net Pay[:\s]+([-\d,.]+)/i,
    /Net[:\s]+([-\d,.]+)/i,
    /Total Net[:\s]+([-\d,.]+)/i,
    /Net Amount[:\s]+([-\d,.]+)/i,
    /Net Earnings[:\s]+([-\d,.]+)/i,
  ];

  let netExtracted = false;
  for (const pattern of netPatterns) {
    const netMatch = text.match(pattern);
    if (netMatch) {
      payrollData.employeeInfo.netPay = parseFloat(netMatch[1].replace(/,/g, ''));
      console.log('[NET PAY EXTRACTION] ✓ Found via regex:', payrollData.employeeInfo.netPay);
      netExtracted = true;
      break;
    }
  }

  // Fallback: Line-by-line scan for Net Pay
  if (!netExtracted) {
    const netKeywords = ['net pay', 'net amount', 'total net', 'net earnings'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (netKeywords.some(keyword => lower.includes(keyword))) {
        console.log('[NET PAY EXTRACTION] Found keyword at line', i, ':', line);

        // Try to extract from this line
        const amounts = line.match(/([-\d,.]+)/g);
        if (amounts && amounts.length > 0) {
          // Take the last amount on the line (usually the current period)
          const val = parseFloat(amounts[amounts.length - 1].replace(/,/g, ''));
          if (!isNaN(val) && val > 0) {
            payrollData.employeeInfo.netPay = val;
            console.log('[NET PAY EXTRACTION] ✓ Found via line scan:', val);
            netExtracted = true;
            break;
          }
        }

        // Look at next 2 lines for amounts
        for (let offset = 1; offset <= 2; offset++) {
          if (i + offset < lines.length) {
            const nextLine = lines[i + offset];
            const nextAmounts = nextLine.match(/([-\d,.]+)/g);
            if (nextAmounts && nextAmounts.length > 0) {
              const val = parseFloat(nextAmounts[0].replace(/,/g, ''));
              if (!isNaN(val) && val > 0) {
                payrollData.employeeInfo.netPay = val;
                console.log('[NET PAY EXTRACTION] ✓ Found at offset +', offset, ':', val);
                netExtracted = true;
                break;
              }
            }
          }
        }

        if (netExtracted) break;
      }
    }

    if (!netExtracted) {
      console.log('[NET PAY EXTRACTION] ✗ No match found');
    }
  }

  // Extract pay period dates - try multiple patterns
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  // Pattern 1: "Pay Period: MM/DD/YYYY to MM/DD/YYYY" or "Period: MM/DD/YYYY - MM/DD/YYYY"
  const periodPattern1 = /(?:Pay Period|Period)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:to|-)?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})?/i;
  const periodMatch1 = text.match(periodPattern1);
  if (periodMatch1) {
    periodStart = periodMatch1[1];
    periodEnd = periodMatch1[2] || periodMatch1[1];
  }

  // Pattern 2: "Period Starting: MM/DD/YYYY" and "Period Ending: MM/DD/YYYY"
  const startPattern = /(?:Period Starting|Starting|Period Start|Start Date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
  const endPattern = /(?:Period Ending|Ending|Period End|End Date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
  const startMatch = text.match(startPattern);
  const endMatch = text.match(endPattern);

  if (startMatch) {
    periodStart = startMatch[1];
  }
  if (endMatch) {
    periodEnd = endMatch[1];
  }

  // If we have Period End but no Period Start, calculate start as 13 days before end
  if (!periodStart && periodEnd) {
    try {
      const endDate = new Date(periodEnd);
      if (!isNaN(endDate.getTime())) {
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 13);
        const month = String(startDate.getMonth() + 1).padStart(2, '0');
        const day = String(startDate.getDate()).padStart(2, '0');
        const year = startDate.getFullYear();
        periodStart = `${month}/${day}/${year}`;
        console.log('[PAY PERIOD EXTRACTION] ℹ️ Calculated Period Start (13 days before end):', periodStart);
      }
    } catch (err) {
      console.log('[PAY PERIOD EXTRACTION] ⚠️ Failed to calculate start date from end date');
    }
  }

  // If we found at least one date, set the pay period
  if (periodStart || periodEnd) {
    payrollData.employeeInfo.payPeriod = {
      start: periodStart || '',
      end: periodEnd || periodStart || '',
    };
    console.log('[PAY PERIOD EXTRACTION] ✓ Success:', {
      start: periodStart,
      end: periodEnd,
    });
  } else {
    console.log('[PAY PERIOD EXTRACTION] ✗ No pay period dates found');
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

  // Extract account number - try multiple patterns
  let accountNumber: string | null = null;

  // Pattern 1: "Account Number: XXXXX" or "Account #: XXXXX"
  const accountPattern1 = /(?:Account\s*(?:Number|#)?|Acct\s*(?:Number|#)?)[:\s]+([\d-]+)/i;
  const accountMatch1 = text.match(accountPattern1);
  if (accountMatch1) {
    accountNumber = accountMatch1[1];
    console.log('[ACCOUNT NUMBER EXTRACTION] ✓ Pattern 1 found:', accountNumber);
  }

  // Pattern 2: Line-by-line search for "Account" keyword
  if (!accountNumber) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('account') && !line.includes('total') && !line.includes('balance')) {
        // Look for numbers in this line or next 2 lines
        const searchLines = lines.slice(i, i + 3).join(' ');
        const numberMatch = searchLines.match(/(\d{3,}(?:-\d+)*)/);
        if (numberMatch) {
          accountNumber = numberMatch[1];
          console.log('[ACCOUNT NUMBER EXTRACTION] ✓ Pattern 2 (line scan) found:', accountNumber);
          break;
        }
      }
    }
  }

  if (accountNumber) {
    payrollData.employeeInfo.accountNumber = accountNumber;
  } else {
    console.log('[ACCOUNT NUMBER EXTRACTION] ✗ No account number found');
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

  // Helper: find a line starting with the label and return the last two numbers on it.
  // Handles rows that may have rate+hours before thisPeriod+ytd (e.g. Commission 28.50 120.00 3,420.00 3,420.00).
  // Split text into lines, find the first line matching the label, then take the last 1-4 numeric tokens.
  // Using lines prevents numbers from neighbouring rows bleeding in when pdf-parse emits little/no newlines.
  const textLines = text.split(/\r?\n|\r/);
  const amountTokenPattern = /\(?-?\$?\s*\d[\d,.]*\)?/g;
  const amountRunPattern = /^((?:\s*\(?-?\$?\s*\d[\d,.]*\)?){1,4})/;
  const parseAmountToken = (token: string): number | null => {
    const raw = token.trim();
    const isNegative = raw.startsWith('-') || /^\(.*\)$/.test(raw);
    const cleaned = raw.replace(/[()$,\s]/g, '').replace(/^-/, '');
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;
    return isNegative ? -Math.abs(n) : n;
  };
  const numbersFromAmountRun = (run: string) =>
    (run.match(amountTokenPattern) || [])
      .map(parseAmountToken)
      .filter((n): n is number => n !== null && n >= 0);

  const extractEarningsLine = (labelPattern: RegExp): { thisPeriod: number; yearToDate: number } | null => {
    for (const line of textLines) {
      if (!labelPattern.test(line)) continue;
      // Extract only the contiguous number-run that starts right after the label (stops at first letter)
      const afterLabel = line.replace(new RegExp('^.*?' + labelPattern.source, 'i'), '');
      const runMatch = afterLabel.match(amountRunPattern);
      if (!runMatch) continue;
      const nums = numbersFromAmountRun(runMatch[1]);
      if (nums.length >= 2) return { thisPeriod: nums[nums.length - 2], yearToDate: nums[nums.length - 1] };
      if (nums.length === 1) return { thisPeriod: 0, yearToDate: nums[0] };
    }
    // Fallback: scan full text for the label then grab a number-run (handles no-newline pdf-parse output)
    const pattern = new RegExp(labelPattern.source + '((?:\\s*\\(?-?\\$?\\s*\\d[\\d,.]*\\)?){1,4})', labelPattern.flags);
    const match = text.match(pattern);
    if (!match || !match[1]) return null;
    const nums = numbersFromAmountRun(match[1]);
    if (nums.length >= 2) return { thisPeriod: nums[nums.length - 2], yearToDate: nums[nums.length - 1] };
    if (nums.length === 1) return { thisPeriod: 0, yearToDate: nums[0] };
    return null;
  };

  // Extract earnings - Regular, Overtime, Double Time
  // Negative lookahead prevents matching "Regular Hours" (hours label, not earnings pay row)
  const regResult = extractEarningsLine(/Regular(?!\s+Hours)\b/i);
  if (regResult) {
    payrollData.earnings.regular = regResult;
  }

  const otResult = extractEarningsLine(/(?:Overtime|OT)\b/i);
  if (otResult) {
    payrollData.earnings.overtime = otResult;
  }

  const dtResult = extractEarningsLine(/Double\s+Time\b/i);
  if (dtResult) {
    payrollData.earnings.doubleTime = dtResult;
  }

  // Extract Commission
  const commResult = extractEarningsLine(/Commission\b/i);
  if (commResult) payrollData.earnings.commission = commResult;

  // Extract Variable Incentive
  const viResult = extractEarningsLine(/Variable\s+Incentive\b/i);
  if (viResult) payrollData.earnings.variableIncentive = viResult;

  // Extract Credit Card Tips Owed
  const tipsResult = extractEarningsLine(/Credit\s+card\s+tips\s+owed\b/i);
  if (tipsResult) payrollData.earnings.creditCardTips = tipsResult;

  // Extract Rest Break Pay (also matches "Rest Pay")
  const rbResult = extractEarningsLine(/Rest\s+(?:Break\s+)?Pay\b/i);
  if (rbResult) payrollData.earnings.restBreakPay = rbResult;

  // Extract Travel Pay (ADP labels it just "Travel"; never a travel reimbursement line)
  const travelResult = extractEarningsLine(/Travel(?:\s+(?:Pay|Time))?\b(?!\s*Reimb)/i);
  if (travelResult) payrollData.earnings.travelPay = travelResult;

  // Extract Bonus
  const bonusResult = extractEarningsLine(/Bonus\b/i);
  if (bonusResult) payrollData.earnings.bonus = bonusResult;

  // Extract Sick Pay
  const sickResult = extractEarningsLine(/Sick(?:\s+Pay)?\b/i);
  if (sickResult) payrollData.earnings.sickPay = sickResult;

  // Extract Meal Premium
  const mealResult = extractEarningsLine(/Meal\s+(?:Time\s+|Break\s+|Period\s+)?(?:Premium|Prem)(?:\s+Pay)?\b/i);
  if (mealResult) payrollData.earnings.mealPremium = mealResult;

  // Extract Holiday Pay (ADP labels it just "Holiday"; "Holidays" in a message does not match)
  const holidayResult = extractEarningsLine(/Holiday(?:\s+Pay)?\b/i);
  if (holidayResult) payrollData.earnings.holidayPay = holidayResult;

  // Net pay adjustments (placed after extractEarningsLine definition)
  const miscReimbResult = extractEarningsLine(/Misc\s+(?:Non\s+Taxable\s+)?[Rr]eimb(?:ursement)?\b/i);
  if (miscReimbResult) payrollData.netPayAdjustments.miscReimbursement = miscReimbResult;

  // Equipment Reimbursement — covers "Equipment Reimbursement", "Equipment Reimb", "Misc reimburse Equipment"
  const equipReimbResult = extractEarningsLine(/(?:Misc\s+[Rr]eimburse(?:ment)?\s+)?Equip(?:ment)?(?:\s+[Rr]eimb(?:ursement)?)?\b/i);
  if (equipReimbResult) payrollData.netPayAdjustments.equipmentReimbursement = equipReimbResult;

  // Mileage Reimbursement — covers "Mileage Reimbursement", "Mileage Reimb"
  const mileageReimbResult = extractEarningsLine(/Mileage\s+(?:Reimb(?:ursement)?\.?|Reimburse(?:ment)?|Reimbursed|Pay|Allowance)(?:\b|\.)/i);
  if (mileageReimbResult) payrollData.netPayAdjustments.mileageReimbursement = mileageReimbResult;

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

  const grossPayLine = lines.find((line) => /\bGross\s+Pay\b/i.test(line));
  if (grossPayLine) {
    const grossAmounts = numbersFromAmountRun(grossPayLine);
    if (grossAmounts.length >= 2) {
      payrollData.employeeInfo.grossPay = grossAmounts[grossAmounts.length - 2];
      payrollData.employeeInfo.ytdGross = grossAmounts[grossAmounts.length - 1];
    } else if (grossAmounts.length === 1 && typeof payrollData.employeeInfo.grossPay !== 'number') {
      payrollData.employeeInfo.grossPay = grossAmounts[0];
    }
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

/**
 * Detect which state the paystub is from based on address or state-specific deductions
 */
export const detectState = (payrollData: PayrollData): string | null => {
  // Check employee address first
  const address = payrollData?.employeeInfo?.address?.toUpperCase() || '';

  // US state abbreviations and names (including states with NO income tax)
  const statePatterns: Record<string, RegExp[]> = {
    // States with NO income tax
    'NV': [/\bNV\b/, /\bNEVADA\b/],
    'WY': [/\bWY\b/, /\bWYOMING\b/],
    'SD': [/\bSD\b/, /\bSOUTH DAKOTA\b/],
    'TX': [/\bTX\b/, /\bTEXAS\b/],
    'FL': [/\bFL\b/, /\bFLORIDA\b/],
    'AK': [/\bAK\b/, /\bALASKA\b/],
    'TN': [/\bTN\b/, /\bTENNESSEE\b/],
    'NH': [/\bNH\b/, /\bNEW HAMPSHIRE\b/],
    'WA': [/\bWA\b/, /\bWASHINGTON\b/],

    // States with income tax (common ones)
    'CA': [/\bCA\b/, /\bCALIFORNIA\b/],
    'WI': [/\bWI\b/, /\bWISCONSIN\b/],
    'NY': [/\bNY\b/, /\bNEW YORK\b/],
    'IL': [/\bIL\b/, /\bILLINOIS\b/],
    'PA': [/\bPA\b/, /\bPENNSYLVANIA\b/],
    'OH': [/\bOH\b/, /\bOHIO\b/],
    'MI': [/\bMI\b/, /\bMICHIGAN\b/],
    'GA': [/\bGA\b/, /\bGEORGIA\b/],
    'NC': [/\bNC\b/, /\bNORTH CAROLINA\b/],
    'NJ': [/\bNJ\b/, /\bNEW JERSEY\b/],
    'VA': [/\bVA\b/, /\bVIRGINIA\b/],
    'MA': [/\bMA\b/, /\bMASSACHUSETTS\b/],
    'AZ': [/\bAZ\b/, /\bARIZONA\b/],
    'CO': [/\bCO\b/, /\bCOLORADO\b/],
    'OR': [/\bOR\b/, /\bOREGON\b/],
    'MN': [/\bMN\b/, /\bMINNESOTA\b/],
    'MD': [/\bMD\b/, /\bMARYLAND\b/],
  };

  for (const [stateCode, patterns] of Object.entries(statePatterns)) {
    if (patterns.some(pattern => pattern.test(address))) {
      return stateCode;
    }
  }

  // Check for state-specific deductions
  const deductions = payrollData?.statutoryDeductions || {};
  if (deductions.californiaStateIncome || deductions.californiaStateDI) {
    return 'CA';
  }
  if (deductions.wisconsinStateIncome) {
    return 'WI';
  }
  if (deductions.arizonaStateIncome) {
    return 'AZ';
  }

  return null; // Unknown state
};

/**
 * Check if page has federal deductions (Federal Income, Social Security, Medicare)
 * These are mandatory on all US paystubs
 */
export const hasFederalDeductions = (payrollData: PayrollData): boolean => {
  const deductions = payrollData?.statutoryDeductions || {};
  const hasFederal = typeof deductions.federalIncome?.thisPeriod === 'number';
  const hasSocialSecurity = typeof deductions.socialSecurity?.thisPeriod === 'number';
  const hasMedicare = typeof deductions.medicare?.thisPeriod === 'number';
  return hasFederal && hasSocialSecurity && hasMedicare;
};

/**
 * Check if page has state income deduction (if required for the detected state)
 */
export const hasStateIncome = (payrollData: PayrollData): boolean => {
  const deductions = payrollData?.statutoryDeductions || {};
  const detectedState = detectState(payrollData);
  const hasStateIncomeValue =
    typeof deductions.californiaStateIncome?.thisPeriod === 'number' ||
    typeof deductions.wisconsinStateIncome?.thisPeriod === 'number' ||
    typeof deductions.arizonaStateIncome?.thisPeriod === 'number';

  // States with NO income tax (exempt from state income requirement)
  const statesWithNoIncomeTax = ['NV', 'WY', 'SD', 'TX', 'FL', 'AK', 'TN', 'NH', 'WA'];
  const stateIncomeRequired = !statesWithNoIncomeTax.includes(detectedState || '');

  // If state income is required, check if we have it; otherwise it's valid
  return !stateIncomeRequired || hasStateIncomeValue;
};

/**
 * Check if page has all required deductions (federal + state)
 */
export const hasRequiredDeductions = (payrollData: PayrollData): boolean => {
  return hasFederalDeductions(payrollData) && hasStateIncome(payrollData);
};

/**
 * Get state income value from payroll data
 */
export const getStateIncomeValue = (payrollData: PayrollData): number | null => {
  const deductions = payrollData?.statutoryDeductions || {};
  return deductions.californiaStateIncome?.thisPeriod ??
         deductions.wisconsinStateIncome?.thisPeriod ??
         deductions.arizonaStateIncome?.thisPeriod ??
         null;
};

/**
 * Extract payroll data from page using AI vision (fallback method)
 */
export const extractWithVision = async (canvas: HTMLCanvasElement, pageNum: number): Promise<PayrollData | null> => {
  try {
    console.log(`[VISION] Starting AI vision extraction for page ${pageNum}...`);

    // Convert canvas to base64 image
    const base64Image = canvas.toDataURL('image/png').split(',')[1];

    // Call vision API
    const visionResponse = await fetch('/api/extract-with-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, pageNumber: pageNum }),
    });

    if (!visionResponse.ok) {
      throw new Error('Vision API failed');
    }

    const visionData = await visionResponse.json();
    console.log(`[VISION] Page ${pageNum}: ✓ AI vision extraction successful`);

    // Use detected state from vision API or fallback to detecting from address
    let detectedState = visionData.payrollData.detectedState;

    // If vision didn't detect state, try to detect from address
    if (!detectedState) {
      const initialData: PayrollData = {
        employeeInfo: {
          name: visionData.payrollData.employeeName,
          ssn: visionData.payrollData.ssn,
          address: visionData.payrollData.address,
          payPeriod: visionData.payrollData.payPeriod,
          payDate: visionData.payrollData.payDate,
          grossPay: visionData.payrollData.grossPay,
          netPay: visionData.payrollData.netPay,
        },
        statutoryDeductions: {},
        voluntaryDeductions: {},
        netPayAdjustments: {},
        earnings: {},
        hours: {},
        allExtractedData: {},
      };
      detectedState = detectState(initialData);
    }

    console.log(`[VISION] Page ${pageNum}: Detected state: ${detectedState || 'UNKNOWN'}`);

    // Build statutory deductions with state-specific mapping
    const statutoryDeductions: any = {
      federalIncome: visionData.payrollData.deductions.federalIncome,
      socialSecurity: visionData.payrollData.deductions.socialSecurity,
      medicare: visionData.payrollData.deductions.medicare,
    };

    // Map state income to the correct state field
    if (visionData.payrollData.deductions.stateIncome) {
      if (detectedState === 'CA') {
        statutoryDeductions.californiaStateIncome = visionData.payrollData.deductions.stateIncome;
        statutoryDeductions.californiaStateDI = visionData.payrollData.deductions.stateDI;
      } else if (detectedState === 'WI') {
        statutoryDeductions.wisconsinStateIncome = visionData.payrollData.deductions.stateIncome;
      } else if (detectedState === 'AZ') {
        statutoryDeductions.arizonaStateIncome = visionData.payrollData.deductions.stateIncome;
      } else {
        // Unknown state - default to California for backwards compatibility
        statutoryDeductions.californiaStateIncome = visionData.payrollData.deductions.stateIncome;
        statutoryDeductions.californiaStateDI = visionData.payrollData.deductions.stateDI;
      }
    }

    // Convert vision API format to our payroll data format
    const convertedData: PayrollData = {
      employeeInfo: {
        name: visionData.payrollData.employeeName,
        ssn: visionData.payrollData.ssn,
        address: visionData.payrollData.address,
        payPeriod: visionData.payrollData.payPeriod,
        payDate: visionData.payrollData.payDate,
        grossPay: visionData.payrollData.grossPay,
        netPay: visionData.payrollData.netPay,
      },
      statutoryDeductions,
      voluntaryDeductions: {},
      netPayAdjustments: {},
      earnings: {},
      hours: {},
      allExtractedData: {},
    };

    // Log extracted deductions for debugging
    const visionDeductions = convertedData.statutoryDeductions;
    const visionStateIncome =
      visionDeductions.californiaStateIncome?.thisPeriod ||
      visionDeductions.wisconsinStateIncome?.thisPeriod ||
      visionDeductions.arizonaStateIncome?.thisPeriod;

    console.log(`[VISION] Page ${pageNum}: Extracted deductions:`, {
      name: convertedData.employeeInfo.name,
      state: detectState(convertedData) || 'UNKNOWN',
      federalIncome: visionDeductions.federalIncome?.thisPeriod ?? 'NOT FOUND',
      socialSecurity: visionDeductions.socialSecurity?.thisPeriod ?? 'NOT FOUND',
      medicare: visionDeductions.medicare?.thisPeriod ?? 'NOT FOUND',
      stateIncome: visionStateIncome ?? 'NOT FOUND',
    });

    return convertedData;
  } catch (error) {
    console.error(`[VISION] Page ${pageNum}: Vision extraction failed:`, error);
    return null;
  }
};

/**
 * Client-side OCR using Tesseract.js and PDF.js from CDN
 * Extracts ALL visible text from the PDF PER PAGE
 * Uses AI vision as fallback if required deductions are missing
 */
export const performClientSideOcr = async (pdfFile: File, hooks: OcrHooks = {}) => {
  hooks.onOcrStart?.();

  try {
    console.log('[OCR] Starting client-side OCR...');

    // Check if PDF.js is loaded (load it from the CDN if the page hasn't yet)
    if (!window.pdfjsLib) {
      await ensurePdfJsLoaded().catch(() => undefined);
    }
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library not loaded yet. Please try again in a moment.');
    }

    console.log('[OCR] PDF.js available, loading PDF...');

    // Load PDF using CDN-loaded library
    const arrayBuffer = await pdfFile.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    console.log(`[OCR] PDF loaded. ${pdf.numPages} pages total`);

    const pageDataArray: Array<{
      pageNumber: number;
      text: string;
      payrollData: PayrollData;
      extractionMethod?: 'llm' | 'regex' | 'vision' | 'hybrid';
    }> = [];
    let allOcrText = '';
    const pagesToProcess = pdf.numPages;

    // Store pay period and pay date from first page to replicate across all pages
    let firstPagePayPeriod: { start: string; end: string } | null = null;
    let firstPagePayDate: string | null = null;

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      console.log(`[OCR] Processing page ${pageNum}/${pagesToProcess}...`);

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });

      // Create canvas and render PDF page
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Could not get canvas 2D context');
      }
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      console.log(`[OCR] Rendering page ${pageNum} to canvas...`);
      await page.render({ canvasContext: context, viewport: viewport }).promise;

      // Convert canvas to blob for Tesseract
      console.log(`[OCR] Converting page ${pageNum} to image...`);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to convert canvas to blob'));
        }, 'image/png');
      });

      // Perform OCR on this page
      console.log(`[OCR] Running Tesseract on page ${pageNum}...`);
      const result = await Tesseract.recognize(blob, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            hooks.onOcrProgress?.({ page: pageNum, progress: m.progress, total: pdf.numPages });
          }
        },
      });

      const pageText = result.data.text;
      console.log(`[OCR] Page ${pageNum} extracted ${pageText.length} characters`);

      // Step 1: Try LLM extraction first
      let pagePayrollData: PayrollData | null = null;
      let extractionMethod: 'llm' | 'regex' | 'vision' | 'hybrid' = 'regex';
      let regexData: PayrollData | null = null;

      try {
        console.log(`[OCR] Page ${pageNum}: Attempting LLM extraction...`);
        const extractResponse = await fetch('/api/extract-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pageText, pageNumber: pageNum }),
        });

        if (extractResponse.ok) {
          const extractData = await extractResponse.json();
          pagePayrollData = extractData.payrollData;
          extractionMethod = 'llm';
          console.log(`[OCR] Page ${pageNum}: ✓ LLM extraction successful`);
        } else {
          throw new Error('LLM extraction API failed');
        }
      } catch (llmError) {
        console.log(`[OCR] Page ${pageNum}: LLM extraction failed, using regex fallback`);
        pagePayrollData = extractPayrollData(pageText);
        extractionMethod = 'regex';
      }

      // Always extract with regex for state income comparison
      regexData = extractPayrollData(pageText);

      // Step 2: Check if federal deductions are present (Federal Income, SS, Medicare)
      if (pagePayrollData) {
        const hasFederal = hasFederalDeductions(pagePayrollData);
        const hasState = hasStateIncome(pagePayrollData);
        const deductions = pagePayrollData.statutoryDeductions || {};
        const detectedState = detectState(pagePayrollData);
        const stateIncome = getStateIncomeValue(pagePayrollData);

        const statesWithNoIncomeTax = ['NV', 'WY', 'SD', 'TX', 'FL', 'AK', 'TN', 'NH', 'WA'];
        const isNoIncomeTaxState = statesWithNoIncomeTax.includes(detectedState || '');

        console.log(`[OCR] Page ${pageNum}: Deduction check (${extractionMethod}):`, {
          state: detectedState || 'UNKNOWN',
          federalIncome: deductions.federalIncome?.thisPeriod ?? 'MISSING',
          socialSecurity: deductions.socialSecurity?.thisPeriod ?? 'MISSING',
          medicare: deductions.medicare?.thisPeriod ?? 'MISSING',
          stateIncome: isNoIncomeTaxState
            ? `N/A (${detectedState} has no state income tax)`
            : stateIncome ?? 'MISSING',
        });

        // Step 3: If federal deductions are missing, use AI vision as fallback
        if (!hasFederal) {
          console.warn(`[OCR] Page ${pageNum}: ⚠️ Federal deductions missing! Trying AI vision fallback...`);
          const visionData = await extractWithVision(canvas, pageNum);

          if (visionData && hasFederalDeductions(visionData)) {
            console.log(`[OCR] Page ${pageNum}: ✓ Vision fallback successful - federal deductions found!`);
            pagePayrollData = visionData;
            extractionMethod = 'vision';
          } else {
            console.warn(`[OCR] Page ${pageNum}: ⚠️ Vision fallback did not find federal deductions, keeping ${extractionMethod} result`);
          }
        }

        // Step 4: HYBRID APPROACH - Assess state income separately
        // Compare regex vs vision for state income accuracy
        if (!isNoIncomeTaxState && pagePayrollData && regexData) {
          const currentStateIncome = getStateIncomeValue(pagePayrollData);
          const regexStateIncome = getStateIncomeValue(regexData);

          console.log(`[OCR] Page ${pageNum}: State income assessment:`, {
            currentMethod: extractionMethod,
            currentValue: currentStateIncome ?? 'MISSING',
            regexValue: regexStateIncome ?? 'MISSING',
          });

          // If current method is missing state income but regex has it, use regex for state
          if (!currentStateIncome && regexStateIncome && regexStateIncome > 0) {
            console.log(`[OCR] Page ${pageNum}: ✓ Regex has better state income - using hybrid approach`);

            // Create hybrid data: federal from current method, state from regex
            const regexDeductions = regexData.statutoryDeductions || {};
            const hybridDeductions = {
              ...pagePayrollData.statutoryDeductions,
              californiaStateIncome: regexDeductions.californiaStateIncome || pagePayrollData.statutoryDeductions.californiaStateIncome,
              wisconsinStateIncome: regexDeductions.wisconsinStateIncome || pagePayrollData.statutoryDeductions.wisconsinStateIncome,
              arizonaStateIncome: regexDeductions.arizonaStateIncome || pagePayrollData.statutoryDeductions.arizonaStateIncome,
            };

            pagePayrollData = {
              ...pagePayrollData,
              statutoryDeductions: hybridDeductions,
            };
            extractionMethod = 'hybrid';
          }

          // Try vision if both current and regex are missing state income
          if (!currentStateIncome && !regexStateIncome) {
            console.warn(`[OCR] Page ${pageNum}: ⚠️ State income missing in both ${extractionMethod} and regex! Trying vision...`);
            const visionData = await extractWithVision(canvas, pageNum);
            const visionStateIncome = visionData ? getStateIncomeValue(visionData) : null;

            if (visionStateIncome && visionStateIncome > 0 && visionData) {
              console.log(`[OCR] Page ${pageNum}: ✓ Vision found state income: $${visionStateIncome}`);

              // Create hybrid: federal from current, state from vision
              const visionDeductions = visionData.statutoryDeductions || {};
              const hybridDeductions = {
                ...pagePayrollData.statutoryDeductions,
                californiaStateIncome: visionDeductions.californiaStateIncome || pagePayrollData.statutoryDeductions.californiaStateIncome,
                wisconsinStateIncome: visionDeductions.wisconsinStateIncome || pagePayrollData.statutoryDeductions.wisconsinStateIncome,
                arizonaStateIncome: visionDeductions.arizonaStateIncome || pagePayrollData.statutoryDeductions.arizonaStateIncome,
              };

              pagePayrollData = {
                ...pagePayrollData,
                statutoryDeductions: hybridDeductions,
              };
              extractionMethod = 'hybrid';
            }
          }
        }

        // Final validation
        const finalHasFederal = hasFederalDeductions(pagePayrollData);
        const finalHasState = hasStateIncome(pagePayrollData);
        const finalStateIncome = getStateIncomeValue(pagePayrollData);

        console.log(`[OCR] Page ${pageNum}: ✓ Final extraction via ${extractionMethod}:`, {
          federalComplete: finalHasFederal,
          stateComplete: finalHasState,
          stateValue: finalStateIncome ?? (isNoIncomeTaxState ? 'N/A' : 'MISSING'),
        });
      }

      // Capture pay period and pay date from first page
      if (pageNum === 1 && pagePayrollData) {
        firstPagePayPeriod = pagePayrollData.employeeInfo?.payPeriod || null;
        firstPagePayDate = pagePayrollData.employeeInfo?.payDate || null;
        console.log('[OCR] Page 1: Captured pay period and pay date:', {
          payPeriod: firstPagePayPeriod,
          payDate: firstPagePayDate,
        });
      }

      // Replicate first page's pay period and pay date to subsequent pages
      if (pageNum > 1 && pagePayrollData && (firstPagePayPeriod || firstPagePayDate)) {
        if (firstPagePayPeriod) {
          pagePayrollData.employeeInfo.payPeriod = firstPagePayPeriod;
        }
        if (firstPagePayDate) {
          pagePayrollData.employeeInfo.payDate = firstPagePayDate;
        }
        console.log(`[OCR] Page ${pageNum}: Replicated pay dates from page 1:`, {
          payPeriod: firstPagePayPeriod,
          payDate: firstPagePayDate,
        });
      }

      // Only include pages that have some meaningful data
      const hasData =
        pagePayrollData?.employeeInfo?.name ||
        pagePayrollData?.employeeInfo?.ssn ||
        Object.keys(pagePayrollData?.statutoryDeductions || {}).length > 0 ||
        Object.keys(pagePayrollData?.voluntaryDeductions || {}).length > 0;

      if (hasData && pagePayrollData) {
        pageDataArray.push({
          pageNumber: pageNum,
          text: `=== Page ${pageNum} ===\n${pageText}`,
          payrollData: pagePayrollData,
          extractionMethod: extractionMethod,
        });
      }

      allOcrText += `\n\n=== Page ${pageNum} ===\n${pageText}`;
    }

    console.log(`[OCR] Complete! Total text extracted: ${allOcrText.length} characters`);
    console.log(`[OCR] Pages with payroll data: ${pageDataArray.length}`);

    return {
      allText: allOcrText,
      pageDataArray: pageDataArray,
    };
  } catch (err) {
    console.error('[OCR] Error:', err);
    throw err;
  } finally {
    hooks.onOcrEnd?.();
  }
};

/**
 * Main extraction entry point, identical to /pdf-reader:
 * 1. Calls /api/extract-pdf for server-side text extraction and image-based detection
 * 2. If the PDF is image-based, runs client-side OCR (PDF.js + Tesseract) with the
 *    LLM / regex / AI-vision fallbacks above
 */
export const extractPdfPayroll = async (pdfFile: File, hooks: OcrHooks = {}): Promise<ExtractResponse> => {
  console.log('[PDF-READER] Starting extraction...');

  // Step 1: Call API for server-side extraction
  const formData = new FormData();
  formData.append('pdf', pdfFile);

  console.log('[PDF-READER] Calling server API...');
  const response = await fetch('/api/extract-pdf', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to extract PDF');
  }

  const data: ExtractResponse = await response.json();
  console.log('[PDF-READER] Server extraction complete');
  console.log('[PDF-READER] Text length:', data.debug?.textLength);
  console.log('[PDF-READER] Image-based:', data.debug?.isImageBased);

  // Step 2: Check if this is an image-based PDF
  if (!data.debug?.isImageBased) {
    console.log('[PDF-READER] Text-based PDF - OCR not needed');
    return data;
  }

  console.log('='.repeat(80));
  console.log('[PDF-READER] IMAGE-BASED PDF DETECTED!');
  console.log('[PDF-READER] Starting automatic OCR...');
  console.log('='.repeat(80));

  const ocrResult = await performClientSideOcr(pdfFile, hooks);
  const ocrText = ocrResult.allText;
  const ocrPageDataArray = ocrResult.pageDataArray;

  // Parse OCR text for structured payroll data (backward compatibility)
  console.log('[PDF-READER] Parsing OCR text for payroll data...');
  const ocrPayrollData = extractPayrollData(ocrText);
  console.log('[PDF-READER] OCR Payroll Data (entire doc):', JSON.stringify(ocrPayrollData, null, 2));
  console.log('[PDF-READER] OCR Pages with data:', ocrPageDataArray.length);

  // Combine OCR text with original extraction
  const updatedData: ExtractResponse = {
    ...data,
    text: `=== OCR EXTRACTION (All Visible Text) ===\n${ocrText}\n\n=== ORIGINAL EXTRACTION ===\n${data.text}`,
    payrollData: ocrPayrollData, // Use OCR-extracted payroll data (backward compatibility - entire document)
    payrollDataByPage: ocrPageDataArray, // NEW: Per-page OCR data
    debug: {
      ...data.debug,
      textLength: ocrText.length,
      pagesWithData: ocrPageDataArray.length,
      ocrPerformed: true,
      ocrSuccess: true,
      hasEmployeeInfo: Object.keys(ocrPayrollData.employeeInfo || {}).length > 0,
      hasEarnings: Object.keys(ocrPayrollData.earnings || {}).length > 0,
      hasHours: Object.keys(ocrPayrollData.hours || {}).length > 0,
      allExtractedDataCount: Object.keys(ocrPayrollData.allExtractedData || {}).length,
    }
  };

  console.log('[PDF-READER] OCR completed successfully');
  console.log('[PDF-READER] Paystubs found per page:', ocrPageDataArray.length);
  return updatedData;
};

export const determineRowState = (data?: PayrollData) => {
  if (!data) return undefined;
  const stateCounts = new Map<string, number>();
  DEDUCTION_DEFS.forEach((def) => {
    if (!def.stateCode) return;
    const amount = data[def.bucket]?.[def.key]?.thisPeriod;
    if (typeof amount === 'number') {
      stateCounts.set(def.stateCode, (stateCounts.get(def.stateCode) || 0) + 1);
    }
  });
  if (stateCounts.get('WI')) return 'WI';
  if (stateCounts.get('AZ')) return 'AZ';
  if (stateCounts.get('CA')) return 'CA';
  return undefined;
};
