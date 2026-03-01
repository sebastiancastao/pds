import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

async function getRole(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  return (data?.role || '').toString().trim().toLowerCase();
}

// GET /api/payroll/approvals — list all submissions with submitter name
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const role = await getRole(user.id);
    if (!['exec', 'admin', 'hr'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { data: submissions, error } = await supabaseAdmin
      .from('payroll_approval_submissions')
      .select('id, submitted_by, file_name, status, submitted_at, notes')
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    // Fetch submitter names
    const userIds = [...new Set((submissions ?? []).map((s: any) => s.submitted_by).filter(Boolean))];
    let profileMap: Record<string, string> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds);

      (profiles ?? []).forEach((p: any) => {
        const first = p.first_name ? safeDecrypt(p.first_name) : '';
        const last = p.last_name ? safeDecrypt(p.last_name) : '';
        profileMap[p.id] = `${first} ${last}`.trim() || 'Unknown';
      });
    }

    const result = (submissions ?? []).map((s: any) => ({
      ...s,
      submitted_by_name: profileMap[s.submitted_by] ?? 'Unknown',
    }));

    return NextResponse.json({ submissions: result });
  } catch (err: any) {
    console.error('[GET /api/payroll/approvals]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/payroll/approvals — update status and/or notes
export async function PATCH(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const role = await getRole(user.id);
    if (!['exec', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized — exec or admin required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, status, notes } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!['approved', 'rejected', 'submitted'].includes(status)) {
      return NextResponse.json({ error: 'status must be approved, rejected, or submitted' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('payroll_approval_submissions')
      .update({ status, notes: notes ?? null })
      .eq('id', id)
      .select('id, status, notes, submitted_at')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, submission: data });
  } catch (err: any) {
    console.error('[PATCH /api/payroll/approvals]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
