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
    if (userId) {
      const { data: profile, error: pErr } = await (supabase
        .from('profiles') as any)
        .select('first_name, last_name')
        .eq('user_id', userId)
        .single();
      if (!pErr && profile) {
        try { firstName = profile.first_name ? decrypt(profile.first_name) : ''; } catch { firstName = profile.first_name || ''; }
        try { lastName = profile.last_name ? decrypt(profile.last_name) : ''; } catch { lastName = profile.last_name || ''; }
      }
    }

    // If this is the final form completion (lgbtq-rights + save-finish), mark onboarding as complete
    if (form === 'lgbtq-rights' && trigger === 'save-finish' && userId) {
      console.log('[ONBOARDING-NOTIFICATION] Final form completed, setting onboarding_completed_at');
      const { error: updateErr } = await supabase
        .from('profiles')
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
    }

    const subject = 'Onboarding Packet Notification — New Onboarding Submitted';
    const html = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>${subject}</title></head>
  <body style="font-family: Arial, sans-serif; color: #111827;">
    <h2 style="margin:0 0 10px 0;">Onboarding Event</h2>
    <p style="margin:0 0 16px 0;">A user has submitted an onboarding documentation in the CA Payroll Packet form viewer.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      <tr><td style="padding:4px 8px; color:#374151;">Time:</td><td style="padding:4px 8px; font-weight:600;">${new Date().toLocaleString()}</td></tr>
      <tr><td style="padding:4px 8px; color:#374151;">User Email:</td><td style="padding:4px 8px; font-weight:600;">${userEmail || 'Unknown'}</td></tr>
      <tr><td style="padding:4px 8px; color:#374151;">User Name:</td><td style="padding:4px 8px; font-weight:600;">${[firstName, lastName].filter(Boolean).join(' ') || 'Unknown'}</td></tr>
    </table>
  </body>
</html>`.trim();

    const result = await sendEmail({
      to: 'sebastiancastao379@gmail.com',
      cc: 'jenvillar625@gmail.com',
      subject,
      html,
    });

    if (!result.success) {
      console.error('[ONBOARDING-NOTIFICATION] Email send failed:', result.error);
      return NextResponse.json({ error: result.error || 'Failed to send email' }, { status: 500 });
    }

    console.log('[ONBOARDING-NOTIFICATION] Email sent. MessageId:', result.messageId);
    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('[ONBOARDING-NOTIFICATION] Exception:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
