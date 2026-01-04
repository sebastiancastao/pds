import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';
import { safeDecrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/onboarding
 * Returns list of all users with their onboarding status
 * Only accessible by admin, hr, or exec roles
 */
export async function GET(req: NextRequest) {
  try {
    console.log('[Onboarding API] GET request received');

    // Create auth client
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      console.log('[Onboarding API] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    console.log('[Onboarding API] User role check:', {
      userId: user.id,
      userData,
      userError,
      role: userData?.role
    });

    if (userError) {
      console.error('[Onboarding API] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
    const adminLikeRoles = ['admin', 'hr', 'exec'];
    const isAdminLike = adminLikeRoles.includes(normalizedRole);

    if (!isAdminLike) {
      console.log('[Onboarding API] Access denied for role:', normalizedRole);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: normalizedRole
      }, { status: 403 });
    }

    console.log('[Onboarding API] Access granted for role:', normalizedRole);

    // Fetch all profiles with their users data
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(`
        id,
        user_id,
        first_name,
        last_name,
        phone,
        created_at,
        onboarding_completed_at,
        users!inner (
          id,
          email,
          role,
          is_temporary_password,
          must_change_password,
          background_check_completed
        )
      `);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return NextResponse.json({
        error: 'Failed to fetch users',
        details: profilesError.message
      }, { status: 500 });
    }

    // Fetch all onboarding statuses
    const { data: onboardingData, error: onboardingError } = await adminClient
      .from('vendor_onboarding_status')
      .select('*');

    if (onboardingError) {
      console.error('Error fetching onboarding data:', onboardingError);
    }

    // Transform the data
    const users = (profiles || []).map((profile: any) => {
      const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;

      // Find onboarding status for this profile
      const onboardingStatus = (onboardingData || []).find((status: any) => status.profile_id === profile.id);

      // Safely decrypt names
      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';

      // Determine if PDF was submitted based on onboarding_completed_at field
      const hasSubmittedPdf = !!profile?.onboarding_completed_at;
      const pdfSubmittedAt = profile?.onboarding_completed_at || null;

      return {
        id: profile.id,
        user_id: profile.user_id,
        full_name: fullName,
        email: userObj?.email || 'N/A',
        role: userObj?.role || 'vendor',
        phone: profile?.phone,
        created_at: profile?.created_at,
        is_temporary_password: userObj?.is_temporary_password || false,
        must_change_password: userObj?.must_change_password || false,
        has_temporary_password: userObj?.is_temporary_password || false,
        onboarding_completed_user_table: false, // Can add this to users table if needed
        background_check_completed: userObj?.background_check_completed || false,
        onboarding_status: onboardingStatus ? {
          id: onboardingStatus.id,
          onboarding_completed: onboardingStatus.onboarding_completed,
          completed_date: onboardingStatus.completed_date,
          notes: onboardingStatus.notes,
          updated_at: onboardingStatus.updated_at,
        } : null,
        has_submitted_pdf: hasSubmittedPdf,
        pdf_submitted_at: pdfSubmittedAt,
        pdf_latest_update: pdfSubmittedAt,
      };
    });

    console.log('[Onboarding API] Returning', users.length, 'users');

    return NextResponse.json({ users }, { status: 200 });

  } catch (err: any) {
    console.error('[Onboarding API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/onboarding
 * Update onboarding status or notes for a user
 * Only accessible by admin, hr, or exec roles
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Onboarding API] POST request received');

    // Create auth client
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      console.log('[Onboarding API] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError) {
      console.error('[Onboarding API] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const role = (userData?.role || '').toString().trim().toLowerCase();

    // Check if user has admin-like privileges
    const isAdminLike = role === 'admin' || role === 'hr' || role === 'exec';

    if (!isAdminLike) {
      console.log('[Onboarding API] Access denied for role:', role);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: role
      }, { status: 403 });
    }

    // Parse request body
    const body = await req.json();
    const { profile_id, onboarding_completed, notes } = body;

    if (!profile_id) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
    }

    console.log('[Onboarding API] Updating onboarding status:', {
      profile_id,
      onboarding_completed,
      notes
    });

    // Upsert the onboarding status record
    const updateData: any = {
      profile_id,
      onboarding_completed: onboarding_completed || false,
      updated_at: new Date().toISOString(),
    };

    // Set completed_date if marking as completed
    if (onboarding_completed) {
      updateData.completed_date = new Date().toISOString();
    } else {
      updateData.completed_date = null;
    }

    // Add notes if provided (allow null to clear notes)
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const { data: onboardingStatus, error: onboardingError } = await adminClient
      .from('vendor_onboarding_status')
      .upsert(updateData, {
        onConflict: 'profile_id'
      })
      .select()
      .single();

    if (onboardingError) {
      console.error('[Onboarding API] Error updating onboarding status:', onboardingError);
      return NextResponse.json({
        error: 'Failed to update onboarding status',
        details: onboardingError.message
      }, { status: 500 });
    }

    console.log('[Onboarding API] Onboarding status updated successfully');

    // Send email notification if onboarding was just marked as completed
    if (onboarding_completed) {
      try {
        // Fetch user's email and name from profile
        const { data: profile, error: profileError } = await adminClient
          .from('profiles')
          .select(`
            first_name,
            last_name,
            users!inner (
              email
            )
          `)
          .eq('id', profile_id)
          .single();

        if (!profileError && profile) {
          const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;
          const userEmail = userObj?.email;

          if (userEmail) {
            const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
            const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
            const fullName = `${firstName} ${lastName}`.trim() || 'User';

            const subject = 'Onboarding Documents Approved';
            const html = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>${subject}</title></head>
  <body style="font-family: Arial, sans-serif; color: #111827; padding: 20px;">
    <h2 style="margin:0 0 20px 0; color: #10b981;">Congratulations, ${firstName || 'User'}!</h2>
    <p style="margin:0 0 16px 0; font-size: 16px;">Your onboarding documents have been reviewed and approved.</p>
    <p style="margin:0 0 16px 0; font-size: 16px;">You are now fully onboarded into the system. Welcome aboard!</p>
    <div style="margin: 24px 0; padding: 16px; background-color: #f3f4f6; border-radius: 8px;">
      <p style="margin:0; font-size: 14px; color: #6b7280;">Approval Date: ${new Date().toLocaleString()}</p>
    </div>
    <p style="margin:0 0 16px 0; font-size: 14px; color: #6b7280;">If you have any questions, please contact HR.</p>
  </body>
</html>`.trim();

            console.log('[Onboarding API] Sending approval email to:', userEmail);

            const emailResult = await sendEmail({
              to: userEmail,
              subject,
              html,
            });

            if (emailResult.success) {
              console.log('[Onboarding API] Approval email sent successfully. MessageId:', emailResult.messageId);
            } else {
              console.error('[Onboarding API] Failed to send approval email:', emailResult.error);
            }
          }
        }
      } catch (emailError: any) {
        console.error('[Onboarding API] Error sending approval email:', emailError);
        // Don't fail the request if email fails, just log the error
      }
    }

    return NextResponse.json({ onboarding_status: onboardingStatus }, { status: 200 });

  } catch (err: any) {
    console.error('[Onboarding API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
