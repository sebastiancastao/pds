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

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

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

    const { data: userProfile, error: profileError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !userProfile) {
      return NextResponse.json({ error: 'Failed to verify user role' }, { status: 500 });
    }

    if (userProfile.role !== 'hr' && userProfile.role !== 'exec' && userProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - HR/Admin/Exec access required' }, { status: 403 });
    }

    console.log('[ACTIVATE] Activating user:', employeeId);

    const { error: updateError } = await adminClient
      .from('users')
      .update({
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', employeeId);

    if (updateError) {
      console.error('[ACTIVATE] Error updating profile:', updateError);
      return NextResponse.json({ error: 'Failed to activate user' }, { status: 500 });
    }

    console.log('[ACTIVATE] User activated successfully');

    return NextResponse.json({
      success: true,
      message: 'User activated successfully'
    });
  } catch (error: any) {
    console.error('[ACTIVATE] Error:', error);
    return NextResponse.json({
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
