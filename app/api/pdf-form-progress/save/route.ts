import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  I9_ENTRY_POINTS,
  isMissingFormAuditTrailError,
  isI9FormName,
  logI9AuditEvent,
  normalizeI9EntryPoint,
} from '@/lib/i9-proxy-audit';
import { safeDecrypt } from '@/lib/encryption';
import { getPdfFormDisplayName } from '@/lib/pdf-forms';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const CUSTOM_FORM_NAME_PATTERN = /^custom-form-([a-f0-9-]{36})$/i;

function normalizeFormEntryPoint(value: unknown, isProxySave: boolean): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return isProxySave ? 'proxy-save' : 'self-save';
  }

  const lower = normalized.toLowerCase();
  if (lower === 'hr-employees' || lower === 'hr/employees' || lower === '/hr/employees') {
    return 'hr-employees';
  }

  return normalized;
}

function getActorDisplayName(
  profile: any,
  fallbackEmail?: string | null,
  fallbackUserId?: string | null,
): string | null {
  const firstName = profile?.first_name ? safeDecrypt(String(profile.first_name)).trim() : '';
  const lastName = profile?.last_name ? safeDecrypt(String(profile.last_name)).trim() : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || fallbackEmail || fallbackUserId || null;
}

function getFormAuditType(formName: string): string {
  const normalized = formName.trim().toLowerCase();
  if (CUSTOM_FORM_NAME_PATTERN.test(normalized)) return 'custom-form';
  if (normalized === 'i9' || normalized.endsWith('-i9')) return 'i9';
  return normalized;
}

async function resolveFormDisplayName(formName: string): Promise<string> {
  const customFormId = formName.match(CUSTOM_FORM_NAME_PATTERN)?.[1];
  if (customFormId) {
    const { data: customForm, error } = await supabaseAdmin
      .from('custom_pdf_forms')
      .select('title')
      .eq('id', customFormId)
      .maybeSingle();

    if (!error && customForm?.title?.trim()) {
      return customForm.title.trim();
    }
  }

  return getPdfFormDisplayName(formName);
}

async function logProxyFormSaveAudit(params: {
  actorUserId: string;
  actorEmail?: string | null;
  actorRole?: string | null;
  actorName?: string | null;
  ownerUserId: string;
  formName: string;
  action: 'created' | 'edited';
  isProxyEdit: boolean;
  formDate?: string | null;
  entryPoint?: unknown;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}) {
  const {
    actorUserId,
    actorEmail,
    actorRole,
    actorName,
    ownerUserId,
    formName,
    action,
    isProxyEdit,
    formDate,
    entryPoint,
    ipAddress,
    userAgent,
    timestamp,
  } = params;

  const formType = getFormAuditType(formName);
  const formDisplayName = await resolveFormDisplayName(formName);
  const resolvedEntryPoint = normalizeFormEntryPoint(entryPoint, true);

  const actionDetails = {
    origin: 'pdf-form-progress/save',
    entry_point: resolvedEntryPoint,
    entryPoint: resolvedEntryPoint,
    action,
    occurred_at: timestamp,
    actor_user_id: actorUserId,
    actor_email: actorEmail || null,
    actor_role: actorRole || null,
    actor_name: actorName || null,
    performed_by_user_id: actorUserId,
    performed_for_user_id: ownerUserId,
    owner_user_id: ownerUserId,
    is_proxy_edit: isProxyEdit,
    form_id: formName,
    form_name: formName,
    form_display_name: formDisplayName,
    form_type: formType,
    form_date: formDate || null,
  };

  let loggedToFormAuditTrail = false;
  const { error: formAuditError } = await supabaseAdmin
    .from('form_audit_trail')
    .insert({
      form_id: formName,
      form_type: formType,
      user_id: ownerUserId,
      action,
      action_details: actionDetails,
      ip_address: ipAddress,
      user_agent: userAgent,
      session_id: `proxy-form-save-${Date.now()}`,
      timestamp,
    });

  if (!formAuditError) {
    loggedToFormAuditTrail = true;
  } else if (!isMissingFormAuditTrailError(formAuditError)) {
    console.error('[SAVE API] Failed to write form_audit_trail row:', formAuditError);
  }

  const { error: auditLogError } = await supabaseAdmin
    .from('audit_logs')
    .insert({
      user_id: actorUserId,
      ip_address: ipAddress === 'unknown' ? null : ipAddress,
      user_agent: userAgent,
      action: isProxyEdit
        ? (action === 'created' ? 'form.proxy_create' : 'form.proxy_edit')
        : (action === 'created' ? 'form.hr_create' : 'form.hr_edit'),
      resource_type: 'form',
      resource_id: ownerUserId,
      metadata: actionDetails,
      success: true,
      error_message: null,
    });

  if (auditLogError) {
    console.error('[SAVE API] Failed to write audit_logs row:', auditLogError);
  }

  return loggedToFormAuditTrail;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[SAVE API] Request received');

    // Resolve authenticated user: try cookie session first, then Bearer token.
    let authUser: { id: string; email?: string | null } | null = null;
    let userId: string | null = null;

    const cookieClient = createRouteHandlerClient({ cookies });
    const { data: { user: cookieUser } } = await cookieClient.auth.getUser();
    if (cookieUser?.id) {
      authUser = cookieUser;
      userId = cookieUser.id;
      console.log('[SAVE API] Cookie-based auth OK:', userId);
    }

    if (!userId) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser }, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
        if (!tokenErr && tokenUser?.id) {
          authUser = tokenUser;
          userId = tokenUser.id;
          console.log('[SAVE API] Bearer token auth OK:', userId);
        }
      }
    }

    if (!userId) {
      console.log('[SAVE API] Authentication failed - returning 401');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { formName, formData, targetUserId, formDate, entryPoint } = body;

    if (!formName || !formData) {
      return NextResponse.json({ error: 'Missing formName or formData' }, { status: 400 });
    }

    // If an admin is submitting on behalf of an employee, verify the caller has exec/admin role
    // before allowing them to save under a different user's ID.
    let saveUserId = userId;
    let actorRole: string | null = null;
    let actorName: string | null = null;
    let actorEmail: string | null = authUser?.email || null;
    if (targetUserId && targetUserId !== userId) {
      const { data: caller } = await supabaseAdmin
        .from('users')
        .select('role, email, profiles(first_name, last_name)')
        .eq('id', userId)
        .single();
      if (!caller || !['exec', 'admin', 'hr', 'hr_admin'].includes(caller.role)) {
        return NextResponse.json({ error: 'Forbidden: cannot save for another user' }, { status: 403 });
      }
      const callerProfile = Array.isArray((caller as any)?.profiles)
        ? (caller as any).profiles[0]
        : (caller as any)?.profiles;
      actorRole = caller.role || null;
      actorEmail = authUser?.email || (caller as any)?.email || null;
      actorName = getActorDisplayName(callerProfile, actorEmail, userId);
      saveUserId = targetUserId;
    }

    const resolvedFormName = formName;
    const isProxySave = saveUserId !== userId;
    const normalizedEntryPoint = normalizeFormEntryPoint(entryPoint, isProxySave);
    const shouldLogI9Save = isI9FormName(resolvedFormName);
    const shouldLogHrFormSave = !shouldLogI9Save && (isProxySave || normalizedEntryPoint === 'hr-employees');
    let hadExistingFormRecord = false;

    if (shouldLogI9Save || shouldLogHrFormSave) {
      const { data: existingFormRecord } = await supabaseAdmin
        .from('pdf_form_progress')
        .select('id')
        .eq('user_id', saveUserId)
        .eq('form_name', resolvedFormName)
        .maybeSingle();

      hadExistingFormRecord = !!existingFormRecord;
    }

    console.log('[SAVE API] Upserting form:', resolvedFormName, 'for user:', saveUserId);
    const occurredAt = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('pdf_form_progress')
      .upsert({
        user_id: saveUserId,
        form_name: resolvedFormName,
        form_data: formData,
        updated_at: occurredAt,
        ...(formDate ? { form_date: formDate } : {}),
      }, { onConflict: 'user_id,form_name' });

    if (error) {
      console.error('[SAVE API] DB upsert error:', error);
      return NextResponse.json({ error: 'Failed to save form progress', details: error.message }, { status: 500 });
    }

    console.log('[SAVE API] Saved successfully');
    const auditAction = hadExistingFormRecord ? 'edited' : 'created';
    const ipAddress = request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    if (shouldLogI9Save) {
      await logI9AuditEvent({
        supabase: supabaseAdmin,
        actorUserId: userId,
        actorEmail,
        ownerUserId: saveUserId,
        formId: resolvedFormName,
        action: auditAction,
        origin: 'pdf-form-progress/save',
        entryPoint: normalizeI9EntryPoint(
          entryPoint,
          isProxySave ? I9_ENTRY_POINTS.HR_EMPLOYEES : I9_ENTRY_POINTS.PAYROLL_PACKET,
        ),
        editKind: 'form_save',
        ipAddress,
        userAgent,
        timestamp: occurredAt,
        extraDetails: {
          form_date: formDate || null,
        },
      });
    } else if (shouldLogHrFormSave) {
      if (!actorRole || !actorName) {
        const { data: callerIdentity } = await supabaseAdmin
          .from('users')
          .select('role, email, profiles(first_name, last_name)')
          .eq('id', userId)
          .maybeSingle();
        if (callerIdentity) {
          const callerProfile = Array.isArray((callerIdentity as any)?.profiles)
            ? (callerIdentity as any).profiles[0]
            : (callerIdentity as any)?.profiles;
          actorRole = (callerIdentity as any)?.role || actorRole;
          actorEmail = actorEmail || (callerIdentity as any)?.email || null;
          actorName = getActorDisplayName(callerProfile, actorEmail, userId);
        }
      }

      await logProxyFormSaveAudit({
        actorUserId: userId,
        actorEmail,
        actorRole,
        actorName,
        ownerUserId: saveUserId,
        formName: resolvedFormName,
        action: auditAction,
        isProxyEdit: isProxySave,
        formDate: formDate || null,
        entryPoint: normalizedEntryPoint,
        ipAddress,
        userAgent,
        timestamp: occurredAt,
      });
    }

    // Upload the filled PDF to i9-documents storage bucket
    let storageUrl: string | null = null;
    try {
      const pdfBuffer = Buffer.from(formData, 'base64');
      const sanitizedName = formName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      const storagePath = `${saveUserId}/custom-forms/${sanitizedName}.pdf`;

      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      if (!buckets?.some((bucket) => bucket.name === 'i9-documents')) {
        const { error: bucketErr } = await supabaseAdmin.storage.createBucket('i9-documents', {
          public: true,
          fileSizeLimit: 52428800,
        });
        if (bucketErr && !bucketErr.message.toLowerCase().includes('already exist')) {
          throw new Error(`Failed to create bucket: ${bucketErr.message}`);
        }
      }

      const { error: uploadErr } = await supabaseAdmin.storage
        .from('i9-documents')
        .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

      if (uploadErr) {
        console.error('[SAVE API] Storage upload error:', uploadErr);
      } else {
        const { data: urlData } = supabaseAdmin.storage.from('i9-documents').getPublicUrl(storagePath);
        storageUrl = urlData.publicUrl;
        console.log('[SAVE API] PDF uploaded to storage:', storageUrl);
      }
    } catch (storageErr: any) {
      console.error('[SAVE API] Storage upload unexpected error:', storageErr);
    }

    return NextResponse.json({ success: true, message: 'Form progress saved', storageUrl }, { status: 200 });
  } catch (error: any) {
    console.error('[SAVE API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to save form progress', details: error.message }, { status: 500 });
  }
}
