// GET /api/custom-forms/all-users
// Returns all active users with their profile names — exec/admin/hr only.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

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

    const { data: userRecord } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    if (!userRecord || !['exec', 'admin', 'hr'].includes(userRecord.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pageSize = 1000;
    const allUsers: any[] = [];
    let offset = 0;

    while (true) {
      const { data: users, error } = await supabase
        .from('users')
        .select('id, email, role, profiles(first_name, last_name, city, state)')
        .eq('is_active', true)
        .order('email', { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!users || users.length === 0) {
        break;
      }

      allUsers.push(...users);

      if (users.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    const result = allUsers.map((u: any) => {
      const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
      return {
        id: u.id,
        email: u.email || '',
        role: u.role || '',
        first_name: safeDecrypt(profile?.first_name || ''),
        last_name: safeDecrypt(profile?.last_name || ''),
        city: profile?.city || null,
        state: profile?.state || null,
      };
    });

    return NextResponse.json({ users: result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
