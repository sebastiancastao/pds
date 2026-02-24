import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    // Authenticate via cookie or Bearer token
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

    // Use service client to read forms regardless of RLS
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: forms, error } = await adminClient
      .from('custom_pdf_forms')
      .select('id, title, requires_signature, allow_date_input, created_at, is_active, created_by, target_state, target_region')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[CUSTOM-FORMS LIST] DB error:', error);
      // 42P01 = relation does not exist (migration not yet run)
      if ((error as any).code === '42P01') {
        return NextResponse.json({
          forms: [],
          setup_needed: true,
          message: 'The custom_pdf_forms table does not exist. Please run the database migration at database/migrations/20250222_custom_pdf_forms.sql in your Supabase SQL editor.',
        });
      }
      return NextResponse.json({ error: 'Failed to fetch forms', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ forms: forms ?? [] });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS LIST] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
