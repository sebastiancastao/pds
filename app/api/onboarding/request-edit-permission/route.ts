import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { userEmail, userFirstName, userLastName, userId } = await req.json();

    if (!userEmail || !userFirstName || !userLastName || !userId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Build the approval URL
    const approvalUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/onboarding?userId=${userId}&action=edit`;

    const emailSubject = `Edit Permission Request - ${userFirstName} ${userLastName}`;
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

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">📝 Edit Permission Request</h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">A user is requesting to edit their onboarding form</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                A user has requested permission to edit their pending onboarding submission.
              </p>

              <!-- User Details Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; border: 2px solid #667eea; margin: 30px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="color: #667eea; margin: 0 0 20px 0; font-size: 20px;">👤 User Information</h2>

                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Name:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 16px;">${userFirstName} ${userLastName}</span>
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
                          <span style="color: #333333; font-size: 14px;">${new Date().toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: 'numeric',
                          })}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Grant Access Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${approvalUrl}"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 6px; font-size: 18px; font-weight: bold; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                      Grant Edit Permission
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

              <!-- Instructions -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0 0 10px 0; font-size: 14px;"><strong>📝 What Happens Next:</strong></p>
                    <ul style="color: #0c5280; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                      <li>Click "Grant Edit Permission" to allow the user to edit their submission</li>
                      <li>The system will update their onboarding status</li>
                      <li>The user will be able to access and edit their forms</li>
                      <li>You'll need to review their updated submission when they resubmit</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Important Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0; font-size: 14px;">
                      <strong>⚠️ Important:</strong> Granting edit permission will allow the user to modify their previously submitted onboarding documents. Their submission will need to be re-reviewed after they make changes.
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
                This notification was sent by PDS Time Tracking System
              </p>
              <p style="color: #999999; font-size: 11px; margin: 0;">
                This message contains confidential information. If you received this in error, please delete it.
              </p>
              <p style="color: #999999; font-size: 11px; margin: 10px 0 0 0;">
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
`.trim();

    // Send email to admin
    const result = await sendEmail({
      to: 'portal@1pds.com',
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
    });
  } catch (error: any) {
    console.error('❌ Error sending edit permission request:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
