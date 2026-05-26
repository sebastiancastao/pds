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
