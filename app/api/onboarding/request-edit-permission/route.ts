import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { userEmail, userFirstName, userLastName, userId, documentName, reason } = await req.json();

    if (!userEmail || !userFirstName || !userId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const lastName = userLastName || '';
    const docLabel = documentName ? String(documentName) : null;
    const reasonText = reason ? String(reason).trim() : null;

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const isCustomForm = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docLabel ?? '');

    const { data: insertedRequest, error: insertError } = await adminClient
      .from('data_edition_requests')
      .insert({
        user_id: userId,
        document_name: docLabel ?? 'Unknown document',
        document_type: isCustomForm ? 'custom' : 'onboarding',
        reason: reasonText ?? null,
        status: 'pending',
      })
      .select('id, created_at')
      .single();

    if (insertError) {
      console.error('Failed to insert data_edition_request:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to save request to database' },
        { status: 500 }
      );
    }

    const approvalUrl = `https://pds-murex.vercel.app/admin/pdf-forms?${new URLSearchParams({
      requestId: insertedRequest.id,
      userId: String(userId),
      userName: `${userFirstName} ${lastName}`.trim(),
      documentName: docLabel ?? '',
    }).toString()}`;

    const emailSubject = docLabel
      ? `Update Permission Request - ${userFirstName} ${lastName} (${docLabel})`.trim()
      : `Update Permission Request - ${userFirstName} ${lastName}`.trim();

    const requestedAt = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });

    const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Data Update Request</h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">A user is requesting a data update review</p>
            </td>
          </tr>

          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                A user has requested a data update. Review the request and assign a custom form directly to this user from PDF Forms if follow-up is needed.
              </p>

              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; border: 2px solid #667eea; margin: 30px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="color: #667eea; margin: 0 0 20px 0; font-size: 20px;">User Information</h2>

                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Name:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 16px;">${userFirstName} ${lastName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Email:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${userEmail}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">User ID:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${userId}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Requested:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${requestedAt}</span>
                        </td>
                      </tr>
                      ${docLabel ? `
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Document:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${docLabel}</span>
                        </td>
                      </tr>` : ''}
                      ${reasonText ? `
                      <tr>
                        <td style="padding: 8px 0; vertical-align: top;">
                          <strong style="color: #555555;">Reason:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${reasonText}</span>
                        </td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${approvalUrl}"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 6px; font-size: 18px; font-weight: bold; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                      Open PDF Forms
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${approvalUrl}" style="color: #667eea; text-decoration: none; word-break: break-all;">${approvalUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0 0 10px 0; font-size: 14px;"><strong>What Happens Next:</strong></p>
                    <ul style="color: #0c5280; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                      <li>Open PDF Forms to review this request</li>
                      <li>Create or choose a custom form and assign it directly to this user</li>
                      <li>Keep the request pending until that direct assignment has been completed</li>
                      <li>Review the user's updated submission after the new form is returned</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0; font-size: 14px;">
                      <strong>Important:</strong> Do not treat this request as approved until a custom form has been assigned directly to this specific user.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                This notification was sent by PDS Time Keeping System
              </p>
              <p style="color: #999999; font-size: 11px; margin: 0;">
                This message contains confidential information. If you received this in error, please delete it.
              </p>
              <p style="color: #999999; font-size: 11px; margin: 10px 0 0 0;">
                &copy; ${new Date().getFullYear()} PDS. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

    const recipients = ['portal@1pds.net', 'sebastiancastao379@gmail.com'];

    const result = await sendEmail({
      to: recipients,
      subject: emailSubject,
      html: emailBody,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to send email' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Edit permission request sent successfully',
      request: insertedRequest,
    });
  } catch (error: any) {
    console.error('Error sending edit permission request:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
