import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

    // Create auth client for user authentication
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    // Use admin client for operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is authenticated and has HR role
    let user;
    if (token) {
      const { data: { user: tokenUser }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !tokenUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      user = tokenUser;
    } else {
      const { data: { user: cookieUser } } = await supabase.auth.getUser();
      if (!cookieUser) {
        return NextResponse.json({ error: 'No authorization token' }, { status: 401 });
      }
      user = cookieUser;
    }

    // Check if user has HR role using admin client
    const { data: userProfile, error: profileError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 500 });
    }

    if (userProfile.role !== 'hr' && userProfile.role !== 'exec') {
      return NextResponse.json({ error: 'Forbidden - HR/Exec access required' }, { status: 403 });
    }

    console.log('[DEACTIVATE] Deactivating user:', employeeId);

    // Update user is_active status to false
    const { error: updateError } = await adminClient
      .from('users')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', employeeId);

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
