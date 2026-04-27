import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_ROLES = new Set([
  'admin',
  'manager',
  'supervisor',
  'supervisor2',
  'hr',
  'hr_admin',
  'exec',
]);
const KNOWN_I9_FORM_IDS = ['i9', 'ca-i9', 'az-i9', 'nv-i9', 'ny-i9', 'wi-i9', 'i9-documents'];

type UserDirectoryEntry = {
  id: string;
  email: string;
  role: string;
  state: string;
  full_name: string;
};

type ActivityCandidate = {
  at: string;
  source: string;
  editor: UserDirectoryEntry | null;
};

function isI9FormName(formName: unknown): boolean {
  if (typeof formName !== 'string') return false;
  const normalized = formName.trim().toLowerCase();
  return normalized === 'i9' || normalized.endsWith('-i9');
}

function dec(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return safeDecrypt(value.trim());
  } catch {
    return value.trim();
  }
}

function normalizeState(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function maxIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestTime = -1;

  for (const value of values) {
    const normalized = normalizeIso(value);
    if (!normalized) continue;
    const time = Date.parse(normalized);
    if (time > bestTime) {
      best = normalized;
      bestTime = time;
    }
  }

  return best;
}

function compareDescByIso(a: string | null | undefined, b: string | null | undefined): number {
  const aTime = a ? Date.parse(a) : 0;
  const bTime = b ? Date.parse(b) : 0;
  return bTime - aTime;
}

function formatI9Label(formName: string | null, fallbackState: string): string {
  if (!formName) {
    return fallbackState ? `${fallbackState} I-9` : 'I-9';
  }

  const normalized = formName.trim().toLowerCase();
  if (normalized === 'i9') return 'I-9';

  const state = normalized.replace(/-i9$/, '').toUpperCase();
  return state ? `${state} I-9` : 'I-9';
}

function normalizeActionDetails(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function getActorUserId(details: Record<string, any>): string | null {
  return details.performed_by_user_id
    || details.performedByUserId
    || details.actor_user_id
    || details.actorUserId
    || null;
}

function getActionSource(formId: string, details: Record<string, any>): string {
  const origin = String(details.origin || '').trim();
  if (origin === 'i9-documents/upload') return 'Document upload';
  if (origin === 'pdf-form-progress/save') return 'Form save';
  if (formId === 'i9-documents') return 'Document upload';
  return 'Audit trail';
}

function isMissingFormAuditTrailError(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === 'PGRST205'
    || message.includes("public.form_audit_trail")
    || message.includes('form_audit_trail');
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: callerData, error: callerError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', authedUser.id)
      .maybeSingle();

    if (callerError) {
      return NextResponse.json({ error: callerError.message }, { status: 500 });
    }

    const callerRole = String(callerData?.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.has(callerRole)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: userRows, error: usersError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        role,
        profiles (
          first_name,
          last_name,
          state
        )
      `);

    if (usersError) {
      throw new Error(usersError.message);
    }

    const usersById = new Map<string, UserDirectoryEntry>();
    for (const row of userRows || []) {
      const profile = Array.isArray((row as any).profiles) ? (row as any).profiles[0] : (row as any).profiles;
      const firstName = dec(profile?.first_name);
      const lastName = dec(profile?.last_name);
      const email = String((row as any).email || '').trim();
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || email || (row as any).id;

      usersById.set((row as any).id, {
        id: (row as any).id,
        email,
        role: String((row as any).role || '').trim(),
        state: normalizeState(profile?.state),
        full_name: fullName,
      });
    }

    const { data: formProgressRows, error: formsError } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('user_id, form_name, updated_at, form_date');

    if (formsError) {
      throw new Error(formsError.message);
    }

    const i9FormRows = (formProgressRows || []).filter((row: any) => isI9FormName(row.form_name));
    const latestI9FormByUser = new Map<string, any>();

    for (const row of i9FormRows) {
      const existing = latestI9FormByUser.get((row as any).user_id);
      if (!existing || compareDescByIso((row as any).updated_at, existing.updated_at) < 0) {
        latestI9FormByUser.set((row as any).user_id, row);
      }
    }

    const { data: i9DocumentsRows, error: docsError } = await supabaseAdmin
      .from('i9_documents')
      .select(`
        user_id,
        drivers_license_filename,
        drivers_license_uploaded_at,
        ssn_document_filename,
        ssn_document_uploaded_at,
        additional_doc_filename,
        additional_doc_uploaded_at,
        updated_at
      `);

    if (docsError) {
      throw new Error(docsError.message);
    }

    const i9DocsByUser = new Map<string, any>();
    for (const row of i9DocumentsRows || []) {
      i9DocsByUser.set((row as any).user_id, row);
    }

    const auditFormIds = Array.from(new Set([
      ...KNOWN_I9_FORM_IDS,
      ...i9FormRows.map((row: any) => String(row.form_name || '')).filter(Boolean),
    ]));

    const auditRowsById = new Map<string, any>();

    if (auditFormIds.length > 0) {
      const { data: auditRowsByFormId, error: auditByFormError } = await supabaseAdmin
        .from('form_audit_trail')
        .select('id, user_id, form_id, form_type, action, action_details, timestamp')
        .in('form_id', auditFormIds)
        .order('timestamp', { ascending: false });

      if (auditByFormError) {
        if (!isMissingFormAuditTrailError(auditByFormError)) {
          throw new Error(auditByFormError.message);
        }
      } else {
        for (const row of auditRowsByFormId || []) {
          auditRowsById.set((row as any).id, row);
        }
      }
    }

    const { data: auditRowsByType, error: auditByTypeError } = await supabaseAdmin
      .from('form_audit_trail')
      .select('id, user_id, form_id, form_type, action, action_details, timestamp')
      .eq('form_type', 'i9')
      .order('timestamp', { ascending: false });

    if (auditByTypeError) {
      if (!isMissingFormAuditTrailError(auditByTypeError)) {
        throw new Error(auditByTypeError.message);
      }
    } else {
      for (const row of auditRowsByType || []) {
        auditRowsById.set((row as any).id, row);
      }
    }

    const auditsByUser = new Map<string, any[]>();
    for (const row of auditRowsById.values()) {
      const ownerUserId = String((row as any).user_id || '').trim();
      if (!ownerUserId) continue;
      if (!auditsByUser.has(ownerUserId)) auditsByUser.set(ownerUserId, []);
      auditsByUser.get(ownerUserId)!.push(row);
    }

    for (const rows of auditsByUser.values()) {
      rows.sort((a: any, b: any) => compareDescByIso(a.timestamp, b.timestamp));
    }

    const recordUserIds = Array.from(new Set([
      ...Array.from(usersById.keys()),
      ...Array.from(latestI9FormByUser.keys()),
      ...Array.from(i9DocsByUser.keys()),
    ]));

    const rows = recordUserIds.map((userId) => {
      const owner = usersById.get(userId) || {
        id: userId,
        email: '',
        role: '',
        state: '',
        full_name: userId,
      };

      const formRow = latestI9FormByUser.get(userId) || null;
      const docsRow = i9DocsByUser.get(userId) || null;
      const auditRows = auditsByUser.get(userId) || [];

      const hasListA = !!docsRow?.additional_doc_filename;
      const hasListB = !!docsRow?.drivers_license_filename;
      const hasListC = !!docsRow?.ssn_document_filename;
      const documentCount = [hasListA, hasListB, hasListC].filter(Boolean).length;
      const documentsAdded = documentCount > 0;

      let documentMode = 'No documents';
      if (hasListA && !hasListB && !hasListC) {
        documentMode = 'List A';
      } else if (!hasListA && hasListB && hasListC) {
        documentMode = 'List B + List C';
      } else if (documentsAdded) {
        documentMode = 'Partial / mixed';
      }

      const documentSummaryParts: string[] = [];
      if (hasListA) documentSummaryParts.push(`List A: ${docsRow.additional_doc_filename}`);
      if (hasListB) documentSummaryParts.push(`List B: ${docsRow.drivers_license_filename}`);
      if (hasListC) documentSummaryParts.push(`List C: ${docsRow.ssn_document_filename}`);
      const documentSummary = documentSummaryParts.join(' | ') || 'No documents';

      const latestDocumentAt = maxIso([
        docsRow?.additional_doc_uploaded_at,
        docsRow?.drivers_license_uploaded_at,
        docsRow?.ssn_document_uploaded_at,
        docsRow?.updated_at,
      ]);

      const proxyAudits = auditRows.filter((auditRow: any) => {
        const details = normalizeActionDetails(auditRow.action_details);
        const actorUserId = getActorUserId(details);
        const explicitProxy = details.is_proxy_edit === true || details.isProxyEdit === true;
        return explicitProxy || (!!actorUserId && actorUserId !== userId);
      });

      const latestAudit = auditRows[0] || null;
      const latestProxyAudit = proxyAudits[0] || null;

      const latestAuditDetails = normalizeActionDetails(latestAudit?.action_details);
      const latestAuditActorId = getActorUserId(latestAuditDetails);
      const latestAuditActor = latestAuditActorId ? usersById.get(latestAuditActorId) || null : null;

      const latestProxyDetails = normalizeActionDetails(latestProxyAudit?.action_details);
      const latestProxyActorId = getActorUserId(latestProxyDetails);
      const latestProxyActor = latestProxyActorId ? usersById.get(latestProxyActorId) || null : null;

      const lastActivityCandidates: ActivityCandidate[] = [];

      if (latestAudit?.timestamp) {
        lastActivityCandidates.push({
          at: latestAudit.timestamp,
          source: getActionSource(String(latestAudit.form_id || ''), latestAuditDetails),
          editor: latestAuditActor || owner,
        });
      }

      if (latestDocumentAt) {
        lastActivityCandidates.push({
          at: latestDocumentAt,
          source: 'Documents',
          editor: owner,
        });
      }

      if (formRow?.updated_at) {
        lastActivityCandidates.push({
          at: formRow.updated_at,
          source: 'Form',
          editor: owner,
        });
      }

      lastActivityCandidates.sort((a, b) => compareDescByIso(a.at, b.at));
      const lastActivity = lastActivityCandidates[0] || null;

      return {
        user_id: userId,
        vendor_name: owner.full_name,
        vendor_email: owner.email,
        vendor_role: owner.role,
        vendor_state: owner.state,
        has_i9_form: !!formRow,
        i9_form_name: formRow?.form_name || null,
        i9_form_label: formatI9Label(formRow?.form_name || null, owner.state),
        form_saved_at: normalizeIso(formRow?.updated_at) || null,
        form_date: formRow?.form_date || null,
        documents_added: documentsAdded,
        document_mode: documentMode,
        document_count: documentCount,
        document_summary: documentSummary,
        has_list_a: hasListA,
        has_list_b: hasListB,
        has_list_c: hasListC,
        list_a_filename: docsRow?.additional_doc_filename || null,
        list_b_filename: docsRow?.drivers_license_filename || null,
        list_c_filename: docsRow?.ssn_document_filename || null,
        list_a_uploaded_at: normalizeIso(docsRow?.additional_doc_uploaded_at) || null,
        list_b_uploaded_at: normalizeIso(docsRow?.drivers_license_uploaded_at) || null,
        list_c_uploaded_at: normalizeIso(docsRow?.ssn_document_uploaded_at) || null,
        last_editor_user_id: lastActivity?.editor?.id || owner.id,
        last_editor_name: lastActivity?.editor?.full_name || owner.full_name,
        last_editor_email: lastActivity?.editor?.email || owner.email,
        last_editor_role: lastActivity?.editor?.role || owner.role,
        last_change_at: normalizeIso(lastActivity?.at) || null,
        last_change_source: lastActivity?.source || 'Unknown',
        edited_by_non_owner: proxyAudits.length > 0,
        proxy_change_count: proxyAudits.length,
        latest_proxy_editor_name: latestProxyActor?.full_name || null,
        latest_proxy_editor_email: latestProxyActor?.email || null,
        latest_proxy_editor_role: latestProxyActor?.role || null,
        latest_proxy_at: normalizeIso(latestProxyAudit?.timestamp) || null,
        latest_proxy_source: latestProxyAudit ? getActionSource(String(latestProxyAudit.form_id || ''), latestProxyDetails) : null,
      };
    });

    rows.sort((a, b) => {
      const byActivity = compareDescByIso(a.last_change_at, b.last_change_at);
      if (byActivity !== 0) return byActivity;
      return a.vendor_name.localeCompare(b.vendor_name);
    });

    const summary = {
      total_records: rows.length,
      with_form: rows.filter((row) => row.has_i9_form).length,
      with_documents: rows.filter((row) => row.documents_added).length,
      without_documents: rows.filter((row) => !row.documents_added).length,
      proxy_edits: rows.filter((row) => row.edited_by_non_owner).length,
      form_only: rows.filter((row) => row.has_i9_form && !row.documents_added).length,
      documents_only: rows.filter((row) => !row.has_i9_form && row.documents_added).length,
    };

    return NextResponse.json({ summary, rows }, { status: 200 });
  } catch (err: any) {
    console.error('[I9-AUDIT-REPORT]', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
