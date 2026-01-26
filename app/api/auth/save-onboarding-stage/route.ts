import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

// Valid onboarding stages that can be saved
const VALID_ONBOARDING_STAGES = [
  'onboarding-mfa-setup',
  'onboarding-register',
];

/**
 * POST /api/auth/save-onboarding-stage
 * Saves the current onboarding stage to pdf_form_progress table
 * This allows users to be redirected back to their last stage on login
 */
export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user using route handler client
    const cookieStore = await cookies();
    let supabase = createRouteHandlerClient({ cookies: () => cookieStore });
    let { data: { user }, error: userError } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token> header for SSR/API contexts
    if (!user || !user.id) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        );
        const { data: tokenUser, error: tokenErr } = await supabase.auth.getUser();
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
          userError = null;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { stage } = body;

    if (!stage) {
      return NextResponse.json({ error: 'Missing stage parameter' }, { status: 400 });
    }

    // Validate stage is in allowed list
    if (!VALID_ONBOARDING_STAGES.includes(stage)) {
      return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
    }

    console.log('[Save Onboarding Stage] Saving stage:', stage, 'for user:', user.id);

    // Use admin client to bypass RLS for upsert
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Upsert the onboarding stage to pdf_form_progress
    // Using empty string for form_data since these are just stage markers
    const { data, error } = await adminClient
      .from('pdf_form_progress')
      .upsert({
        user_id: user.id,
        form_name: stage,
        form_data: '', // Empty data - just a stage marker
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,form_name'
      })
      .select();

    if (error) {
      console.error('[Save Onboarding Stage] Error saving stage:', error);
      return NextResponse.json({ error: 'Failed to save stage', details: error.message }, { status: 500 });
    }

    console.log('[Save Onboarding Stage] ✅ Stage saved successfully');

    return NextResponse.json({ success: true, message: 'Stage saved' }, { status: 200 });
  } catch (error: any) {
    console.error('[Save Onboarding Stage] Error:', error);
    return NextResponse.json({ error: 'Failed to save stage', details: error.message }, { status: 500 });
  }
}
