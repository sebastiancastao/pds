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

    // Fetch latest form progress for each user
    // Get all form progress entries and we'll pick the latest per user
    const { data: formProgressData, error: formProgressError } = await adminClient
      .from('pdf_form_progress')
      .select('user_id, form_name, updated_at')
      .order('updated_at', { ascending: false });

    if (formProgressError) {
      console.error('Error fetching form progress data:', formProgressError);
    }

    // Form order from DEFAULT_FORMS in StatePayrollFormViewer
    const FORM_ORDER = [
      { id: 'adp-deposit', display: 'ADP Direct Deposit' },
      { id: 'marketplace', display: 'Marketplace Notice' },
      { id: 'health-insurance', display: 'Health Insurance Marketplace' },
      { id: 'time-of-hire', display: 'Time of Hire Notice' },
      { id: 'employee-information', display: 'Employee Information' },
      { id: 'fw4', display: 'Federal W-4' },
      { id: 'i9', display: 'I-9 Employment Verification' },
      { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee' },
      { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
      { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
      { id: 'state-tax', display: 'State Tax Form' },
      { id: 'handbook', display: 'Employee Handbook' },
    ];
    const TOTAL_FORMS = FORM_ORDER.length;

    // Helper to extract form ID from stored form_name (e.g., "ca-adp-deposit" -> "adp-deposit")
    const extractFormId = (formName: string): string => {
      // form_name format is "{stateCode}-{formId}" e.g., "ca-adp-deposit", "az-fw4"
      const parts = formName.split('-');
      if (parts.length > 1) {
        // Remove first part (state code) and rejoin the rest
        return parts.slice(1).join('-');
      }
      return formName;
    };

    // Get form position (1-indexed) in the sequence
    const getFormPosition = (formName: string): number => {
      const formId = extractFormId(formName);
      const index = FORM_ORDER.findIndex(f => f.id === formId);
      return index >= 0 ? index + 1 : 0;
    };

    // Get display name for a form
    const getFormDisplayName = (formName: string): string => {
      const formId = extractFormId(formName);
      const form = FORM_ORDER.find(f => f.id === formId);
      return form?.display || formName;
    };

    // Create a map of user_id to their furthest form progress (highest position) and count of completed forms
    const furthestFormProgressByUser = new Map<string, { form_name: string; updated_at: string; position: number; display_name: string }>();
    const formCountByUser = new Map<string, number>();
    const completedFormsByUser = new Map<string, string[]>();

    if (formProgressData) {
      for (const progress of formProgressData) {
        const position = getFormPosition(progress.form_name);

        // Track the form with the highest position (furthest in the sequence)
        const existing = furthestFormProgressByUser.get(progress.user_id);
        if (!existing || position > existing.position) {
          furthestFormProgressByUser.set(progress.user_id, {
            form_name: progress.form_name,
            updated_at: progress.updated_at,
            position: position,
            display_name: getFormDisplayName(progress.form_name)
          });
        }

        // Count forms per user
        formCountByUser.set(progress.user_id, (formCountByUser.get(progress.user_id) || 0) + 1);
        // Track completed form names
        if (!completedFormsByUser.has(progress.user_id)) {
          completedFormsByUser.set(progress.user_id, []);
        }
        completedFormsByUser.get(progress.user_id)!.push(progress.form_name);
      }
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

      // Get furthest form progress for this user (highest position in sequence)
      const latestFormProgress = furthestFormProgressByUser.get(profile.user_id) || null;
      const formsCompleted = formCountByUser.get(profile.user_id) || 0;
      const completedForms = completedFormsByUser.get(profile.user_id) || [];

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
        latest_form_progress: latestFormProgress,
        forms_completed: formsCompleted,
        total_forms: TOTAL_FORMS,
        completed_forms: completedForms,
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

            const subject = 'Phase 2 Onboarding Documents Approved';
            const html = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>${subject}</title></head>
  <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Congratulations!</h1>
                <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">Phase 2 Complete</p>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding: 40px 30px;">
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  Hello <strong>${fullName}</strong>,
                </p>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  Congratulations! Your Phase 2 onboarding documents have been successfully reviewed and approved.
                </p>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  You will now advance to <strong>Phase 3</strong> of the onboarding process, which will include calendar availability review and clock-in / clock-out training.
                </p>
                <!-- Important Notice -->
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 30px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="color: #856404; margin: 0; font-size: 14px;">
                        <strong>Mandatory training is required.</strong> A separate email will be sent with training session details.
                      </p>
                    </td>
                  </tr>
                </table>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 20px 0 0 0;">
                  Thank you,<br>
                  <strong>Your Onboarding Team</strong>
                </p>
                <!-- Login Button -->
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                  <tr>
                    <td align="center">
                      <a href="https://pds-murex.vercel.app/login"
                         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">
                        Login to Your Account
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-top: 15px;">
                      <p style="color: #666666; font-size: 13px; margin: 0;">
                        Or copy and paste this link in your browser:<br>
                        <a href="https://pds-murex.vercel.app/login" style="color: #667eea; text-decoration: none; word-break: break-all;">https://pds-murex.vercel.app/login</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                  This email was sent by PDS Time keepingSystem
                </p>
                <p style="color: #999999; font-size: 11px; margin: 0;">
                  © ${new Date().getFullYear()} PDS. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
