import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    console.log('[VENDOR_ROSTER] Starting authentication check');

    // Validate auth via cookie session or bearer token
    const routeClient = createRouteHandlerClient({ cookies });
    let { data: { user }, error: userError } = await routeClient.auth.getUser();

    console.log('[VENDOR_ROSTER] Cookie auth result:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      error: userError?.message,
      errorName: userError?.name
    });

    if (!user) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      console.log('[VENDOR_ROSTER] No cookie user, checking Bearer token:', { hasAuthHeader: !!authHeader });

      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[VENDOR_ROSTER] Bearer token found, validating...');
        const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${token}` } }
        });
        const { data: tokenUser, error: tokenError } = await supabaseAnon.auth.getUser(token);
        console.log('[VENDOR_ROSTER] Bearer token validation:', {
          hasUser: !!tokenUser?.user,
          userId: tokenUser?.user?.id,
          error: tokenError?.message
        });
        if (!tokenError && tokenUser?.user) {
          user = tokenUser.user;
        }
      }
    }

    if (!user) {
      console.log('[VENDOR_ROSTER] Authentication failed - no user found');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('[VENDOR_ROSTER] Authentication successful:', { userId: user.id, email: user.email });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const { data, error } = await supabaseAdmin
      .from('vendor_roster')
      .select('first_name, last_name, address_line1, city, state, zip, cell_phone, email, new_hire_packet')
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });

    if (error) {
      console.error('[VENDOR_ROSTER] Error fetching roster:', error);
      return NextResponse.json({ error: 'Failed to fetch vendor roster' }, { status: 500 });
    }

    return NextResponse.json({ vendors: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error('[VENDOR_ROSTER] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
