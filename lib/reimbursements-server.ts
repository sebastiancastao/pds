import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';
import { sendEmail } from '@/lib/email';
import {
  REIMBURSEMENT_ALLOWED_MIME,
  REIMBURSEMENT_BUCKET,
  REIMBURSEMENT_MAX_BYTES,
  ReimbursementEventOption,
  getEventDisplayName,
  isAllowedReimbursementFile,
  sanitizeReimbursementFilename,
} from '@/lib/reimbursements';

export const reimbursementSupabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const reimbursementSupabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function getReimbursementAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await reimbursementSupabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }

  return null;
}

export async function getReimbursementUserRole(userId: string): Promise<string> {
  const { data } = await reimbursementSupabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return (data?.role || '').toString().trim().toLowerCase();
}

export async function ensureReimbursementBucket() {
  const { data: buckets } = await reimbursementSupabaseAdmin.storage.listBuckets();
  if (buckets?.some((bucket) => bucket.name === REIMBURSEMENT_BUCKET)) {
    return;
  }

  const { error } = await reimbursementSupabaseAdmin.storage.createBucket(REIMBURSEMENT_BUCKET, {
    public: false,
    fileSizeLimit: REIMBURSEMENT_MAX_BYTES,
    allowedMimeTypes: REIMBURSEMENT_ALLOWED_MIME,
  });

  if (error && !error.message.toLowerCase().includes('already exist')) {
    throw new Error(`Failed to create reimbursement bucket: ${error.message}`);
  }
}

export async function uploadReimbursementReceipt(params: {
  userId: string;
  file: File;
}): Promise<{ receiptPath: string; receiptFilename: string }> {
  const { userId, file } = params;

  if (!isAllowedReimbursementFile(file)) {
    throw new Error('Invalid receipt file type. Allowed: JPG, PNG, WEBP, PDF');
  }
  if (file.size > REIMBURSEMENT_MAX_BYTES) {
    throw new Error('Receipt file is too large. Maximum size is 4 mb.');
  }

  await ensureReimbursementBucket();

  const safeName = sanitizeReimbursementFilename(file.name || 'receipt');
  const receiptPath = `${userId}/${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await reimbursementSupabaseAdmin.storage
    .from(REIMBURSEMENT_BUCKET)
    .upload(receiptPath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload receipt: ${error.message}`);
  }

  return {
    receiptPath,
    receiptFilename: file.name || safeName,
  };
}

export async function createSignedReceiptUrl(receiptPath: string | null | undefined): Promise<string | null> {
  if (!receiptPath) return null;
  const { data, error } = await reimbursementSupabaseAdmin.storage
    .from(REIMBURSEMENT_BUCKET)
    .createSignedUrl(receiptPath, 60 * 60);

  if (error) {
    console.warn('[REIMBURSEMENTS] Failed to sign receipt URL:', error.message);
    return null;
  }

  return data.signedUrl;
}

export async function removeReimbursementReceipt(receiptPath: string | null | undefined) {
  if (!receiptPath) return;
  const { error } = await reimbursementSupabaseAdmin.storage
    .from(REIMBURSEMENT_BUCKET)
    .remove([receiptPath]);
  if (error) {
    console.warn('[REIMBURSEMENTS] Failed to remove receipt:', error.message);
  }
}

export async function getSelectableReimbursementEvents(userId: string): Promise<ReimbursementEventOption[]> {
  const [teamRowsResult, paymentRowsResult, timeRowsResult] = await Promise.all([
    reimbursementSupabaseAdmin
      .from('event_teams')
      .select('event_id')
      .eq('vendor_id', userId),
    reimbursementSupabaseAdmin
      .from('event_vendor_payments')
      .select('event_id')
      .eq('user_id', userId),
    reimbursementSupabaseAdmin
      .from('time_entries')
      .select('event_id')
      .eq('user_id', userId)
      .not('event_id', 'is', null),
  ]);

  const eventIds = Array.from(
    new Set(
      [
        ...(teamRowsResult.data || []).map((row: any) => row.event_id),
        ...(paymentRowsResult.data || []).map((row: any) => row.event_id),
        ...(timeRowsResult.data || []).map((row: any) => row.event_id),
      ].filter(Boolean)
    )
  );

  if (eventIds.length === 0) {
    return [];
  }

  const { data: events, error } = await reimbursementSupabaseAdmin
    .from('events')
    .select('*')
    .in('id', eventIds)
    .order('event_date', { ascending: false });

  if (error) {
    throw new Error(`Failed to load selectable events: ${error.message}`);
  }

  return (events || []).map((event: any) => ({
    id: event.id,
    event_name: getEventDisplayName(event),
    event_date: event.event_date || null,
    venue: event.venue || null,
    city: event.city || null,
    state: event.state || null,
  }));
}

export async function getUserDisplayMap(userIds: string[]): Promise<Record<string, { name: string; email: string | null }>> {
  if (userIds.length === 0) return {};

  const { data: users, error } = await reimbursementSupabaseAdmin
    .from('users')
    .select('id, email, profiles ( first_name, last_name )')
    .in('id', userIds);

  if (error) {
    throw new Error(`Failed to load user display names: ${error.message}`);
  }

  const displayMap: Record<string, { name: string; email: string | null }> = {};
  for (const user of users || []) {
    const profile = Array.isArray((user as any).profiles) ? (user as any).profiles[0] : (user as any).profiles;
    const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
    const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
    displayMap[user.id] = {
      name: `${firstName} ${lastName}`.trim() || user.email || 'Unknown',
      email: user.email || null,
    };
  }

  return displayMap;
}

// Notified on every new reimbursement submission (self-service or admin-entered
// on a vendor's behalf) so a reviewer knows to check the approval queue.
const REIMBURSEMENT_SUBMISSION_NOTIFICATION_RECIPIENTS = [
  'sebastiancastao379@gmail.com',
  'jenvillar@1pds.net',
];

// The testing branch's Vercel preview deployment. A submission made from this
// URL should link back to it, not to production, so testers land where they
// actually are instead of on live data.
const TESTING_APP_URL = 'https://pds-git-testing-sebastiancastaos-projects.vercel.app';

// Picks the link base for the notification email: the testing deployment when
// that's where the request came from, otherwise the normal production default.
export function resolveReimbursementAppUrl(req: NextRequest): string {
  const origin = req.nextUrl?.origin || req.headers.get('origin') || '';
  if (origin === TESTING_APP_URL) {
    return TESTING_APP_URL;
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export type ReimbursementNotificationItem = {
  requestedAmount: number;
  purchaseDate: string;
  description: string;
  eventName: string | null;
};

// One email per submission, whether it's a single receipt or a batch of
// several uploaded together. Lists every receipt in the batch with a combined
// total, so a reviewer only gets one message per trip/outing instead of one
// per file.
export async function notifyReimbursementSubmitted(params: {
  baseUrl: string;
  vendorName: string;
  vendorEmail: string | null;
  items: ReimbursementNotificationItem[];
}): Promise<void> {
  const { baseUrl, vendorName, vendorEmail, items } = params;
  if (items.length === 0) return;

  const approvalUrl = `${baseUrl}/payroll-approvals`;
  const totalAmount = items.reduce((sum, item) => sum + item.requestedAmount, 0);
  const totalLabel = `$${totalAmount.toFixed(2)}`;
  const isBatch = items.length > 1;
  const subject = isBatch
    ? `Reimbursement Submitted - ${vendorName} - ${items.length} receipts - ${totalLabel} total`
    : `Reimbursement Submitted - ${vendorName} - ${totalLabel}`;

  const itemRows = items
    .map(
      (item, index) => `
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">Receipt ${index + 1} of ${items.length} — $${item.requestedAmount.toFixed(2)}</p>
                    <p style="margin:4px 0 0 0;color:#64748b;font-size:13px;">${escapeHtml(item.eventName || 'Standalone reimbursement')} · ${escapeHtml(item.purchaseDate)}</p>
                    <p style="margin:6px 0 0 0;color:#334155;font-size:13px;line-height:1.5;">${escapeHtml(item.description).replace(/\n/g, '<br />')}</p>
                  </td>
                </tr>`
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:32px 0;background:#f5f5f5;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="640" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 32px;color:#ffffff;">
              <h1 style="margin:0;font-size:24px;">${isBatch ? 'Reimbursement Batch Submitted' : 'Reimbursement Submitted'}</h1>
              <p style="margin:10px 0 0 0;font-size:14px;color:#cbd5e1;">
                ${isBatch ? `${items.length} receipts are` : 'A new receipt is'} waiting for approval.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Vendor</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(vendorName)}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Vendor Email</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;">${escapeHtml(vendorEmail || '-')}</td></tr>
                      <tr><td style="padding:6px 0;color:#64748b;font-size:13px;">${isBatch ? 'Receipts' : 'Amount'}</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:600;">${isBatch ? `${items.length}` : totalLabel}</td></tr>
                      ${isBatch ? `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">Batch Total</td><td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:700;">${totalLabel}</td></tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <div style="margin-top:24px;">
                <p style="margin:0 0 8px 0;color:#334155;font-size:14px;font-weight:700;">${isBatch ? 'Receipts in this batch' : 'Receipt'}</p>
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:8px;background:#ffffff;overflow:hidden;">
                  ${itemRows}
                </table>
              </div>

              <div style="margin-top:28px;text-align:center;">
                <a href="${approvalUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-size:14px;font-weight:700;">Open Approval Page</a>
                <p style="margin:12px 0 0 0;color:#64748b;font-size:12px;">${approvalUrl}</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  const result = await sendEmail({
    to: REIMBURSEMENT_SUBMISSION_NOTIFICATION_RECIPIENTS,
    subject,
    html,
  });

  if (!result.success) {
    console.error('[REIMBURSEMENTS] Failed to send submission notification email:', result.error);
  }
}
