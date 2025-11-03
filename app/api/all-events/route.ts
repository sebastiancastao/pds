import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }
    if (!user || !user.id) {
      console.error('[ALL-EVENTS] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check user role - only admin and exec can see all events
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      console.error('[ALL-EVENTS] Failed to fetch user data:', userError);
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 403 });
    }

    const userRole = userData.role as string;
    if (userRole !== 'admin' && userRole !== 'exec') {
      console.error('[ALL-EVENTS] Access denied - user role:', userRole);
      return NextResponse.json({ error: 'Access denied. Only admin and exec users can view all events.' }, { status: 403 });
    }

    // Optional filters
    const { searchParams } = new URL(req.url);
    const isActiveParam = searchParams.get('is_active');

    // Return ALL events (no user filter) for global calendar
    let query = supabaseAdmin
      .from('events')
      .select('*')
      .order('event_date', { ascending: false })
      .order('start_time', { ascending: false });

    if (isActiveParam !== null) {
      query = query.eq('is_active', isActiveParam === 'true');
    }

    const { data, error } = await query;
    if (error) {
      console.error('[ALL-EVENTS] SUPABASE SELECT ERROR:', error);
      return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
    }

    console.log(`[ALL-EVENTS] Returning ${data?.length || 0} events for ${userRole} user`);
    return NextResponse.json({ events: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error('[ALL-EVENTS] SERVER ERROR:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
