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

// Roles that may approve or reject a vendor's reimbursement request. Matches
// the "Executives can manage ..." convention used on event_payments and
// event_vendor_payments — financial approval is exec-only. A reviewer must
// also never be the same person who filed the request (checked separately),
// so this alone does not make self-approval possible.
export const REIMBURSEMENT_REVIEW_ROLES: ReadonlySet<string> = new Set(['exec']);

export function isReimbursementReviewer(role: string | null | undefined): boolean {
  return REIMBURSEMENT_REVIEW_ROLES.has(String(role || '').trim().toLowerCase());
}

// Roles that may view the full reimbursement list read-only (HR dashboard
// Payroll tab). Approving/rejecting still requires isReimbursementReviewer.
export const REIMBURSEMENT_VIEW_ROLES: ReadonlySet<string> = new Set(['exec', 'admin', 'hr']);

export function canViewAllReimbursements(role: string | null | undefined): boolean {
  return REIMBURSEMENT_VIEW_ROLES.has(String(role || '').trim().toLowerCase());
}

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
  // Groups receipts uploaded together in one batch (e.g. "3 gas receipts for
  // this trip") so they can be listed together with one combined recap. Null
  // for a lone submission.
  batch_id: string | null;
};

// Groups a list of reimbursement requests by their shared batch_id, preserving
// the incoming order (rows already sorted newest-first). A request with no
// batch_id is its own group of one. Used by every surface that lists
// reimbursements so a multi-receipt submission shows as one batch with a recap.
export function groupReimbursementRequestsByBatch<
  T extends { id: string; batch_id?: string | null }
>(requests: T[]): { batchId: string | null; items: T[] }[] {
  const order: string[] = [];
  const groups = new Map<string, T[]>();

  for (const request of requests) {
    const key = request.batch_id || `single:${request.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(request);
  }

  return order.map((key) => {
    const items = groups.get(key)!;
    return { batchId: items[0].batch_id || null, items };
  });
}

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
