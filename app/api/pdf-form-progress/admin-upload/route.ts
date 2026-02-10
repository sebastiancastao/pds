import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Allow HR to upload filled onboarding PDFs for a specific user.
const allowedRoles = new Set(['exec', 'admin', 'hr']);

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[PDF-UPLOAD] Missing Supabase configuration');
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userRecord, error: roleError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const normalizedRole = (userRecord?.role || '').toString().trim().toLowerCase();

    if (roleError || !userRecord || !allowedRoles.has(normalizedRole)) {
      return NextResponse.json({ error: 'Forbidden: HR/Exec/Admin access required' }, { status: 403 });
    }

    const payload = await request.json();
    const { userId, formName, formData } = payload;

    if (!userId || !formName || !formData) {
      return NextResponse.json({ error: 'Missing userId, formName, or formData' }, { status: 400 });
    }

    if (typeof formData !== 'string') {
      return NextResponse.json({ error: 'formData must be a base64 string' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl!, supabaseServiceKey!, {
      auth: { persistSession: false },
    });

    const sanitizedUserId = userId.trim();
    const sanitizedFormName = formName.trim();

    const { data: existingRecord, error: existingError } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('updated_at')
      .eq('user_id', sanitizedUserId)
      .eq('form_name', sanitizedFormName)
      .maybeSingle();

    if (existingError) {
      console.error('[PDF-UPLOAD] Failed to read previous form progress', existingError);
      return NextResponse.json({ error: 'Failed to read previous progress' }, { status: 500 });
    }

    const previousUpdatedAt = existingRecord?.updated_at ?? null;
    const targetUpdatedAt = previousUpdatedAt ?? new Date().toISOString();

    const { error: upsertError } = await supabaseAdmin
      .from('pdf_form_progress')
      .upsert(
        {
          user_id: sanitizedUserId,
          form_name: sanitizedFormName,
          form_data: formData,
          updated_at: targetUpdatedAt,
        },
        { onConflict: 'user_id,form_name' }
      );

    if (upsertError) {
      console.error('[PDF-UPLOAD] Failed to persist PDF form', upsertError);
      return NextResponse.json({ error: 'Failed to save form data' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      previousUpdatedAt,
      updatedAt: targetUpdatedAt,
    });
  } catch (error: any) {
    console.error('[PDF-UPLOAD] Unexpected error', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
