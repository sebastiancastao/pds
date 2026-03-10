// app/api/custom-forms/user-assignments/route.ts
// GET /api/custom-forms/user-assignments?userId=<uuid>
// Returns all custom form IDs (and metadata) that have been specifically assigned to a user.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || user.id;

    // Only exec/admin can query other users; employees can query themselves
    if (userId !== user.id) {
      const { data: userRecord } = await supabase.from('users').select('role').eq('id', user.id).single();
      if (!userRecord || !['exec', 'admin', 'hr'].includes(userRecord.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { data: assignments, error } = await supabase
      .from('custom_form_assignments')
      .select('form_id, assigned_at')
      .eq('user_id', userId);

    if (error) {
      // Table doesn't exist yet → return empty gracefully
      if (error.code === '42P01') return NextResponse.json({ assignedForms: [] });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ assignedForms: [] });
    }

    const formIds = assignments.map((a: any) => a.form_id);
    const assignedAtMap: Record<string, string> = {};
    for (const a of assignments as any[]) assignedAtMap[a.form_id] = a.assigned_at;

    const { data: forms, error: formsError } = await supabase
      .from('custom_pdf_forms')
      .select('id, title, requires_signature, allow_date_input, allow_print_name, target_state, target_region, is_active, created_at')
      .in('id', formIds)
      .eq('is_active', true);

    if (formsError) return NextResponse.json({ error: formsError.message }, { status: 500 });

    const assignedForms = (forms || []).map((f: any) => ({
      ...f,
      assigned_at: assignedAtMap[f.id] ?? null,
    }));

    return NextResponse.json({ assignedForms });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
