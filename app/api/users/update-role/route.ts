import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logUserEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const ALLOWED_ROLES = ['employee', 'worker', 'supervisor', 'supervisor2', 'supervisor3', 'manager', 'finance', 'exec', 'hr', 'backgroundchecker'];
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
};

const isValidUUID = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// PUT: Update a user's role
//
// Round trips are batched: the requester check and both target lookups run in
// parallel, and the auth-metadata sync and audit log run in parallel after the
// update. Previously all seven calls ran one after another.
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

    // Use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Verify requester identity and parse the body at the same time
    const [authResult, body] = await Promise.all([
      supabase.auth.getUser(token),
      request.json().catch(() => ({})),
    ]);
    const user = authResult.data?.user;
    if (authResult.error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { userId, newRole } = body || {};
    const userIdValid = !!userId && typeof userId === 'string' && isValidUUID(userId);

    // Requester role check + target lookups in parallel
    const [requesterResult, targetResult, targetAuthResult] = await Promise.all([
      supabase.from('users').select('role').eq('id', user.id).single(),
      userIdValid
        ? supabaseAdmin.from('users').select('id, email, role').eq('id', userId).single()
        : Promise.resolve({ data: null, error: null } as const),
      userIdValid && userId !== user.id
        ? supabaseAdmin.auth.admin.getUserById(userId)
        : Promise.resolve({ data: { user: null }, error: null } as const),
    ]);

    const userData = requesterResult.data as { role: string } | null;
    if (requesterResult.error || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Validate userId
    if (!userIdValid) {
      console.error('[UPDATE-ROLE] Invalid userId received:', { userId, body });
      return NextResponse.json({ error: 'Valid user ID is required' }, { status: 400 });
    }

    // Validate newRole
    if (!newRole || !ALLOWED_ROLES.includes(newRole)) {
      console.error('[UPDATE-ROLE] Invalid role received:', { newRole, body });
      return NextResponse.json(
        { error: `Invalid role. Allowed: ${ALLOWED_ROLES.join(', ')}` },
        { status: 400 }
      );
    }

    // Prevent self-role-change
    if (userId === user.id) {
      console.warn('[UPDATE-ROLE] Attempted self-role-change by:', user.id);
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    const targetUser = targetResult.data as { id: string; email: string; role: string } | null;
    if (targetResult.error || !targetUser) {
      return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Ensure target user exists in Supabase Auth so metadata can stay in sync.
    const targetAuthUser = targetAuthResult.data?.user;
    if (targetAuthResult.error || !targetAuthUser) {
      console.error('[UPDATE-ROLE] Auth user lookup failed:', targetAuthResult.error);
      return NextResponse.json(
        { error: 'Target auth user not found. Role update aborted to avoid inconsistent data.' },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const oldRole = targetUser.role;

    if (oldRole === newRole) {
      console.log('[UPDATE-ROLE] Role already set, returning no-op success:', { userId, role: newRole });
      return NextResponse.json({
        success: true,
        message: `Role is already ${newRole}`,
        user: { id: targetUser.id, role: targetUser.role },
      }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // Update the role
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, role')
      .single();

    if (updateError || !updatedUser) {
      console.error('[UPDATE-ROLE] Error updating user role:', updateError);
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500, headers: NO_STORE_HEADERS });
    }

    // Keep auth user metadata role in sync with public.users role, and write the
    // audit log, in parallel.
    const mergedUserMetadata = {
      ...(targetAuthUser.user_metadata || {}),
      role: newRole,
    };

    const [authUpdateResult] = await Promise.all([
      supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: mergedUserMetadata }),
      logUserEvent(
        'user_updated',
        userId,
        user.id,
        true,
        {
          action: 'role_changed',
          oldRole,
          newRole,
          targetEmail: targetUser.email,
          authMetadataUpdated: true,
        }
      ),
    ]);

    if (authUpdateResult.error) {
      // Auth metadata sync is best-effort — log the failure but do NOT roll back
      // the database change. public.users.role is the source of truth for access control.
      console.error('[UPDATE-ROLE] Warning: auth metadata sync failed (non-fatal):', authUpdateResult.error);
    }

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
    }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[UPDATE-ROLE] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
