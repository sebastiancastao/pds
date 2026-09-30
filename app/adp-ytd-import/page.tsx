'use client';

// /adp-ytd-import
//
// Imports an ADP (or any spreadsheet) year-to-date report — federal/state
// taxes withheld, social security, medicare, gross pay, etc. — and saves it
// as each employee's YTD carryover baseline in the new employee_ytd_carryover
// table (see supabase/migrations/20260922000001_create_employee_ytd_carryover_table.sql).
//
// Backend link to /paystub-generator: app/api/generate-paystub/route.ts reads
// this table automatically for the matched employee and adds it on top of
// this system's own running YTD, so a paystub generated there is correct on
// day one for anyone migrated mid-year from ADP — no manual Excel override
// needed for that employee going forward. This page is purely the
// entry/review screen for that baseline; it does not generate paystubs.
//
// A row can come from an uploaded spreadsheet, an uploaded paystub PDF, or be
// typed in by hand. Every path goes through the same review grid and the same
// employee-matching (/api/match-employee) that /paystub-generator's own Excel
// import uses.
//
// PDFs are read exactly the way /pdf-reader reads them: the pipeline lives in
// lib/pdf-reader-extraction.ts (server text extraction via /api/extract-pdf,
// and for scanned PDFs client-side OCR with LLM / regex / AI-vision fallbacks).
// Each paystub page becomes one row built from its year-to-date column.

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { OcrProgress, PayrollData } from '@/lib/pdf-reader-extraction';

type FieldKey =
  | 'federalIncomeYtd'
  | 'socialSecurityYtd'
  | 'medicareYtd'
  | 'stateIncomeYtd'
  | 'stateDIYtd'
  | 'calSaversRothRetYtd'
  | 'regularYtd'
  | 'overtimeYtd'
  | 'doubleTimeYtd'
  | 'commissionYtd'
  | 'variableIncentiveYtd'
  | 'creditCardTipsYtd'
  | 'restBreakPayYtd'
  | 'travelPayYtd'
  | 'bonusYtd'
  | 'sickPayYtd'
  | 'mealPremiumYtd'
  | 'grossPayYtd'
  | 'equipmentReimbYtd'
  | 'mileageReimbYtd'
  | 'miscReimbursementYtd';

type Row = {
  key: string;
  employeeName: string;
  userId: string | null;
  matchStatus: 'unchecked' | 'checking' | 'matched' | 'unmatched';
  asOfDate: string;
  stateCode: string;
  notes: string;
} & Record<FieldKey, string>;

type OnFileRecord = {
  id: string;
  user_id: string;
  employeeName: string;
  as_of_date: string | null;
  state_code: string | null;
  updated_at: string;
  gross_pay_ytd: number | null;
  federal_income_ytd: number | null;
  social_security_ytd: number | null;
  medicare_ytd: number | null;
};

// Column definitions: label shown in the grid + the header aliases accepted
// when parsing an uploaded file. Keeping these aliased to the exact strings
// app/paystub-generator/page.tsx's own Excel import recognizes so a file
// prepared for one works for the other, plus a few common ADP-style aliases.
const FIELD_DEFS: { key: FieldKey; label: string; aliases: string[] }[] = [
  { key: 'federalIncomeYtd', label: 'Federal Income', aliases: ['federal income ytd', 'ytd federal income tax', 'ytd fed income tax', 'fed tax ytd'] },
  { key: 'socialSecurityYtd', label: 'Social Security', aliases: ['social security ytd', 'ytd social security tax', 'ytd fica', 'ss tax ytd'] },
  { key: 'medicareYtd', label: 'Medicare', aliases: ['medicare ytd', 'ytd medicare tax', 'med tax ytd'] },
  { key: 'calSaversRothRetYtd', label: 'CalSavers Roth', aliases: ['calsavers roth ira ytd', 'cal savers roth ira ytd', 'calsavers roth ret ytd', 'roth ira ytd', 'roth ret ytd'] },
  { key: 'regularYtd', label: 'Regular', aliases: ['regular ytd', 'ytd regular pay', 'ytd regular earnings'] },
  { key: 'overtimeYtd', label: 'Overtime', aliases: ['overtime ytd', 'ytd overtime pay', 'ytd overtime earnings'] },
  { key: 'doubleTimeYtd', label: 'Double Time', aliases: ['double time ytd', 'doubletime ytd', 'ytd double time'] },
  { key: 'commissionYtd', label: 'Commission', aliases: ['commission ytd', 'ytd commission'] },
  { key: 'variableIncentiveYtd', label: 'Variable Incentive', aliases: ['variable incentive ytd', 'ytd variable incentive'] },
  { key: 'creditCardTipsYtd', label: 'CC Tips', aliases: ['credit card tips ytd', 'ytd credit card tips', 'ytd tips'] },
  { key: 'restBreakPayYtd', label: 'Rest Break Pay', aliases: ['rest break pay ytd', 'ytd rest break pay'] },
  { key: 'travelPayYtd', label: 'Travel Pay', aliases: ['travel pay ytd', 'ytd travel pay'] },
  { key: 'bonusYtd', label: 'Bonus', aliases: ['bonus ytd', 'ytd bonus'] },
  { key: 'sickPayYtd', label: 'Sick Pay', aliases: ['sick pay ytd', 'ytd sick pay'] },
  { key: 'mealPremiumYtd', label: 'Meal Premium', aliases: ['meal premium ytd', 'ytd meal premium'] },
  { key: 'grossPayYtd', label: 'Gross Pay', aliases: ['gross pay ytd', 'year to date gross pay', 'ytd gross pay', 'ytd gross', 'gross ytd'] },
  { key: 'equipmentReimbYtd', label: 'Equipment Reimb.', aliases: ['equipment reimbursement ytd', 'ytd equipment reimbursement'] },
  { key: 'mileageReimbYtd', label: 'Mileage Reimb.', aliases: ['mileage reimbursement ytd', 'ytd mileage reimbursement'] },
  { key: 'miscReimbursementYtd', label: 'Misc Reimb.', aliases: ['misc reimbursement ytd', 'ytd misc reimbursement'] },
  // State income/DI are handled specially below (one column per state code).
  { key: 'stateIncomeYtd', label: 'State Income', aliases: [] },
  { key: 'stateDIYtd', label: 'State DI', aliases: ['ca state di ytd', 'ytd ca sdi', 'ytd sdi', 'state disability ytd'] },
];

const STATE_INCOME_ALIASES: Record<string, string[]> = {
  CA: ['ca state income ytd'],
  WI: ['wi state income ytd'],
  AZ: ['az state income ytd'],
  NY: ['ny state income ytd'],
};

const STATE_CODES = ['CA', 'WI', 'AZ', 'NY'];

function emptyFields(): Record<FieldKey, string> {
  const out: any = {};
  for (const f of FIELD_DEFS) out[f.key] = '';
  return out;
}

function newRow(employeeName = ''): Row {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    employeeName,
    userId: null,
    matchStatus: 'unchecked',
    asOfDate: new Date().toISOString().slice(0, 10),
    stateCode: 'CA',
    notes: '',
    ...emptyFields(),
  };
}

function normalizeHeaderText(value: any): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "LastName, FirstName MI" -> "FirstName MI LastName" (ADP commonly exports
// names in the former; official_name in this system is stored in the latter).
function toDisplayName(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed.includes(',')) return trimmed;
  const commaIndex = trimmed.indexOf(',');
  const lastName = trimmed.slice(0, commaIndex).trim();
  const afterComma = trimmed.slice(commaIndex + 1).trim();
  const tokens = afterComma.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return `${afterComma} ${lastName}`.trim();
  const initials = tokens.filter((t) => /^[A-Za-z]\.?$/.test(t));
  const nameParts = tokens.filter((t) => !/^[A-Za-z]\.?$/.test(t));
  if (nameParts.length > 0) return [...nameParts, ...initials, lastName].join(' ').trim();
  return `${afterComma} ${lastName}`.trim();
}

// ---------- PDF import (same extraction as /pdf-reader) ----------

type PdfReaderLib = typeof import('@/lib/pdf-reader-extraction');

type PdfStatus = {
  fileName: string;
  index: number;
  total: number;
  ocr: OcrProgress | null;
};

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// Positive dollar string for the grid, or '' when missing / zero (the same
// convention the spreadsheet import uses, so empty cells stay empty).
function ytdString(value: unknown): string {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n === 0) return '';
  return Math.abs(n).toFixed(2);
}

function ytdOf(bucket: any, key: string): string {
  return ytdString(bucket?.[key]?.yearToDate);
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Pay dates come out of the PDF reader as "09/15/2026", "9/15/26",
// "2026-09-15" or "Sep 15, 2026". Normalize to YYYY-MM-DD.
function pdfDateToIso(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoFromParts(year, Number(m[1]), Number(m[2]));
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

// Extractor keys for each state the grid supports (NY has no PDF extractor key).
const PDF_STATE_KEYS: Record<string, { income: string; di?: string }> = {
  CA: { income: 'californiaStateIncome', di: 'californiaStateDI' },
  WI: { income: 'wisconsinStateIncome', di: 'wisconsinStateDI' },
  AZ: { income: 'arizonaStateIncome' },
};

function pdfStateCode(data: PayrollData, lib: PdfReaderLib): string {
  const sd = data?.statutoryDeductions || {};
  // Prefer the state whose YTD withholding is present: a late-year stub can
  // show $0 this period but still carry YTD state tax. WI/AZ win over CA the
  // same way /pdf-reader's determineRowState orders them.
  if (ytdOf(sd, 'wisconsinStateIncome')) return 'WI';
  if (ytdOf(sd, 'arizonaStateIncome')) return 'AZ';
  if (ytdOf(sd, 'californiaStateIncome') || ytdOf(sd, 'californiaStateDI')) return 'CA';
  const fromDeductions = lib.determineRowState(data);
  if (fromDeductions && STATE_CODES.includes(fromDeductions)) return fromDeductions;
  const fromAddress = lib.detectState(data);
  if (fromAddress && STATE_CODES.includes(fromAddress)) return fromAddress;
  return 'CA';
}

function rowFromPdfPage(
  payrollData: PayrollData,
  fileName: string,
  pageNumber: number,
  extractionMethod: string | undefined,
  lib: PdfReaderLib
): Row {
  const info = payrollData?.employeeInfo || {};
  const sd = payrollData?.statutoryDeductions || {};
  const vd = payrollData?.voluntaryDeductions || {};
  const earnings = payrollData?.earnings || {};
  const adj = payrollData?.netPayAdjustments || {};

  // An overly long 'name' is garbled text from a PDF whose content could not
  // be decoded. Leave it blank so the reviewer types the name instead.
  const rawName = typeof info.name === 'string' && info.name.trim().length <= 80 ? info.name : '';
  const row = newRow(toDisplayName(rawName));
  row.asOfDate = pdfDateToIso(info.payDate) || pdfDateToIso(info.payPeriod?.end) || row.asOfDate;
  row.stateCode = pdfStateCode(payrollData, lib);

  const stateKeys = PDF_STATE_KEYS[row.stateCode];
  row.stateIncomeYtd = stateKeys ? ytdOf(sd, stateKeys.income) : '';
  row.stateDIYtd = stateKeys?.di ? ytdOf(sd, stateKeys.di) : '';

  row.federalIncomeYtd = ytdOf(sd, 'federalIncome');
  row.socialSecurityYtd = ytdOf(sd, 'socialSecurity');
  row.medicareYtd = ytdOf(sd, 'medicare');
  row.calSaversRothRetYtd = ytdOf(vd, 'calSaversRothRet');

  row.regularYtd = ytdOf(earnings, 'regular');
  row.overtimeYtd = ytdOf(earnings, 'overtime');
  row.doubleTimeYtd = ytdOf(earnings, 'doubleTime');
  row.commissionYtd = ytdOf(earnings, 'commission');
  row.variableIncentiveYtd = ytdOf(earnings, 'variableIncentive');
  row.creditCardTipsYtd = ytdOf(earnings, 'creditCardTips');
  row.restBreakPayYtd = ytdOf(earnings, 'restBreakPay');
  row.travelPayYtd = ytdOf(earnings, 'travelPay');
  row.bonusYtd = ytdOf(earnings, 'bonus');
  row.sickPayYtd = ytdOf(earnings, 'sickPay');
  row.mealPremiumYtd = ytdOf(earnings, 'mealPremium');
  row.grossPayYtd = ytdString(info.ytdGross);

  row.equipmentReimbYtd = ytdOf(adj, 'equipmentReimbursement');
  row.mileageReimbYtd = ytdOf(adj, 'mileageReimbursement');
  row.miscReimbursementYtd = ytdOf(adj, 'miscReimbursement');

  row.notes = `From PDF ${fileName}, page ${pageNumber}${extractionMethod ? ` (${extractionMethod})` : ''}`;
  return row;
}

function hasAnyYtd(row: Row): boolean {
  return FIELD_DEFS.some((f) => row[f.key] !== '');
}

// One carryover record per employee: the save API upserts on user_id, so a
// PDF holding several pay periods for the same person must collapse to the
// latest stub (latest as-of date, then highest gross YTD, then later page).
function keepLatestPerEmployee(rows: Row[]): { kept: Row[]; dropped: number } {
  const byName = new Map<string, Row>();
  const unnamed: Row[] = [];
  const order: string[] = [];
  const grossOf = (r: Row) => parseFloat(r.grossPayYtd || '0') || 0;
  for (const row of rows) {
    const key = row.employeeName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) {
      unnamed.push(row);
      continue;
    }
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      order.push(key);
      continue;
    }
    const newer =
      row.asOfDate > existing.asOfDate ||
      (row.asOfDate === existing.asOfDate && grossOf(row) >= grossOf(existing));
    if (newer) byName.set(key, row);
  }
  const kept = [...order.map((k) => byName.get(k)!), ...unnamed];
  return { kept, dropped: rows.length - kept.length };
}

async function matchEmployee(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(`/api/match-employee?name=${encodeURIComponent(trimmed)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user_id || null;
  } catch {
    return null;
  }
}

export default function AdpYtdImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [onFile, setOnFile] = useState<OnFileRecord[]>([]);
  const [loadingOnFile, setLoadingOnFile] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<PdfStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function authHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  const loadOnFile = useCallback(async () => {
    setLoadingOnFile(true);
    try {
      const headers = await authHeader();
      const res = await fetch('/api/employee-ytd-carryover', { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load existing carryover records');
      setOnFile(data.rows || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load existing carryover records');
    } finally {
      setLoadingOnFile(false);
    }
  }, []);

  useEffect(() => {
    loadOnFile();
  }, [loadOnFile]);

  const rematchRow = useCallback(async (key: string, name: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, matchStatus: 'checking' } : r)));
    const userId = await matchEmployee(name);
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, userId, matchStatus: userId ? 'matched' : 'unmatched' } : r
      )
    );
  }, []);

  // Adds parsed rows to the grid, then matches each to an employee
  // sequentially so we don't hammer the server.
  const appendAndMatch = useCallback(async (parsed: Row[]) => {
    setRows((prev) => [...prev, ...parsed]);
    for (const row of parsed) {
      if (!row.employeeName) {
        setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, matchStatus: 'unmatched' } : r)));
        continue;
      }
      await rematchRow(row.key, row.employeeName);
    }
  }, [rematchRow]);

  const handleAddManual = useCallback(() => {
    setRows((prev) => [...prev, newRow()]);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setSuccess(null);
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError('Please upload an Excel (.xlsx/.xls), CSV, or PDF file.');
      return;
    }
    setParsing(true);
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

      if (jsonData.length < 2) {
        setError('File must have at least a header row and one employee row.');
        return;
      }

      const normalizedHeaders = jsonData[0].map((h: any) => normalizeHeaderText(h));
      const findHeaderIndex = (possibleNames: string[]) => {
        for (const name of possibleNames) {
          const normalizedName = normalizeHeaderText(name);
          const exact = normalizedHeaders.findIndex((h) => h === normalizedName);
          if (exact !== -1) return exact;
        }
        for (const name of possibleNames) {
          const normalizedName = normalizeHeaderText(name);
          if (!normalizedName || normalizedName.length < 5) continue;
          const nameTokens = normalizedName.split(' ').filter(Boolean);
          const tokenMatch = normalizedHeaders.findIndex((h) => {
            const headerTokens = new Set(h.split(' ').filter(Boolean));
            return nameTokens.every((t) => headerTokens.has(t));
          });
          if (tokenMatch !== -1) return tokenMatch;
        }
        return -1;
      };
      const getValue = (valuesRow: any[], possibleNames: string[]): string => {
        const idx = findHeaderIndex(possibleNames);
        if (idx === -1 || valuesRow[idx] == null || valuesRow[idx] === '') return '';
        const val = valuesRow[idx];
        if (typeof val === 'number' && val === 0) return '';
        return String(val).trim();
      };
      const getAbsolute = (valuesRow: any[], possibleNames: string[]): string => {
        const v = getValue(valuesRow, possibleNames);
        if (!v) return '';
        const n = parseFloat(v.replace(/,/g, ''));
        return Number.isNaN(n) ? v : String(Math.abs(n));
      };
      const formatDate = (value: any): string => {
        if (!value) return new Date().toISOString().slice(0, 10);
        try {
          if (typeof value === 'number') {
            const d = XLSX.SSF.parse_date_code(value);
            return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
          }
          const d = new Date(value);
          if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        } catch {
          /* fall through */
        }
        return new Date().toISOString().slice(0, 10);
      };

      const dataRows = jsonData
        .slice(1)
        .filter((row) => Array.isArray(row) && row.some((c) => c != null && String(c).trim() !== ''));

      if (dataRows.length === 0) {
        setError('No employee rows found in the file.');
        return;
      }

      const parsed: Row[] = dataRows.map((valuesRow) => {
        const rawName = getValue(valuesRow, ['employee name', 'employee full name', 'full name', 'name', 'employee']);
        const employeeName = toDisplayName(rawName);

        let stateCode = 'CA';
        for (const code of STATE_CODES) {
          if (getValue(valuesRow, STATE_INCOME_ALIASES[code])) {
            stateCode = code;
            break;
          }
        }

        const row = newRow(employeeName);
        row.asOfDate = formatDate(
          getValue(valuesRow, ['as of date', 'pay date', 'period end', 'pay period end'])
        );
        row.stateCode = stateCode;
        row.stateIncomeYtd = getAbsolute(valuesRow, STATE_INCOME_ALIASES[stateCode]);

        for (const f of FIELD_DEFS) {
          if (f.key === 'stateIncomeYtd' || f.aliases.length === 0) continue;
          row[f.key] = getAbsolute(valuesRow, f.aliases);
        }
        return row;
      });

      setSuccess(`Parsed ${parsed.length} row(s) from ${file.name}. Matching employees…`);
      await appendAndMatch(parsed);
      setSuccess(`Imported ${parsed.length} row(s) from ${file.name}.`);
    } catch (e: any) {
      setError(`Failed to read file: ${e?.message || e}`);
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [appendAndMatch]);

  // PDF upload: same reader as /pdf-reader, one row per paystub page.
  const handlePdfFiles = useCallback(async (files: File[]) => {
    setError(null);
    setSuccess(null);
    setParsing(true);
    const collected: Row[] = [];
    const failures: string[] = [];
    try {
      const lib = await import('@/lib/pdf-reader-extraction');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setPdfStatus({ fileName: file.name, index: i + 1, total: files.length, ocr: null });
        try {
          const result = await lib.extractPdfPayroll(file, {
            onOcrStart: () => setPdfStatus((s) => (s ? { ...s, ocr: { page: 0, progress: 0, total: 0 } } : s)),
            onOcrProgress: (progress) => setPdfStatus((s) => (s ? { ...s, ocr: progress } : s)),
            onOcrEnd: () => setPdfStatus((s) => (s ? { ...s, ocr: null } : s)),
          });
          const pages =
            result.payrollDataByPage && result.payrollDataByPage.length > 0
              ? result.payrollDataByPage
              : result.payrollData
                ? [{ pageNumber: 1, text: result.text || '', payrollData: result.payrollData, extractionMethod: undefined }]
                : [];
          let fromThisFile = 0;
          for (const page of pages) {
            const row = rowFromPdfPage(page.payrollData, file.name, page.pageNumber, page.extractionMethod, lib);
            // Skip pages that carry neither a name nor any YTD figure
            // (cover pages, continuation pages, blank scans).
            if (!row.employeeName && !hasAnyYtd(row)) continue;
            collected.push(row);
            fromThisFile++;
          }
          if (fromThisFile === 0) failures.push(`${file.name}: no paystub data found`);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      failures.push(`Failed to load the PDF reader: ${e?.message || e}`);
    } finally {
      setPdfStatus(null);
    }

    try {
      if (collected.length > 0) {
        const { kept, dropped } = keepLatestPerEmployee(collected);
        const dupNote = dropped > 0 ? ` Kept the most recent stub per employee (${dropped} older page(s) skipped).` : '';
        setSuccess(`Read ${kept.length} employee row(s) from ${files.length} PDF(s). Matching employees…${dupNote}`);
        await appendAndMatch(kept);
        setSuccess(`Imported ${kept.length} row(s) from ${files.length} PDF(s).${dupNote} Review the YTD numbers before saving.`);
      }
      if (failures.length > 0) setError(failures.join('; '));
    } finally {
      setParsing(false);
    }
  }, [appendAndMatch]);

  const handleFiles = useCallback(async (files: File[]) => {
    const pdfFiles = files.filter(isPdfFile);
    const sheetFiles = files.filter((f) => !isPdfFile(f));
    for (const f of sheetFiles) await handleFile(f);
    if (pdfFiles.length > 0) await handlePdfFiles(pdfFiles);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFile, handlePdfFiles]);

  const updateRow = useCallback((key: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    setSuccess(null);
    const matched = rows.filter((r) => r.userId);
    if (matched.length === 0) {
      setError('No matched employees to save. Match at least one row first.');
      return;
    }
    setSaving(true);
    try {
      const headers = await authHeader();
      const payload = {
        rows: matched.map((r) => ({
          userId: r.userId,
          asOfDate: r.asOfDate,
          stateCode: r.stateCode,
          notes: r.notes,
          ...Object.fromEntries(FIELD_DEFS.map((f) => [f.key, r[f.key]])),
        })),
      };
      const res = await fetch('/api/employee-ytd-carryover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setSuccess(
        `Saved ${data.saved} record(s).` +
          (data.skipped ? ` ${data.skipped} row(s) skipped — see below.` : '')
      );
      if (data.problems?.length) {
        setError(data.problems.map((p: any) => p.message).join('; '));
      }
      setRows((prev) => prev.filter((r) => !r.userId));
      loadOnFile();
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [rows, loadOnFile]);

  const handleDownloadTemplate = useCallback(async () => {
    if (rows.length === 0) return;
    const XLSX = await import('xlsx');
    const headerLabel: Record<FieldKey, string> = {
      federalIncomeYtd: 'Federal Income YTD',
      socialSecurityYtd: 'Social Security YTD',
      medicareYtd: 'Medicare YTD',
      stateIncomeYtd: '', // filled per-state below
      stateDIYtd: 'CA State DI YTD',
      calSaversRothRetYtd: 'CalSavers Roth IRA YTD',
      regularYtd: 'Regular YTD',
      overtimeYtd: 'Overtime YTD',
      doubleTimeYtd: 'Double Time YTD',
      commissionYtd: 'Commission YTD',
      variableIncentiveYtd: 'Variable Incentive YTD',
      creditCardTipsYtd: 'Credit Card Tips YTD',
      restBreakPayYtd: 'Rest Break Pay YTD',
      travelPayYtd: 'Travel Pay YTD',
      bonusYtd: 'Bonus YTD',
      sickPayYtd: 'Sick Pay YTD',
      mealPremiumYtd: 'Meal Premium YTD',
      grossPayYtd: 'Gross Pay YTD',
      equipmentReimbYtd: 'Equipment Reimbursement YTD',
      mileageReimbYtd: 'Mileage Reimbursement YTD',
      miscReimbursementYtd: 'Misc Reimbursement YTD',
    };
    const sheetRows = rows.map((r) => {
      const out: Record<string, string> = { 'Employee Name': r.employeeName };
      for (const code of STATE_CODES) {
        out[`${code} State Income YTD`] = r.stateCode === code ? r.stateIncomeYtd : '';
      }
      for (const f of FIELD_DEFS) {
        if (f.key === 'stateIncomeYtd') continue;
        out[headerLabel[f.key]] = r[f.key];
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'YTD Carryover');
    XLSX.writeFile(wb, `paystub-generator-ytd-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [rows]);

  const loadForEdit = useCallback((rec: OnFileRecord) => {
    const row = newRow(rec.employeeName);
    row.userId = rec.user_id;
    row.matchStatus = 'matched';
    row.asOfDate = rec.as_of_date || row.asOfDate;
    row.stateCode = rec.state_code || 'CA';
    row.grossPayYtd = rec.gross_pay_ytd != null ? String(rec.gross_pay_ytd) : '';
    row.federalIncomeYtd = rec.federal_income_ytd != null ? String(rec.federal_income_ytd) : '';
    row.socialSecurityYtd = rec.social_security_ytd != null ? String(rec.social_security_ytd) : '';
    row.medicareYtd = rec.medicare_ytd != null ? String(rec.medicare_ytd) : '';
    setRows((prev) => [...prev, row]);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-7xl py-10 px-6">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">ADP Year-to-Date Import</h1>
            <p className="text-gray-600 mt-1 max-w-3xl">
              Upload an ADP year-to-date report (or type numbers in by hand) to set each
              employee&apos;s YTD carryover baseline — federal/state taxes, social security,
              medicare, gross pay, etc. <strong>/api/generate-paystub</strong> reads this
              automatically, so paystubs generated on{' '}
              <Link href="/paystub-generator" className="text-blue-600 underline">
                /paystub-generator
              </Link>{' '}
              start with the correct YTD totals for anyone migrated mid-year — no re-upload
              needed per pay run.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/paystub-generator"
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >
              Go to Paystub Generator
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 text-green-700 px-4 py-3 text-sm">
            {success}
          </div>
        )}

        {/* On file */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">On file ({onFile.length})</h2>
            <button onClick={loadOnFile} className="text-sm text-blue-600 hover:underline">
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Employee</th>
                  <th className="px-4 py-2 text-left font-medium">State</th>
                  <th className="px-4 py-2 text-left font-medium">As Of</th>
                  <th className="px-4 py-2 text-right font-medium">Gross YTD</th>
                  <th className="px-4 py-2 text-right font-medium">Federal YTD</th>
                  <th className="px-4 py-2 text-right font-medium">Updated</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingOnFile && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-500">Loading…</td>
                  </tr>
                )}
                {!loadingOnFile && onFile.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                      No carryover records saved yet.
                    </td>
                  </tr>
                )}
                {onFile.map((rec) => (
                  <tr key={rec.id}>
                    <td className="px-4 py-2 text-gray-900">{rec.employeeName}</td>
                    <td className="px-4 py-2 text-gray-600">{rec.state_code || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{rec.as_of_date || '—'}</td>
                    <td className="px-4 py-2 text-right text-gray-900">
                      {rec.gross_pay_ytd != null ? `$${Number(rec.gross_pay_ytd).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-900">
                      {rec.federal_income_ytd != null ? `$${Number(rec.federal_income_ytd).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {rec.updated_at ? new Date(rec.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => loadForEdit(rec)} className="text-blue-600 hover:underline text-xs">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Import controls */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Import</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) handleFiles(files);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {parsing ? 'Reading…' : 'Upload ADP report (.xlsx/.xls/.csv/.pdf)'}
            </button>
            <button
              onClick={handleAddManual}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              + Add employee manually
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500 max-w-3xl">
            PDF paystubs are read the same way as the{' '}
            <Link href="/pdf-reader" className="text-blue-600 underline">
              PDF Reader
            </Link>
            : text PDFs are parsed directly and scanned PDFs go through OCR. Each paystub page
            becomes a row built from its year-to-date column. If one PDF has several pay periods
            for the same employee, only the most recent is kept.
          </p>
          {pdfStatus && (
            <p className="mt-2 text-sm text-gray-700">
              Reading {pdfStatus.fileName} ({pdfStatus.index} of {pdfStatus.total})
              {pdfStatus.ocr
                ? ` — scanned PDF, OCR page ${pdfStatus.ocr.page || 1} of ${pdfStatus.ocr.total || '?'} (${Math.round(
                    (pdfStatus.ocr.progress || 0) * 100
                  )}%)`
                : '…'}
            </p>
          )}
        </div>

        {/* Editable grid */}
        {rows.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Pending rows ({rows.length})</h2>
              <div className="flex gap-3">
                <button
                  onClick={handleDownloadTemplate}
                  className="text-sm text-gray-600 hover:underline"
                >
                  Download as paystub-generator template
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : `Save ${rows.filter((r) => r.userId).length} matched row(s)`}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium sticky left-0 bg-gray-50">Employee</th>
                    <th className="px-3 py-2 text-left font-medium">Match</th>
                    <th className="px-3 py-2 text-left font-medium">State</th>
                    <th className="px-3 py-2 text-left font-medium">As Of</th>
                    {FIELD_DEFS.map((f) => (
                      <th key={f.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td className="px-3 py-2 sticky left-0 bg-white">
                        <input
                          value={row.employeeName}
                          onChange={(e) => updateRow(row.key, { employeeName: e.target.value })}
                          onBlur={(e) => rematchRow(row.key, e.target.value)}
                          className="w-40 border border-gray-200 rounded px-2 py-1"
                          placeholder="Employee name"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {row.matchStatus === 'matched' && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">Matched</span>
                        )}
                        {row.matchStatus === 'unmatched' && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">No match</span>
                        )}
                        {row.matchStatus === 'checking' && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">Checking…</span>
                        )}
                        {row.matchStatus === 'unchecked' && (
                          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={row.stateCode}
                          onChange={(e) => updateRow(row.key, { stateCode: e.target.value })}
                          className="border border-gray-200 rounded px-1 py-1"
                        >
                          {STATE_CODES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={row.asOfDate}
                          onChange={(e) => updateRow(row.key, { asOfDate: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1"
                        />
                      </td>
                      {FIELD_DEFS.map((f) => (
                        <td key={f.key} className="px-2 py-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={row[f.key]}
                            onChange={(e) => updateRow(row.key, { [f.key]: e.target.value } as Partial<Row>)}
                            className="w-24 border border-gray-200 rounded px-2 py-1 text-right"
                            placeholder="0.00"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <button onClick={() => removeRow(row.key)} className="text-red-600 hover:underline text-xs">
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
