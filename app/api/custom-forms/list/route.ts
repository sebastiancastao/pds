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
      .select('id, title, requires_signature, allow_date_input, allow_print_name, allow_venue_display, created_at, is_active, created_by, target_state, target_region')
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

    const allForms = forms ?? [];

    // Execs, admins, and HR always see all forms regardless of assignments
    const { data: userRecord } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userRecord && ['exec', 'admin', 'hr'].includes(userRecord.role)) {
      // Include per-form assignment counts so admins can see which forms are restricted
      const { data: allAssignmentsForAdmin } = await adminClient
        .from('custom_form_assignments')
        .select('form_id');
      const countMap: Record<string, number> = {};
      for (const a of (allAssignmentsForAdmin ?? [])) {
        countMap[a.form_id] = (countMap[a.form_id] ?? 0) + 1;
      }
      const formsWithCounts = allForms.map((f: any) => ({
        ...f,
        assignment_count: countMap[f.id] ?? 0,
      }));
      return NextResponse.json({ forms: formsWithCounts });
    }

    // For employees/workers: filter by user-specific assignments.
    // Forms with at least one assignment are restricted — only assigned users can see them.
    // Forms with no assignments are visible to everyone.
    const { data: allAssignments, error: assignErr } = await adminClient
      .from('custom_form_assignments')
      .select('form_id, user_id');

    if (assignErr) {
      if ((assignErr as any).code === '42P01') {
        // Table doesn't exist yet — show all forms
        return NextResponse.json({ forms: allForms });
      }
      console.error('[CUSTOM-FORMS LIST] Assignments error:', assignErr);
      // On error, fail safe: show all forms
      return NextResponse.json({ forms: allForms });
    }

    const assignments = allAssignments ?? [];

    if (assignments.length === 0) {
      // No assignments exist at all — show everything
      return NextResponse.json({ forms: allForms });
    }

    // Build sets: which forms are restricted, and which are assigned to this user
    const restrictedFormIds = new Set(assignments.map((a: any) => a.form_id));
    const userAssignedFormIds = new Set(
      assignments.filter((a: any) => a.user_id === user.id).map((a: any) => a.form_id)
    );

    const visibleForms = allForms.filter(
      (f: any) => !restrictedFormIds.has(f.id) || userAssignedFormIds.has(f.id)
    );

    return NextResponse.json({ forms: visibleForms });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS LIST] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
