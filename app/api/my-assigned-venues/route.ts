import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify user identity
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Use service role to bypass RLS on venue_reference
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // If asUser is provided, verify caller is admin/exec/hr before using target id
    const asUserId = request.nextUrl.searchParams.get('asUser');
    let targetUserId = user.id;
    if (asUserId && asUserId !== user.id) {
      const { data: caller } = await adminClient
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      if (caller && ['exec', 'admin', 'hr'].includes(caller.role)) {
        targetUserId = asUserId;
      }
    }

    const { data: rows, error } = await adminClient
      .from('vendor_venue_assignments')
      .select('venue:venue_reference(id, venue_name, city, state)')
      .eq('vendor_id', targetUserId);

    if (error) {
      console.error('[MY-ASSIGNED-VENUES] DB error:', error);
      return NextResponse.json({ venues: [] });
    }

    const venues = (rows ?? [])
      .map((r: any) => (Array.isArray(r.venue) ? r.venue[0] : r.venue))
      .filter(Boolean);

    return NextResponse.json({ venues });
  } catch (err: any) {
    console.error('[MY-ASSIGNED-VENUES] Unexpected error:', err);
    return NextResponse.json({ venues: [] });
  }
}
