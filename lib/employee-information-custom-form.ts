import 'server-only';

import { readFileSync } from 'fs';
import { join } from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildCustomFormCompletionName,
  parsePayrollPacketVirtualStoragePath,
} from '@/lib/payroll-packet-custom-forms';

const EMPLOYEE_INFORMATION_PLACEHOLDER_FILE = 'employee information.pdf';

let cachedEmployeeInformationPlaceholderBase64: string | null = null;

function getEmployeeInformationPlaceholderPdfBase64() {
  if (!cachedEmployeeInformationPlaceholderBase64) {
    const pdfPath = join(process.cwd(), EMPLOYEE_INFORMATION_PLACEHOLDER_FILE);
    cachedEmployeeInformationPlaceholderBase64 = readFileSync(pdfPath).toString('base64');
  }

  return cachedEmployeeInformationPlaceholderBase64;
}

export async function markEmployeeInformationCustomFormComplete(params: {
  customFormId?: string | null;
  supabase: SupabaseClient<any, any, any>;
  userId: string;
}) {
  const { customFormId, supabase, userId } = params;
  const trimmedCustomFormId = String(customFormId || '').trim();
  if (!trimmedCustomFormId) return;

  const { data: customForm, error: customFormError } = await supabase
    .from('custom_pdf_forms')
    .select('storage_path, is_active')
    .eq('id', trimmedCustomFormId)
    .maybeSingle();

  if (customFormError) {
    throw new Error(customFormError.message || 'Failed to load custom form');
  }

  if (!customForm?.is_active) {
    throw new Error('Custom form is no longer active');
  }

  const parsed = parsePayrollPacketVirtualStoragePath(customForm.storage_path);
  if (!parsed || parsed.mode !== 'viewer' || parsed.formType !== 'employee-information') {
    throw new Error('Custom form is not a viewer-backed employee information form');
  }

  const occurredAt = new Date().toISOString();
  const formDate = occurredAt.slice(0, 10);

  const { error: progressError } = await supabase
    .from('pdf_form_progress')
    .upsert(
      {
        user_id: userId,
        form_name: buildCustomFormCompletionName(trimmedCustomFormId),
        form_data: getEmployeeInformationPlaceholderPdfBase64(),
        form_date: formDate,
        updated_at: occurredAt,
      },
      { onConflict: 'user_id,form_name' },
    );

  if (progressError) {
    throw new Error(progressError.message || 'Failed to mark custom form complete');
  }
}
