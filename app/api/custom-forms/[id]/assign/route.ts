// app/api/custom-forms/[id]/assign/route.ts
// POST  /api/custom-forms/:id/assign  — assign form to specific users
// GET   /api/custom-forms/:id/assign  — list current assignees for this form
// DELETE /api/custom-forms/:id/assign — remove a user assignment

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function getExecUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: userRecord } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (!userRecord || userRecord.role !== 'exec') return null;
  return user;
}

// POST: assign this form to one or more users
// body: { userIds: string[] }
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const exec = await getExecUser(request);
    if (!exec) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { userIds }: { userIds: string[] } = await request.json();
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'userIds array is required' }, { status: 400 });
    }

    const formId = params.id;

    // Verify form exists
    const { data: form } = await supabase
      .from('custom_pdf_forms')
      .select('id, title')
      .eq('id', formId)
      .eq('is_active', true)
      .single();

    if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 });

    const rows = userIds.map(userId => ({
      form_id: formId,
      user_id: userId,
      assigned_by: exec.id,
    }));

    // Upsert so re-assigning the same user is idempotent
    const { error } = await supabase
      .from('custom_form_assignments')
      .upsert(rows, { onConflict: 'form_id,user_id' });

    if (error) {
      console.error('[ASSIGN] upsert error:', error);
      // If table doesn't exist yet, return helpful message
      if (error.code === '42P01') {
        return NextResponse.json({
          error: 'Setup required: run the custom_form_assignments migration',
          setup_needed: true,
        }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, assigned: userIds.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

// GET: list users assigned to this form
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const exec = await getExecUser(request);
    if (!exec) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: assignments, error } = await supabase
      .from('custom_form_assignments')
      .select('user_id, assigned_at')
      .eq('form_id', params.id);

    if (error) {
      if (error.code === '42P01') return NextResponse.json({ assignees: [] });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ assignees: [] });
    }

    // Fetch profile info for each assigned user
    const userIds = assignments.map(a => a.user_id);
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', userIds);

    const { data: userRows } = await supabase
      .from('users')
      .select('id, email')
      .in('id', userIds);

    const profileMap = Object.fromEntries((profileRows || []).map(p => [p.id, p]));
    const userMap = Object.fromEntries((userRows || []).map(u => [u.id, u]));

    const assignees = assignments.map(a => ({
      user_id: a.user_id,
      assigned_at: a.assigned_at,
      profiles: profileMap[a.user_id]
        ? {
            first_name: profileMap[a.user_id].first_name,
            last_name: profileMap[a.user_id].last_name,
            email: userMap[a.user_id]?.email || '',
          }
        : null,
    }));

    return NextResponse.json({ assignees });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}

// DELETE: remove a user from this form's assignments
// body: { userId: string }
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const exec = await getExecUser(request);
    if (!exec) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { userId }: { userId: string } = await request.json();
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

    const { error } = await supabase
      .from('custom_form_assignments')
      .delete()
      .eq('form_id', params.id)
      .eq('user_id', userId);

    if (error && error.code !== '42P01') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
