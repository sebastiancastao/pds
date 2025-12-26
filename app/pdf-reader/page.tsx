'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import Tesseract from 'tesseract.js';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

// Extend window type to include PDF.js global
declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

type PayrollData = Record<string, any>;

type ExtractResponse = {
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
  stateCode?: 'CA' | 'WI' | 'AZ';
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

  // Extract Misc reimbursement
  const miscReimbPattern = /Misc reimbursement\s*([-\d,.]+)\s*([-\d,.]+)/i;
  const miscReimbMatch = text.match(miscReimbPattern);
  if (miscReimbMatch) {
    payrollData.netPayAdjustments.miscReimbursement = {
      thisPeriod: parseFloat(miscReimbMatch[1].replace(/,/g, '')),
      yearToDate: parseFloat(miscReimbMatch[2].replace(/,/g, '')),
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

function StructuredPayrollGrid({ payrollInfo }: { payrollInfo: PayrollData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Employee</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Name</span>
            <span className="font-medium text-slate-900">{payrollInfo.employeeInfo?.name || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">SSN</span>
            <span className="font-medium text-slate-900">{payrollInfo.employeeInfo?.ssn || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pay period</span>
            <span className="font-medium text-slate-900">
              {payrollInfo.employeeInfo?.payPeriod?.start || '--'}{' '}
              {payrollInfo.employeeInfo?.payPeriod?.end ? `-> ${payrollInfo.employeeInfo?.payPeriod?.end}` : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pay date</span>
            <span className="font-medium text-slate-900">{payrollInfo.employeeInfo?.payDate || '---'}</span>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Earnings</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Regular</span>
            <span className="font-semibold text-slate-900">{formatCurrency(payrollInfo.earnings?.regular)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Overtime</span>
            <span className="font-semibold text-slate-900">{formatCurrency(payrollInfo.earnings?.overtime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Double time</span>
            <span className="font-semibold text-slate-900">{formatCurrency(payrollInfo.earnings?.doubleTime)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Hourly rate</span>
            <span className="font-semibold text-slate-900">{formatCurrency(payrollInfo.employeeInfo?.hourlyRate)}</span>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Deductions</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Federal income</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(payrollInfo.statutoryDeductions?.federalIncome?.thisPeriod)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Social security</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(payrollInfo.statutoryDeductions?.socialSecurity?.thisPeriod)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Medicare</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(payrollInfo.statutoryDeductions?.medicare?.thisPeriod)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">CA State Income</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(payrollInfo.statutoryDeductions?.californiaStateIncome?.thisPeriod)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">CA State DI</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(payrollInfo.statutoryDeductions?.californiaStateDI?.thisPeriod)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Misc Non Taxable</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(payrollInfo.voluntaryDeductions?.miscNonTaxableDeduction?.thisPeriod)}
            </span>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Hours</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Regular</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.regular ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Overtime</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.overtime ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Double time</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.doubleTime ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Total</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.total ?? '-'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PDFReaderPage() {
  const [pdfs, setPdfs] = useState<PdfProcessItem[]>([]);
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null);
  const selectedPdf = useMemo(() => pdfs.find((p) => p.id === selectedPdfId) || null, [pdfs, selectedPdfId]);
  const extracted = selectedPdf?.extracted || null;
  const [isExtracting, setIsExtracting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const [performingOcr, setPerformingOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ page: number; progress: number; total: number } | null>(null);
  const [savingToDatabase, setSavingToDatabase] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load PDF.js from CDN on component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.pdfjsLib) {
      console.log('[PDF.js] Loading from CDN...');
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setPdfJsLoaded(true);
          console.log('[PDF.js] Loaded successfully from CDN');
        }
      };
      script.onerror = () => {
        console.error('[PDF.js] Failed to load from CDN');
      };
      document.head.appendChild(script);
    } else if (window.pdfjsLib) {
      setPdfJsLoaded(true);
    }
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    const pdfFiles = selectedFiles.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) {
      setError('Please select PDF files.');
      return;
    }

    if (pdfFiles.length !== selectedFiles.length) {
      setError('Some files were skipped because they did not look like PDFs.');
    } else {
      setError(null);
    }

    const createId = () => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    };

    const newItems: PdfProcessItem[] = pdfFiles.map((file) => ({
      id: createId(),
      file,
      status: 'pending',
      extracted: null,
      error: null,
    }));

    setPdfs((prev) => [...prev, ...newItems]);
    setSelectedPdfId((prev) => prev || newItems[0].id);
    setBatchProgress(null);

    // Allow selecting the same files again
    event.target.value = '';
  };

  /**
   * Detect which state the paystub is from based on address or state-specific deductions
   */
  const detectState = (payrollData: PayrollData): string | null => {
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
  const hasFederalDeductions = (payrollData: PayrollData): boolean => {
    const deductions = payrollData?.statutoryDeductions || {};
    const hasFederal = typeof deductions.federalIncome?.thisPeriod === 'number';
    const hasSocialSecurity = typeof deductions.socialSecurity?.thisPeriod === 'number';
    const hasMedicare = typeof deductions.medicare?.thisPeriod === 'number';
    return hasFederal && hasSocialSecurity && hasMedicare;
  };

  /**
   * Check if page has state income deduction (if required for the detected state)
   */
  const hasStateIncome = (payrollData: PayrollData): boolean => {
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
  const hasRequiredDeductions = (payrollData: PayrollData): boolean => {
    return hasFederalDeductions(payrollData) && hasStateIncome(payrollData);
  };

  /**
   * Get state income value from payroll data
   */
  const getStateIncomeValue = (payrollData: PayrollData): number | null => {
    const deductions = payrollData?.statutoryDeductions || {};
    return deductions.californiaStateIncome?.thisPeriod ??
           deductions.wisconsinStateIncome?.thisPeriod ??
           deductions.arizonaStateIncome?.thisPeriod ??
           null;
  };

  /**
   * Extract payroll data from page using AI vision (fallback method)
   */
  const extractWithVision = async (canvas: HTMLCanvasElement, pageNum: number): Promise<PayrollData | null> => {
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
  const performClientSideOcr = async (pdfFile: File) => {
    setPerformingOcr(true);
    setOcrProgress({ page: 0, progress: 0, total: 0 });

    try {
      console.log('[OCR] Starting client-side OCR...');

      // Check if PDF.js is loaded
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
              setOcrProgress({ page: pageNum, progress: m.progress, total: pdf.numPages });
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
      setPerformingOcr(false);
      setOcrProgress(null);
    }
  };

  /**
   * Main extraction handler:
   * 1. Calls API for server-side extraction and image-based detection
   * 2. If image-based PDF detected, automatically triggers client-side OCR
   */
  const updatePdfItem = (id: string, updates: Partial<PdfProcessItem>) => {
    setPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const extractSinglePdf = async (pdfFile: File): Promise<ExtractResponse> => {
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

    const ocrResult = await performClientSideOcr(pdfFile);
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

  const handleExtract = async () => {
    const itemsToProcess = pdfs.filter((p) => p.status === 'pending' || p.status === 'error');
    if (itemsToProcess.length === 0) return;

    setIsExtracting(true);
    setError(null);
    setBatchProgress({ current: 0, total: itemsToProcess.length, fileName: '' });

    try {
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        setSelectedPdfId(item.id);
        setBatchProgress({ current: i + 1, total: itemsToProcess.length, fileName: item.file.name });
        updatePdfItem(item.id, { status: 'extracting', error: null });

        try {
          const result = await extractSinglePdf(item.file);
          updatePdfItem(item.id, { status: 'done', extracted: result });
        } catch (itemError: any) {
          console.error('[PDF-READER] Extraction error:', itemError);
          updatePdfItem(item.id, {
            status: 'error',
            extracted: null,
            error: itemError.message || 'Failed to process PDF.',
          });
        }
      }
    } finally {
      setBatchProgress(null);
      setIsExtracting(false);
    }
  };

  const payrollInfo = useMemo(() => extracted?.payrollData || {}, [extracted]);
  const selectedDisplayName = useMemo(() => {
    if (!selectedPdf) return '';
    const extractedName = selectedPdf.extracted?.payrollData?.employeeInfo?.name;
    if (typeof extractedName === 'string' && extractedName.trim()) return extractedName.trim();
    return selectedPdf.file.name;
  }, [selectedPdf]);

  const completedCount = useMemo(
    () => pdfs.filter((p) => p.status === 'done' && p.extracted?.payrollData).length,
    [pdfs]
  );

  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
  const toggleRowExpansion = (rowKey: string) => {
    setExpandedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const showPerPageResults = useMemo(
    () => pdfs.some((item) => item.status === 'done' && item.extracted),
    [pdfs]
  );

  const determineRowState = (data?: PayrollData) => {
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

  const resultsColumnCount = 3 + 1 + 3 + DEDUCTION_DEFS.length + 3; // PDF File, Page, Name + SSN, Account Number + Period Start, Period End, Pay Date + Deductions + Gross Pay, Net Pay, Extraction Method
  const renderRowDetails = (rowKey: string, data?: PayrollData, text?: string) => {
    if (!expandedRowKeys.has(rowKey)) return null;
    const structured = data ? JSON.stringify(data, null, 2) : 'No structured data captured';
    return (
      <tr key={`${rowKey}-details`}>
        <td colSpan={resultsColumnCount}>
          <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
            {text && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Extracted text
                </div>
                <pre className="text-[10px] leading-relaxed max-h-40 overflow-y-auto bg-white border border-slate-100 rounded-lg p-2 whitespace-pre-wrap">
                  {text}
                </pre>
              </div>
            )}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Structured data
              </div>
              <pre className="text-[10px] leading-relaxed max-h-40 overflow-y-auto bg-white border border-slate-100 rounded-lg p-2">
                {structured}
              </pre>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  const handleDownloadExcel = () => {
    const completed = pdfs.filter((p) => p.status === 'done' && p.extracted);
    if (completed.length === 0) return;

    const sanitizeFileName = (name: string) => {
      return name
        .replace(/[<>:"/\\|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Build header row
    const headers = [
      'PDF File',
      'Page',
      'Employee Name',
      'SSN',
      'Account Number',
      'Period Start',
      'Period End',
      'Pay Date',
      ...DEDUCTION_DEFS.map(def => def.label),
      'Gross Pay',
      'Net Pay',
      'Extraction Method',
    ];

    const rows: any[][] = [headers];

    // Process each PDF
    for (const item of completed) {
      const pageDataArray = item.extracted?.payrollDataByPage || [];

      // If no per-page data, fall back to single payroll data
      if (pageDataArray.length === 0 && item.extracted?.payrollData) {
        const data = item.extracted.payrollData;
        const extractedName = typeof data.employeeInfo?.name === 'string'
          ? data.employeeInfo.name.trim()
          : '';
        const displayName = extractedName || item.file.name;
        const ssn = data.employeeInfo?.ssn || '';
        const deductionValues = getDeductionValues(data, item.extracted.text);
        const rowState = determineRowState(data);

        const row = [
          item.file.name,
          1,
          displayName,
          ssn,
          data.employeeInfo?.accountNumber || '',
          data.employeeInfo?.payPeriod?.start || '',
          data.employeeInfo?.payPeriod?.end || '',
          data.employeeInfo?.payDate || '',
        ];

        // Add deduction values (only show state-specific ones for the detected state)
        DEDUCTION_DEFS.forEach((def) => {
          const showValue = !def.stateCode || def.stateCode === rowState;
          row.push(showValue ? (deductionValues[def.key] || 0) : '');
        });

        // Add Gross Pay and Net Pay
        row.push(data.employeeInfo?.grossPay || 0);
        row.push(data.employeeInfo?.netPay || 0);
        row.push('N/A');

        rows.push(row);
      } else {
        // Process per-page data
        // Get pay period and pay date from first page to use for ALL pages in this PDF
        const firstPageData = pageDataArray[0]?.payrollData;
        const periodStart = firstPageData?.employeeInfo?.payPeriod?.start || '';
        const periodEnd = firstPageData?.employeeInfo?.payPeriod?.end || '';
        const payDate = firstPageData?.employeeInfo?.payDate || '';

        for (const pageData of pageDataArray) {
          const extractedName = typeof pageData.payrollData?.employeeInfo?.name === 'string'
            ? pageData.payrollData.employeeInfo.name.trim()
            : '';
          const displayName = extractedName || '';
          const ssn = pageData.payrollData?.employeeInfo?.ssn || '';
          const accountNumber = pageData.payrollData?.employeeInfo?.accountNumber || '';
          const deductionValues = getDeductionValues(pageData.payrollData, pageData.text);
          const rowState = determineRowState(pageData.payrollData);

          const row = [
            item.file.name,
            pageData.pageNumber,
            displayName,
            ssn,
            accountNumber,
            periodStart,
            periodEnd,
            payDate,
          ];

          // Add deduction values (only show state-specific ones for the detected state)
          DEDUCTION_DEFS.forEach((def) => {
            const showValue = !def.stateCode || def.stateCode === rowState;
            row.push(showValue ? (deductionValues[def.key] || 0) : '');
          });

          // Add Gross Pay and Net Pay
          row.push(pageData.payrollData?.employeeInfo?.grossPay || 0);
          row.push(pageData.payrollData?.employeeInfo?.netPay || 0);

          // Add extraction method
          const method = pageData.extractionMethod || 'N/A';
          row.push(method.charAt(0).toUpperCase() + method.slice(1));

          rows.push(row);
        }
      }
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    const colWidths = [
      { wch: 25 }, // PDF File
      { wch: 6 },  // Page
      { wch: 25 }, // Employee Name
      { wch: 15 }, // SSN
      { wch: 15 }, // Account Number
      { wch: 12 }, // Period Start
      { wch: 12 }, // Period End
      { wch: 12 }, // Pay Date
    ];

    // Add widths for deduction columns
    DEDUCTION_DEFS.forEach(() => {
      colWidths.push({ wch: 15 });
    });

    // Add widths for Gross Pay, Net Pay, Extraction Method
    colWidths.push({ wch: 12 }); // Gross Pay
    colWidths.push({ wch: 12 }); // Net Pay
    colWidths.push({ wch: 15 }); // Extraction Method

    (ws as any)['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Payroll Data');

    // Generate filename
    const timestamp = new Date().getTime();
    const fileName = completed.length === 1
      ? `payroll-${sanitizeFileName(completed[0].file.name.replace(/\.pdf$/i, ''))}-${timestamp}.xlsx`
      : `payroll-batch-${completed.length}-files-${timestamp}.xlsx`;

    XLSX.writeFile(wb, fileName);
  };

  const handleSaveToDatabase = async () => {
    if (!selectedPdf || !selectedPdf.extracted) {
      setSaveError('No data available to save');
      return;
    }

    // Prefer per-page data if available, otherwise fall back to single payroll data
    const payrollDataByPage = selectedPdf.extracted.payrollDataByPage;
    const hasPerPageData = payrollDataByPage && payrollDataByPage.length > 0;

    if (!hasPerPageData && !selectedPdf.extracted.payrollData) {
      setSaveError('No payroll data available to save');
      return;
    }

    setSavingToDatabase(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      // Get session for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error('You must be logged in to save payroll data');
      }

      // Prepare data array - use per-page data if available
      let dataToSave;
      if (hasPerPageData) {
        dataToSave = payrollDataByPage;
      } else {
        // Backward compatibility: wrap single payroll data in array
        dataToSave = [{
          pageNumber: 1,
          payrollData: selectedPdf.extracted.payrollData
        }];
      }

      // Call API to save the data
      const response = await fetch('/api/save-payroll-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          payrollDataArray: dataToSave,
          pdfFilename: selectedPdf.file.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save payroll data');
      }

      const result = await response.json();
      const count = result.count || 1;
      setSaveSuccess(`Successfully saved ${count} paystub${count > 1 ? 's' : ''} to database!`);

      // Clear success message after 5 seconds
      setTimeout(() => setSaveSuccess(null), 5000);
    } catch (err: any) {
      console.error('Error saving to database:', err);
      setSaveError(err.message || 'Failed to save payroll data to database');
    } finally {
      setSavingToDatabase(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-semibold text-blue-700 uppercase tracking-wide">Utilities</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1">PDF Reader & Extractor</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Upload a paystub or any PDF to extract text. Automatically performs OCR for image-based PDFs.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to dashboard
          </Link>
        </div>

        {/* OCR Progress Banner */}
        {performingOcr && ocrProgress && (
          <div className="mb-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl shadow-lg p-4">
            <div className="flex items-center gap-3">
              <div className="inline-block h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <div className="flex-1">
                <p className="font-semibold">
                  Running OCR on page {ocrProgress.page} of {ocrProgress.total}
                </p>
                <div className="mt-2 bg-white/20 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-white h-full transition-all duration-300"
                    style={{ width: `${ocrProgress.progress * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Batch Progress Banner */}
        {batchProgress && (
          <div className="mb-6 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-xl shadow-lg p-4">
            <div className="flex items-center gap-3">
              <div className="inline-block h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <div className="flex-1">
                <p className="font-semibold">
                  Processing PDF {batchProgress.current} of {batchProgress.total}
                  {batchProgress.fileName ? `: ${batchProgress.fileName}` : ''}
                </p>
                <div className="mt-2 bg-white/20 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-white h-full transition-all duration-300"
                    style={{
                      width: `${batchProgress.total ? (batchProgress.current / batchProgress.total) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: file input and metadata */}
          <div className="space-y-6 lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Upload a PDF</h2>
              <p className="text-sm text-slate-600 mb-4">
                Automatic OCR for image-based paystubs. Extracts all visible text.
              </p>
              <label
                htmlFor="pdf-input"
                className="block border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-blue-400 cursor-pointer transition-colors"
              >
                <input
                  id="pdf-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Choose PDF(s)</p>
                    <p className="text-xs text-slate-500">Drop files here or click to browse</p>
                  </div>
                  {pdfs.length > 0 && (
                    <div className="text-xs text-blue-700 bg-blue-50 px-3 py-1 rounded-full">
                      {pdfs.length === 1
                        ? `${pdfs[0].file.name} - ${(pdfs[0].file.size / 1024).toFixed(0)} KB`
                        : `${pdfs.length} PDFs selected`}
                    </div>
                  )}
                </div>
              </label>

              {pdfs.length > 0 && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-200">
                    {pdfs.map((item) => {
                      const isSelected = item.id === selectedPdfId;
                      const statusColor =
                        item.status === 'done'
                          ? 'bg-green-50 text-green-700'
                          : item.status === 'error'
                            ? 'bg-red-50 text-red-700'
                            : item.status === 'extracting'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-slate-100 text-slate-700';

                      const statusLabel =
                        item.status === 'done'
                          ? 'Done'
                          : item.status === 'error'
                            ? 'Error'
                            : item.status === 'extracting'
                              ? 'Processing'
                              : 'Pending';

                      return (
                        <div key={item.id} className="bg-white">
                          <button
                            type="button"
                            onClick={() => setSelectedPdfId(item.id)}
                            className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors ${
                              isSelected ? 'bg-blue-50/40' : ''
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-sm text-slate-900">
                                {typeof item.extracted?.payrollData?.employeeInfo?.name === 'string' &&
                                item.extracted.payrollData.employeeInfo.name.trim()
                                  ? item.extracted.payrollData.employeeInfo.name.trim()
                                  : item.file.name}
                              </p>
                              {typeof item.extracted?.payrollData?.employeeInfo?.name === 'string' &&
                                item.extracted.payrollData.employeeInfo.name.trim() && (
                                  <p className="truncate text-xs text-slate-500">{item.file.name}</p>
                                )}
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>
                              {statusLabel}
                            </span>
                          </button>
                          {item.error && (
                            <p className="px-3 pb-2 text-xs text-red-700 bg-red-50/50">{item.error}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PDF.js Loading Status */}
              <div className="mt-3 text-xs text-center">
                {pdfJsLoaded ? (
                  <span className="text-green-600">✓ OCR ready for image-based PDFs</span>
                ) : (
                  <span className="text-slate-500">⏳ Loading PDF.js library...</span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={pdfs.length === 0 || isExtracting || !pdfJsLoaded}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {isExtracting ? (
                    <>
                      <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12v9m0-9l-3 3m3-3l3 3" />
                      </svg>
                      {pdfs.length > 1 ? 'Extract PDFs' : 'Extract data'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPdfs([]);
                    setSelectedPdfId(null);
                    setBatchProgress(null);
                    setError(null);
                  }}
                  disabled={pdfs.length === 0}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleSaveToDatabase}
                  disabled={
                    !selectedPdf ||
                    (!selectedPdf.extracted?.payrollDataByPage?.length && !selectedPdf.extracted?.payrollData) ||
                    savingToDatabase
                  }
                  className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {savingToDatabase ? (
                    <>
                      <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      Save to Database
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadExcel}
                  disabled={completedCount === 0}
                  className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download All Excel{completedCount ? ` (${completedCount})` : ''}
                </button>
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                  {error}
                </p>
              )}
              {saveSuccess && (
                <div className="mt-3 text-sm text-green-600 bg-green-50 border border-green-100 rounded-lg p-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {saveSuccess}
                </div>
              )}
              {saveError && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                  {saveError}
                </p>
              )}
            </div>

            {/* Metadata cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Pages</p>
                <p className="text-2xl font-bold text-slate-900">{extracted?.metadata?.pageCount ?? '--'}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Paystubs Found</p>
                <p className="text-2xl font-bold text-purple-600">
                  {extracted?.debug?.pagesWithData ?? extracted?.payrollDataByPage?.length ?? (extracted?.payrollData ? 1 : '--')}
                </p>
                {extracted?.debug?.pagesWithData && extracted?.debug?.pagesWithData > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Per-page extraction
                  </p>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Text length</p>
                <p className="text-2xl font-bold text-slate-900">
                  {extracted?.debug?.textLength ?? '--'}
                </p>
                {extracted?.debug && (
                  <p className="text-xs text-slate-500 mt-1">
                    {extracted.debug.isImageBased ? 'Image-based (OCR used)' : 'Text-based'}
                  </p>
                )}
              </div>
            </div>

            {/* Payroll highlights */}
            {extracted && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Payroll summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Net pay</span>
                    <span className="font-semibold text-green-700">
                      {formatCurrency(payrollInfo?.employeeInfo?.netPay)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Gross pay</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(payrollInfo?.employeeInfo?.grossPay)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total hours</span>
                    <span className="font-semibold text-slate-900">
                      {payrollInfo?.hours?.total ?? '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Employee</span>
                    <span className="font-semibold text-slate-900">
                      {payrollInfo?.employeeInfo?.name || '---'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right column: extracted text and data */}
          <div className="lg:col-span-2 space-y-6">
            {showPerPageResults && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">Results by Page</h3>
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    disabled={completedCount === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download All Excel{completedCount ? ` (${completedCount})` : ''}
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Page</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Employee</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">SSN</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Account Number</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Period Start</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Period End</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Pay Date</th>
                        {DEDUCTION_DEFS.map((def) => (
                          <th key={def.key} className="text-right px-3 py-2 font-semibold text-slate-700">
                            {def.label}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 font-semibold text-slate-700">Gross Pay</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-700">Net Pay</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {pdfs.flatMap((item) => {
                        const statusColor =
                          item.status === 'done'
                            ? 'bg-green-50 text-green-700'
                            : item.status === 'error'
                              ? 'bg-red-50 text-red-700'
                              : item.status === 'extracting'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-slate-100 text-slate-700';

                        const statusLabel =
                          item.status === 'done'
                            ? 'Done'
                            : item.status === 'error'
                              ? 'Error'
                              : item.status === 'extracting'
                                ? 'Processing'
                                : 'Pending';

                        const isSelected = item.id === selectedPdfId;

                        // Get per-page data if available
                        const pageDataArray = item.extracted?.payrollDataByPage || [];

                        // If no per-page data, fall back to single payroll data
                        if (pageDataArray.length === 0 && item.extracted?.payrollData) {
                          const extractedName =
                            typeof item.extracted.payrollData.employeeInfo?.name === 'string'
                              ? item.extracted.payrollData.employeeInfo.name.trim()
                              : '';
                          const displayName = extractedName || item.file.name;
                          const ssn = item.extracted.payrollData.employeeInfo?.ssn || '--';
                          const deductionValues = getDeductionValues(
                            item.extracted?.payrollData,
                            item.extracted?.text
                          );
                          const rowState = determineRowState(item.extracted?.payrollData);
                          const rowKey = `${item.id}-single`;

                          return (
                            <Fragment key={rowKey}>
                              <tr
                                className={`hover:bg-slate-50 cursor-pointer ${isSelected ? 'bg-blue-50/40' : ''}`}
                                onClick={() => setSelectedPdfId(item.id)}
                              >
                                <td className="px-3 py-2 text-slate-600 font-mono">1</td>
                                <td className="px-3 py-2 text-slate-900 font-medium">
                                  <div className="min-w-0">
                                    <p className="truncate">{displayName}</p>
                                    {extractedName && (
                                      <p className="truncate text-xs text-slate-500">{item.file.name}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-slate-800 font-mono">{ssn}</td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.accountNumber || '--'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.payPeriod?.start || '--'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.payPeriod?.end || '--'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.payDate || '--'}
                                </td>
                                {DEDUCTION_DEFS.map((def) => {
                                  const showValue = !def.stateCode || def.stateCode === rowState;
                                  return (
                                    <td
                                      key={`${item.id}-${def.key}-single`}
                                      className="px-3 py-2 text-right text-slate-900 font-mono"
                                    >
                                      {showValue ? formatCurrency(deductionValues[def.key]) : '--'}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-right text-slate-900 font-mono">
                                  {formatCurrency(item.extracted?.payrollData?.employeeInfo?.grossPay)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-900 font-mono font-semibold text-green-700">
                                  {formatCurrency(item.extracted?.payrollData?.employeeInfo?.netPay)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex flex-col items-end gap-1">
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}`}
                                    >
                                      {statusLabel}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-[11px] text-blue-600 hover:text-blue-800 underline"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleRowExpansion(rowKey);
                                      }}
                                    >
                                      {expandedRowKeys.has(rowKey) ? 'Hide data' : 'Show data'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {renderRowDetails(rowKey, item.extracted?.payrollData, item.extracted?.text)}
                            </Fragment>
                          );
                        }

                        // Render per-page data
                        // Get pay period and pay date from first page to use for ALL pages in this PDF
                        const firstPageData = pageDataArray[0]?.payrollData;
                        const periodStart = firstPageData?.employeeInfo?.payPeriod?.start || '--';
                        const periodEnd = firstPageData?.employeeInfo?.payPeriod?.end || '--';
                        const payDate = firstPageData?.employeeInfo?.payDate || '--';

                        return pageDataArray.map((pageData, idx) => {
                          const extractedName =
                            typeof pageData.payrollData?.employeeInfo?.name === 'string'
                              ? pageData.payrollData.employeeInfo.name.trim()
                              : '';
                          const displayName = extractedName || `${item.file.name} - Page ${pageData.pageNumber}`;
                          const ssn = pageData.payrollData?.employeeInfo?.ssn || '--';
                          const accountNumber = pageData.payrollData?.employeeInfo?.accountNumber || '--';
                          const deductionValues = getDeductionValues(pageData.payrollData, pageData.text);
                          const rowState = determineRowState(pageData.payrollData);
                          const rowKey = `${item.id}-page-${pageData.pageNumber}`;

                          return (
                            <Fragment key={rowKey}>
                              <tr
                                className={`hover:bg-slate-50 cursor-pointer ${isSelected ? 'bg-blue-50/40' : ''}`}
                                onClick={() => setSelectedPdfId(item.id)}
                              >
                                <td className="px-3 py-2 text-slate-600 font-mono">{pageData.pageNumber}</td>
                                <td className="px-3 py-2 text-slate-900 font-medium">
                                  <div className="min-w-0">
                                    <p className="truncate">{extractedName || '--'}</p>
                                    <p className="truncate text-xs text-slate-500">{item.file.name}</p>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-slate-800 font-mono">{ssn}</td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {accountNumber}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {periodStart}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {periodEnd}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {payDate}
                                </td>
                                {DEDUCTION_DEFS.map((def) => {
                                  const showValue = !def.stateCode || def.stateCode === rowState;
                                  return (
                                    <td
                                      key={`${item.id}-page-${pageData.pageNumber}-${def.key}`}
                                      className="px-3 py-2 text-right text-slate-900 font-mono"
                                    >
                                      {showValue ? formatCurrency(deductionValues[def.key]) : '--'}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-right text-slate-900 font-mono">
                                  {formatCurrency(pageData.payrollData?.employeeInfo?.grossPay)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-900 font-mono font-semibold text-green-700">
                                  {formatCurrency(pageData.payrollData?.employeeInfo?.netPay)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex flex-col items-end gap-1">
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}`}
                                    >
                                      {statusLabel}
                                    </span>
                                    {pageData.extractionMethod && (
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                          pageData.extractionMethod === 'vision'
                                            ? 'bg-purple-100 text-purple-700'
                                            : pageData.extractionMethod === 'llm'
                                              ? 'bg-blue-100 text-blue-700'
                                              : pageData.extractionMethod === 'hybrid'
                                                ? 'bg-teal-100 text-teal-700'
                                                : 'bg-gray-100 text-gray-700'
                                        }`}
                                      >
                                        {pageData.extractionMethod === 'vision'
                                          ? '👁️ Vision'
                                          : pageData.extractionMethod === 'llm'
                                            ? '🤖 LLM'
                                            : pageData.extractionMethod === 'hybrid'
                                              ? '🔀 Hybrid'
                                              : '📝 Regex'}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="text-[11px] text-blue-600 hover:text-blue-800 underline"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleRowExpansion(rowKey);
                                      }}
                                    >
                                      {expandedRowKeys.has(rowKey) ? 'Hide data' : 'Show data'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {renderRowDetails(rowKey, pageData.payrollData, pageData.text)}
                            </Fragment>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {pdfs.length > 1 &&
              pdfs.some((p) => p.status === 'done' && p.extracted?.payrollData) && (
                <div className="space-y-6">
                  {pdfs
                    .filter((p) => p.status === 'done' && p.extracted?.payrollData)
                    .map((item) => {
                      const itemPayrollInfo = (item.extracted?.payrollData || {}) as PayrollData;
                      const extractedName =
                        typeof item.extracted?.payrollData?.employeeInfo?.name === 'string'
                          ? item.extracted.payrollData.employeeInfo.name.trim()
                          : '';
                      const displayName = extractedName || item.file.name;
                      const isSelected = item.id === selectedPdfId;

                      return (
                        <div
                          key={item.id}
                          className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4 ${
                            isSelected ? 'ring-2 ring-blue-200' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <h3 className="text-lg font-semibold text-slate-900">Structured Payroll Fields</h3>
                                <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full truncate max-w-[260px]">
                                  {displayName}
                                </span>
                              </div>
                              {extractedName && (
                                <p className="mt-1 text-xs text-slate-500 truncate">{item.file.name}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedPdfId(item.id)}
                              className="shrink-0 text-sm font-semibold text-blue-700 hover:text-blue-800 transition-colors"
                            >
                              View details
                            </button>
                          </div>

                          <StructuredPayrollGrid payrollInfo={itemPayrollInfo} />
                        </div>
                      );
                    })}
                </div>
              )}

            {extracted?.text && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-lg font-semibold text-slate-900">Extracted Text</h3>
                    {selectedDisplayName && (
                      <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full truncate max-w-[260px]">
                        {selectedDisplayName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full">
                    {extracted.text.length} chars
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-80 overflow-y-auto">
                  {extracted.text}
                </pre>
              </div>
            )}

            {pdfs.length <= 1 && extracted?.payrollData && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-lg font-semibold text-slate-900">Structured Payroll Fields</h3>
                    {selectedDisplayName && (
                      <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full truncate max-w-[260px]">
                        {selectedDisplayName}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {pdfs.filter((p) => p.status === 'done').length > 1 ? 'Download Excel (per PDF)' : 'Download Excel'}
                  </button>
                </div>

                <StructuredPayrollGrid payrollInfo={payrollInfo} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
