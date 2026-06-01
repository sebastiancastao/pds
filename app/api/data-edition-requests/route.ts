import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Allow HR/exec to fetch any user's requests via ?userId=
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const isPrivileged = ['exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'finance'].includes(
      callerProfile?.role ?? ''
    );

    const requestedUserId = req.nextUrl.searchParams.get('userId');

    // Privileged users with no userId param → return all requests with employee info
    if (isPrivileged && !requestedUserId) {
      const { data: requests, error } = await adminClient
        .from('data_edition_requests')
        .select('id, user_id, document_name, document_type, reason, status, review_notes, reviewed_at, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const userIds = [...new Set((requests ?? []).map((r: any) => r.user_id))];
      let profileMap: Record<string, { first_name: string; last_name: string; email: string }> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await adminClient
          .from('profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', userIds);
        const { data: usersData } = await adminClient
          .from('users')
          .select('id, email')
          .in('id', userIds);
        const emailMap: Record<string, string> = {};
        (usersData ?? []).forEach((u: any) => { emailMap[u.id] = u.email; });
        (profiles ?? []).forEach((p: any) => {
          profileMap[p.user_id] = {
            first_name: p.first_name ?? '',
            last_name: p.last_name ?? '',
            email: emailMap[p.user_id] ?? '',
          };
        });
      }

      const enriched = (requests ?? []).map((r: any) => ({
        ...r,
        employee: profileMap[r.user_id] ?? null,
      }));

      return NextResponse.json({ requests: enriched });
    }

    const targetUserId = isPrivileged && requestedUserId ? requestedUserId : user.id;

    const { data: requests, error } = await adminClient
      .from('data_edition_requests')
      .select('id, document_name, document_type, reason, status, review_notes, reviewed_at, created_at')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ requests: requests ?? [] });
  } catch (err: any) {
    console.error('❌ GET /api/data-edition-requests:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const isPrivileged = ['exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'finance'].includes(
      callerProfile?.role ?? ''
    );

    if (!isPrivileged) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id, status, review_notes } = await req.json();
    if (!id || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { data: updated, error } = await adminClient
      .from('data_edition_requests')
      .update({
        status,
        review_notes: review_notes ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, review_notes, reviewed_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ request: updated });
  } catch (err: any) {
    console.error('❌ PATCH /api/data-edition-requests:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
