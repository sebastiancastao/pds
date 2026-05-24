import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  isMissingPdfFormProgressVersionsError,
  normalizeStoredPdfFormDataToBase64,
} from '@/lib/pdf-form-progress-versions';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ALLOWED_PROXY_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);

export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null;

    const cookieClient = createRouteHandlerClient({ cookies });
    const { data: { user: cookieUser } } = await cookieClient.auth.getUser();
    if (cookieUser?.id) {
      userId = cookieUser.id;
    }

    if (!userId) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser }, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
        if (!tokenErr && tokenUser?.id) {
          userId = tokenUser.id;
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const formName = String(searchParams.get('formName') || '').trim();
    const targetUserIdParam = String(searchParams.get('targetUserId') || '').trim();

    if (!formName) {
      return NextResponse.json({ error: 'Missing formName parameter' }, { status: 400 });
    }

    let targetUserId = userId;
    if (targetUserIdParam && targetUserIdParam !== userId) {
      const { data: caller } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      if (!caller || !ALLOWED_PROXY_ROLES.has(String((caller as any).role || '').trim())) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      targetUserId = targetUserIdParam;
    }

    const { data, error } = await supabaseAdmin
      .from('pdf_form_progress_versions')
      .select('id, form_name, form_data, form_date, source_updated_at, replaced_at, created_at')
      .eq('user_id', targetUserId)
      .eq('form_name', formName)
      .order('replaced_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingPdfFormProgressVersionsError(error)) {
        return NextResponse.json({ versions: [] }, { status: 200 });
      }

      console.error('[PDF_FORM_VERSIONS] Failed to fetch versions:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve form versions', details: error.message },
        { status: 500 },
      );
    }

    const versions = (data || [])
      .map((row: any) => {
        const base64Data = normalizeStoredPdfFormDataToBase64(row.form_data);
        if (!base64Data) {
          return null;
        }

        return {
          id: row.id,
          form_name: row.form_name,
          form_data: base64Data,
          updated_at: row.source_updated_at || row.replaced_at || row.created_at || '',
          created_at: row.created_at || row.replaced_at || row.source_updated_at || '',
          form_date: row.form_date || null,
          snapshot_updated_at: row.source_updated_at || null,
          replaced_at: row.replaced_at || null,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ versions }, { status: 200 });
  } catch (error: any) {
    console.error('[PDF_FORM_VERSIONS] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve form versions', details: error.message },
      { status: 500 },
    );
  }
}
