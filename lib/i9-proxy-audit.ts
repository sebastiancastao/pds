export function isMissingFormAuditTrailError(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === 'PGRST205'
    || message.includes("public.form_audit_trail")
    || message.includes('form_audit_trail');
}

export const I9_ENTRY_POINTS = {
  HR_EMPLOYEES: 'hr/employees',
  PAYROLL_PACKET: 'payroll-packet',
  ADMIN_UPLOAD: 'admin-upload',
  UNKNOWN: 'unknown',
} as const;

export type I9EntryPoint = (typeof I9_ENTRY_POINTS)[keyof typeof I9_ENTRY_POINTS];
export type I9EditKind = 'form_save' | 'document_upload' | 'signature_save' | 'admin_upload';

export function isI9FormName(formName: unknown): boolean {
  if (typeof formName !== 'string') return false;
  const normalized = formName.trim().toLowerCase();
  return normalized === 'i9' || normalized.endsWith('-i9');
}

export function normalizeI9EntryPoint(
  value: unknown,
  fallback: I9EntryPoint = I9_ENTRY_POINTS.UNKNOWN,
): I9EntryPoint {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) return fallback;

  if (
    normalized === 'hr-employees'
    || normalized === 'hr/employees'
    || normalized === '/hr/employees'
  ) {
    return I9_ENTRY_POINTS.HR_EMPLOYEES;
  }

  if (
    normalized === 'payroll-packet'
    || normalized === 'payroll_packet'
    || normalized.startsWith('/payroll-packet')
  ) {
    return I9_ENTRY_POINTS.PAYROLL_PACKET;
  }

  if (
    normalized === 'admin-upload'
    || normalized === 'admin_upload'
    || normalized === 'pdf-form-progress/admin-upload'
  ) {
    return I9_ENTRY_POINTS.ADMIN_UPLOAD;
  }

  return fallback;
}

type LogI9AuditParams = {
  supabase: any;
  actorUserId: string;
  actorEmail?: string | null;
  ownerUserId: string;
  formId: string;
  action: string;
  origin: string;
  entryPoint?: unknown;
  editKind: I9EditKind;
  ipAddress: string;
  userAgent: string;
  timestamp?: string;
  extraDetails?: Record<string, any>;
};

export async function logI9AuditEvent(
  params: LogI9AuditParams,
): Promise<'both' | 'form_audit_trail' | 'audit_logs' | 'none'> {
  const {
    supabase,
    actorUserId,
    actorEmail,
    ownerUserId,
    formId,
    action,
    origin,
    entryPoint,
    editKind,
    ipAddress,
    userAgent,
    timestamp,
    extraDetails = {},
  } = params;

  const occurredAt = timestamp || new Date().toISOString();
  const isProxyEdit = actorUserId !== ownerUserId;
  const resolvedEntryPoint = normalizeI9EntryPoint(
    entryPoint,
    isProxyEdit ? I9_ENTRY_POINTS.HR_EMPLOYEES : I9_ENTRY_POINTS.PAYROLL_PACKET,
  );

  const actionDetails = {
    origin,
    entry_point: resolvedEntryPoint,
    entryPoint: resolvedEntryPoint,
    edit_kind: editKind,
    editKind: editKind,
    action,
    actor_email: actorEmail || null,
    performed_by_user_id: actorUserId,
    performed_for_user_id: ownerUserId,
    actor_user_id: actorUserId,
    owner_user_id: ownerUserId,
    is_proxy_edit: isProxyEdit,
    occurred_at: occurredAt,
    ...extraDetails,
  };

  let loggedToFormAuditTrail = false;
  const { error: formAuditError } = await supabase
    .from('form_audit_trail')
    .insert({
      form_id: formId,
      form_type: 'i9',
      user_id: ownerUserId,
      action,
      action_details: actionDetails,
      ip_address: ipAddress,
      user_agent: userAgent,
      session_id: `i9-${editKind}-${Date.now()}`,
      timestamp: occurredAt,
    });

  if (!formAuditError) {
    loggedToFormAuditTrail = true;
  } else if (!isMissingFormAuditTrailError(formAuditError)) {
    console.error('[I9_PROXY_AUDIT] Failed to write form_audit_trail row:', formAuditError);
  }

  const { error: auditLogsError } = await supabase
    .from('audit_logs')
    .insert({
      user_id: actorUserId,
      ip_address: ipAddress === 'unknown' ? null : ipAddress,
      user_agent: userAgent,
      action: isProxyEdit ? 'i9.proxy_edit' : 'i9.edit',
      resource_type: 'i9',
      resource_id: `${ownerUserId}:${formId}`,
      metadata: {
        ...actionDetails,
        form_id: formId,
        form_type: 'i9',
        proxy_action: isProxyEdit ? action : null,
      },
      success: true,
      error_message: null,
    });

  if (auditLogsError) {
    console.error('[I9_PROXY_AUDIT] Failed to write audit_logs row:', auditLogsError);
    return loggedToFormAuditTrail ? 'form_audit_trail' : 'none';
  }

  return loggedToFormAuditTrail ? 'both' : 'audit_logs';
}

type LogI9ProxyAuditParams = Omit<LogI9AuditParams, 'editKind'> & {
  editKind?: I9EditKind;
};

export async function logI9ProxyAuditEvent(
  params: LogI9ProxyAuditParams,
): Promise<'both' | 'form_audit_trail' | 'audit_logs' | 'none'> {
  return logI9AuditEvent({
    ...params,
    editKind: params.editKind || 'form_save',
  });
}
