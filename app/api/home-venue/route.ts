import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function authenticateUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const token = authHeader.substring(7);
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user: userData.user, token };
}

/**
 * GET /api/home-venue
 * Returns list of all venues and the current user's home venue assignment (if any).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);
    if (auth.error) return auth.error;
    const userId = auth.user!.id;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const [venuesResult, assignmentResult] = await Promise.all([
      supabaseAdmin
        .from('venue_reference')
        .select('id, venue_name, city, state')
        .order('venue_name', { ascending: true }),
      supabaseAdmin
        .from('vendor_venue_assignments')
        .select('venue_id, venue:venue_reference(id, venue_name, city, state)')
        .eq('vendor_id', userId)
        .limit(1)
        .maybeSingle(),
    ]);

    if (venuesResult.error) {
      console.error('[HOME-VENUE GET] venues error:', venuesResult.error);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    const venues = (venuesResult.data || []).map((v: any) => ({
      id: v.id,
      venue_name: v.venue_name,
      city: v.city,
      state: v.state,
    }));

    const currentVenue = assignmentResult.data?.venue
      ? {
          id: (assignmentResult.data.venue as any).id,
          venue_name: (assignmentResult.data.venue as any).venue_name,
          city: (assignmentResult.data.venue as any).city,
          state: (assignmentResult.data.venue as any).state,
        }
      : null;

    return NextResponse.json({ venues, currentVenue });
  } catch (err: any) {
    console.error('[HOME-VENUE GET] unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/home-venue
 * Assigns the current user to a selected home venue.
 * Body: { venue_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request);
    if (auth.error) return auth.error;
    const userId = auth.user!.id;

    const body = await request.json();
    const { venue_id } = body || {};

    if (!venue_id || typeof venue_id !== 'string') {
      return NextResponse.json({ error: 'venue_id is required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Verify venue exists
    const { data: venue, error: venueErr } = await supabaseAdmin
      .from('venue_reference')
      .select('id, venue_name')
      .eq('id', venue_id)
      .maybeSingle();

    if (venueErr || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    // Remove any existing assignments for this user, then insert the new one
    await supabaseAdmin
      .from('vendor_venue_assignments')
      .delete()
      .eq('vendor_id', userId);

    const { error: insertError } = await supabaseAdmin
      .from('vendor_venue_assignments')
      .insert({
        vendor_id: userId,
        venue_id,
        assigned_by: userId,
        assigned_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('[HOME-VENUE POST] insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save venue assignment' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Home venue saved successfully', venue_name: venue.venue_name });
  } catch (err: any) {
    console.error('[HOME-VENUE POST] unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
