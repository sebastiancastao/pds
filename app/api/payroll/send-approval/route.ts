import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { Resend } from 'resend';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

const APPROVAL_EMAIL = 'sebastiancastao379@gmail.com';
const FROM = process.env.RESEND_FROM || 'PDS Time Keeping <service@pdsportal.site>';

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = (userData?.role || '').toString().trim().toLowerCase();
    if (!['exec', 'admin', 'hr'].includes(role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
    ];
    const isExcel =
      allowedTypes.includes(file.type) ||
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls');

    if (!isExcel) {
      return NextResponse.json({ error: 'File must be an Excel spreadsheet (.xlsx or .xls)' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const { data, error } = await resend.emails.send({
      from: FROM,
      to: APPROVAL_EMAIL,
      subject: 'Payroll Approval Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Payroll Approval Request</h1>
            <p style="color: #e6e6ff; margin: 8px 0 0 0; font-size: 15px;">PDS Time Keeping System</p>
          </div>
          <div style="background: #ffffff; padding: 32px 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
              A payroll spreadsheet has been submitted for your approval.
            </p>
            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
              Please review the attached Excel file and approve or request changes as needed.
            </p>
            <div style="background: #f8f9fa; border-left: 4px solid #667eea; padding: 16px 20px; border-radius: 4px; margin-bottom: 24px;">
              <strong style="color: #444;">Attachment:</strong>
              <span style="color: #555; margin-left: 8px;">${file.name}</span>
            </div>
            <p style="color: #777; font-size: 13px; margin: 0;">
              This email was sent automatically by the PDS HR Dashboard.
            </p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: file.name,
          content: fileBuffer,
        },
      ],
    });

    if (error) {
      console.error('[send-approval] Resend error:', error);
      return NextResponse.json({ error: error.message || 'Failed to send email' }, { status: 500 });
    }

    // Record the submission in the database
    const { data: submission, error: dbError } = await supabaseAdmin
      .from('payroll_approval_submissions')
      .insert({
        submitted_by: user.id,
        file_name: file.name,
        status: 'submitted',
      })
      .select('id, status, submitted_at')
      .single();

    if (dbError) {
      // Email was sent — log the DB error but don't fail the request
      console.error('[send-approval] DB insert error:', dbError);
    }

    return NextResponse.json({ success: true, messageId: data?.id, submission: submission ?? null });
  } catch (err: any) {
    console.error('[send-approval] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
