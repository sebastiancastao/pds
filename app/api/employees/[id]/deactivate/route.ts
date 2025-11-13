import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = params.id;

    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    // Get auth token
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    // Initialize Supabase with service role
    const supabase = createServerClient();

    // Verify user is authenticated and has HR role
    if (token) {
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Check if user has HR role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (profile?.role !== 'hr') {
        return NextResponse.json({ error: 'Forbidden - HR access required' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'No authorization token' }, { status: 401 });
    }

    console.log('[DEACTIVATE] Deactivating user:', employeeId);

    // Update profile status to inactive
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        status: 'inactive',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', employeeId);

    if (updateError) {
      console.error('[DEACTIVATE] Error updating profile:', updateError);
      return NextResponse.json({ error: 'Failed to deactivate user' }, { status: 500 });
    }

    console.log('[DEACTIVATE] User deactivated successfully');

    return NextResponse.json({
      success: true,
      message: 'User deactivated successfully'
    });

  } catch (error: any) {
    console.error('[DEACTIVATE] Error:', error);
    return NextResponse.json({
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
