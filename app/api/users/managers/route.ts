import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TARGET_MANAGER_ROLE = 'manager';
const PAGE_SIZE = 1000;

// GET: Retrieve all manager users
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Use service role to bypass RLS and fetch users with manager role.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const managers: Array<{ id: string; email: string; role: string }> = [];
    let from = 0;

    while (true) {
      const { data: page, error: managersError } = await supabaseAdmin
        .from('users')
        .select('id, email, role')
        .eq('role', TARGET_MANAGER_ROLE)
        .range(from, from + PAGE_SIZE - 1);

      if (managersError) {
        console.error('[MANAGERS] Error fetching managers:', managersError);
        return NextResponse.json({ error: 'Failed to fetch managers' }, { status: 500 });
      }

      const rows = page || [];
      managers.push(...rows);
      if (rows.length < PAGE_SIZE) break;

      from += PAGE_SIZE;
    }

    // Fetch profiles separately to avoid PostgREST join ambiguity
    const managerIds = managers.map((m) => m.id);
    const profilesMap: Record<string, any> = {};

    if (managerIds.length > 0) {
      for (let i = 0; i < managerIds.length; i += PAGE_SIZE) {
        const chunk = managerIds.slice(i, i + PAGE_SIZE);
        const { data: profiles, error: profilesError } = await supabaseAdmin
          .from('profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', chunk);

        if (profilesError) {
          console.error('[MANAGERS] Error fetching profiles:', profilesError);
          return NextResponse.json({ error: 'Failed to fetch manager profiles' }, { status: 500 });
        }

        (profiles || []).forEach((p: any) => {
          profilesMap[p.user_id] = p;
        });
      }
    }

    // Transform the data, decrypt names
    const transformedManagers = (managers || []).map((manager: any) => {
      const profile = profilesMap[manager.id];
      return {
        id: manager.id,
        email: manager.email,
        role: manager.role,
        first_name: safeDecrypt(profile?.first_name || ''),
        last_name: safeDecrypt(profile?.last_name || ''),
      };
    }).sort((a: any, b: any) => {
      const aName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email || '';
      const bName = `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.email || '';
      return aName.localeCompare(bName);
    });

    return NextResponse.json({ managers: transformedManagers }, { status: 200 });
  } catch (err: any) {
    console.error('[MANAGERS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
