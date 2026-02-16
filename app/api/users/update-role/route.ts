import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logUserEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ALLOWED_ROLES = ['worker', 'supervisor', 'supervisor2', 'manager', 'finance', 'exec', 'hr', 'backgroundchecker'];

const isValidUUID = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

// PUT: Update a user's role
export async function PUT(request: NextRequest) {
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

    // Verify requester identity
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify requester is exec/admin
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
    const { userId, newRole } = body;

    // Validate userId
    if (!userId || typeof userId !== 'string' || !isValidUUID(userId)) {
      return NextResponse.json({ error: 'Valid user ID is required' }, { status: 400 });
    }

    // Validate newRole
    if (!newRole || !ALLOWED_ROLES.includes(newRole)) {
      return NextResponse.json(
        { error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    // Prevent self-role-change
    if (userId === user.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    // Use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Get target user's current role
    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select('id, email, role')
      .eq('id', userId)
      .single();

    if (targetError || !targetUser) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    const oldRole = targetUser.role;

    if (oldRole === newRole) {
      return NextResponse.json({ error: 'New role is the same as current role' }, { status: 400 });
    }

    // Update the role
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, role')
      .single();

    if (updateError) {
      console.error('[UPDATE-ROLE] Error updating user role:', updateError);
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }

    // Log audit event
    await logUserEvent(
      'user_updated',
      userId,
      user.id,
      true,
      {
        action: 'role_changed',
        oldRole,
        newRole,
        targetEmail: targetUser.email,
      }
    );

    console.log('[UPDATE-ROLE] Successfully updated role:', {
      targetUserId: userId,
      oldRole,
      newRole,
      updatedBy: user.id,
    });

    return NextResponse.json({
      success: true,
      message: `Role updated from ${oldRole} to ${newRole}`,
      user: { id: updatedUser.id, role: updatedUser.role },
    }, { status: 200 });
  } catch (err: any) {
    console.error('[UPDATE-ROLE] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
