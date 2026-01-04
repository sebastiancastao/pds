import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/auth/check-onboarding
 * Checks if a user's onboarding has been approved in vendor_onboarding_status table
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Check Onboarding API] Request received');

    // Get authenticated user - try from cookies first
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header if no cookie session
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

      if (token) {
        console.log('[Check Onboarding API] No cookie session, trying token auth');
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      console.log('[Check Onboarding API] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('[Check Onboarding API] Checking onboarding for user:', user.id);

    // Use admin client to bypass RLS
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get profile ID from user ID
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[Check Onboarding API] Error fetching profile:', profileError);
      return NextResponse.json({
        approved: false,
        error: 'Profile not found'
      }, { status: 200 });
    }

    console.log('[Check Onboarding API] Profile ID:', profile.id);

    // Get onboarding_completed_at from profiles table
    const { data: profileWithOnboarding, error: onboardingAtError } = await adminClient
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', profile.id)
      .single();

    if (onboardingAtError) {
      console.error('[Check Onboarding API] Error fetching onboarding_completed_at:', onboardingAtError);
    }

    const hasSubmittedPDF = !!profileWithOnboarding?.onboarding_completed_at;
    console.log('[Check Onboarding API] onboarding_completed_at:', profileWithOnboarding?.onboarding_completed_at);
    console.log('[Check Onboarding API] hasSubmittedPDF:', hasSubmittedPDF);

    // Check vendor_onboarding_status table
    const { data: onboardingStatus, error: onboardingError } = await adminClient
      .from('vendor_onboarding_status')
      .select('onboarding_completed, completed_date')
      .eq('profile_id', profile.id)
      .single();

    if (onboardingError) {
      // No record found means onboarding not started/approved
      console.log('[Check Onboarding API] No onboarding record found (not approved)');
      return NextResponse.json({
        approved: false,
        hasSubmittedPDF: hasSubmittedPDF,
        pdfSubmittedAt: profileWithOnboarding?.onboarding_completed_at || null,
        message: 'Onboarding not completed'
      }, { status: 200 });
    }

    const isApproved = onboardingStatus?.onboarding_completed || false;
    console.log('[Check Onboarding API] Onboarding completed:', isApproved);

    return NextResponse.json({
      approved: isApproved,
      hasSubmittedPDF: hasSubmittedPDF,
      pdfSubmittedAt: profileWithOnboarding?.onboarding_completed_at || null,
      completedDate: onboardingStatus?.completed_date || null
    }, { status: 200 });

  } catch (err: any) {
    console.error('[Check Onboarding API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error', approved: false },
      { status: 500 }
    );
  }
}
