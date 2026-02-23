import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

export async function GET(request: NextRequest) {
  try {
    // Auth check
    let authClient = createRouteHandlerClient({ cookies });
    let { data: { user } } = await authClient.auth.getUser();

    if (!user) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: { user: tokenUser } } = await tokenClient.auth.getUser();
        user = tokenUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const year = new Date().getFullYear();

    // Get all active custom forms
    const { data: forms, error: formsError } = await supabaseAdmin
      .from('custom_pdf_forms')
      .select('id, title')
      .eq('is_active', true);

    if (formsError) {
      return NextResponse.json({ error: formsError.message }, { status: 500 });
    }

    if (!forms || forms.length === 0) {
      return NextResponse.json({ completions: [] });
    }

    // Build the exact form_name values used when saving: "${title} ${year}"
    const formNames = forms.map(f => `${f.title} ${year}`);

    // Query pdf_form_progress directly — no PDF size filtering, exact name match
    const { data: rows, error: progressError } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('user_id, form_name, updated_at')
      .in('form_name', formNames);

    if (progressError) {
      return NextResponse.json({ error: progressError.message }, { status: 500 });
    }

    return NextResponse.json({
      completions: (rows || []).map(r => ({
        userId: r.user_id,
        formName: r.form_name,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS COMPLETIONS]', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
