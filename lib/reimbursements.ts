export const REIMBURSEMENT_BUCKET = 'vendor-reimbursements';
export const REIMBURSEMENT_MAX_BYTES = 10 * 1024 * 1024;
export const REIMBURSEMENT_ALLOWED_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export type ReimbursementStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';

export type ReimbursementEventOption = {
  id: string;
  event_name: string;
  event_date: string | null;
  venue: string | null;
  city: string | null;
  state: string | null;
};

export type ReimbursementRequestRecord = {
  id: string;
  user_id: string;
  event_id: string | null;
  purchase_date: string;
  description: string;
  requested_amount: number;
  approved_amount: number | null;
  status: ReimbursementStatus;
  receipt_path: string | null;
  receipt_filename: string | null;
  approved_pay_date: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function sanitizeReimbursementFilename(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, '_');
}

export function isAllowedReimbursementFile(file: { type?: string | null; name?: string | null }): boolean {
  const mime = (file.type || '').toLowerCase().trim();
  if (REIMBURSEMENT_ALLOWED_MIME.includes(mime)) {
    return true;
  }

  const name = (file.name || '').toLowerCase().trim();
  return /\.(pdf|png|jpe?g|webp)$/i.test(name);
}

export function parseCurrencyInput(value: FormDataEntryValue | string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }

  const raw = typeof value === 'string' ? value : typeof value?.toString === 'function' ? value.toString() : '';
  const normalized = raw.replace(/[$,\s]/g, '').trim();
  if (!normalized) return NaN;

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : NaN;
}

export function getEventDisplayName(event: Record<string, any> | null | undefined): string {
  return (event?.event_name || event?.name || 'Event').toString();
}
