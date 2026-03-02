import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const isValidUUID = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function authenticateExecAdmin(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const token = authHeader.substring(7);
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
    return { error: NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 }) };
  }
  return { user };
}

/**
 * GET /api/supervisor3-team-venues?supervisor3_id=xxx&supervisor_id=yyy
 * Returns venue assignments for a specific supervisor on a supervisor3's team.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const supervisor3Id = searchParams.get('supervisor3_id');
    const supervisorId = searchParams.get('supervisor_id');

    if (!supervisor3Id || !isValidUUID(supervisor3Id)) {
      return NextResponse.json({ error: 'Valid supervisor3_id is required' }, { status: 400 });
    }
    if (!supervisorId || !isValidUUID(supervisorId)) {
      return NextResponse.json({ error: 'Valid supervisor_id is required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: assignments, error } = await supabaseAdmin
      .from('supervisor3_team_venue_assignments')
      .select('id, venue_id, assigned_at')
      .eq('supervisor3_id', supervisor3Id)
      .eq('supervisor_id', supervisorId)
      .order('assigned_at', { ascending: true });

    if (error) {
      console.error('[SUP3-TEAM-VENUES] GET error:', error);
      return NextResponse.json({ error: 'Failed to fetch venue assignments' }, { status: 500 });
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ assignments: [] }, { status: 200 });
    }

    const venueIds = assignments.map((a) => a.venue_id);
    const { data: venues, error: venueError } = await supabaseAdmin
      .from('venue_reference')
      .select('id, venue_name, city, state')
      .in('id', venueIds);

    if (venueError) {
      console.error('[SUP3-TEAM-VENUES] venue lookup error:', venueError);
      return NextResponse.json({ error: 'Failed to fetch venue details' }, { status: 500 });
    }

    const venueMap = Object.fromEntries((venues || []).map((v) => [v.id, v]));
    const data = assignments.map((a) => ({ ...a, venue: venueMap[a.venue_id] ?? null }));

    return NextResponse.json({ assignments: data }, { status: 200 });
  } catch (err: any) {
    console.error('[SUP3-TEAM-VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/supervisor3-team-venues
 * Assign a specific venue to a supervisor on a supervisor3's team.
 * Body: { supervisor3_id, supervisor_id, venue_id }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { supervisor3_id, supervisor_id, venue_id } = body;

    if (!supervisor3_id || !isValidUUID(supervisor3_id)) {
      return NextResponse.json({ error: 'Valid supervisor3_id is required' }, { status: 400 });
    }
    if (!supervisor_id || !isValidUUID(supervisor_id)) {
      return NextResponse.json({ error: 'Valid supervisor_id is required' }, { status: 400 });
    }
    if (!venue_id || !isValidUUID(venue_id)) {
      return NextResponse.json({ error: 'Valid venue_id is required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Guard: venue must actually be assigned to the supervisor3
    const { data: venueCheck, error: venueCheckError } = await supabaseAdmin
      .from('venue_managers')
      .select('id')
      .eq('manager_id', supervisor3_id)
      .eq('venue_id', venue_id)
      .eq('is_active', true)
      .maybeSingle();

    if (venueCheckError || !venueCheck) {
      return NextResponse.json(
        { error: 'This venue is not assigned to the selected Supervisor 3' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('supervisor3_team_venue_assignments')
      .insert({
        supervisor3_id,
        supervisor_id,
        venue_id,
        assigned_by: auth.user!.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This venue is already assigned to this supervisor' }, { status: 400 });
      }
      console.error('[SUP3-TEAM-VENUES] POST error:', error);
      return NextResponse.json({ error: 'Failed to assign venue' }, { status: 500 });
    }

    return NextResponse.json({ success: true, assignment: data }, { status: 200 });
  } catch (err: any) {
    console.error('[SUP3-TEAM-VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/supervisor3-team-venues?id=xxx
 * Remove a specific venue assignment for a supervisor.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: 'Valid assignment id is required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { error } = await supabaseAdmin
      .from('supervisor3_team_venue_assignments')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[SUP3-TEAM-VENUES] DELETE error:', error);
      return NextResponse.json({ error: 'Failed to remove venue assignment' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error('[SUP3-TEAM-VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
