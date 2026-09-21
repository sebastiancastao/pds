// Server-only helpers for the /api/venue-data routes: the service-role client and
// the exec/admin access check.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { VENUE_DATA_ROLES } from '@/lib/venue-data';

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

async function getAuthedUserId(req: NextRequest): Promise<string | null> {
  // Cookie session first, then a Bearer token (the pages send the access token).
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user.id;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data, error } = await supabaseAnon.auth.getUser(token);
    if (!error && data?.user?.id) return data.user.id;
  }
  return null;
}

export type VenueDataAccess =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

// Venue data is exec/admin only, matching the venue management page.
export async function requireVenueDataAccess(req: NextRequest): Promise<VenueDataAccess> {
  const userId = await getAuthedUserId(req);
  if (!userId) return { ok: false, response: jsonError('Unauthorized', 401) };

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[VENUE-DATA] Role lookup failed:', error);
    return { ok: false, response: jsonError('Could not verify access', 500) };
  }

  const role = String(data?.role || '').toLowerCase().trim();
  if (!(VENUE_DATA_ROLES as readonly string[]).includes(role)) {
    return { ok: false, response: jsonError('Forbidden: Exec/Admin access required', 403) };
  }
  return { ok: true, userId };
}

export const VENUE_JOIN = 'venue:venue_reference(id, venue_name, city, state)';
