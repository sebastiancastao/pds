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
// employee matching: one batched POST to /api/employee-ytd-carryover/match
// (tolerant matcher in lib/employee-name-match.ts). Confident matches apply
// automatically; near matches are offered as suggestions to pick from, and
// "Re-match unmatched" runs the search again for rows that did not match.
//
// PDFs are read exactly the way /pdf-reader reads them: the pipeline lives in
// lib/pdf-reader-extraction.ts (server text extraction via /api/extract-pdf,
// and for scanned PDFs client-side OCR with LLM / regex / AI-vision fallbacks).
// Each paystub page becomes one row built from its year-to-date column.
//
// Several documents can be uploaded at once (file picker multi-select or drag
// and drop, spreadsheets and PDFs mixed), and more can be added later. Each
// upload is read one file at a time and listed in the "Documents" panel with
// its own status, so one bad file never hides the others. Within an upload the
// most recent row per employee name is kept; across uploads, rows that match
// the same employee are flagged "Duplicate" and only the most recent is saved,
// because the save API upserts one baseline per user_id.

import { useState, useRef, useCallback, useEffect, useMemo, type DragEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { OcrHooks, OcrProgress, PayrollData } from '@/lib/pdf-reader-extraction';
import type { MatchMethod, NameCandidate, NameMatchResult } from '@/lib/employee-name-match';

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
  // Employee the row is matched to, and how ('picked' = chosen by hand from
  // the suggestions, 'onfile' = loaded from an existing carryover record).
  matchedName: string | null;
  matchMethod: MatchMethod | 'picked' | 'onfile' | null;
  // Near matches the reviewer can pick from when nothing matched automatically.
  suggestions: NameCandidate[];
  // Name the current match result is for; blur only re-matches when it changed.
  matchedQuery: string;
  asOfDate: string;
  stateCode: string;
  notes: string;
  // UI-only: which uploaded document produced this row ('' for manual rows
  // and rows loaded from "On file"). Never sent to the save API.
  sourceDocId: string;
  sourceName: string;
} & Record<FieldKey, string>;

type UploadedDoc = {
  id: string;
  name: string;
  kind: 'pdf' | 'sheet' | 'other';
  status: 'queued' | 'reading' | 'done' | 'error';
  rowsRead: number;
  message: string | null;
};

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

const mileageReimbursementYtdAliases = [
  'mileage reimbursement ytd',
  'mileage reimbursement year to date',
  'year to date mileage reimbursement',
  'mileage reimb ytd',
  'mileage reimb year to date',
  'year to date mileage reimb',
  'mileage pay ytd',
  'mileage pay year to date',
  'year to date mileage pay',
  'mileage ytd',
  'mileage year to date',
  'ytd mileage reimbursement',
  'ytd mileage reimb',
  'ytd mileage pay',
  'ytd mileage',
];

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
  { key: 'sickPayYtd', label: 'Sick Pay', aliases: ['sick pay ytd', 'sick ytd', 'sick pay year to date', 'sick year to date', 'ytd sick pay', 'ytd sick'] },
  {
    key: 'mealPremiumYtd',
    label: 'Meal Premium',
    aliases: [
      'meal premium ytd',
      'meal premium year to date',
      'year to date meal premium',
      'meal prem ytd',
      'meal prem year to date',
      'year to date meal prem',
      'meal time premium ytd',
      'meal time premium year to date',
      'year to date meal time premium',
      'meal time prem ytd',
      'meal time prem year to date',
      'year to date meal time prem',
      'ytd meal premium',
      'ytd meal prem',
      'ytd meal time premium',
      'ytd meal time prem',
    ],
  },
  { key: 'grossPayYtd', label: 'Gross Pay', aliases: ['gross pay ytd', 'year to date gross pay', 'ytd gross pay', 'ytd gross', 'gross ytd'] },
  { key: 'equipmentReimbYtd', label: 'Equipment Reimb.', aliases: ['equipment reimbursement ytd', 'ytd equipment reimbursement'] },
  {
    key: 'mileageReimbYtd',
    label: 'Mileage Reimb.',
    aliases: mileageReimbursementYtdAliases,
  },
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
    matchedName: null,
    matchMethod: null,
    suggestions: [],
    matchedQuery: '',
    asOfDate: new Date().toISOString().slice(0, 10),
    stateCode: 'CA',
    notes: '',
    sourceDocId: '',
    sourceName: '',
    ...emptyFields(),
  };
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

// Progress of the document currently being read in an upload batch.
type ReadStatus = {
  fileName: string;
  index: number;
  total: number;
  ocr: OcrProgress | null;
};

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isSpreadsheetFile(file: File): boolean {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
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

// Save-time twin of keepLatestPerEmployee, keyed on the matched user_id. Rows
// from separate uploads (or name spellings that match the same person) would
// otherwise send the same user_id twice, which the upsert rejects outright.
// Latest as-of date wins, then higher gross YTD, then the later row in the grid.
function keepLatestPerUser(rows: Row[]): { kept: Row[]; dropped: number } {
  const byUser = new Map<string, Row>();
  const grossOf = (r: Row) => parseFloat(String(r.grossPayYtd || '0').replace(/,/g, '')) || 0;
  for (const row of rows) {
    if (!row.userId) continue;
    const existing = byUser.get(row.userId);
    if (
      !existing ||
      row.asOfDate > existing.asOfDate ||
      (row.asOfDate === existing.asOfDate && grossOf(row) >= grossOf(existing))
    ) {
      byUser.set(row.userId, row);
    }
  }
  const keptSet = new Set(byUser.values());
  const kept = rows.filter((r) => keptSet.has(r));
  return { kept, dropped: rows.filter((r) => r.userId).length - kept.length };
}

// ---------- Per-document readers (one file in, rows out; throw on failure) ----------

async function readSpreadsheetFile(file: File): Promise<Row[]> {
  const XLSX = await import('xlsx');
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) throw new Error('the workbook has no sheets');
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];

  if (jsonData.length < 2) {
    throw new Error('the file needs a header row and at least one employee row');
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
  const parseCurrencyNumber = (value: any) => {
    const raw = String(value ?? '').trim();
    if (!raw) return NaN;
    const isNegative = raw.startsWith('-') || /^\(.*\)$/.test(raw);
    const normalized = raw.replace(/[()$,\s]/g, '').replace(/^-/, '');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? (isNegative ? -n : n) : NaN;
  };
  const getAbsolute = (valuesRow: any[], possibleNames: string[]): string => {
    const v = getValue(valuesRow, possibleNames);
    if (!v) return '';
    const n = parseCurrencyNumber(v);
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

  if (dataRows.length === 0) throw new Error('no employee rows found');

  return dataRows.map((valuesRow) => {
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
    row.asOfDate = formatDate(getValue(valuesRow, ['as of date', 'pay date', 'period end', 'pay period end']));
    row.stateCode = stateCode;
    row.stateIncomeYtd = getAbsolute(valuesRow, STATE_INCOME_ALIASES[stateCode]);

    for (const f of FIELD_DEFS) {
      if (f.key === 'stateIncomeYtd' || f.aliases.length === 0) continue;
      row[f.key] = getAbsolute(valuesRow, f.aliases);
    }
    row.notes = `From ${file.name}`;
    return row;
  });
}

// Same reader as /pdf-reader, one row per paystub page.
async function readPdfFile(
  file: File,
  lib: PdfReaderLib,
  hooks: OcrHooks
): Promise<Row[]> {
  const result = await lib.extractPdfPayroll(file, hooks);
  const pages =
    result.payrollDataByPage && result.payrollDataByPage.length > 0
      ? result.payrollDataByPage
      : result.payrollData
        ? [{ pageNumber: 1, text: result.text || '', payrollData: result.payrollData, extractionMethod: undefined }]
        : [];
  const rows: Row[] = [];
  for (const page of pages) {
    const row = rowFromPdfPage(page.payrollData, file.name, page.pageNumber, page.extractionMethod, lib);
    // Skip pages that carry neither a name nor any YTD figure
    // (cover pages, continuation pages, blank scans).
    if (!row.employeeName && !hasAnyYtd(row)) continue;
    rows.push(row);
  }
  if (rows.length === 0) throw new Error('no paystub data found');
  return rows;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// ---------- Employee matching (batched) ----------
//
// The old flow called /api/match-employee once per row, one after another,
// and that endpoint only accepted an exact official_name. Now every distinct
// name goes to /api/employee-ytd-carryover/match in one request, which loads
// the employee directory once and matches with lib/employee-name-match.ts
// (accents, name order, middle names, second surnames, suffixes, nicknames,
// typos). Only confident matches are applied; near matches come back as
// suggestions for the reviewer to pick.

const MATCH_CHUNK = 1000;
const CLEAR_SUGGESTION_MIN = 0.85;
const CLEAR_SUGGESTION_LEAD = 0.05;

async function matchNamesBatch(names: string[], refresh = false): Promise<Map<string, NameMatchResult>> {
  const distinct = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  const out = new Map<string, NameMatchResult>();
  if (distinct.length === 0) return out;
  const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
  for (let i = 0; i < distinct.length; i += MATCH_CHUNK) {
    const chunk = distinct.slice(i, i + MATCH_CHUNK);
    const res = await fetch('/api/employee-ytd-carryover/match', {
      method: 'POST',
      headers,
      body: JSON.stringify({ names: chunk, refresh: refresh && i === 0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `employee matching failed (HTTP ${res.status})`);
    (data.results || []).forEach((r: NameMatchResult, idx: number) => out.set(chunk[idx], r));
  }
  return out;
}

function applyMatchResult(row: Row, result: NameMatchResult): Row {
  return {
    ...row,
    userId: result.userId,
    matchStatus: result.userId ? 'matched' : 'unmatched',
    matchedName: result.userId ? result.matchedName : null,
    matchMethod: result.userId ? result.method : null,
    suggestions: result.candidates,
    matchedQuery: row.employeeName.trim(),
  };
}

// A suggestion safe enough to accept in bulk: high score and a clear lead
// over the next person.
function clearTopSuggestion(row: Row): NameCandidate | null {
  if (row.matchStatus !== 'unmatched' || row.suggestions.length === 0) return null;
  const [top, second] = row.suggestions;
  if (top.score < CLEAR_SUGGESTION_MIN) return null;
  if (second && top.score - second.score < CLEAR_SUGGESTION_LEAD) return null;
  return top;
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) =>
    String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
}

type MatchOutcome = { total: number; matched: number; suggested: number; none: number; seconds: number };

export default function AdpYtdImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [onFile, setOnFile] = useState<OnFileRecord[]>([]);
  const [loadingOnFile, setLoadingOnFile] = useState(true);
  const [parsing, setParsing] = useState(false);
  // Guards against a second upload (drop or picker) starting mid-read.
  const busyRef = useRef(false);
  const [readStatus, setReadStatus] = useState<ReadStatus | null>(null);
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [rematching, setRematching] = useState(false);
  const [view, setView] = useState<'all' | 'attention' | 'new'>('all');

  const loadOnFile = useCallback(async () => {
    setLoadingOnFile(true);
    try {
      const headers = await getAuthHeaders();
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

  // Matches the given rows to employees with one batched request and writes
  // the results back. Returns counts for the status message, or null if the
  // request failed (the error banner says why).
  const matchRows = useCallback(async (targets: Row[], refresh = false): Promise<MatchOutcome | null> => {
    const started = performance.now();
    const named = targets.filter((r) => r.employeeName.trim());
    const namedKeys = new Set(named.map((r) => r.key));
    const blankKeys = new Set(targets.filter((r) => !r.employeeName.trim()).map((r) => r.key));
    setRows((prev) =>
      prev.map((r) => {
        if (namedKeys.has(r.key)) return { ...r, matchStatus: 'checking' };
        if (blankKeys.has(r.key)) {
          return { ...r, userId: null, matchStatus: 'unmatched', matchedName: null, matchMethod: null, suggestions: [], matchedQuery: '' };
        }
        return r;
      })
    );
    if (named.length === 0) return { total: targets.length, matched: 0, suggested: 0, none: targets.length, seconds: 0 };

    try {
      const results = await matchNamesBatch(named.map((r) => r.employeeName), refresh);
      setRows((prev) =>
        prev.map((r) => {
          if (!namedKeys.has(r.key)) return r;
          // The name may have been edited while the request was in flight;
          // leave that row for its own blur to re-match.
          const result = results.get(r.employeeName.trim());
          if (!result) return r.matchStatus === 'checking' ? { ...r, matchStatus: 'unchecked' } : r;
          return applyMatchResult(r, result);
        })
      );
      let matched = 0;
      let suggested = 0;
      for (const r of named) {
        const result = results.get(r.employeeName.trim());
        if (result?.userId) matched++;
        else if (result && result.candidates.length > 0) suggested++;
      }
      return {
        total: targets.length,
        matched,
        suggested,
        none: targets.length - matched - suggested,
        seconds: (performance.now() - started) / 1000,
      };
    } catch (e: any) {
      setRows((prev) =>
        prev.map((r) => (namedKeys.has(r.key) && r.matchStatus === 'checking' ? { ...r, matchStatus: 'unchecked' } : r))
      );
      setError(`Could not match employees: ${e?.message || e}`);
      return null;
    }
  }, []);

  // Adds parsed rows to the grid, then matches all of them in one request.
  const appendAndMatch = useCallback(
    async (parsed: Row[]) => {
      setRows((prev) => [...prev, ...parsed]);
      return matchRows(parsed);
    },
    [matchRows]
  );

  // Another run over the rows that did not match, against a freshly loaded
  // employee list (refresh) so people added since the last run are found.
  const handleRematchUnmatched = useCallback(async () => {
    const targets = rows.filter((r) => r.matchStatus === 'unmatched' || r.matchStatus === 'unchecked');
    if (targets.length === 0 || rematching) return;
    setError(null);
    setSuccess(null);
    setRematching(true);
    try {
      const outcome = await matchRows(targets, true);
      if (outcome) {
        setSuccess(
          `Re-checked ${outcome.total} unmatched row(s) in ${outcome.seconds.toFixed(1)}s: ` +
            `${outcome.matched} matched, ${outcome.suggested} have suggestions to pick from, ${outcome.none} still not found.`
        );
      }
    } finally {
      setRematching(false);
    }
  }, [rows, rematching, matchRows]);

  const pickCandidate = useCallback((key: string, candidate: NameCandidate) => {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key
          ? { ...r, userId: candidate.userId, matchStatus: 'matched', matchedName: candidate.name, matchMethod: 'picked' }
          : r
      )
    );
  }, []);

  // Clears a match so the reviewer can choose another suggestion.
  const unmatchRow = useCallback((key: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, userId: null, matchStatus: 'unmatched', matchedName: null, matchMethod: null } : r))
    );
  }, []);

  const handleAcceptClearSuggestions = useCallback(() => {
    const picks = rows.map((r) => [r.key, clearTopSuggestion(r)] as const).filter(([, c]) => c);
    if (picks.length === 0) return;
    const ok = window.confirm(
      `Use the top suggestion for ${picks.length} row(s)? Each one scored at least ${Math.round(
        CLEAR_SUGGESTION_MIN * 100
      )}% and is clearly ahead of the next person. Check the "as ..." names before saving.`
    );
    if (!ok) return;
    const byKey = new Map(picks);
    setRows((prev) =>
      prev.map((r) => {
        const c = byKey.get(r.key);
        return c ? { ...r, userId: c.userId, matchStatus: 'matched', matchedName: c.name, matchMethod: 'picked' } : r;
      })
    );
  }, [rows]);

  const handleAddManual = useCallback(() => {
    setRows((prev) => [...prev, newRow()]);
  }, []);

  // Reads every document in one upload (any mix of spreadsheets and PDFs),
  // one file at a time, recording each file's outcome in the Documents list.
  // A failed file is marked and skipped; the rest of the upload still imports.
  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setSuccess(null);
    setParsing(true);

    const batch: UploadedDoc[] = files.map((file) => ({
      id: makeId(),
      name: file.name,
      kind: isPdfFile(file) ? 'pdf' : isSpreadsheetFile(file) ? 'sheet' : 'other',
      status: 'queued',
      rowsRead: 0,
      message: null,
    }));
    setDocs((prev) => [...prev, ...batch]);
    const updateDoc = (id: string, patch: Partial<UploadedDoc>) =>
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

    const collected: Row[] = [];
    const failures: string[] = [];
    let lib: PdfReaderLib | null = null;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const doc = batch[i];
        updateDoc(doc.id, { status: 'reading' });
        setReadStatus({ fileName: file.name, index: i + 1, total: files.length, ocr: null });
        try {
          let parsed: Row[];
          if (doc.kind === 'pdf') {
            if (!lib) lib = await import('@/lib/pdf-reader-extraction');
            parsed = await readPdfFile(file, lib, {
              onOcrStart: () => setReadStatus((s) => (s ? { ...s, ocr: { page: 0, progress: 0, total: 0 } } : s)),
              onOcrProgress: (progress) => setReadStatus((s) => (s ? { ...s, ocr: progress } : s)),
              onOcrEnd: () => setReadStatus((s) => (s ? { ...s, ocr: null } : s)),
            });
          } else if (doc.kind === 'sheet') {
            parsed = await readSpreadsheetFile(file);
          } else {
            throw new Error('unsupported file type (use .xlsx, .xls, .csv or .pdf)');
          }
          for (const row of parsed) {
            row.sourceDocId = doc.id;
            row.sourceName = file.name;
          }
          collected.push(...parsed);
          updateDoc(doc.id, { status: 'done', rowsRead: parsed.length });
        } catch (e: any) {
          const message = e?.message || String(e);
          failures.push(`${file.name}: ${message}`);
          updateDoc(doc.id, { status: 'error', message });
        }
      }
    } finally {
      setReadStatus(null);
    }

    try {
      const docWord = files.length === 1 ? 'document' : 'documents';
      if (collected.length > 0) {
        // One baseline per employee: across every document in this upload keep
        // the most recent row per name (latest as-of date, then gross YTD).
        const { kept, dropped } = keepLatestPerEmployee(collected);
        const dupNote =
          dropped > 0 ? ` Kept the most recent row per employee (${dropped} older row(s) skipped).` : '';
        setSuccess(`Read ${kept.length} employee row(s) from ${files.length} ${docWord}. Matching employees…${dupNote}`);
        const outcome = await appendAndMatch(kept);
        const matchNote = outcome
          ? ` Employees matched in ${outcome.seconds.toFixed(1)}s: ${outcome.matched} matched, ${outcome.suggested} need a pick from suggestions, ${outcome.none} not found.`
          : '';
        setSuccess(
          `Imported ${kept.length} row(s) from ${files.length - failures.length} of ${files.length} ${docWord}.${dupNote}${matchNote} Review the YTD numbers before saving.`
        );
      }
      if (failures.length > 0) {
        setError(`Could not read ${failures.length} of ${files.length} ${docWord}: ${failures.join('; ')}`);
      }
    } finally {
      setParsing(false);
      busyRef.current = false;
    }
  }, [appendAndMatch]);

  // Removes an uploaded document from the list together with its rows that
  // are still pending (saved rows are already gone from the grid).
  const removeDoc = useCallback((docId: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== docId));
    setRows((prev) => prev.filter((r) => r.sourceDocId !== docId));
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      if (busyRef.current) return;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles]
  );

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
    // Rows from different documents can match the same employee; send only the
    // most recent one per user_id (the upsert rejects a repeated user_id).
    const { kept, dropped } = keepLatestPerUser(matched);
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const payload = {
        rows: kept.map((r) => ({
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
          (dropped
            ? ` ${dropped} older duplicate row(s) for the same employee were not saved; the most recent was kept.`
            : '') +
          (data.skipped ? ` ${data.skipped} row(s) skipped — see below.` : '')
      );
      // Rows the API rejected (e.g. a non-numeric cell) stay in the grid so
      // they can be fixed; everything else that was matched is now on file.
      const failedUserIds = new Set<string>();
      if (data.problems?.length) {
        setError(data.problems.map((p: any) => p.message).join('; '));
        for (const p of data.problems) {
          const uid = kept[p?.index]?.userId;
          if (uid) failedUserIds.add(uid);
        }
      }
      setRows((prev) => prev.filter((r) => !r.userId || failedUserIds.has(r.userId)));
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
    row.matchedName = rec.employeeName;
    row.matchMethod = 'onfile';
    row.matchedQuery = rec.employeeName.trim();
    row.asOfDate = rec.as_of_date || row.asOfDate;
    row.stateCode = rec.state_code || 'CA';
    row.grossPayYtd = rec.gross_pay_ytd != null ? String(rec.gross_pay_ytd) : '';
    row.federalIncomeYtd = rec.federal_income_ytd != null ? String(rec.federal_income_ytd) : '';
    row.socialSecurityYtd = rec.social_security_ytd != null ? String(rec.social_security_ytd) : '';
    row.medicareYtd = rec.medicare_ytd != null ? String(rec.medicare_ytd) : '';
    setRows((prev) => [...prev, row]);
  }, []);

  // user_ids matched by more than one pending row (flagged "Duplicate"; only
  // the most recent of them is saved).
  const duplicateUserIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.userId) counts.set(r.userId, (counts.get(r.userId) || 0) + 1);
    return new Set(Array.from(counts).filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);

  const saveableCount = useMemo(
    () => new Set(rows.filter((r) => r.userId).map((r) => r.userId)).size,
    [rows]
  );

  const pendingByDoc = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.sourceDocId) counts.set(r.sourceDocId, (counts.get(r.sourceDocId) || 0) + 1);
    return counts;
  }, [rows]);

  const onFileIds = useMemo(() => new Set(onFile.map((r) => r.user_id)), [onFile]);

  // Matched rows for employees who already have a saved baseline (from an
  // earlier run). Rows opened with "Edit" are excluded: those are deliberate.
  const isAlreadyOnFile = useCallback(
    (r: Row) => !!r.userId && onFileIds.has(r.userId) && r.matchMethod !== 'onfile',
    [onFileIds]
  );

  const needsAttention = useCallback(
    (r: Row) => r.matchStatus !== 'matched' || (!!r.userId && duplicateUserIds.has(r.userId)),
    [duplicateUserIds]
  );

  const counts = useMemo(() => {
    let unmatched = 0;
    let withSuggestions = 0;
    let clearSuggestions = 0;
    let attention = 0;
    let alreadyOnFile = 0;
    for (const r of rows) {
      if (r.matchStatus === 'unmatched' || r.matchStatus === 'unchecked') unmatched++;
      if (r.matchStatus === 'unmatched' && r.suggestions.length > 0) withSuggestions++;
      if (clearTopSuggestion(r)) clearSuggestions++;
      if (needsAttention(r)) attention++;
      if (isAlreadyOnFile(r)) alreadyOnFile++;
    }
    return { unmatched, withSuggestions, clearSuggestions, attention, alreadyOnFile, notOnFile: rows.length - alreadyOnFile };
  }, [rows, needsAttention, isAlreadyOnFile]);

  const visibleRows = useMemo(() => {
    if (view === 'attention') return rows.filter(needsAttention);
    if (view === 'new') return rows.filter((r) => !isAlreadyOnFile(r));
    return rows;
  }, [rows, view, needsAttention, isAlreadyOnFile]);

  const handleRemoveAlreadyOnFile = useCallback(() => {
    if (counts.alreadyOnFile === 0) return;
    const ok = window.confirm(
      `Remove ${counts.alreadyOnFile} pending row(s) for employees who already have a saved YTD baseline? ` +
        'Their saved numbers stay as they are.'
    );
    if (!ok) return;
    setRows((prev) => prev.filter((r) => !isAlreadyOnFile(r)));
  }, [counts.alreadyOnFile, isAlreadyOnFile]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-7xl py-10 px-6">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">ADP Year-to-Date Import</h1>
            <p className="text-gray-600 mt-1 max-w-3xl">
              Upload ADP year-to-date reports or paystub PDFs (several at once) or type
              numbers in by hand to set each
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              // Reset now so picking the same file(s) again still fires onChange.
              e.target.value = '';
              if (files.length > 0) handleFiles(files);
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!parsing) setDragActive(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
            }}
            onDrop={handleDrop}
            className={`rounded-lg border-2 border-dashed p-5 transition-colors ${
              dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {parsing ? 'Reading…' : 'Upload documents (.xlsx/.xls/.csv/.pdf)'}
              </button>
              <button
                onClick={handleAddManual}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50"
              >
                + Add employee manually
              </button>
              <span className="text-sm text-gray-500">
                {parsing ? 'Wait for the current upload to finish…' : 'or drag and drop files here'}
              </span>
            </div>
            <p className="mt-3 text-xs text-gray-500 max-w-3xl">
              Select several files at once (Ctrl/Shift-click) and mix spreadsheets and PDFs; you can
              keep uploading more and new rows are added to the pending list. PDF paystubs are read the
              same way as the{' '}
              <Link href="/pdf-reader" className="text-blue-600 underline">
                PDF Reader
              </Link>
              : text PDFs are parsed directly and scanned PDFs go through OCR. Each paystub page becomes
              a row built from its year-to-date column. When one upload has several rows for the same
              employee, only the most recent is kept; rows from separate uploads that match the same
              employee are marked Duplicate and only the most recent is saved.
            </p>
          </div>
          {readStatus && (
            <p className="mt-3 text-sm text-gray-700">
              Reading {readStatus.fileName} ({readStatus.index} of {readStatus.total})
              {readStatus.ocr
                ? ` — scanned PDF, OCR page ${readStatus.ocr.page || 1} of ${readStatus.ocr.total || '?'} (${Math.round(
                    (readStatus.ocr.progress || 0) * 100
                  )}%)`
                : '…'}
            </p>
          )}
          {docs.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Documents ({docs.length})</h3>
                <button
                  onClick={() => setDocs([])}
                  disabled={parsing}
                  className="text-xs text-gray-500 hover:underline disabled:opacity-50"
                  title="Clears this list only; pending rows stay in the grid"
                >
                  Clear list
                </button>
              </div>
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">File</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">Rows read</th>
                      <th className="px-3 py-2 text-right font-medium">Pending</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {docs.map((doc) => (
                      <tr key={doc.id}>
                        <td className="px-3 py-2 text-gray-900 break-all">{doc.name}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {doc.kind === 'pdf' ? 'PDF' : doc.kind === 'sheet' ? 'Spreadsheet' : 'Unsupported'}
                        </td>
                        <td className="px-3 py-2">
                          {doc.status === 'queued' && <span className="text-gray-500">Waiting</span>}
                          {doc.status === 'reading' && <span className="text-blue-600">Reading…</span>}
                          {doc.status === 'done' && <span className="text-green-700">Read</span>}
                          {doc.status === 'error' && (
                            <span className="text-red-600">Failed: {doc.message}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {doc.status === 'done' ? doc.rowsRead : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {doc.status === 'done' ? pendingByDoc.get(doc.id) || 0 : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeDoc(doc.id)}
                            disabled={parsing}
                            className="text-red-600 hover:underline text-xs disabled:opacity-50"
                            title="Remove this document and its pending rows"
                          >
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

        {/* Editable grid */}
        {rows.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900">Pending rows ({rows.length})</h2>
                <select
                  value={view}
                  onChange={(e) => setView(e.target.value as typeof view)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-700"
                  aria-label="Which rows to show"
                >
                  <option value="all">Show all rows ({rows.length})</option>
                  <option value="attention">Needs attention ({counts.attention})</option>
                  <option value="new">Not yet on file ({counts.notOnFile})</option>
                </select>
              </div>
              <div className="flex gap-3 flex-wrap items-center">
                <button
                  onClick={handleRematchUnmatched}
                  disabled={counts.unmatched === 0 || rematching || parsing}
                  className="px-3 py-2 rounded-lg border border-blue-300 bg-white text-blue-700 text-sm font-medium hover:bg-blue-50 disabled:opacity-50"
                  title="Search again for every row that did not match, with the tolerant matcher and a fresh employee list"
                >
                  {rematching ? 'Searching…' : `Re-match unmatched (${counts.unmatched})`}
                </button>
                {counts.clearSuggestions > 0 && (
                  <button
                    onClick={handleAcceptClearSuggestions}
                    className="px-3 py-2 rounded-lg border border-amber-300 bg-white text-amber-800 text-sm font-medium hover:bg-amber-50"
                  >
                    Accept {counts.clearSuggestions} clear suggestion(s)
                  </button>
                )}
                {counts.alreadyOnFile > 0 && (
                  <button
                    onClick={handleRemoveAlreadyOnFile}
                    className="text-sm text-gray-600 hover:underline"
                    title="Drop rows for employees whose YTD baseline was already saved in an earlier run"
                  >
                    Remove {counts.alreadyOnFile} already on file
                  </button>
                )}
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
                  {saving ? 'Saving…' : `Save ${saveableCount} matched employee(s)`}
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
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={FIELD_DEFS.length + 5} className="px-4 py-6 text-center text-gray-500">
                        No rows in this view.
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((row) => (
                    <tr key={row.key}>
                      <td className="px-3 py-2 sticky left-0 bg-white align-top">
                        <input
                          value={row.employeeName}
                          onChange={(e) => updateRow(row.key, { employeeName: e.target.value })}
                          onBlur={() => {
                            // Re-match only when the name actually changed, so
                            // a hand-picked employee is not overwritten.
                            if (row.employeeName.trim() !== row.matchedQuery || row.matchStatus === 'unchecked') {
                              matchRows([row]);
                            }
                          }}
                          className="w-40 border border-gray-200 rounded px-2 py-1"
                          placeholder="Employee name"
                        />
                        {row.sourceName && (
                          <div className="mt-1 w-40 truncate text-[11px] text-gray-400" title={row.sourceName}>
                            {row.sourceName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {row.matchStatus === 'matched' && (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              {row.matchMethod === 'picked' ? (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs">Picked</span>
                              ) : row.matchMethod === 'normalized' || row.matchMethod === 'partial' ? (
                                <span
                                  className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs"
                                  title={
                                    row.matchMethod === 'partial'
                                      ? 'Matched although one name has extra parts (middle name or second surname)'
                                      : 'Matched although spelling, order, accents or initials differ'
                                  }
                                >
                                  Close match
                                </span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs">Matched</span>
                              )}
                              {row.userId && duplicateUserIds.has(row.userId) && (
                                <span
                                  className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs"
                                  title="Another pending row matches the same employee. Only the one with the latest As Of date is saved."
                                >
                                  Duplicate
                                </span>
                              )}
                              {isAlreadyOnFile(row) && (
                                <span
                                  className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs"
                                  title="This employee already has a saved YTD baseline; saving replaces it"
                                >
                                  On file
                                </span>
                              )}
                              {row.matchMethod !== 'onfile' && (
                                <button
                                  onClick={() => unmatchRow(row.key)}
                                  className="text-[11px] text-gray-500 hover:underline"
                                  title="Clear this match and choose another employee"
                                >
                                  change
                                </button>
                              )}
                            </div>
                            {row.matchedName && !sameName(row.matchedName, row.employeeName) && (
                              <div className="max-w-[15rem] truncate text-[11px] text-gray-600" title={row.matchedName}>
                                as {row.matchedName}
                              </div>
                            )}
                          </div>
                        )}
                        {row.matchStatus === 'unmatched' && row.suggestions.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="inline-block w-fit px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs whitespace-nowrap">
                              Pick employee
                            </span>
                            <select
                              value=""
                              onChange={(e) => {
                                const c = row.suggestions.find((s) => s.userId === e.target.value);
                                if (c) pickCandidate(row.key, c);
                              }}
                              className="max-w-[16rem] border border-amber-300 rounded px-1 py-1 text-xs"
                            >
                              <option value="">
                                {row.suggestions.length} suggestion{row.suggestions.length === 1 ? '' : 's'}…
                              </option>
                              {row.suggestions.map((c) => (
                                <option key={c.userId} value={c.userId}>
                                  {`${c.name} · ${Math.round(c.score * 100)}%${c.email ? ` · ${c.email}` : ''}${c.active ? '' : ' (inactive)'}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        {row.matchStatus === 'unmatched' && row.suggestions.length === 0 && (
                          <span
                            className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs whitespace-nowrap"
                            title="No employee name is close. Fix the name in the Employee box (or check the person has an account)."
                          >
                            No match
                          </span>
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
