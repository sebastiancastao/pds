import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';
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
    throw new Error('Receipt file is too large. Maximum size is 10 MB.');
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
