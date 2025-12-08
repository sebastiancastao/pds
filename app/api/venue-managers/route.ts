import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// GET: Retrieve all venue manager assignments
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get('venue_id');
    const managerId = searchParams.get('manager_id');

    let query = supabase
      .from('venue_managers')
      .select(`
        *,
        venue:venue_reference(id, venue_name, city, state),
        manager:users!venue_managers_manager_id_fkey(id, email, role, profiles(first_name, last_name)),
        assigned_by_user:users!venue_managers_assigned_by_fkey(id, email, profiles(first_name, last_name))
      `)
      .order('assigned_at', { ascending: false });

    if (venueId) {
      query = query.eq('venue_id', venueId);
    }

    if (managerId) {
      query = query.eq('manager_id', managerId);
    }

    const { data: assignments, error } = await query;

    if (error) {
      console.error('[VENUE_MANAGERS] Error fetching assignments:', error);
      return NextResponse.json({ error: 'Failed to fetch venue assignments' }, { status: 500 });
    }

    // Transform the data to flatten the profiles structure and decrypt names
    const transformedAssignments = (assignments || []).map((assignment: any) => ({
      ...assignment,
      manager: assignment.manager ? {
        id: assignment.manager.id,
        email: assignment.manager.email,
        role: assignment.manager.role,
        first_name: safeDecrypt(assignment.manager.profiles?.first_name || ''),
        last_name: safeDecrypt(assignment.manager.profiles?.last_name || ''),
      } : null,
      assigned_by_user: assignment.assigned_by_user ? {
        id: assignment.assigned_by_user.id,
        email: assignment.assigned_by_user.email,
        first_name: safeDecrypt(assignment.assigned_by_user.profiles?.first_name || ''),
        last_name: safeDecrypt(assignment.assigned_by_user.profiles?.last_name || ''),
      } : null,
    }));

    return NextResponse.json({ assignments: transformedAssignments }, { status: 200 });
  } catch (err: any) {
    console.error('[VENUE_MANAGERS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Assign a manager to a venue
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { venue_id, manager_id, notes } = body;

    // Validation
    if (!venue_id || !manager_id) {
      return NextResponse.json({
        error: 'Missing required fields: venue_id, manager_id'
      }, { status: 400 });
    }

    // Verify manager exists and has manager role - use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const { data: managerData, error: managerError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', manager_id)
      .single();

    if (managerError || !managerData) {
      console.error('[VENUE_MANAGERS] Manager lookup error:', managerError);
      return NextResponse.json({
        error: 'Manager user not found'
      }, { status: 404 });
    }

    if (managerData.role !== 'manager') {
      return NextResponse.json({
        error: 'User must have manager role'
      }, { status: 400 });
    }

    // Insert or update assignment - use admin client to bypass RLS
    const { data: assignment, error: insertError } = await supabaseAdmin
      .from('venue_managers')
      .upsert({
        venue_id,
        manager_id,
        assigned_by: user.id,
        is_active: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'venue_id,manager_id'
      })
      .select()
      .single();

    if (insertError) {
      console.error('[VENUE_MANAGERS] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to assign manager' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Manager assigned successfully',
      assignment
    }, { status: 201 });
  } catch (err: any) {
    console.error('[VENUE_MANAGERS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Remove a manager assignment
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Get assignment ID from search params
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Assignment ID is required' }, { status: 400 });
    }

    // Delete assignment
    const { error: deleteError } = await supabase
      .from('venue_managers')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('[VENUE_MANAGERS] Delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to remove assignment' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Assignment removed successfully' }, { status: 200 });
  } catch (err: any) {
    console.error('[VENUE_MANAGERS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Update assignment (e.g., toggle active status)
export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { id, is_active, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Assignment ID is required' }, { status: 400 });
    }

    // Update assignment
    const updateData: any = { updated_at: new Date().toISOString() };
    if (typeof is_active !== 'undefined') updateData.is_active = is_active;
    if (typeof notes !== 'undefined') updateData.notes = notes;

    const { data: updatedAssignment, error: updateError } = await supabase
      .from('venue_managers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[VENUE_MANAGERS] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Assignment updated successfully',
      assignment: updatedAssignment
    }, { status: 200 });
  } catch (err: any) {
    console.error('[VENUE_MANAGERS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
