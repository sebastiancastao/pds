import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { safeDecrypt } from '@/lib/encryption';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tickets, error } = await adminClient
      .from('helpdesk_tickets')
      .select('id, ticket_number, ticket_date, urgency, status, description, created_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tickets: tickets ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { ticket_date, urgency, description } = await req.json();
    if (!ticket_date) return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    if (!urgency) return NextResponse.json({ error: 'Urgency is required' }, { status: 400 });
    if (!description?.trim()) return NextResponse.json({ error: 'Description is required' }, { status: 400 });

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await adminClient
      .from('profiles')
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .maybeSingle();
    const senderName = profile
      ? `${safeDecrypt(profile.first_name ?? '')} ${safeDecrypt(profile.last_name ?? '')}`.trim() || user.email
      : user.email;

    const { data: ticket, error: insertError } = await adminClient
      .from('helpdesk_tickets')
      .insert({
        created_by: user.id,
        ticket_date,
        urgency,
        description: description.trim(),
      })
      .select('id, ticket_number, ticket_date, urgency, status, description, created_at')
      .single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    const urgencyLabel: Record<string, string> = {
      low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
    };

    await sendEmail({
      to: ['portal@1pds.net', 'mardel@1pds.net', 'sebastiancastao379@gmail.com'],
      subject: `[Help Desk ${ticket.ticket_number}] ${urgencyLabel[urgency] ?? urgency} — ${senderName}`,
      html: `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f5;padding:40px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,.1);">
        <tr><td style="background:linear-gradient(135deg,#667eea,#764ba2);padding:32px 30px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">New Help Desk Ticket</h1>
          <p style="color:#e6e6ff;margin:8px 0 0;font-size:16px;">${ticket.ticket_number}</p>
        </td></tr>
        <tr><td style="padding:32px 30px;">
          <table width="100%" cellpadding="4" cellspacing="0" style="background:#f8f9fa;border-radius:8px;border:2px solid #667eea;margin-bottom:24px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="4" cellspacing="0">
                <tr><td><strong style="color:#555;">From:</strong></td><td style="text-align:right;color:#333;">${senderName} &lt;${user.email}&gt;</td></tr>
                <tr><td><strong style="color:#555;">Ticket #:</strong></td><td style="text-align:right;color:#333;">${ticket.ticket_number}</td></tr>
                <tr><td><strong style="color:#555;">Date:</strong></td><td style="text-align:right;color:#333;">${ticket_date}</td></tr>
                <tr><td><strong style="color:#555;">Urgency:</strong></td><td style="text-align:right;color:#333;">${urgencyLabel[urgency] ?? urgency}</td></tr>
              </table>
              <div style="margin-top:16px;padding-top:16px;border-top:1px solid #dee2e6;">
                <strong style="color:#555;">Description:</strong>
                <p style="color:#333;margin:8px 0 0;white-space:pre-wrap;">${description.trim()}</p>
              </div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:#f8f9fa;padding:16px 30px;text-align:center;border-top:1px solid #e0e0e0;">
          <p style="color:#999;font-size:11px;margin:0;">&copy; ${new Date().getFullYear()} PDS. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim(),
    }).catch(() => {}); // non-blocking — ticket is already saved

    return NextResponse.json({ ticket });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
