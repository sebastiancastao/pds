import { SupabaseClient } from '@supabase/supabase-js';

type ExistingPdfFormProgressRecord = {
  id?: string | null;
  user_id: string;
  form_name: string;
  form_data: unknown;
  form_date?: string | null;
  updated_at?: string | null;
};

type ArchivePdfFormProgressVersionParams = {
  supabase: SupabaseClient;
  existingRecord: ExistingPdfFormProgressRecord;
  replacedAt: string;
  replacedByUserId?: string | null;
  entryPoint?: string | null;
  isProxyEdit?: boolean;
};

export function normalizeStoredPdfFormDataToBase64(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      const hex = value.slice(2);
      return Buffer.from(hex, 'hex').toString('base64');
    }
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }

  if (Array.isArray(value)) {
    return Buffer.from(Uint8Array.from(value)).toString('base64');
  }

  if ((value as any)?.type === 'Buffer' && Array.isArray((value as any).data)) {
    return Buffer.from((value as any).data).toString('base64');
  }

  if (Array.isArray((value as any)?.data)) {
    return Buffer.from((value as any).data).toString('base64');
  }

  return null;
}

export function isMissingPdfFormProgressVersionsError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  const details = String((error as any)?.details || '').toLowerCase();
  const hint = String((error as any)?.hint || '').toLowerCase();
  const code = String((error as any)?.code || '').toLowerCase();

  return (
    code === '42p01'
    || message.includes('pdf_form_progress_versions')
    || details.includes('pdf_form_progress_versions')
    || hint.includes('pdf_form_progress_versions')
  );
}

export async function archivePdfFormProgressVersion({
  supabase,
  existingRecord,
  replacedAt,
  replacedByUserId,
  entryPoint,
  isProxyEdit = false,
}: ArchivePdfFormProgressVersionParams): Promise<boolean> {
  const normalizedFormData = normalizeStoredPdfFormDataToBase64(existingRecord.form_data);
  if (!normalizedFormData) {
    return false;
  }

  const { error } = await supabase
    .from('pdf_form_progress_versions')
    .insert({
      pdf_form_progress_id: existingRecord.id || null,
      user_id: existingRecord.user_id,
      form_name: existingRecord.form_name,
      form_data: normalizedFormData,
      form_date: existingRecord.form_date || null,
      source_updated_at: existingRecord.updated_at || null,
      replaced_at: replacedAt,
      replaced_by_user_id: replacedByUserId || null,
      entry_point: entryPoint || null,
      is_proxy_edit: isProxyEdit,
    });

  if (error) {
    throw error;
  }

  return true;
}
