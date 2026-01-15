import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { decrypt } from '@/lib/encryption';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    console.log('[ONBOARDING-NOTIFICATION] Received POST');
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    let supabase;
    try {
      supabase = createServerClient();
    } catch (err: any) {
      return NextResponse.json({ error: 'Service role key not configured' }, { status: 500 });
    }

    let userId: string | null = null;
    let userEmail: string = '';

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (!error && user) {
        userId = user.id;
        userEmail = user.email || '';
      }
    }

    const body = await request.json().catch(() => ({}));
    const form = body?.form || 'unknown';
    const trigger = body?.trigger || 'unknown';
    console.log('[ONBOARDING-NOTIFICATION] Body:', { form, trigger });

    // Fetch optional profile data for nicer email
    let firstName = '';
    let lastName = '';
    let profileId: string | null = null;
    if (userId) {
      const { data: profile, error: pErr } = await (supabase
        .from('profiles') as any)
        .select('id, first_name, last_name')
        .eq('user_id', userId)
        .single();
      if (!pErr && profile) {
        profileId = profile.id || null;
        try { firstName = profile.first_name ? decrypt(profile.first_name) : ''; } catch { firstName = profile.first_name || ''; }
        try { lastName = profile.last_name ? decrypt(profile.last_name) : ''; } catch { lastName = profile.last_name || ''; }
      }
    }

    // Mark onboarding as submitted when the workflow finishes (used to determine "has submitted PDF")
    if (trigger === 'save-finish' && userId) {
      console.log('[ONBOARDING-NOTIFICATION] Workflow finished, setting onboarding_completed_at', { form });
      const { error: updateErr } = await (supabase
        .from('profiles') as any)
        .update({
          onboarding_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (updateErr) {
        console.error('[ONBOARDING-NOTIFICATION] Failed to update onboarding_completed_at:', updateErr);
      } else {
        console.log('[ONBOARDING-NOTIFICATION] Successfully set onboarding_completed_at');
      }

      if (profileId) {
        const { error: statusError } = await (supabase
          .from('vendor_onboarding_status') as any)
          .upsert(
            {
              profile_id: profileId,
              onboarding_completed: false,
            },
            {
              onConflict: 'profile_id',
              ignoreDuplicates: true,
            }
          );

        if (statusError) {
          console.error('[ONBOARDING-NOTIFICATION] Failed to upsert vendor_onboarding_status:', statusError);
        } else {
          console.log('[ONBOARDING-NOTIFICATION] vendor_onboarding_status row ensured');
        }
      }
    }

    // Detect state from form parameter
    let stateName = 'CA';
    if (form.includes('-ca-') || form.includes('payroll-packet-ca')) {
      stateName = 'CA';
    } else if (form.includes('-az-') || form.includes('payroll-packet-az')) {
      stateName = 'AZ';
    } else if (form.includes('-nv-') || form.includes('payroll-packet-nv')) {
      stateName = 'NV';
    } else if (form.includes('-ny-') || form.includes('payroll-packet-ny')) {
      stateName = 'NY';
    } else if (form.includes('-wi-') || form.includes('payroll-packet-wi')) {
      stateName = 'WI';
    }

    const subject = 'Onboarding Packet Notification — New Onboarding Submitted';
    const html = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>${subject}</title></head>
  <body style="font-family: Arial, sans-serif; color: #111827;">
    <h2 style="margin:0 0 10px 0;">Onboarding Event</h2>
    <p style="margin:0 0 16px 0;">A user has submitted an onboarding documentation in the ${stateName} Payroll Packet</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      <tr><td style="padding:4px 8px; color:#374151;">Time:</td><td style="padding:4px 8px; font-weight:600;">${new Date().toLocaleString()}</td></tr>
      <tr><td style="padding:4px 8px; color:#374151;">User Email:</td><td style="padding:4px 8px; font-weight:600;">${userEmail || 'Unknown'}</td></tr>
      <tr><td style="padding:4px 8px; color:#374151;">User Name:</td><td style="padding:4px 8px; font-weight:600;">${[firstName, lastName].filter(Boolean).join(' ') || 'Unknown'}</td></tr>
    </table>
  </body>
</html>`.trim();

    // Send notification to admin
    const result = await sendEmail({
      to: 'sebastiancastao379@gmail.com',
      cc: 'jenvillar625@gmail.com',
      subject,
      html,
    });

    if (!result.success) {
      console.error('[ONBOARDING-NOTIFICATION] Admin email send failed:', result.error);
      return NextResponse.json({ error: result.error || 'Failed to send email' }, { status: 500 });
    }

    console.log('[ONBOARDING-NOTIFICATION] Admin email sent. MessageId:', result.messageId);

    // Send confirmation email to user
    if (userEmail) {
      const userSubject = 'Onboarding Packet Received';
      const userHtml = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>${userSubject}</title></head>
  <body style="font-family: Arial, sans-serif; color: #111827;">
    <h2 style="margin:0 0 10px 0;">Thank You for Submitting Your Onboarding Packet</h2>
    <p style="margin:0 0 16px 0;">Hi ${firstName || 'there'},</p>
    <p style="margin:0 0 16px 0;">We have successfully received your ${stateName} Payroll Packet onboarding documentation.</p>
    <p style="margin:0 0 16px 0;">Our HR team will review your submission and reach out if any additional information is needed.</p>
    <p style="margin:0 0 16px 0;">If you have any questions, please don't hesitate to contact us.</p>
    <p style="margin:16px 0 0 0;">Best regards,<br/>HR Team</p>
  </body>
</html>`.trim();

      const userResult = await sendEmail({
        to: userEmail,
        subject: userSubject,
        html: userHtml,
      });

      if (!userResult.success) {
        console.error('[ONBOARDING-NOTIFICATION] User confirmation email send failed:', userResult.error);
      } else {
        console.log('[ONBOARDING-NOTIFICATION] User confirmation email sent. MessageId:', userResult.messageId);
      }
    }

    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('[ONBOARDING-NOTIFICATION] Exception:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
