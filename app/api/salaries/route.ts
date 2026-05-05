import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAuthUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
    if (token) {
      const { data } = await supabaseAnon.auth.getUser(token);
      user = data?.user ?? null;
    }
  }
  return user;
}

async function checkAdminRole(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('users').select('role').eq('id', userId).single();
  return ['admin', 'exec', 'hr', 'manager'].includes(data?.role || '');
}

// GET /api/salaries — returns all salary records (or ?user_id=x for a single user)
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await checkAdminRole(user.id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    let query = supabaseAdmin
      .from('user_salaries')
      .select('*')
      .order('created_at', { ascending: false });

    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ salaries: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// POST /api/salaries — upsert salary for a user
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!(await checkAdminRole(user.id))) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const body = await req.json();
    const { user_id, annual_salary, department, position, employment_type, effective_date } = body;

    if (!user_id || annual_salary == null) {
      return NextResponse.json({ error: 'user_id and annual_salary are required' }, { status: 400 });
    }
    if (isNaN(Number(annual_salary)) || Number(annual_salary) < 0) {
      return NextResponse.json({ error: 'annual_salary must be a non-negative number' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('user_salaries')
      .upsert({
        user_id,
        annual_salary: Number(annual_salary),
        department: department || null,
        position: position || null,
        employment_type: employment_type || 'salaried',
        effective_date: effective_date || new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ salary: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
