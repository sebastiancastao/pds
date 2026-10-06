// lib/adp-statement-ytd.ts
//
// Reads every year-to-date figure off one page of an ADP "Earnings Statement"
// (the PayStatementData PDFs HR exports), for /adp-ytd-import.
//
// The general paystub parser (extractPayrollData in app/api/extract-pdf and
// lib/pdf-reader-extraction.ts) is tuned for this-period amounts and misses
// YTD-only lines: on these statements a $0 this-period column is left blank,
// so "Gross Pay $5,604.93" carries only the YTD figure, and lines such as
// Meal Break Premium Pay, Travel, Sick or New York State Income were never
// mapped. This reader works line by line instead: a line is a label followed
// by a run of amounts (rate, hours, this period, year to date, with the
// blank ones simply absent), and the LAST amount of that run is always the
// year-to-date column. Text after the run belongs to the right-hand column
// of the statement (deposits, notes) and is ignored.
//
// Works on the pdf.js text layer and on OCR text alike, since both put one
// statement line per text line.

export type AdpYtdKey =
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
  | 'holidayPayYtd'
  | 'grossPayYtd'
  | 'equipmentReimbYtd'
  | 'mileageReimbYtd'
  | 'miscReimbursementYtd';

export type AdpStatementYtd = {
  // YTD per grid column. stateIncomeYtd is the chosen state's figure.
  fields: Partial<Record<AdpYtdKey, number>>;
  // State whose income-tax line has the largest YTD, if any state line exists.
  stateCode: string | null;
  // Every state income-tax YTD found (a person can move mid-year).
  stateIncomes: Record<string, number>;
  // YTD lines with no carryover column (Medical, Child support, Vacation, ...).
  unmapped: { label: string; ytd: number }[];
  // Earnings lines (mapped + unmapped earnings) added up, to check against Gross Pay.
  earningsTotal: number;
  linesRead: number;
};

// An amount as ADP prints it: 1,234.56  $1,234.56  -1.76  (1.76)  1.76-
const AMOUNT_RE = /^\(?-?\$?\d[\d,]*\.\d{2}\)?-?$/;

function amountValue(token: string): number {
  const negative = /^\(.*\)$/.test(token) || token.startsWith('-') || token.endsWith('-');
  const n = parseFloat(token.replace(/[()$,\-\s]/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

// ADP statements draw the employee name and headings several times over for
// a bold effect, so the text layer reads "Ana Lopez Ana Lopez Ana Lopez Ana
// Lopez". Collapses three or more exact copies to one, so a genuinely
// doubled name such as "Jo Jo" survives; anything else is returned trimmed
// and unchanged.
export function collapseRepeatedText(text: string): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.replace(/^(.+?)(?: \1){2,}$/, '$1');
}

// The general parser cuts some names short, e.g. "Colleen M O'Reilly" comes
// back as "Colleen M O" because it stops at the apostrophe. The statement
// prints the name line several times over, so look for a repeated line that
// starts with the parsed name and is longer, and use it instead.
export function fullNameFromStatement(text: string, parsedName: string): string {
  const parsed = String(parsedName || '').replace(/\s+/g, ' ').trim();
  if (!parsed) return parsed;
  const want = parsed.toLowerCase();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const single = collapseRepeatedText(line);
    if (single === line) continue; // not a repeated (bold) line
    if (/\d/.test(single) || single.length > 80) continue; // address, account, date
    if (single.length > parsed.length && single.toLowerCase().startsWith(want)) return single;
  }
  return parsed;
}

function normalizeLabel(raw: string): string {
  const label = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // The statement draws headings several times over for a bold effect, so
  // "Gross Pay Gross Pay Gross Pay Gross Pay" collapses to "gross pay".
  return label.replace(/^(.+?)(?: \1)+$/, '$1');
}

const STATE_NAMES: Record<string, string> = {
  california: 'CA',
  ca: 'CA',
  arizona: 'AZ',
  az: 'AZ',
  'new york': 'NY',
  ny: 'NY',
  wisconsin: 'WI',
  wi: 'WI',
};

type LabelRule = { re: RegExp; key: AdpYtdKey; earning?: boolean };

const LABEL_RULES: LabelRule[] = [
  { re: /^gross pay$/, key: 'grossPayYtd' },
  { re: /^regular( pay| earnings| hours)?$/, key: 'regularYtd', earning: true },
  { re: /^overtime( pay| earnings)?$/, key: 'overtimeYtd', earning: true },
  { re: /^double ?time( pay| earnings)?$/, key: 'doubleTimeYtd', earning: true },
  { re: /^commissions?( pay)?$/, key: 'commissionYtd', earning: true },
  { re: /^variable incentive( pay)?$/, key: 'variableIncentiveYtd', earning: true },
  { re: /^(credit card )?tips( owed| paid)?$|^credit card tips( owed)?$/, key: 'creditCardTipsYtd', earning: true },
  { re: /^rest( break| period)?( pay)?$/, key: 'restBreakPayYtd', earning: true },
  { re: /^travel( pay| time)?$/, key: 'travelPayYtd', earning: true },
  { re: /^bonus( pay)?$/, key: 'bonusYtd', earning: true },
  { re: /^sick( pay| leave)?$/, key: 'sickPayYtd', earning: true },
  { re: /^meal( break| time| period)? (premium|prem)( pay)?$/, key: 'mealPremiumYtd', earning: true },
  { re: /^holiday( pay)?$/, key: 'holidayPayYtd', earning: true },
  { re: /^federal income( tax)?$/, key: 'federalIncomeYtd' },
  { re: /^social security( tax)?$/, key: 'socialSecurityYtd' },
  { re: /^medicare( tax)?$/, key: 'medicareYtd' },
  { re: /^(california |ca )?state (di|sdi|disability)$|^ca sdi$/, key: 'stateDIYtd' },
  { re: /^cal ?savers roth( ret| ira)?$/, key: 'calSaversRothRetYtd' },
  { re: /^(misc )?reimburse(ment)? equipment$|^equipment reimburse(ment)?$/, key: 'equipmentReimbYtd' },
  { re: /^mileage( reimburse(ment)?)?$/, key: 'mileageReimbYtd' },
  { re: /^misc reimburse(ment)?$/, key: 'miscReimbursementYtd' },
];

const STATE_INCOME_RE = /^(california|arizona|new york|wisconsin|ca|az|ny|wi) state income( tax)?$/;

// Earnings codes with no carryover column; still part of Gross Pay.
const UNMAPPED_EARNING_RE = /^(other income|vacation|pto|retro|severance|jury duty|bereavement)( pay)?$/;

// Lines that carry an amount but are not YTD items.
const SKIP_LABEL_RE =
  /^(net pay|your |total|deposit|checking|savings|account|basis of pay|taxable|federal$|state$|local$|federal taxable|excluded from|other benefits)/;

export function readAdpStatementYtd(text: string): AdpStatementYtd {
  const fields: Partial<Record<AdpYtdKey, number>> = {};
  const stateIncomes: Record<string, number> = {};
  const unmapped: { label: string; ytd: number }[] = [];
  let earningsTotal = 0;
  let linesRead = 0;

  const keep = (key: AdpYtdKey, value: number) => {
    // A code printed on several lines (one per pay rate) carries its YTD on
    // one of them; YTD is never below any this-period amount, so keep the max.
    const prev = fields[key];
    if (prev === undefined || Math.abs(value) > Math.abs(prev)) fields[key] = value;
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const tokens = rawLine.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    let i = 0;
    const labelTokens: string[] = [];
    while (i < tokens.length && !AMOUNT_RE.test(tokens[i])) labelTokens.push(tokens[i++]);
    const amounts: number[] = [];
    while (i < tokens.length && AMOUNT_RE.test(tokens[i])) amounts.push(amountValue(tokens[i++]));
    if (labelTokens.length === 0 || amounts.length === 0) continue;

    // "Child support 1", "Creditor 1": a trailing order number is part of the
    // label. Any other digit means an address, account or date line.
    const rawLabel = labelTokens.join(' ').replace(/ \d{1,2}$/, '');
    if (/\d/.test(rawLabel) || rawLabel.includes(':')) continue;
    const label = normalizeLabel(rawLabel);
    if (!label || SKIP_LABEL_RE.test(label)) continue;

    const ytd = amounts[amounts.length - 1];
    if (!Number.isFinite(ytd)) continue;

    const stateMatch = label.match(STATE_INCOME_RE);
    if (stateMatch) {
      const code = STATE_NAMES[stateMatch[1]];
      if (code) {
        stateIncomes[code] = Math.max(stateIncomes[code] ?? 0, Math.abs(ytd));
        linesRead++;
      }
      continue;
    }

    const rule = LABEL_RULES.find((r) => r.re.test(label));
    if (rule) {
      keep(rule.key, ytd);
      if (rule.earning) earningsTotal += ytd;
      linesRead++;
      continue;
    }

    if (UNMAPPED_EARNING_RE.test(label)) earningsTotal += ytd;
    unmapped.push({ label: rawLabel.replace(/^(.+?)(?: \1)+$/, '$1'), ytd });
    linesRead++;
  }

  let stateCode: string | null = null;
  for (const [code, value] of Object.entries(stateIncomes)) {
    if (stateCode === null || value > stateIncomes[stateCode]) stateCode = code;
  }
  if (stateCode) fields.stateIncomeYtd = stateIncomes[stateCode];

  return {
    fields,
    stateCode,
    stateIncomes,
    unmapped,
    earningsTotal: Math.round(earningsTotal * 100) / 100,
    linesRead,
  };
}
