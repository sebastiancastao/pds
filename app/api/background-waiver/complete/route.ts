import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendBackgroundCheckSubmissionNotification } from '@/lib/email';
import { decrypt } from '@/lib/encryption';
import { Resend } from 'resend';

export const runtime = 'nodejs'; // ensure Node runtime for Resend

const resend = new Resend(process.env.RESEND_API_KEY || '');

function userReceiptHtml(first: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Background Check Submitted Successfully</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #f5f5f5;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
        <tr>
          <td align="center">
            <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #34C759 0%, #28A745 100%); padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px;">✓ Submission Successful</h1>
                  <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">Your background check forms have been received</p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    Hi <strong>${first || 'there'}</strong>,
                  </p>

                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    Thank you for submitting your background check documents. We have successfully received your submission!
                  </p>

                  <!-- Status Box -->
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 30px 0;">
                    <tr>
                      <td style="padding: 20px;">
                        <p style="color: #856404; margin: 0 0 10px 0; font-size: 15px; font-weight: bold;">⏳ Important: Subject to Approval</p>
                        <p style="color: #856404; margin: 0; font-size: 14px; line-height: 1.6;">
                          Your background check is currently under review by our HR team. We will notify you by email as soon as your background check has been approved.
                        </p>
                      </td>
                    </tr>
                  </table>

                  <!-- Next Steps -->
                  <h3 style="color: #333333; font-size: 18px; margin: 30px 0 15px 0;">What happens next?</h3>
                  <ul style="color: #555555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                    <li>Our HR team will review your submission</li>
                    <li>You'll receive an email notification once approved</li>
                    <li>After approval, you can proceed with the onboarding process</li>
                  </ul>

                  <!-- Support -->
                  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                    <tr>
                      <td style="padding: 20px;">
                        <p style="color: #0c5280; margin: 0; font-size: 14px;">
                          <strong>Questions?</strong> If you have any questions about your background check status, please contact us at
                          <a href="mailto:support@pds.com" style="color: #2196F3; text-decoration: none;">support@pds.com</a>
                        </p>
                      </td>
                    </tr>
                  </table>

                  <p style="color: #777777; font-size: 14px; margin: 30px 0 0 0;">
                    Thank you,<br>
                    <strong>PDS HR Team</strong>
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                  <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                    This email was sent by PDS Time Tracking System
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
    </html>
  `;
}

/**
 * POST /api/background-waiver/complete
 * Mark background check as completed for a user
 */
export async function POST(request: NextRequest) {
  try {
    // Get session from request
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    console.log('[BACKGROUND CHECK COMPLETE] Marking background check as completed for user:', user.id);

    // Update users table to mark background check as completed
    const { error: updateError } = await ((supabase
      .from('users') as any)
      .update({
        background_check_completed: true,
        background_check_completed_at: new Date().toISOString()
      })
      .eq('id', user.id));

    if (updateError) {
      console.error('[BACKGROUND CHECK COMPLETE] Failed to update user:', updateError);
      return NextResponse.json(
        { error: 'Failed to mark background check as completed', details: updateError.message },
        { status: 500 }
      );
    }

    console.log('[BACKGROUND CHECK COMPLETE] ✅ Background check marked as completed in users table');

    // Get the profile_id for this user
    const { data: profileData, error: profileError } = await (supabase
      .from('profiles') as any)
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profileData) {
      console.error('[BACKGROUND CHECK COMPLETE] Failed to get profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to find user profile', details: profileError?.message },
        { status: 500 }
      );
    }

    console.log('[BACKGROUND CHECK COMPLETE] Found profile_id:', profileData.id);

    // Check if vendor_background_checks record exists
    const { data: existingCheck } = await supabase
      .from('vendor_background_checks')
      .select('id')
      .eq('profile_id', profileData.id)
      .single();

    if (existingCheck) {
      // Update existing record - only update the timestamp, keep background_check_completed as is
      console.log('[BACKGROUND CHECK COMPLETE] Updating existing vendor_background_checks record (timestamp only)');
      const { error: updateCheckError } = await (supabase
        .from('vendor_background_checks') as any)
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('profile_id', profileData.id);

      if (updateCheckError) {
        console.error('[BACKGROUND CHECK COMPLETE] Failed to update vendor_background_checks:', updateCheckError);
        return NextResponse.json(
          { error: 'Failed to update vendor background check record', details: updateCheckError.message },
          { status: 500 }
        );
      }
    } else {
      // Insert new record with background_check_completed = FALSE
      console.log('[BACKGROUND CHECK COMPLETE] Creating new vendor_background_checks record (completed = FALSE)');
      const { error: insertCheckError } = await (supabase
        .from('vendor_background_checks') as any)
        .insert({
          profile_id: profileData.id,
          background_check_completed: false,
          completed_date: null
        });

      if (insertCheckError) {
        console.error('[BACKGROUND CHECK COMPLETE] Failed to insert vendor_background_checks:', insertCheckError);
        return NextResponse.json(
          { error: 'Failed to create vendor background check record', details: insertCheckError.message },
          { status: 500 }
        );
      }
    }

    console.log('[BACKGROUND CHECK COMPLETE] ✅ Vendor background check record created/updated (awaiting admin approval)');

    // Get user profile information (for names)
    const { data: profileInfo, error: profileInfoError } = await (supabase
      .from('profiles') as any)
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .single();

    // Prepare names (with decryption fallback)
    let firstName = 'User';
    let lastName = '';

    if (!profileInfoError && profileInfo) {
      try {
        firstName = profileInfo.first_name ? decrypt(profileInfo.first_name) : 'User';
      } catch {
        firstName = profileInfo.first_name || 'User';
      }
      try {
        lastName = profileInfo.last_name ? decrypt(profileInfo.last_name) : '';
      } catch {
        lastName = profileInfo.last_name || '';
      }
    } else {
      console.error('[BACKGROUND CHECK COMPLETE] ⚠️ Could not fetch profile info for name:', profileInfoError);
    }

    // --- Admin notification ---
    try {
      console.log('[BACKGROUND CHECK COMPLETE] Sending email notification to admin...');
      const emailResult = await sendBackgroundCheckSubmissionNotification({
        userEmail: user.email || 'N/A',
        userFirstName: firstName,
        userLastName: lastName,
        submittedAt: new Date().toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York'
        })
      });

      if (emailResult.success) {
        console.log('[BACKGROUND CHECK COMPLETE] ✅ Admin email sent successfully');
      } else {
        console.error('[BACKGROUND CHECK COMPLETE] ❌ Failed to send admin email:', emailResult.error);
      }
    } catch (e) {
      console.error('[BACKGROUND CHECK COMPLETE] ❌ Admin email exception:', e);
    }

    // --- User receipt via Resend (NEW) ---
    let emailSentToUser = false;
    const toEmail = (user.email || '').trim();
    const fromEmail = (process.env.RESEND_FROM || 'service@furnituretaxi.site').trim();

    if (!process.env.RESEND_API_KEY) {
      console.warn('[BACKGROUND CHECK COMPLETE] RESEND_API_KEY not set; skipping user receipt email.');
    } else if (!fromEmail) {
      console.warn('[BACKGROUND CHECK COMPLETE] RESEND_FROM not set; skipping user receipt email.');
    } else if (!toEmail) {
      console.warn('[BACKGROUND CHECK COMPLETE] No user email; skipping user receipt email.');
    } else {
      try {
        const first = (firstName || '').split(' ')[0] || 'there';
        await resend.emails.send({
          from: `PDS HR Team <${fromEmail}>`,
          to: [toEmail],
          subject: 'Background Check Submitted Successfully - Subject to Approval',
          html: userReceiptHtml(first),
        });
        emailSentToUser = true;
        console.log('[BACKGROUND CHECK COMPLETE] ✅ User receipt email sent');
      } catch (e) {
        console.error('[BACKGROUND CHECK COMPLETE] ❌ User receipt email failed:', e);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Background check marked as completed',
      emailSentToUser,
    });

  } catch (error: any) {
    console.error('[BACKGROUND CHECK COMPLETE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

