import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// POST: Delete vendor_onboarding_status record for a user (allows them to re-edit onboarding)
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
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Invalid request: userId is required' }, { status: 400 });
    }

    // Use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Get the profile_id for this user
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('[RESET-ONBOARDING] Error fetching profile:', profileError);
      return NextResponse.json({ error: 'Profile not found for user' }, { status: 404 });
    }

    // Delete the vendor_onboarding_status record
    const { error: deleteError } = await supabaseAdmin
      .from('vendor_onboarding_status')
      .delete()
      .eq('profile_id', profile.id);

    if (deleteError) {
      console.error('[RESET-ONBOARDING] Error deleting onboarding record:', deleteError);
      return NextResponse.json({ error: 'Failed to delete onboarding record' }, { status: 500 });
    }

    // Clear the submission marker so the user is no longer treated as "submitted".
    const { error: clearProfileError } = await supabaseAdmin
      .from('profiles')
      .update({ onboarding_completed_at: null })
      .eq('id', profile.id);

    if (clearProfileError) {
      console.error('[RESET-ONBOARDING] Error clearing onboarding_completed_at:', clearProfileError);
      return NextResponse.json({ error: 'Failed to clear onboarding submission marker' }, { status: 500 });
    }

    console.log('[RESET-ONBOARDING] Successfully deleted onboarding record:', {
      userId,
      profileId: profile.id,
      deletedBy: user.id
    });

    return NextResponse.json({
      success: true,
      message: 'Onboarding record deleted. User can now re-edit their onboarding forms.'
    }, { status: 200 });
  } catch (err: any) {
    console.error('[RESET-ONBOARDING] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
