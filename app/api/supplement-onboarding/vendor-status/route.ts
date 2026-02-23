import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getAuthUser(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });
  let { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
    if (token) {
      const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
      if (tokenUser) user = tokenUser;
    }
  }
  return user;
}

async function checkAdminRole(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('users').select('role').eq('id', userId).single();
  const role = (data?.role || '').toString().trim().toLowerCase();
  return ['admin', 'hr', 'exec'].includes(role);
}

/**
 * GET /api/supplement-onboarding/vendor-status
 * Returns vendor_onboarding_status keyed by user_id for all profiles.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!await checkAdminRole(user.id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('user_id, vendor_onboarding_status(onboarding_completed, completed_date)');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statuses: Record<string, { onboarding_completed: boolean; completed_date: string | null }> = {};
  for (const row of data || []) {
    const vos = Array.isArray(row.vendor_onboarding_status)
      ? row.vendor_onboarding_status[0]
      : row.vendor_onboarding_status;
    statuses[row.user_id] = {
      onboarding_completed: vos?.onboarding_completed ?? false,
      completed_date: vos?.completed_date ?? null,
    };
  }

  return NextResponse.json({ statuses });
}

/**
 * POST /api/supplement-onboarding/vendor-status
 * Body: { user_id: string, action: 'mark_complete' | 'mark_incomplete' | 'send_email' }
 *
 * - mark_complete:   Sets vendor_onboarding_status.onboarding_completed = true (no email sent)
 * - mark_incomplete: Sets vendor_onboarding_status.onboarding_completed = false
 * - send_email:      Sends the Phase 2 approval confirmation email to the employee
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!await checkAdminRole(user.id)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const body = await req.json();
  const { user_id, action } = body as { user_id: string; action: string };

  if (!user_id || !action) {
    return NextResponse.json({ error: 'user_id and action are required' }, { status: 400 });
  }

  // Look up profile by user_id
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, first_name, last_name, users!inner(email)')
    .eq('user_id', user_id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found for this user' }, { status: 404 });
  }

  const profile_id: string = profile.id;
  const userObj: any = Array.isArray(profile.users) ? profile.users[0] : profile.users;
  const email: string | undefined = userObj?.email;
  const firstName = profile.first_name ? safeDecrypt(profile.first_name) : '';
  const lastName = profile.last_name ? safeDecrypt(profile.last_name) : '';
  const fullName = `${firstName} ${lastName}`.trim() || 'User';

  // ── Action: Mark Complete / Incomplete ──────────────────────────────────
  if (action === 'mark_complete' || action === 'mark_incomplete') {
    const onboarding_completed = action === 'mark_complete';

    const { error: upsertError } = await supabaseAdmin
      .from('vendor_onboarding_status')
      .upsert(
        {
          profile_id,
          onboarding_completed,
          completed_date: onboarding_completed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id' }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, onboarding_completed });
  }

  // ── Action: Send Confirmation Email ─────────────────────────────────────
  if (action === 'send_email') {
    if (!email) {
      return NextResponse.json({ error: 'No email address on file for this employee' }, { status: 400 });
    }

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
            <tr>
              <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Congratulations!</h1>
                <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">Phase 2 Complete</p>
              </td>
            </tr>
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
            <tr>
              <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                  This email was sent by PDS Time Keeping System
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

    const result = await sendEmail({ to: email, subject, html });
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Email sending failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true, messageId: result.messageId });
  }

  return NextResponse.json({ error: 'Invalid action. Use mark_complete, mark_incomplete, or send_email.' }, { status: 400 });
}
