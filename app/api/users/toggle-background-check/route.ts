import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// POST: Toggle background check status for a user
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
    const { userId, status } = body;

    if (!userId || typeof status !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request: userId and status are required' }, { status: 400 });
    }

    // Use service role to bypass RLS and update the user
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const updateData: any = {
      background_check_completed: status,
    };

    // If setting to true, record the completion timestamp
    if (status) {
      updateData.background_check_completed_at = new Date().toISOString();
    }

    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('[TOGGLE-BACKGROUND-CHECK] Error updating user:', updateError);
      return NextResponse.json({ error: 'Failed to update background check status' }, { status: 500 });
    }

    console.log('[TOGGLE-BACKGROUND-CHECK] Successfully updated user:', {
      userId,
      newStatus: status,
      updatedBy: user.id
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: status
        ? 'Background check marked as completed (closed for editing)'
        : 'Background check opened for editing'
    }, { status: 200 });
  } catch (err: any) {
    console.error('[TOGGLE-BACKGROUND-CHECK] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
