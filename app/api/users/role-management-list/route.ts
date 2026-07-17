import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

// GET: Retrieve users for role management (exec/admin only)
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    // Use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Fetch in pages of 1000 so the PostgREST max-rows cap can't truncate results
    const fetchAll = async (buildQuery: (from: number, to: number) => any) => {
      const rows: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await buildQuery(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      return rows;
    };

    let users: any[];
    let profiles: any[];
    try {
      // Users and profiles are fetched separately (left-join semantics) so users
      // without a profile row still appear in the list
      users = await fetchAll((from, to) =>
        supabaseAdmin
          .from('users')
          .select('id, email, role, division, is_active')
          .order('id')
          .range(from, to)
      );
      profiles = await fetchAll((from, to) =>
        supabaseAdmin
          .from('profiles')
          .select('user_id, first_name, last_name')
          .order('user_id')
          .range(from, to)
      );
    } catch (fetchError) {
      console.error('[ROLE-MGMT-LIST] Error fetching users:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const profileByUserId = new Map(profiles.map((p: any) => [p.user_id, p]));

    const transformedUsers = users.map((u: any) => {
      const profile = profileByUserId.get(u.id);
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        division: u.division,
        is_active: u.is_active,
        first_name: profile ? (safeDecrypt(profile.first_name) || '') : '',
        last_name: profile ? (safeDecrypt(profile.last_name) || '') : '',
      };
    }).sort((a: any, b: any) => {
      const nameA = `${a.first_name} ${a.last_name}`.trim() || a.email;
      const nameB = `${b.first_name} ${b.last_name}`.trim() || b.email;
      return nameA.localeCompare(nameB);
    });

    return NextResponse.json({ users: transformedUsers }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[ROLE-MGMT-LIST] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
