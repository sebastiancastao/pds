import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const nameRaw = searchParams.get('name');
    const debug = searchParams.get('debug') === 'true';

    const name = (nameRaw || '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    if (debug && process.env.NODE_ENV !== 'production') {
      console.log('[MATCH-EMPLOYEE][debug] match attempt', { nameLength: name.length });
    }

    // Query profiles for matching official_name (exact match first).
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('official_name', name)
      .maybeSingle();

    if (error) {
      console.error('Error matching employee:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data?.user_id) {
      if (debug && process.env.NODE_ENV !== 'production') {
        console.log('[MATCH-EMPLOYEE][debug] match result', { found: true, method: 'exact' });
      }
      return NextResponse.json({ user_id: data.user_id || null }, { status: 200 });
    }

    // Fallback: case-insensitive match (still exact, no wildcards). If ambiguous, return null.
    const { data: ilikeRows, error: ilikeErr } = await supabaseAdmin
      .from('profiles')
      .select('user_id, official_name')
      .ilike('official_name', name)
      .limit(2);
    if (ilikeErr) {
      console.error('Error matching employee (ilike):', ilikeErr);
      return NextResponse.json({ error: ilikeErr.message }, { status: 500 });
    }
    if ((ilikeRows || []).length === 1) {
      const uid = (ilikeRows as any)[0]?.user_id || null;
      if (debug && process.env.NODE_ENV !== 'production') {
        console.log('[MATCH-EMPLOYEE][debug] match result', { found: !!uid, method: 'ilike' });
      }
      return NextResponse.json({ user_id: uid }, { status: 200 });
    }

    if (debug && process.env.NODE_ENV !== 'production') {
      console.log('[MATCH-EMPLOYEE][debug] match result', { found: false, method: 'none_or_ambiguous', count: (ilikeRows || []).length });
    }

    return NextResponse.json({ user_id: null, message: 'No unique matching employee found' }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in match-employee:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
