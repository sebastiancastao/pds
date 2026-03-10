// app/api/employees/search/route.ts
// GET /api/employees/search?q=<name_or_email>&limit=20
// Lightweight employee search for typeahead — exec/admin/hr only.

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

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);

    const { data: users, error } = await supabase
      .from('users')
      .select(`
        id,
        email,
        profiles!inner (
          first_name,
          last_name,
          city,
          state
        )
      `)
      .eq('role', 'employee')
      .eq('is_active', true)
      .limit(100); // fetch more, filter client-side for fuzzy name search

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const results = (users || [])
      .map((u: any) => ({
        id: u.id,
        email: u.email,
        first_name: u.profiles?.first_name || '',
        last_name: u.profiles?.last_name || '',
        city: u.profiles?.city || null,
        state: u.profiles?.state || null,
      }))
      .filter(u => {
        if (!q) return true;
        const full = `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase();
        return full.includes(q);
      })
      .slice(0, limit);

    return NextResponse.json({ employees: results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
