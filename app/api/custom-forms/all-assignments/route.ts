// GET /api/custom-forms/all-assignments
// Returns all custom_form_assignments rows for exec/admin/hr use.
// Response: { assignments: { form_id: string; user_id: string }[] }

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

    const { data: userRecord } = await supabase.from('users').select('role').eq('id', user.id).single();
    if (!userRecord || !['exec', 'admin', 'hr'].includes(userRecord.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: assignments, error } = await supabase
      .from('custom_form_assignments')
      .select('form_id, user_id');

    if (error) {
      if (error.code === '42P01') return NextResponse.json({ assignments: [] });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ assignments: assignments ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
