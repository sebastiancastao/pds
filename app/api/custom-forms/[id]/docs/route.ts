import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const SLOT_META = [
  { slot: 'list_a', col: 'additional_doc',  label: 'List A — Identity & Work Authorization' },
  { slot: 'list_b', col: 'drivers_license', label: 'List B — Identity Document' },
  { slot: 'list_c', col: 'ssn_document',    label: 'List C — Work Authorization' },
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');

    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.substring(7);

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Exec/admin can query any user; employees see only their own
    let targetUserId = user.id;
    if (requestedUserId && requestedUserId !== user.id) {
      const { data: me } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!me || !['exec', 'admin', 'hr_admin'].includes(me.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      targetUserId = requestedUserId;
    }

    // Read from i9_documents table — populated by the upload-doc route
    const { data: row } = await supabase
      .from('i9_documents')
      .select(`
        additional_doc_url, additional_doc_filename,
        drivers_license_url, drivers_license_filename,
        ssn_document_url, ssn_document_filename
      `)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (!row) return NextResponse.json({ docs: [] });

    const docs = SLOT_META
      .map(({ slot, col, label }) => {
        const url = row[`${col}_url` as keyof typeof row] as string | null;
        const filename = row[`${col}_filename` as keyof typeof row] as string | null;
        if (!url) return null;
        return { slot, label, filename: filename ?? slot, url };
      })
      .filter(Boolean);

    return NextResponse.json({ docs });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS DOCS] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
