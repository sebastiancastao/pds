import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';
import { getPdfFormDisplayName } from '@/lib/pdf-forms';
import { isMissingFormAuditTrailError } from '@/lib/i9-proxy-audit';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const PAGE_SIZE = 1000;
const MAX_RECENT_EDITS = 20;
const HR_FORM_AUDIT_LOG_ACTIONS = [
  'form.proxy_create',
  'form.proxy_edit',
  'form.hr_create',
  'form.hr_edit',
  'i9.proxy_edit',
  'i9.edit',
] as const;

type ActorDirectoryEntry = {
  id: string;
  email: string;
  role: string;
  full_name: string;
};

function dec(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return safeDecrypt(value.trim());
  } catch {
    return value.trim();
  }
}

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function compareDescByIso(a: string | null | undefined, b: string | null | undefined): number {
  const aTime = a ? Date.parse(a) : 0;
  const bTime = b ? Date.parse(b) : 0;
  return bTime - aTime;
}

function normalizeActionDetails(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function normalizeHrEmployeesEntryPoint(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'hr-employees' || normalized === 'hr/employees' || normalized === '/hr/employees') {
    return 'hr-employees';
  }
  return normalized;
}

function isHrEmployeesFormEdit(details: Record<string, any>): boolean {
  const origin = String(details.origin || '').trim().toLowerCase();
  if (origin !== 'pdf-form-progress/save') return false;

  const normalizedEntryPoint = normalizeHrEmployeesEntryPoint(
    details.entry_point || details.entryPoint,
  );

  if (normalizedEntryPoint === 'hr-employees') {
    return true;
  }

  return details.is_proxy_edit === true || details.is_proxy_edit === 'true';
}

function getActorUserId(details: Record<string, any>): string | null {
  const rawValue = details.performed_by_user_id
    || details.performedByUserId
    || details.actor_user_id
    || details.actorUserId
    || details.editor_user_id
    || details.editorUserId
    || null;

  if (typeof rawValue !== 'string') return null;
  const normalized = rawValue.trim();
  return normalized || null;
}

function formatI9Label(formName: string | null): string {
  if (!formName) return 'I-9';
  const normalized = formName.trim().toLowerCase();
  if (normalized === 'i9') return 'I-9';
  const state = normalized.replace(/-i9$/, '').toUpperCase();
  return state ? `${state} I-9` : 'I-9';
}

function resolveFormDisplayName(formId: string, details: Record<string, any>): string {
  const displayName = typeof details.form_display_name === 'string' ? details.form_display_name.trim() : '';
  if (displayName) return displayName;

  if (formId === 'i9' || formId.endsWith('-i9')) {
    return formatI9Label(formId);
  }

  return getPdfFormDisplayName(formId);
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

async function fetchFormAuditTrailRows() {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('form_audit_trail')
      .select('id, user_id, form_id, form_type, action, action_details, timestamp')
      .contains('action_details', { origin: 'pdf-form-progress/save' })
      .in('action', ['created', 'edited'])
      .order('timestamp', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (isMissingFormAuditTrailError(error)) {
        return { rows: [], sourceMode: 'audit_logs' as const };
      }
      throw new Error(error.message);
    }

    const page = data || [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { rows, sourceMode: 'form_audit_trail' as const };
}

async function fetchAuditLogFallbackRows() {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('id, user_id, action, resource_id, metadata, created_at')
      .in('action', [...HR_FORM_AUDIT_LOG_ACTIONS])
      .contains('metadata', { origin: 'pdf-form-progress/save' })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = data || [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows.map((row: any) => {
    const metadata = normalizeActionDetails(row.metadata);
    const ownerUserId = String(
      metadata.owner_user_id
      || metadata.performed_for_user_id
      || metadata.ownerUserId
      || metadata.performedForUserId
      || ''
    ).trim();
    const formId = String(
      metadata.form_id
      || metadata.form_name
      || metadata.formId
      || metadata.formName
      || ''
    ).trim();

    return {
      id: `audit-log-${row.id}`,
      user_id: ownerUserId,
      form_id: formId,
      form_type: String(metadata.form_type || '').trim(),
      action: String(
        metadata.action
        || (row.action === 'form.proxy_create' || row.action === 'form.hr_create' ? 'created' : 'edited')
      ).trim(),
      action_details: metadata,
      timestamp: normalizeIso(metadata.occurred_at) || normalizeIso(row.created_at) || row.created_at,
    };
  }).filter((row) => row.user_id && row.form_id);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get('userId')?.trim() || null;
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

    const { rows: formAuditRows, sourceMode } = await fetchFormAuditTrailRows();
    const auditRows = sourceMode === 'form_audit_trail'
      ? formAuditRows
      : await fetchAuditLogFallbackRows();

    if (!auditRows.length) {
      return NextResponse.json({
        latestByUser: {},
        recentEdits: [],
        sourceMode: sourceMode === 'form_audit_trail' ? 'form_audit_trail' : 'audit_logs',
      });
    }

    const actorUserIds = [...new Set(
      auditRows
        .map((row: any) => getActorUserId(normalizeActionDetails(row.action_details)))
        .filter((value): value is string => !!value)
    )];

    const actorsById = new Map<string, ActorDirectoryEntry>();
    if (actorUserIds.length > 0) {
      const { data: actorRows, error: actorsError } = await supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          role,
          profiles (
            first_name,
            last_name
          )
        `)
        .in('id', actorUserIds);

      if (actorsError) {
        throw new Error(actorsError.message);
      }

      for (const row of actorRows || []) {
        const profile = Array.isArray((row as any).profiles) ? (row as any).profiles[0] : (row as any).profiles;
        const firstName = dec(profile?.first_name);
        const lastName = dec(profile?.last_name);
        const email = String((row as any).email || '').trim();
        const fullName = [firstName, lastName].filter(Boolean).join(' ') || email || (row as any).id;

        actorsById.set((row as any).id, {
          id: (row as any).id,
          email,
          role: String((row as any).role || '').trim(),
          full_name: fullName,
        });
      }
    }

    const normalizedEdits = auditRows
      .map((row: any) => {
        const details = normalizeActionDetails(row.action_details);
        if (!isHrEmployeesFormEdit(details)) {
          return null;
        }

        const actorUserId = getActorUserId(details);
        const actor = actorUserId ? actorsById.get(actorUserId) : null;
        const formId = String(row.form_id || details.form_id || details.form_name || '').trim();
        const editedAt = normalizeIso(row.timestamp) || normalizeIso(details.occurred_at) || null;
        const editorEmail = String(details.actor_email || actor?.email || '').trim() || null;
        const editorName = String(details.actor_name || actor?.full_name || editorEmail || actorUserId || '').trim() || null;
        const editorRole = String(details.actor_role || actor?.role || '').trim() || null;

        return {
          userId: String(row.user_id || '').trim(),
          formId,
          formDisplayName: resolveFormDisplayName(formId, details),
          action: String(row.action || details.action || 'edited').trim().toLowerCase(),
          editedAt,
          editorUserId: actorUserId,
          editorName,
          editorEmail,
          editorRole,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .filter((row) => row.userId && row.formId && row.editedAt)
      .sort((a, b) => compareDescByIso(a.editedAt, b.editedAt));

    const scopedEdits = requestedUserId
      ? normalizedEdits.filter((row) => row.userId === requestedUserId)
      : normalizedEdits;

    const latestByUser: Record<string, typeof scopedEdits[number]> = {};
    for (const edit of scopedEdits) {
      if (!latestByUser[edit.userId]) {
        latestByUser[edit.userId] = edit;
      }
    }

    return NextResponse.json({
      latestByUser,
      recentEdits: scopedEdits.slice(0, MAX_RECENT_EDITS),
      sourceMode: sourceMode === 'form_audit_trail' ? 'form_audit_trail' : 'audit_logs',
    });
  } catch (error: any) {
    console.error('[HR_FORM_EDITS] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load HR form edit history' },
      { status: 500 }
    );
  }
}
