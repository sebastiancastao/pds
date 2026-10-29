// Deduction lines of a statement that pays no wages this period (Gross Pay $0.00): a
// /paystub-generator equipment reimbursement paystub, or an ADP reimbursement-only check.
// Those lines print the year-to-date amount only, and the two-number deduction patterns of
// the /pdf-reader parsers then split that one amount in two ("1,234.56" read as 1,234.5 this
// period and 6 year to date). Nothing is withheld from $0.00 of wages, so on such a statement
// a deduction line holding a single amount is its year to date, with 0 this period.
//
// Used by both parsers: app/api/extract-pdf/route.ts (text PDFs, e.g. generated paystubs)
// and lib/pdf-reader-extraction.ts (OCR text).

type DeductionBucket = 'statutoryDeductions' | 'voluntaryDeductions';

const ZERO_GROSS_DEDUCTION_LINES: Array<{ bucket: DeductionBucket; key: string; label: RegExp }> = [
  { bucket: 'statutoryDeductions', key: 'federalIncome', label: /Federal\s+Income(?:\s+Tax)?/i },
  // Not the "Social Security Number:XXX-XX-1234" line at the top of the statement.
  { bucket: 'statutoryDeductions', key: 'socialSecurity', label: /Social\s+Security(?!\s+Number)(?:\s+Tax)?/i },
  { bucket: 'statutoryDeductions', key: 'medicare', label: /Medicare(?:\s+Tax)?/i },
  { bucket: 'statutoryDeductions', key: 'californiaStateIncome', label: /California\s+State\s+Income/i },
  { bucket: 'statutoryDeductions', key: 'californiaStateDI', label: /California\s+State\s+DI/i },
  { bucket: 'statutoryDeductions', key: 'arizonaStateIncome', label: /Arizona\s+State\s+Income/i },
  { bucket: 'statutoryDeductions', key: 'wisconsinStateIncome', label: /Wisconsin\s+State\s+Income/i },
  { bucket: 'voluntaryDeductions', key: 'calSaversRothRet', label: /Cal\s*Savers?\s+Roth\s+Ret\s*%?/i },
  // Not ADP's "Misc Non Taxable Reimbursement" (a net pay adjustment).
  { bucket: 'voluntaryDeductions', key: 'miscNonTaxableDeduction', label: /Misc\s+Non\s+Taxable(?!\s+Reimb)(?:\s+Deduction)?/i },
];

const AMOUNT_RUN = /^((?:\s*\(?-?\$?\s*\d[\d,.]*\)?){1,4})/;
const AMOUNT_TOKEN = /\(?-?\$?\s*\d[\d,.]*\)?/g;

const amountsAfterLabel = (line: string, label: RegExp): number[] | null => {
  const match = label.exec(line);
  if (!match) return null;
  const run = line.slice(match.index + match[0].length).match(AMOUNT_RUN);
  if (!run) return [];
  return (run[1].match(AMOUNT_TOKEN) || [])
    .map((token) => Number(token.replace(/[()$,\s-]/g, '')))
    .filter((n) => Number.isFinite(n));
};

export function fixZeroGrossDeductionLines(payrollData: any, textLines: string[]): void {
  if (!payrollData || payrollData.employeeInfo?.grossPay !== 0) return;
  for (const { bucket, key, label } of ZERO_GROSS_DEDUCTION_LINES) {
    for (const line of textLines) {
      const amounts = amountsAfterLabel(line, label);
      if (amounts === null || amounts.length === 0) continue;
      if (amounts.length === 1) {
        payrollData[bucket] = payrollData[bucket] || {};
        payrollData[bucket][key] = { thisPeriod: 0, yearToDate: amounts[0] };
      }
      break;
    }
  }
}
