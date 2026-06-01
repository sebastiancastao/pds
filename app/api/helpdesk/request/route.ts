import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { category, message } = await req.json();
    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: profile } = await adminClient
      .from('profiles')
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .maybeSingle();

    const senderName = profile
      ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || user.email
      : user.email;

    const categoryLabel = category?.trim() || 'General';
    const submittedAt = new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: 'numeric',
    });

    const subject = `Help Desk Request — ${categoryLabel} (${senderName})`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f5;padding:40px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,.1);">
        <tr>
          <td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:40px 30px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;">Help Desk Request</h1>
            <p style="color:#e6e6ff;margin:10px 0 0;font-size:16px;">A new request has been submitted</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 30px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8f9fa;border-radius:8px;border:2px solid #667eea;margin-bottom:30px;">
              <tr><td style="padding:25px;">
                <h2 style="color:#667eea;margin:0 0 20px;font-size:20px;">Request Details</h2>
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">From:</strong></td>
                    <td style="padding:8px 0;text-align:right;color:#333;">${senderName}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">Email:</strong></td>
                    <td style="padding:8px 0;text-align:right;color:#333;">${user.email}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">Category:</strong></td>
                    <td style="padding:8px 0;text-align:right;color:#333;">${categoryLabel}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">Submitted:</strong></td>
                    <td style="padding:8px 0;text-align:right;color:#333;">${submittedAt}</td>
                  </tr>
                </table>
                <div style="margin-top:20px;padding-top:20px;border-top:1px solid #dee2e6;">
                  <strong style="color:#555;">Message:</strong>
                  <p style="color:#333;margin:10px 0 0;white-space:pre-wrap;">${message.trim()}</p>
                </div>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fa;padding:20px 30px;text-align:center;border-top:1px solid #e0e0e0;">
            <p style="color:#999;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} PDS. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    const result = await sendEmail({
      to: ['portal@1pds.net', 'sebastiancastao379@gmail.com'],
      subject,
      html,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('❌ POST /api/helpdesk/request:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
