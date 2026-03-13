import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const safeDecrypt = (value: string | null | undefined): string => {
  if (!value) return '';
  try { return decrypt(value); } catch { return value; }
};

/**
 * GET /api/invitations/export?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Returns all vendor invitations created within the date range.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

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
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    if (!start || !end) {
      return NextResponse.json({ error: 'start and end date params are required' }, { status: 400 });
    }

    // Build query: invitations created in the date range
    let query = supabaseAdmin
      .from('vendor_invitations')
      .select(`
        id,
        status,
        invitation_type,
        created_at,
        responded_at,
        expires_at,
        start_date,
        end_date,
        vendor_id,
        event_id
      `)
      .gte('created_at', `${start}T00:00:00.000Z`)
      .lte('created_at', `${end}T23:59:59.999Z`)
      .order('created_at', { ascending: true });

    const { data: invitations, error: invErr } = await query;

    if (invErr) {
      console.error('[INVITATIONS EXPORT] DB error:', invErr);
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
    }

    if (!invitations || invitations.length === 0) {
      return NextResponse.json({ invitations: [] });
    }

    // Fetch vendor info for all vendor_ids
    const vendorIds = [...new Set(invitations.map((i: any) => i.vendor_id).filter(Boolean))];
    const { data: usersData } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .in('id', vendorIds);

    const { data: profilesData } = await supabaseAdmin
      .from('profiles')
      .select('user_id, first_name, last_name, city')
      .in('user_id', vendorIds);

    // Fetch event info for event_ids that are not null
    const eventIds = [...new Set(invitations.map((i: any) => i.event_id).filter(Boolean))];
    let eventsMap = new Map<string, { name: string; date: string; venue: string }>();
    if (eventIds.length > 0) {
      const { data: eventsData } = await supabaseAdmin
        .from('events')
        .select('id, event_name, event_date, venue')
        .in('id', eventIds);
      if (eventsData) {
        eventsData.forEach((e: any) => {
          eventsMap.set(e.id, {
            name: e.event_name || '',
            date: e.event_date ? e.event_date.slice(0, 10) : '',
            venue: e.venue || '',
          });
        });
      }
    }

    // Build lookup maps
    const emailMap = new Map<string, string>();
    (usersData || []).forEach((u: any) => emailMap.set(u.id, u.email || ''));

    const nameMap = new Map<string, string>();
    const cityMap = new Map<string, string>();
    (profilesData || []).forEach((p: any) => {
      const first = safeDecrypt(p.first_name);
      const last = safeDecrypt(p.last_name);
      nameMap.set(p.user_id, `${first} ${last}`.trim());
      cityMap.set(p.user_id, safeDecrypt(p.city) || '');
    });

    const result = invitations.map((inv: any) => ({
      id: inv.id,
      vendorName: nameMap.get(inv.vendor_id) || '—',
      email: emailMap.get(inv.vendor_id) || '—',
      city: cityMap.get(inv.vendor_id) || '—',
      status: inv.status || '—',
      invitationType: inv.invitation_type || 'single',
      invitationDate: inv.created_at ? inv.created_at.slice(0, 10) : '—',
      responseDate: inv.responded_at ? inv.responded_at.slice(0, 10) : '—',
      expiresAt: inv.expires_at ? inv.expires_at.slice(0, 10) : '—',
      availabilityStart: inv.start_date ? inv.start_date.slice(0, 10) : '—',
      availabilityEnd: inv.end_date ? inv.end_date.slice(0, 10) : '—',
      eventName: inv.event_id ? (eventsMap.get(inv.event_id)?.name || '—') : 'Bulk / General',
      eventDate: inv.event_id ? (eventsMap.get(inv.event_id)?.date || '—') : '—',
      eventVenue: inv.event_id ? (eventsMap.get(inv.event_id)?.venue || '—') : '—',
    }));

    return NextResponse.json({ invitations: result });
  } catch (err: any) {
    console.error('[INVITATIONS EXPORT] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
