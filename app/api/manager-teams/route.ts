import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';
import { logUserEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const isValidUUID = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/**
 * Helper: authenticate and verify exec/admin role
 */
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
 * GET /api/manager-teams?manager_id=xxx
 * Get team members for a specific manager, or all teams if no manager_id
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const managerId = searchParams.get('manager_id');

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    let query = supabaseAdmin
      .from('manager_team_members')
      .select(`
        id,
        manager_id,
        member_id,
        is_active,
        assigned_at,
        notes
      `)
      .eq('is_active', true);

    if (managerId) {
      query = query.eq('manager_id', managerId);
    }

    const { data: assignments, error: assignError } = await query;

    if (assignError) {
      console.error('[MANAGER-TEAMS] Error fetching assignments:', assignError);
      return NextResponse.json({ error: 'Failed to fetch team assignments' }, { status: 500 });
    }

    // Get member details for all assigned members
    const memberIds = (assignments || []).map((a: any) => a.member_id);

    let members: any[] = [];
    if (memberIds.length > 0) {
      const { data: memberData, error: memberError } = await supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          role,
          division,
          profiles!inner(first_name, last_name)
        `)
        .in('id', memberIds);

      if (memberError) {
        console.error('[MANAGER-TEAMS] Error fetching member details:', memberError);
      } else {
        members = (memberData || []).map((u: any) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          division: u.division,
          first_name: safeDecrypt(u.profiles.first_name),
          last_name: safeDecrypt(u.profiles.last_name),
        }));
      }
    }

    // Merge assignment info with member details
    const teamMembers = (assignments || []).map((a: any) => {
      const member = members.find((m: any) => m.id === a.member_id);
      return {
        assignment_id: a.id,
        manager_id: a.manager_id,
        member_id: a.member_id,
        assigned_at: a.assigned_at,
        notes: a.notes,
        member: member || null,
      };
    });

    return NextResponse.json({ teamMembers }, { status: 200 });
  } catch (err: any) {
    console.error('[MANAGER-TEAMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/manager-teams
 * Assign a member to a manager's team
 * Body: { managerId, memberId, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { managerId, memberId, notes } = body;

    if (!managerId || !isValidUUID(managerId)) {
      return NextResponse.json({ error: 'Valid manager ID is required' }, { status: 400 });
    }
    if (!memberId || !isValidUUID(memberId)) {
      return NextResponse.json({ error: 'Valid member ID is required' }, { status: 400 });
    }
    if (managerId === memberId) {
      return NextResponse.json({ error: 'Cannot assign a manager to their own team' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Verify manager exists and has manager/exec role
    const { data: manager, error: managerError } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', managerId)
      .single();

    if (managerError || !manager) {
      return NextResponse.json({ error: 'Manager not found' }, { status: 404 });
    }
    if (!['manager', 'exec'].includes(manager.role)) {
      return NextResponse.json({ error: 'Target user is not a manager or exec' }, { status: 400 });
    }

    // Verify member exists
    const { data: member, error: memberError } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', memberId)
      .single();

    if (memberError || !member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Upsert: if already exists but inactive, reactivate; if new, insert
    const { data: existing } = await supabaseAdmin
      .from('manager_team_members')
      .select('id, is_active')
      .eq('manager_id', managerId)
      .eq('member_id', memberId)
      .maybeSingle();

    let result;
    if (existing) {
      if (existing.is_active) {
        return NextResponse.json({ error: 'This user is already on this manager\'s team' }, { status: 400 });
      }
      // Reactivate
      const { data, error } = await supabaseAdmin
        .from('manager_team_members')
        .update({
          is_active: true,
          assigned_by: auth.user!.id,
          assigned_at: new Date().toISOString(),
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      result = { data, error };
    } else {
      const { data, error } = await supabaseAdmin
        .from('manager_team_members')
        .insert({
          manager_id: managerId,
          member_id: memberId,
          assigned_by: auth.user!.id,
          notes: notes || null,
        })
        .select()
        .single();
      result = { data, error };
    }

    if (result.error) {
      console.error('[MANAGER-TEAMS] Error assigning member:', result.error);
      return NextResponse.json({ error: 'Failed to assign member to team' }, { status: 500 });
    }

    await logUserEvent('user_updated', memberId, auth.user!.id, true, {
      action: 'assigned_to_manager_team',
      managerId,
      memberId,
      memberRole: member.role,
    });

    return NextResponse.json({
      success: true,
      message: 'Member assigned to team',
      assignment: result.data,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[MANAGER-TEAMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/manager-teams
 * Remove a member from a manager's team (soft delete)
 * Body: { assignmentId }
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateExecAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { assignmentId } = body;

    if (!assignmentId || !isValidUUID(assignmentId)) {
      return NextResponse.json({ error: 'Valid assignment ID is required' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Get assignment details for audit log
    const { data: assignment, error: fetchError } = await supabaseAdmin
      .from('manager_team_members')
      .select('id, manager_id, member_id')
      .eq('id', assignmentId)
      .single();

    if (fetchError || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const { error: updateError } = await supabaseAdmin
      .from('manager_team_members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', assignmentId);

    if (updateError) {
      console.error('[MANAGER-TEAMS] Error removing member:', updateError);
      return NextResponse.json({ error: 'Failed to remove member from team' }, { status: 500 });
    }

    await logUserEvent('user_updated', assignment.member_id, auth.user!.id, true, {
      action: 'removed_from_manager_team',
      managerId: assignment.manager_id,
      memberId: assignment.member_id,
    });

    return NextResponse.json({ success: true, message: 'Member removed from team' }, { status: 200 });
  } catch (err: any) {
    console.error('[MANAGER-TEAMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
