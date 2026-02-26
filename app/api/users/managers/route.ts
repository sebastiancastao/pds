import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

    // Use service role to bypass RLS and get all managers
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const { data: managers, error: managersError } = await supabaseAdmin
      .from('users')
      .select('id, email, role')
      .eq('role', 'manager');

    if (managersError) {
      console.error('[MANAGERS] Error fetching managers:', managersError);
      return NextResponse.json({ error: 'Failed to fetch managers' }, { status: 500 });
    }

    // Fetch profiles separately to avoid PostgREST join ambiguity
    const managerIds = (managers || []).map((m: any) => m.id);
    const profilesMap: Record<string, any> = {};

    if (managerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', managerIds);

      (profiles || []).forEach((p: any) => {
        profilesMap[p.user_id] = p;
      });
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
    }).sort((a: any, b: any) => a.first_name.localeCompare(b.first_name));

    return NextResponse.json({ managers: transformedManagers }, { status: 200 });
  } catch (err: any) {
    console.error('[MANAGERS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
