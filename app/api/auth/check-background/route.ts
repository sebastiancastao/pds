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
    type ProfileData = {
      id: string;
      onboarding_completed_at: string | null;
      state: string | null;
      address: string | null;
    };

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, onboarding_completed_at, state, address')
      .eq('user_id', user.id)
      .single<ProfileData>();

    if (profileError || !profileData) {
      console.error('[BG CHECK API] Profile not found:', profileError);
      return NextResponse.json({
        approved: false,
        message: 'Profile not found'
      }, { status: 200 });
    }

    console.log('[BG CHECK API] Profile ID:', profileData.id);
    console.log('[BG CHECK API] Onboarding completed:', profileData.onboarding_completed_at);
    console.log('[BG CHECK API] State:', profileData.state);

    // Check vendor_background_checks table
    type BgCheckData = {
      background_check_completed: boolean | null;
      completed_date: string | null;
      notes: string | null;
    };

    const { data: rawBgCheckData, error: bgCheckError } = await supabase
      .from('vendor_background_checks')
      .select('background_check_completed, completed_date, notes')
      .eq('profile_id', profileData.id)
      .maybeSingle<BgCheckData>();

    if (bgCheckError) {
      console.log('[BG CHECK API] Error reading vendor_background_checks row:', bgCheckError.message);
    }

    let bgCheckData = rawBgCheckData;

    if (!bgCheckData) {
      console.log('[BG CHECK API] vendor_background_checks entry missing; creating fallback record');
      const { data: insertedBgCheck, error: insertError } = await supabase
        .from('vendor_background_checks')
        .upsert({
          profile_id: profileData.id,
          background_check_completed: false,
          completed_date: null,
          notes: null,
        }, { onConflict: 'profile_id' })
        .select('background_check_completed, completed_date, notes')
        .maybeSingle<BgCheckData>();

      if (insertError) {
        console.error('[BG CHECK API] Failed to insert fallback vendor_background_checks row:', insertError);
      } else {
        bgCheckData = insertedBgCheck;
      }
    }

    if (!bgCheckData) {
      bgCheckData = {
        background_check_completed: false,
        completed_date: null,
        notes: null,
      };
    }

    console.log('[BG CHECK API] Background check data:', bgCheckData);

    const isApproved = bgCheckData.background_check_completed === true;

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
