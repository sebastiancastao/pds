import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Define the order of onboarding forms for California (most common)
const CA_ONBOARDING_FORMS = [
  'employee-information',
  'ca-de4',
  'fw4',
  'i9',
  'adp-deposit',
  'ui-guide',
  'disability-insurance',
  'paid-family-leave',
  'sexual-harassment',
  'survivors-rights',
  'transgender-rights',
  'health-insurance',
  'time-of-hire',
  'discrimination-law',
  'immigration-rights',
  'military-rights',
  'lgbtq-rights',
  'meal-waiver-6hour',
  'meal-waiver-10-12'
];

// Define the order for other states (simplified - you can expand these)
const NY_ONBOARDING_FORMS = [
  'employee-information',
  'ny-state-tax',
  'fw4',
  'i9',
  'meal-waiver-6hour',
  'meal-waiver-10-12'
];

const WI_ONBOARDING_FORMS = [
  'employee-information',
  'wi-state-tax',
  'fw4',
  'i9',
  'meal-waiver-6hour',
  'meal-waiver-10-12'
];

const AZ_ONBOARDING_FORMS = [
  'employee-information',
  'az-state-tax',
  'fw4',
  'i9',
  'meal-waiver-6hour',
  'meal-waiver-10-12'
];

const NV_ONBOARDING_FORMS = [
  'employee-information',
  'fw4',
  'i9',
  'meal-waiver-6hour',
  'meal-waiver-10-12'
];

// Pre-registration onboarding stages (before PDF forms)
const PRE_REGISTRATION_STAGES: Record<string, string> = {
  'onboarding-mfa-setup': '/mfa-setup',
  'onboarding-register': '/register',
};

/**
 * POST /api/auth/check-onboarding-stage
 * Determines which onboarding stage a worker is currently at based on their completed forms
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Check Onboarding Stage API] Request received');

    // Get authenticated user - try from cookies first
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header if no cookie session
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

      if (token) {
        console.log('[Check Onboarding Stage API] No cookie session, trying token auth');
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      console.log('[Check Onboarding Stage API] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    console.log('[Check Onboarding Stage API] Checking onboarding stage for user:', user.id);

    // Use admin client to bypass RLS
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get profile ID and check if user has completed registration
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, state, first_name, last_name, address')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('[Check Onboarding Stage API] Error fetching profile:', profileError);
      return NextResponse.json({
        error: 'Profile not found',
        nextStage: '/register' // Send to register if no profile
      }, { status: 200 });
    }

    console.log('[Check Onboarding Stage API] Profile ID:', profile.id);
    console.log('[Check Onboarding Stage API] User state:', profile.state);

    // Check if user has completed basic registration (required fields)
    const hasCompletedRegistration = profile.first_name && profile.last_name && profile.address && profile.state;
    console.log('[Check Onboarding Stage API] Has completed registration:', hasCompletedRegistration);
    console.log('[Check Onboarding Stage API] Profile data:', {
      first_name: !!profile.first_name,
      last_name: !!profile.last_name,
      address: !!profile.address,
      state: profile.state
    });

    if (!hasCompletedRegistration) {
      console.log('[Check Onboarding Stage API] ========================================');
      console.log('[Check Onboarding Stage API] ⚠️ USER HAS NOT COMPLETED REGISTRATION');
      console.log('[Check Onboarding Stage API] Redirecting to /register to complete profile');
      console.log('[Check Onboarding Stage API] ========================================');
      return NextResponse.json({
        nextStage: '/register',
        completedCount: 0,
        totalCount: 0,
        percentComplete: 0,
        needsRegistration: true
      }, { status: 200 });
    }

    console.log('[Check Onboarding Stage API] ✅ User has completed registration');

    // Determine which form sequence to use based on user's state
    let formSequence = CA_ONBOARDING_FORMS;
    let statePrefix = 'ca';

    console.log('[Check Onboarding Stage API] Determining form sequence based on state...');
    if (profile.state) {
      const stateLower = profile.state.toLowerCase();
      console.log('[Check Onboarding Stage API] State (lowercase):', stateLower);
      if (stateLower === 'ny' || stateLower === 'new york') {
        formSequence = NY_ONBOARDING_FORMS;
        statePrefix = 'ny';
      } else if (stateLower === 'wi' || stateLower === 'wisconsin') {
        formSequence = WI_ONBOARDING_FORMS;
        statePrefix = 'wi';
      } else if (stateLower === 'az' || stateLower === 'arizona') {
        formSequence = AZ_ONBOARDING_FORMS;
        statePrefix = 'az';
      } else if (stateLower === 'nv' || stateLower === 'nevada') {
        formSequence = NV_ONBOARDING_FORMS;
        statePrefix = 'nv';
      }
    }

    console.log('[Check Onboarding Stage API] Selected state prefix:', statePrefix);
    console.log('[Check Onboarding Stage API] Form sequence length:', formSequence.length);
    console.log('[Check Onboarding Stage API] Form sequence:', formSequence);

    // Get all completed forms for this user
    console.log('[Check Onboarding Stage API] 🔍 Fetching completed forms from pdf_form_progress...');
    const { data: completedForms, error: formsError } = await adminClient
      .from('pdf_form_progress')
      .select('form_name, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (formsError) {
      console.error('[Check Onboarding Stage API] ❌ Error fetching completed forms:', formsError);
      return NextResponse.json({
        error: 'Could not fetch completed forms',
        nextStage: `/payroll-packet-${statePrefix}/employee-information`
      }, { status: 200 });
    }

    console.log('[Check Onboarding Stage API] ✅ Raw completed forms data:', completedForms);
    console.log('[Check Onboarding Stage API] Number of completed forms:', completedForms?.length || 0);

    // Check for pre-registration stages first (mfa-setup, register)
    // These take priority over PDF forms if they're the most recent
    if (completedForms && completedForms.length > 0) {
      const mostRecentEntry = completedForms[0]; // Already sorted by updated_at DESC
      const preRegStage = PRE_REGISTRATION_STAGES[mostRecentEntry.form_name];

      if (preRegStage) {
        console.log('[Check Onboarding Stage API] ========================================');
        console.log('[Check Onboarding Stage API] ⭐ PRE-REGISTRATION STAGE DETECTED');
        console.log('[Check Onboarding Stage API] Stage:', mostRecentEntry.form_name);
        console.log('[Check Onboarding Stage API] Redirect path:', preRegStage);
        console.log('[Check Onboarding Stage API] Last updated:', mostRecentEntry.updated_at);
        console.log('[Check Onboarding Stage API] ========================================');

        return NextResponse.json({
          nextStage: preRegStage,
          completedCount: 0,
          totalCount: 0,
          percentComplete: 0,
          isPreRegistration: true
        }, { status: 200 });
      }
    }

    // Log each raw form name from database
    console.log('[Check Onboarding Stage API] ===== RAW FORM NAMES FROM DATABASE =====');
    (completedForms || []).forEach((f, index) => {
      console.log(`[Check Onboarding Stage API] DB Form ${index + 1}: "${f.form_name}" (updated: ${f.updated_at})`);
    });

    const completedFormNames = new Set(
      (completedForms || [])
        .filter(f => !PRE_REGISTRATION_STAGES[f.form_name]) // Exclude pre-registration stages
        .map(f => {
          // Normalize form names - remove state prefix if present
          const formName = f.form_name.toLowerCase();
          // Remove state prefixes like 'ca-', 'ny-', etc.
          const normalized = formName.replace(/^(ca|ny|wi|az|nv)-/, '');
          console.log('[Check Onboarding Stage API] Normalizing form:', f.form_name, '→', normalized);
          return normalized;
        })
    );

    console.log('[Check Onboarding Stage API] ===== COMPLETED FORMS =====');
    console.log('[Check Onboarding Stage API] Normalized completed forms:', Array.from(completedFormNames));
    console.log('[Check Onboarding Stage API] Total completed:', completedFormNames.size);

    // Special case: If no forms completed at all, send to landing page
    if (completedFormNames.size === 0) {
      const landingPage = `/payroll-packet-${statePrefix}`;
      console.log('[Check Onboarding Stage API] ========================================');
      console.log('[Check Onboarding Stage API] ⭐ NO FORMS COMPLETED - SENDING TO LANDING PAGE');
      console.log('[Check Onboarding Stage API] Landing page:', landingPage);
      console.log('[Check Onboarding Stage API] Progress: 0/19 (0%)');
      console.log('[Check Onboarding Stage API] ========================================');
      return NextResponse.json({
        nextStage: landingPage,
        completedCount: 0,
        totalCount: formSequence.length,
        percentComplete: 0
      }, { status: 200 });
    }

    // Check if all forms in the sequence are completed
    const allFormsCompleted = formSequence.every(formName => completedFormNames.has(formName));

    if (allFormsCompleted) {
      console.log('[Check Onboarding Stage API] ===== ALL FORMS COMPLETED =====');
      console.log('[Check Onboarding Stage API] All', formSequence.length, 'forms in sequence are completed');
      console.log('[Check Onboarding Stage API] Checking if admin has approved onboarding...');

      // Check if onboarding has been approved
      const { data: onboardingStatus, error: statusError } = await adminClient
        .from('vendor_onboarding_status')
        .select('onboarding_completed, completed_date')
        .eq('profile_id', profile.id)
        .single();

      if (statusError) {
        console.log('[Check Onboarding Stage API] ⚠️ Error or no record in vendor_onboarding_status:', statusError.message);
        console.log('[Check Onboarding Stage API] This likely means onboarding has NOT been approved yet');
      } else {
        console.log('[Check Onboarding Stage API] ✅ Found vendor_onboarding_status record:', onboardingStatus);
      }

      if (onboardingStatus?.onboarding_completed) {
        console.log('[Check Onboarding Stage API] ========================================');
        console.log('[Check Onboarding Stage API] ✅ ONBOARDING APPROVED BY ADMIN');
        console.log('[Check Onboarding Stage API] Completed date:', onboardingStatus.completed_date);
        console.log('[Check Onboarding Stage API] Returning: nextStage = null (fully onboarded)');
        console.log('[Check Onboarding Stage API] ========================================');
        return NextResponse.json({
          nextStage: null, // No more stages - fully onboarded
          completedCount: completedFormNames.size,
          totalCount: formSequence.length,
          percentComplete: 100,
          approved: true
        }, { status: 200 });
      }

      // Forms completed but not approved - redirect to pending page
      console.log('[Check Onboarding Stage API] ========================================');
      console.log('[Check Onboarding Stage API] ⚠️ FORMS COMPLETED BUT NOT APPROVED');
      console.log('[Check Onboarding Stage API] User has completed all forms but admin has not approved');
      console.log('[Check Onboarding Stage API] Returning: nextStage = /onboarding-pending');
      console.log('[Check Onboarding Stage API] ========================================');
      return NextResponse.json({
        nextStage: '/onboarding-pending',
        completedCount: completedFormNames.size,
        totalCount: formSequence.length,
        percentComplete: 100,
        approved: false
      }, { status: 200 });
    }

    // Not all forms completed - redirect to most recently updated form
    console.log('[Check Onboarding Stage API] ===== FINDING MOST RECENT FORM =====');
    let mostRecentForm = completedForms[0];
    for (const form of completedForms) {
      if (new Date(form.updated_at) > new Date(mostRecentForm.updated_at)) {
        mostRecentForm = form;
      }
    }

    // Normalize the most recent form name (remove state prefix)
    const recentFormName = mostRecentForm.form_name.toLowerCase().replace(/^(ca|ny|wi|az|nv)-/, '');

    // Build the correct URL based on state
    // California uses base form-viewer for DE-4; other states use form-viewer with query param
    let nextStage: string;
    if (statePrefix === 'ca') {
      // de4 is the first form; background check forms are not part of form-viewer.
      // If the last form is a background check form, redirect to the first CA form
      if (recentFormName === 'de4' || recentFormName === 'state-tax' || recentFormName === 'background-disclosure' || recentFormName === 'background-waiver' || recentFormName === 'background-addon') {
        nextStage = `/payroll-packet-ca/form-viewer`;
      } else {
        nextStage = `/payroll-packet-ca/form-viewer?form=${recentFormName}`;
      }
    } else {
      nextStage = `/payroll-packet-${statePrefix}/form-viewer?form=${recentFormName}`;
    }

    console.log('[Check Onboarding Stage API] ========================================');
    console.log('[Check Onboarding Stage API] ⭐ MOST RECENTLY UPDATED FORM');
    console.log('[Check Onboarding Stage API] Form:', mostRecentForm.form_name);
    console.log('[Check Onboarding Stage API] Last updated:', mostRecentForm.updated_at);
    console.log('[Check Onboarding Stage API] State prefix:', statePrefix);
    console.log('[Check Onboarding Stage API] Next stage:', nextStage);
    console.log('[Check Onboarding Stage API] Progress:', `${completedFormNames.size}/${formSequence.length} (${Math.round((completedFormNames.size / formSequence.length) * 100)}%)`);
    console.log('[Check Onboarding Stage API] ========================================');

    return NextResponse.json({
      nextStage,
      completedCount: completedFormNames.size,
      totalCount: formSequence.length,
      percentComplete: Math.round((completedFormNames.size / formSequence.length) * 100)
    }, { status: 200 });

  } catch (err: any) {
    console.error('[Check Onboarding Stage API] Error:', err);
    return NextResponse.json(
      {
        error: err?.message || 'Server error',
        nextStage: '/payroll-packet-ca/employee-information' // Default fallback
      },
      { status: 500 }
    );
  }
}
