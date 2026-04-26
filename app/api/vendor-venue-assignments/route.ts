import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ASSIGNABLE_VENDOR_DIVISIONS = ['vendor', 'trailers', 'both'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getProfile = (profileData: any) => {
  if (!profileData) return null;
  if (Array.isArray(profileData)) return profileData[0] || null;
  return profileData;
};

const isValidUuid = (value: string | null | undefined) =>
  !!value && UUID_REGEX.test(value);

const toCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
    return {
      error: NextResponse.json(
        { error: 'Forbidden: Exec/Admin access required' },
        { status: 403 }
      ),
    };
  }

  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendor_id');

    if (vendorId && !isValidUuid(vendorId)) {
      return NextResponse.json({ error: 'Invalid vendor_id' }, { status: 400 });
    }

    const [vendorsResult, venuesResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          role,
          division,
          is_active,
          profiles(first_name, last_name, latitude, longitude)
        `)
        .in('division', [...ASSIGNABLE_VENDOR_DIVISIONS])
        .eq('is_active', true)
        .order('email', { ascending: true }),
      supabaseAdmin
        .from('venue_reference')
        .select('id, venue_name, city, state, latitude, longitude')
        .order('venue_name', { ascending: true }),
    ]);

    if (vendorsResult.error) {
      console.error('[VENDOR_VENUE_ASSIGNMENTS] vendors query error:', vendorsResult.error);
      return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
    }

    if (venuesResult.error) {
      console.error('[VENDOR_VENUE_ASSIGNMENTS] venues query error:', venuesResult.error);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    const vendorsRaw = vendorsResult.data || [];
    const venuesRaw = venuesResult.data || [];

    let assignmentsQuery = supabaseAdmin
      .from('vendor_venue_assignments')
      .select(`
        id,
        vendor_id,
        venue_id,
        assigned_at,
        created_at,
        venue:venue_reference(id, venue_name, city, state),
        vendor:users!vendor_venue_assignments_vendor_id_fkey(id, email, role, division, is_active, profiles(first_name, last_name)),
        assigned_by_user:users!vendor_venue_assignments_assigned_by_fkey(id, email, profiles(first_name, last_name))
      `)
      .order('assigned_at', { ascending: false });

    if (vendorId) {
      assignmentsQuery = assignmentsQuery.eq('vendor_id', vendorId);
    }

    const { data: assignmentsRaw, error: assignmentsError } = await assignmentsQuery;

    if (assignmentsError) {
      console.error(
        '[VENDOR_VENUE_ASSIGNMENTS] assignments query error:',
        assignmentsError
      );
      return NextResponse.json({ error: 'Failed to fetch assignments' }, { status: 500 });
    }

    const vendors = vendorsRaw
      .map((vendor: any) => {
        const profile = getProfile(vendor.profiles);
        const firstName = safeDecrypt(profile?.first_name || '');
        const lastName = safeDecrypt(profile?.last_name || '');
        const fullName = `${firstName} ${lastName}`.trim();

        return {
          id: vendor.id,
          email: vendor.email,
          role: vendor.role,
          division: vendor.division,
          is_active: vendor.is_active,
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          latitude: toCoordinate(profile?.latitude),
          longitude: toCoordinate(profile?.longitude),
        };
      })
      .sort((a: any, b: any) => {
        const aName = a.full_name || a.email || '';
        const bName = b.full_name || b.email || '';
        return aName.localeCompare(bName);
      });

    const vendorMap = new Map(vendors.map((vendor: any) => [vendor.id, vendor]));

    const assignments = (assignmentsRaw || []).map((assignment: any) => {
      const vendor = assignment.vendor || vendorMap.get(assignment.vendor_id) || null;
      const vendorProfile = getProfile(vendor?.profiles);
      const assignedByProfile = getProfile(assignment.assigned_by_user?.profiles);

      return {
        id: assignment.id,
        vendor_id: assignment.vendor_id,
        venue_id: assignment.venue_id,
        assigned_at: assignment.assigned_at,
        created_at: assignment.created_at,
        venue: assignment.venue
          ? {
              id: assignment.venue.id,
              venue_name: assignment.venue.venue_name,
              city: assignment.venue.city,
              state: assignment.venue.state,
            }
          : null,
        vendor: vendor
          ? {
              id: vendor.id,
              email: vendor.email,
              role: vendor.role,
              division: vendor.division,
              is_active: vendor.is_active,
              first_name: safeDecrypt(vendorProfile?.first_name || vendor.first_name || ''),
              last_name: safeDecrypt(vendorProfile?.last_name || vendor.last_name || ''),
            }
          : null,
        assigned_by_user: assignment.assigned_by_user
          ? {
              id: assignment.assigned_by_user.id,
              email: assignment.assigned_by_user.email,
              first_name: safeDecrypt(assignedByProfile?.first_name || ''),
              last_name: safeDecrypt(assignedByProfile?.last_name || ''),
            }
          : null,
      };
    });

    return NextResponse.json(
      {
        vendors,
        venues: (venuesRaw || []).map((venue: any) => ({
          id: venue.id,
          venue_name: venue.venue_name,
          city: venue.city,
          state: venue.state,
          latitude: toCoordinate(venue.latitude),
          longitude: toCoordinate(venue.longitude),
        })),
        assignments,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[VENDOR_VENUE_ASSIGNMENTS] Unexpected GET error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { vendor_id, venue_id } = body || {};

    if (!isValidUuid(vendor_id) || !isValidUuid(venue_id)) {
      return NextResponse.json(
        { error: 'Valid vendor_id and venue_id are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const [vendorResult, venueResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, division, is_active')
        .eq('id', vendor_id)
        .single(),
      supabaseAdmin.from('venue_reference').select('id').eq('id', venue_id).single(),
    ]);

    if (vendorResult.error || !vendorResult.data) {
      return NextResponse.json({ error: 'Vendor user not found' }, { status: 404 });
    }

    if (venueResult.error || !venueResult.data) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    if (!vendorResult.data.is_active) {
      return NextResponse.json({ error: 'Vendor user is inactive' }, { status: 400 });
    }

    const normalizedDivision = String(vendorResult.data.division || '')
      .trim()
      .toLowerCase();

    if (!(ASSIGNABLE_VENDOR_DIVISIONS as readonly string[]).includes(normalizedDivision)) {
      return NextResponse.json(
        { error: 'Selected user is not a vendor-division user' },
        { status: 400 }
      );
    }

    const { data: assignment, error: upsertError } = await supabaseAdmin
      .from('vendor_venue_assignments')
      .upsert(
        {
          vendor_id,
          venue_id,
          assigned_by: auth.user.id,
          assigned_at: new Date().toISOString(),
        },
        { onConflict: 'vendor_id,venue_id' }
      )
      .select('id, vendor_id, venue_id, assigned_at, created_at')
      .single();

    if (upsertError) {
      console.error('[VENDOR_VENUE_ASSIGNMENTS] POST upsert error:', upsertError);
      return NextResponse.json({ error: 'Failed to assign venue' }, { status: 500 });
    }

    const { error: cleanupError } = await supabaseAdmin
      .from('vendor_venue_assignments')
      .delete()
      .eq('vendor_id', vendor_id)
      .neq('venue_id', venue_id);

    if (cleanupError) {
      console.error('[VENDOR_VENUE_ASSIGNMENTS] POST cleanup error:', cleanupError);
      return NextResponse.json({ error: 'Failed to finalize vendor assignment' }, { status: 500 });
    }

    return NextResponse.json(
      { message: 'Venue assigned successfully.', assignment },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[VENDOR_VENUE_ASSIGNMENTS] Unexpected POST error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { assignments } = body || {};

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ error: 'assignments array is required' }, { status: 400 });
    }

    if (assignments.length > 500) {
      return NextResponse.json({ error: 'Maximum 500 assignments per bulk upload' }, { status: 400 });
    }

    for (const row of assignments) {
      if (!isValidUuid(row?.vendor_id) || !isValidUuid(row?.venue_id)) {
        return NextResponse.json(
          { error: 'Each assignment must have valid vendor_id and venue_id UUIDs' },
          { status: 400 }
        );
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const vendorIds = [...new Set(assignments.map((a: any) => a.vendor_id))];
    const venueIds = [...new Set(assignments.map((a: any) => a.venue_id))];

    const [vendorsResult, venuesResult] = await Promise.all([
      supabaseAdmin
        .from('users')
        .select('id, division, is_active')
        .in('id', vendorIds),
      supabaseAdmin
        .from('venue_reference')
        .select('id')
        .in('id', venueIds),
    ]);

    if (vendorsResult.error) {
      return NextResponse.json({ error: 'Failed to validate vendors' }, { status: 500 });
    }
    if (venuesResult.error) {
      return NextResponse.json({ error: 'Failed to validate venues' }, { status: 500 });
    }

    const validVendorMap = new Map(
      (vendorsResult.data || []).map((v: any) => [v.id, v])
    );
    const validVenueIds = new Set((venuesResult.data || []).map((v: any) => v.id));

    const results: Array<{ vendor_id: string; venue_id: string; success: boolean; error?: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const row of assignments) {
      const vendor = validVendorMap.get(row.vendor_id);

      if (!vendor) {
        results.push({ ...row, success: false, error: 'Vendor not found' });
        failed++;
        continue;
      }
      if (!vendor.is_active) {
        results.push({ ...row, success: false, error: 'Vendor is inactive' });
        failed++;
        continue;
      }
      const normalizedDivision = String(vendor.division || '').trim().toLowerCase();
      if (!(ASSIGNABLE_VENDOR_DIVISIONS as readonly string[]).includes(normalizedDivision)) {
        results.push({ ...row, success: false, error: 'User is not a vendor-division user' });
        failed++;
        continue;
      }
      if (!validVenueIds.has(row.venue_id)) {
        results.push({ ...row, success: false, error: 'Venue not found' });
        failed++;
        continue;
      }

      const { error: upsertError } = await supabaseAdmin
        .from('vendor_venue_assignments')
        .upsert(
          { vendor_id: row.vendor_id, venue_id: row.venue_id, assigned_by: auth.user.id, assigned_at: new Date().toISOString() },
          { onConflict: 'vendor_id,venue_id' }
        );

      if (upsertError) {
        results.push({ ...row, success: false, error: 'Failed to assign venue' });
        failed++;
        continue;
      }

      const { error: cleanupError } = await supabaseAdmin
        .from('vendor_venue_assignments')
        .delete()
        .eq('vendor_id', row.vendor_id)
        .neq('venue_id', row.venue_id);

      if (cleanupError) {
        results.push({ ...row, success: false, error: 'Failed to clean up old assignments' });
        failed++;
        continue;
      }

      results.push({ ...row, success: true });
      succeeded++;
    }

    return NextResponse.json({ results, succeeded, failed }, { status: 200 });
  } catch (err: any) {
    console.error('[VENDOR_VENUE_ASSIGNMENTS] Unexpected PUT error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const venueId = searchParams.get('venue_id');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Unassign all vendors from an entire venue
    if (venueId) {
      if (!isValidUuid(venueId)) {
        return NextResponse.json({ error: 'Valid venue_id is required' }, { status: 400 });
      }

      const { data: venueAssignments, error: lookupError } = await supabaseAdmin
        .from('vendor_venue_assignments')
        .select('id, vendor_id')
        .eq('venue_id', venueId);

      if (lookupError) {
        console.error('[VENDOR_VENUE_ASSIGNMENTS] DELETE venue lookup error:', lookupError);
        return NextResponse.json({ error: 'Failed to load venue assignments' }, { status: 500 });
      }

      if (!venueAssignments || venueAssignments.length === 0) {
        return NextResponse.json({ message: 'No assignments found for this venue', removed: 0 }, { status: 200 });
      }

      const { error: deleteError } = await supabaseAdmin
        .from('vendor_venue_assignments')
        .delete()
        .eq('venue_id', venueId);

      if (deleteError) {
        console.error('[VENDOR_VENUE_ASSIGNMENTS] DELETE venue error:', deleteError);
        return NextResponse.json({ error: 'Failed to remove venue assignments' }, { status: 500 });
      }

      return NextResponse.json(
        { message: `Removed ${venueAssignments.length} assignment(s) for venue.`, removed: venueAssignments.length },
        { status: 200 }
      );
    }

    // Unassign a single assignment by id
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Valid assignment id or venue_id is required' }, { status: 400 });
    }

    const { data: assignmentRow, error: lookupError } = await supabaseAdmin
      .from('vendor_venue_assignments')
      .select('id, vendor_id')
      .eq('id', id)
      .maybeSingle();

    if (lookupError) {
      console.error('[VENDOR_VENUE_ASSIGNMENTS] DELETE lookup error:', lookupError);
      return NextResponse.json({ error: 'Failed to load assignment' }, { status: 500 });
    }

    if (!assignmentRow) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('vendor_venue_assignments')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('[VENDOR_VENUE_ASSIGNMENTS] DELETE error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove assignment' }, { status: 500 });
    }

    return NextResponse.json(
      { message: 'Assignment removed successfully.' },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[VENDOR_VENUE_ASSIGNMENTS] Unexpected DELETE error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
