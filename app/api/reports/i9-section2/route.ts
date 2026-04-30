import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
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

const SECTION2_EXACT_FIELDS = new Set([
  'S2 Todays Date mmddyyyy',
  'FirstDayEmployed mmddyyyy',
  'List B Document 1 Title',
  'List B Issuing Authority 1',
  'List B Document Number 1',
  'List B Expiration Date 1',
  'List C Document Title 1',
  'List C Issuing Authority 1',
  'List C Document Number 1',
  'List C Expiration Date 1',
  'Document Title 0',
  'Document Title 1',
  'Document Title 2',
  'Document Title 2 If any',
  'Document Number 0',
  'Document Number 0 (if any)',
  'Document Number 1',
  'Document Number 2',
  'Document Number If any_2',
  'Document Number if any_3',
  'Issuing Authority 1',
  'Issuing Authority_2',
  'Expiration Date 0',
  'Expiration Date 1',
  'Expiration Date 2',
  'Expiration Date if any',
  'List A.   Document Title 3.  If any',
  'List A. Document 3.  Enter Issuing Authority',
  'List A.  Document 3 Number.  If any',
  'List A.  Document 2. Expiration Date (if any)',
]);

const SECTION2_FIELD_PATTERNS = [
  /\bs2[\s._-]*todays[\s._-]*date\b/i,
  /\bfirstdayemployed\b/i,
  /\bdocument[\s._-]*title\b/i,
  /\bissuing[\s._-]*authority\b/i,
  /\bdocument[\s._-]*number\b/i,
  /\bexpiration[\s._-]*date\b/i,
  /\blist[\s._-]*[abc]\b/i,
];

const SECTION2_IGNORED_FIELDS = new Set([
  'Signature of Employer or AR',
  'Signature of Employee',
  'Last Name First Name and Title of Employer or Authorized Representative',
  'Employers Business or Org Name',
  'Employers Business or Org Address',
  "Today's Date mmddyyy",
  'Last Name Family Name from Section 1',
  'First Name Given Name from Section 1',
  'Middle initial if any from Section 1',
  'Middle initial if any from Section 1-2',
  'Last Name Family Name from Section 1-2',
  'First Name Given Name from Section 1-2',
]);

type UserDirectoryEntry = {
  id: string;
  email: string;
  role: string;
  state: string;
  full_name: string;
};

type Section2Result = {
  filled: boolean;
  basis: 'section2_date' | 'first_day_employed' | 'document_fields' | 'none';
  fields: Record<string, string>;
};

type I9MetaEntry = {
  userId: string;
  form_name: string;
  updated_at: string;
};

const EMPTY_SECTION2_RESULT: Section2Result = {
  filled: false,
  basis: 'none',
  fields: {},
};

const LOOKUP_BATCH_SIZE = 200;
const LOOKUP_BATCH_CONCURRENCY = 3;
const SECTION2_FETCH_CONCURRENCY = 12;

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

function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeBase64(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      return Buffer.from(value.slice(2), 'hex').toString('base64');
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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function runBatched<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function consumeQueue() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => consumeQueue()
  );
  await Promise.all(workers);
  return results;
}

function getSection2Basis(fields: Record<string, string>): Section2Result['basis'] {
  const names = Object.keys(fields);
  if (names.some((name) => /^S2 Todays Date mmddyyyy$/i.test(name))) {
    return 'section2_date';
  }
  if (names.some((name) => /^FirstDayEmployed mmddyyyy$/i.test(name))) {
    return 'first_day_employed';
  }
  if (names.length > 0) {
    return 'document_fields';
  }
  return 'none';
}

function isSection2FieldName(name: string): boolean {
  if (!name || SECTION2_IGNORED_FIELDS.has(name)) return false;
  if (SECTION2_EXACT_FIELDS.has(name)) return true;
  return SECTION2_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}

async function parseSection2(rawFormData: unknown): Promise<Section2Result> {
  try {
    const base64 = normalizeBase64(rawFormData);
    if (!base64) return EMPTY_SECTION2_RESULT;

    const pdfBytes = Buffer.from(base64, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const matchedFields: Record<string, string> = {};

    for (const field of form.getFields()) {
      let name = '';
      try {
        name = field.getName();
      } catch {
        continue;
      }

      if (!isSection2FieldName(name)) continue;

      let value = '';
      try {
        if (typeof (field as any).getText === 'function') {
          value = ((field as any).getText() ?? '').trim();
        }
      } catch {
        value = '';
      }

      if (!value) continue;
      matchedFields[name] = value;
    }

    return {
      filled: Object.keys(matchedFields).length > 0,
      basis: getSection2Basis(matchedFields),
      fields: matchedFields,
    };
  } catch {
    return EMPTY_SECTION2_RESULT;
  }
}

async function fetchLatestI9Section2(meta: I9MetaEntry): Promise<Section2Result> {
  try {
    const { data, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_data, updated_at')
      .eq('user_id', meta.userId)
      .eq('form_name', meta.form_name)
      .not('form_data', 'is', null)
      .neq('form_data', '')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[I9-SECTION2-REPORT] Failed to fetch latest I-9 form data', {
        userId: meta.userId,
        formName: meta.form_name,
        updatedAt: meta.updated_at,
        error: error.message,
      });
      return EMPTY_SECTION2_RESULT;
    }

    if (!data) {
      return EMPTY_SECTION2_RESULT;
    }

    return await parseSection2((data as any).form_data);
  } catch (error: any) {
    console.warn('[I9-SECTION2-REPORT] Skipping malformed or unreadable I-9 form payload', {
      userId: meta.userId,
      formName: meta.form_name,
      updatedAt: meta.updated_at,
      error: error?.message || String(error),
    });
    return EMPTY_SECTION2_RESULT;
  }
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
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

    const { data: metaRows, error: metaError } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('user_id, form_name, updated_at')
      .or('form_name.ilike.i9,form_name.ilike.*-i9')
      .not('form_data', 'is', null)
      .neq('form_data', '');

    if (metaError) {
      throw new Error(metaError.message);
    }

    const latestI9MetaByUser = new Map<string, { form_name: string; updated_at: string }>();
    for (const row of metaRows || []) {
      const typedRow = row as any;
      if (!isI9FormName(typedRow.form_name)) continue;

      const existing = latestI9MetaByUser.get(typedRow.user_id);
      if (!existing || String(typedRow.updated_at || '') > existing.updated_at) {
        latestI9MetaByUser.set(typedRow.user_id, {
          form_name: String(typedRow.form_name || '').trim(),
          updated_at: String(typedRow.updated_at || '').trim(),
        });
      }
    }

    const i9MetaEntries = Array.from(latestI9MetaByUser.entries()).map(([userId, meta]) => ({
      userId,
      form_name: meta.form_name,
      updated_at: meta.updated_at,
    }));
    const i9UserIds = i9MetaEntries.map((entry) => entry.userId);

    if (i9UserIds.length === 0) {
      return NextResponse.json({
        summary: {
          total: 0,
          with_section2: 0,
          without_section2: 0,
          with_documents: 0,
        },
        rows: [],
      }, { status: 200 });
    }

    const userIdBatches = chunkArray(i9UserIds, LOOKUP_BATCH_SIZE);
    const [userBatchResults, docsBatchResults] = await Promise.all([
      runBatched(userIdBatches, async (userIdBatch) => {
        const { data, error } = await supabaseAdmin
          .from('users')
          .select('id, email, role, profiles(id, first_name, last_name, state)')
          .in('id', userIdBatch);

        if (error) {
          throw new Error(error.message);
        }

        return data || [];
      }, LOOKUP_BATCH_CONCURRENCY),
      runBatched(userIdBatches, async (userIdBatch) => {
        const { data, error } = await supabaseAdmin
          .from('i9_documents')
          .select(`
            user_id,
            additional_doc_filename,
            additional_doc_uploaded_at,
            drivers_license_filename,
            drivers_license_uploaded_at,
            ssn_document_filename,
            ssn_document_uploaded_at
          `)
          .in('user_id', userIdBatch);

        if (error) {
          throw new Error(error.message);
        }

        return data || [];
      }, LOOKUP_BATCH_CONCURRENCY),
    ]);

    const usersById = new Map<string, UserDirectoryEntry>();
    for (const batch of userBatchResults) {
      for (const row of batch) {
        const typedRow = row as any;
        const profile = Array.isArray(typedRow.profiles) ? typedRow.profiles[0] : typedRow.profiles;
        const firstName = dec(profile?.first_name);
        const lastName = dec(profile?.last_name);
        const email = String(typedRow.email || '').trim();

        usersById.set(typedRow.id, {
          id: typedRow.id,
          email,
          role: String(typedRow.role || '').trim(),
          state: String(profile?.state || '').trim().toUpperCase(),
          full_name: [firstName, lastName].filter(Boolean).join(' ') || email || typedRow.id,
        });
      }
    }

    const docsByUser = new Map<string, any>();
    for (const batch of docsBatchResults) {
      for (const row of batch) {
        docsByUser.set((row as any).user_id, row);
      }
    }

    const parsedByUser = new Map<string, Section2Result>();

    const parsedResults = await runBatched(i9MetaEntries, async (meta) => ({
      userId: meta.userId,
      result: await fetchLatestI9Section2(meta),
    }), SECTION2_FETCH_CONCURRENCY);

    for (const parsed of parsedResults) {
      parsedByUser.set(parsed.userId, parsed.result);
    }

    const rows = i9UserIds.map((userId) => {
      const user = usersById.get(userId) || {
        id: userId,
        email: '',
        role: '',
        state: '',
        full_name: userId,
      };
      const meta = latestI9MetaByUser.get(userId)!;
      const docsRow = docsByUser.get(userId) || null;
      const section2 = parsedByUser.get(userId) || EMPTY_SECTION2_RESULT;

      const hasListA = !!docsRow?.additional_doc_filename;
      const hasListB = !!docsRow?.drivers_license_filename;
      const hasListC = !!docsRow?.ssn_document_filename;

      let documentMode = 'No documents';
      if (hasListA && !hasListB && !hasListC) {
        documentMode = 'List A';
      } else if (!hasListA && hasListB && hasListC) {
        documentMode = 'List B + C';
      } else if (hasListA || hasListB || hasListC) {
        documentMode = 'Partial / mixed';
      }

      return {
        user_id: userId,
        vendor_name: user.full_name,
        vendor_email: user.email,
        vendor_role: user.role,
        vendor_state: user.state,
        has_i9_form: true,
        i9_form_name: meta.form_name,
        form_updated_at: normalizeIso(meta.updated_at),
        has_section2: section2.filled,
        section2_basis: section2.basis,
        section2_fields: section2.fields,
        has_list_a: hasListA,
        has_list_b: hasListB,
        has_list_c: hasListC,
        document_mode: documentMode,
        list_a_filename: docsRow?.additional_doc_filename || null,
        list_b_filename: docsRow?.drivers_license_filename || null,
        list_c_filename: docsRow?.ssn_document_filename || null,
        list_a_uploaded_at: normalizeIso(docsRow?.additional_doc_uploaded_at),
        list_b_uploaded_at: normalizeIso(docsRow?.drivers_license_uploaded_at),
        list_c_uploaded_at: normalizeIso(docsRow?.ssn_document_uploaded_at),
      };
    });

    rows.sort((a, b) => {
      if (a.has_section2 !== b.has_section2) {
        return a.has_section2 ? -1 : 1;
      }
      return a.vendor_name.localeCompare(b.vendor_name);
    });

    const summary = {
      total: rows.length,
      with_section2: rows.filter((row) => row.has_section2).length,
      without_section2: rows.filter((row) => !row.has_section2).length,
      with_documents: rows.filter((row) => row.has_list_a || row.has_list_b || row.has_list_c).length,
    };

    return NextResponse.json({ summary, rows }, { status: 200 });
  } catch (error: any) {
    console.error('[I9-SECTION2-REPORT]', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
