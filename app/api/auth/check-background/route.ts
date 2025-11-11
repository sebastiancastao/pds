import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

/**
 * POST /api/auth/check-background
 * Check if worker's background check is approved
 * Uses service role to bypass RLS
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No authorization header' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase with service role (bypasses RLS)
    const supabase = createServerClient();

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    console.log('[BG CHECK API] Checking background check for user:', user.id);

    // Get profile data including onboarding status (bypasses RLS since we're using service role)
    const profileResult = await supabase
      .from('profiles')
      .select('id, onboarding_completed_at, state, address')
      .eq('user_id', user.id)
      .single();

    if (profileResult.error) {
      console.error('[BG CHECK API] Profile query error:', profileResult.error);
      return NextResponse.json({
        approved: false,
        message: 'Profile not found'
      }, { status: 200 });
    }

    if (!profileResult.data) {
      console.error('[BG CHECK API] Profile not found');
      return NextResponse.json({
        approved: false,
        message: 'Profile not found'
      }, { status: 200 });
    }

    const profileData = profileResult.data;

    console.log('[BG CHECK API] Profile ID:', profileData.id);
    console.log('[BG CHECK API] Onboarding completed:', profileData.onboarding_completed_at);
    console.log('[BG CHECK API] State:', profileData.state);

    // Check vendor_background_checks table
    const { data: bgCheckData, error: bgCheckError } = await supabase
      .from('vendor_background_checks')
      .select('background_check_completed, completed_date, notes')
      .eq('profile_id', profileData.id)
      .single();

    if (bgCheckError) {
      console.log('[BG CHECK API] No background check record:', bgCheckError.message);
      return NextResponse.json({
        approved: false,
        message: 'No background check record found'
      }, { status: 200 });
    }

    console.log('[BG CHECK API] Background check data:', bgCheckData);

    const isApproved = bgCheckData?.background_check_completed === true;

    // Check onboarding status
    const onboardingCompleted = !!profileData.onboarding_completed_at;

    // Determine onboarding redirect path
    let onboardingRedirect = null;
    if (!onboardingCompleted) {
      // Check if they have an address (completed /register)
      if (profileData.address) {
        // They've completed register - redirect to payroll packet for their state
        const userState = profileData.state?.toLowerCase() || 'ny';
        onboardingRedirect = `/payroll-packet-${userState}`;
        console.log('[BG CHECK API] User has address, redirect to:', onboardingRedirect);
      } else {
        // They haven't completed register - redirect to register
        onboardingRedirect = '/register';
        console.log('[BG CHECK API] User needs to complete registration at /register');
      }
    }

    return NextResponse.json({
      approved: isApproved,
      completedDate: bgCheckData?.completed_date,
      notes: bgCheckData?.notes,
      message: isApproved ? 'Background check approved' : 'Background check pending',
      onboardingCompleted,
      onboardingRedirect
    }, { status: 200 });

  } catch (error: any) {
    console.error('[BG CHECK API] Error:', error);
    return NextResponse.json({
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
