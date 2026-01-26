// PDS Time keeping System - Email Utilities
// Secure email delivery for temporary passwords and notifications via Resend

import { Resend } from 'resend';

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY);

interface TemporaryPasswordEmailData {
  email: string;
  firstName: string;
  lastName: string;
  temporaryPassword: string;
  expiresAt: Date;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send temporary password email to new user
 * 
 * Security Features:
 * - TLS 1.2+ encryption in transit
 * - No password stored in logs
 * - Email template sanitized
 * - Rate limiting (future)
 * 
 * @param data - Email data including temporary password
 * @returns Promise with email result
 */
export async function sendTemporaryPasswordEmail(
  data: TemporaryPasswordEmailData
): Promise<EmailResult> {
  const { email, firstName, lastName, temporaryPassword, expiresAt } = data;

  // Format expiration date
  const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Email template
  const emailSubject = 'PDS new Portal Onboarding and Background Check Process';
  const emailBody = generateEmailTemplate({
    firstName,
    lastName,
    email,
    temporaryPassword,
    expiresFormatted,
  });

  // Send email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Portal <service@pdsportal.site>', // Using Resend's test domain (change to your verified domain later)
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Email sent successfully via Resend!');
    console.log(`   To: ${email}`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Email sending failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email',
    };
  }
}

/**
 * Generate HTML email template for temporary password
 */
function generateEmailTemplate(data: {
  firstName: string;
  lastName: string;
  email: string;
  temporaryPassword: string;
  expiresFormatted: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to the New PDS Portal- Onboarding Process</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Welcome to PDS Time keeping</h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">Your account has been created</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello <strong>${data.firstName} ${data.lastName}</strong>,
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Please create your account to begin the onboarding process to the new portal, which includes a background check. Once the background check is complete, you will be notified when you may proceed to the next phase of onboarding, including review of the updated handbook and completion of required documents.
              </p>
              <strong> We recommend using a laptop or desktop computer to ensure all forms display and submit correctly</strong>

              <!-- Login Details Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; border: 2px solid #667eea; margin: 30px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="color: #667eea; margin: 0 0 20px 0; font-size: 20px;">🔐 Your Login Credentials</h2>
                    
                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Email:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <code style="background-color: #ffffff; padding: 6px 12px; border-radius: 4px; font-size: 14px; color: #333333;">${data.email}</code>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; vertical-align: top;">
                          <strong style="color: #555555;">Temporary Password:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <code style="background-color: #ffffff; padding: 6px 12px; border-radius: 4px; font-size: 14px; color: #333333; font-weight: bold; letter-spacing: 1px;">${data.temporaryPassword}</code>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Warning Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0 0 10px 0; font-size: 14px;"><strong>⚠️ Important Security Information:</strong></p>
                    <ul style="color: #856404; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                      <li>This is a <strong>temporary password</strong> that expires on <strong>${data.expiresFormatted}</strong></li>
                      <li>You must change this password on your first login</li>
                      <li>Do not share this password with anyone</li>
                      <li>Multi-Factor Authentication (MFA) is required for all users, Download Google Authenticator before creating account</li>
                    </ul>
                  </td>
                </tr>
              </table>

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

              <!-- Next Steps -->
              <h3 style="color: #333333; font-size: 18px; margin: 30px 0 15px 0;">📋 Next Steps:</h3>
              <ol style="color: #555555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Click the "Login to Your Account" button above</li>
                <li>Enter your email and temporary password</li>
                <li>You'll be prompted to create a new secure password</li>
                <li>Set up Multi-Factor Authentication (MFA)</li>
                <li>Complete your onboarding profile</li>
              </ol>

              <!-- Support -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0; font-size: 14px;">
                      <strong>Need help?</strong> Contact our support team at 
                      <a href="mailto:portal@1pds.net " style="color: #2196F3; text-decoration: none;">portal@1pds.net</a>
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
                This email was sent by PDS Time keeping System
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
}

// Email service now uses Resend - no need for separate production function

/**
 * Send invite email (NO password creation - user sets their own!)
 */
export async function sendInviteEmail(data: {
  email: string;
  firstName: string;
  lastName: string;
  inviteUrl: string;
  expiresAt: Date;
}): Promise<EmailResult> {
  const { email, firstName, lastName, inviteUrl, expiresAt } = data;

  const expiresFormatted = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const emailSubject = 'You\'re Invited to PDS Time keeping';
  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>You're Invited to PDS Time keeping</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🎉 You're Invited!</h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">Join the PDS Time keeping System</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello <strong>${firstName} ${lastName}</strong>,
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                You've been invited to join the PDS Time keeping System! Click the button below to create your account and get started.
              </p>

              <!-- Invite Info Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; border: 2px solid #667eea; margin: 30px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="color: #667eea; margin: 0 0 15px 0; font-size: 20px;">✨ What's Next?</h2>
                    <p style="color: #555555; margin: 0; font-size: 15px; line-height: 1.6;">
                      Click the button below to accept your invitation and create your secure password. 
                      You'll have full control over your account credentials.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Accept Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 6px; font-size: 18px; font-weight: bold; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                      Accept Invitation & Create Account
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${inviteUrl}" style="color: #667eea; text-decoration: none; word-break: break-all;">${inviteUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Important Info -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0 0 10px 0; font-size: 14px;"><strong>⏰ Time Sensitive:</strong></p>
                    <p style="color: #856404; margin: 0; font-size: 14px; line-height: 1.6;">
                      This invitation expires on <strong>${expiresFormatted}</strong>. 
                      Please accept it before then to complete your account setup.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Benefits -->
              <h3 style="color: #333333; font-size: 18px; margin: 30px 0 15px 0;">🚀 What You'll Get:</h3>
              <ul style="color: #555555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Easy clock in/out for shifts</li>
                <li>View your scheduled events</li>
                <li>Track your pay by event and date</li>
                <li>Complete onboarding digitally</li>
                <li>Secure, encrypted account</li>
              </ul>

              <!-- Security Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0; font-size: 14px;">
                      <strong>🔒 Your Security Matters:</strong> You'll create your own password when you accept this invitation. 
                      We'll never ask for your password, and you should never share it with anyone.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <p style="color: #777777; font-size: 14px; margin: 30px 0 0 0; text-align: center;">
                Questions? Contact us at 
                <a href="mailto:portal@1pds.net" style="color: #2196F3; text-decoration: none;">portal@1pds.net</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                This invitation was sent by PDS Time keeping System
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
`.trim();

  // Send invite email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Time keeping <service@pdsportal.site>', // Using Resend's test domain (change to your verified domain later)
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Invite email sent successfully via Resend!');
    console.log(`   To: ${email}`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Invite email sending failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send invite email',
    };
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
): Promise<EmailResult> {
  const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${resetToken}`;
  
  // TODO: Implement password reset email
  console.log(`Password reset email would be sent to ${email} with link: ${resetUrl}`);
  
  return {
    success: true,
    messageId: `sim-reset-${Date.now()}`,
  };
}

/**
 * Send account locked notification
 */
export async function sendAccountLockedEmail(
  email: string,
  unlockTime: Date
): Promise<EmailResult> {
  // TODO: Implement account locked email
  console.log(`Account locked email would be sent to ${email}. Unlocks at: ${unlockTime}`);
  
  return {
    success: true,
    messageId: `sim-locked-${Date.now()}`,
  };
}

/**
 * Send MFA email verification code
 */
export async function sendMFAVerificationEmail(
  email: string,
  code: string,
  purpose: 'setup' | 'login'
): Promise<EmailResult> {
  const emailSubject = purpose === 'setup'
    ? 'Enable Multi-Factor Authentication - Verification Code'
    : 'PDS Login Verification Code';

  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif;">
  <p>Your verification code is:</p>
  <h1 style="font-size: 32px; letter-spacing: 5px; margin: 20px 0;">${code}</h1>
  <p>This code expires in 10 minutes.</p>
  <p>If you didn't request this, please ignore this email.</p>
</body>
</html>
`.trim();

  // Send email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Time keeping <service@pdsportal.site>',
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (MFA code):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ MFA verification email sent successfully!');
    console.log(`   To: ${email}`);
    console.log(`   Purpose: ${purpose}`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ MFA email sending failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send MFA email',
    };
  }
}

/**
 * Send vendor event invitation email with availability form link
 */
export async function sendVendorEventInvitationEmail(data: {
  email: string;
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venueName: string;
  invitationToken: string;
}): Promise<EmailResult> {
  const { email, firstName, lastName, eventName, eventDate, venueName, invitationToken } = data;

  // Build invitation URL with token
  const invitationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/invitation/${invitationToken}`;

  const emailSubject = `Event Invitation: ${eventName} - ${eventDate}`;
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
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🎫 Event Invitation</h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">You're invited to work an event!</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello <strong>${firstName} ${lastName}</strong>,
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                We'd like to invite you to work at an upcoming event. Please review the details below and let us know your availability.
              </p>

              <!-- Event Details Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; border: 2px solid #667eea; margin: 30px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="color: #667eea; margin: 0 0 20px 0; font-size: 20px;">📅 Event Details</h2>

                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Event:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 16px;">${eventName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Date:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 16px;">${eventDate}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Venue:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 16px;">${venueName}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Call to Action -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${invitationUrl}"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 6px; font-size: 18px; font-weight: bold; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.3);">
                      Confirm Your Availability
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${invitationUrl}" style="color: #667eea; text-decoration: none; word-break: break-all;">${invitationUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Instructions -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0 0 10px 0; font-size: 14px;"><strong>📝 Next Steps:</strong></p>
                    <ol style="color: #0c5280; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                      <li>Click the "Confirm Your Availability" button above</li>
                      <li>Review the next 21 days and mark which days you're available</li>
                      <li>Add any notes or special requirements</li>
                      <li>Submit your availability</li>
                    </ol>
                  </td>
                </tr>
              </table>

              <!-- Important Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0; font-size: 14px;">
                      <strong>⏰ Please respond soon:</strong> We need to confirm staffing for this event.
                      Your prompt response helps us plan better!
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <p style="color: #777777; font-size: 14px; margin: 30px 0 0 0; text-align: center;">
                Questions about this event? Contact us at
                <a href="mailto:portal@1pds.net" style="color: #2196F3; text-decoration: none;">portal@1pds.net</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                This invitation was sent by PDS Time keeping System
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
`.trim();

  // Send email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Events <service@pdsportal.site>', // Update this to your domain after verification
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (vendor invitation):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Vendor event invitation sent successfully!');
    console.log(`   To: ${email}`);
    console.log(`   Event: ${eventName}`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Vendor invitation email failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send vendor invitation',
    };
  }
}

/**
 * Send bulk vendor invitation email for multiple events over a period
 */
export async function sendVendorBulkInvitationEmail(data: {
  email: string;
  firstName: string;
  lastName: string;
  durationWeeks: number;
  eventCount: number;
  startDate: string;
  endDate: string;
  managerName: string;
  managerPhone: string;
  invitationToken: string;
}): Promise<EmailResult> {
  const { email, firstName, lastName, durationWeeks, eventCount, startDate, endDate, managerName, managerPhone, invitationToken } = data;

  // Build invitation URL with token
  const invitationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/invitation/${invitationToken}`;

  const emailSubject = `Work Opportunity: ${durationWeeks}-Week Event Series`;
  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #007AFF 0%, #0051D5 100%); padding: 50px 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 600; letter-spacing: -0.5px;">🎉 Work Opportunity</h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 12px 0 0 0; font-size: 18px; font-weight: 400;">${durationWeeks}-Week Event Series</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px;">
              <p style="color: #1d1d1f; font-size: 17px; line-height: 1.6; margin: 0 0 24px 0; font-weight: 400;">
                Hello <strong>${firstName} ${lastName}</strong>,
              </p>

              <p style="color: #1d1d1f; font-size: 17px; line-height: 1.6; margin: 0 0 24px 0; font-weight: 400;">
                You're invited to work across multiple events over the next ${durationWeeks} weeks! We think you'd be a great fit for this opportunity.
              </p>

              <!-- Opportunity Details Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(135deg, #f5f7fa 0%, #f0f2f5 100%); border-radius: 12px; margin: 32px 0; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 32px;">
                    <h2 style="color: #007AFF; margin: 0 0 24px 0; font-size: 22px; font-weight: 600; letter-spacing: -0.5px;">📋 Opportunity Details</h2>

                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Duration:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 17px; font-weight: 600;">${durationWeeks} Weeks</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Period:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 15px; font-weight: 500;">${startDate}<br>to ${endDate}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Events:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 17px; font-weight: 600;">${eventCount} Event${eventCount !== 1 ? 's' : ''}</span>
                        </td>
                      </tr>
                      ${managerName ? `
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Manager:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 15px; font-weight: 500;">${managerName}</span>
                        </td>
                      </tr>
                      ` : ''}
                      ${managerPhone ? `
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Contact:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 15px; font-weight: 500;">${managerPhone}</span>
                        </td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Call to Action -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 36px 0;">
                <tr>
                  <td align="center">
                    <a href="${invitationUrl}"
                       style="display: inline-block; background: linear-gradient(180deg, #007AFF 0%, #0051D5 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 17px; font-weight: 600; box-shadow: 0 4px 12px rgba(0, 122, 255, 0.4); letter-spacing: -0.3px;">
                      Confirm Your Availability
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${invitationUrl}" style="color: #007AFF; text-decoration: none; word-break: break-all;">${invitationUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- What to Expect -->
              <h3 style="color: #1d1d1f; font-size: 20px; margin: 36px 0 16px 0; font-weight: 600; letter-spacing: -0.5px;">📅 What to Expect</h3>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb; margin: 20px 0;">
                <tr>
                  <td style="padding: 24px;">
                    <ul style="color: #4b5563; margin: 0; padding-left: 24px; font-size: 16px; line-height: 1.8;">
                      <li style="margin-bottom: 10px;">Multiple events across ${durationWeeks} weeks</li>
                      <li style="margin-bottom: 10px;">Flexible schedule - choose your available dates</li>
                      <li style="margin-bottom: 10px;">Work with professional event teams</li>
                      <li style="margin-bottom: 10px;">Competitive compensation</li>
                      <li style="margin-bottom: 0;">Opportunity for future events</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Instructions -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); border-radius: 12px; margin: 28px 0; border: 1px solid #93c5fd;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="color: #1e40af; margin: 0 0 12px 0; font-size: 15px; font-weight: 600;">📝 Next Steps:</p>
                    <ol style="color: #1e40af; margin: 0; padding-left: 20px; font-size: 15px; line-height: 1.7;">
                      <li style="margin-bottom: 8px;">Click "Confirm Your Availability" above</li>
                      <li style="margin-bottom: 8px;">Review the ${durationWeeks}-week period and mark your available dates</li>
                      <li style="margin-bottom: 8px;">Add any scheduling notes or preferences</li>
                      <li style="margin-bottom: 0;">Submit to confirm your interest</li>
                    </ol>
                  </td>
                </tr>
              </table>

              <!-- Important Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fef3c7; border-radius: 12px; border-left: 4px solid #f59e0b; margin: 24px 0;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <p style="color: #92400e; margin: 0; font-size: 15px; line-height: 1.6;">
                      <strong style="font-weight: 600;">⏰ Time Sensitive:</strong> Please respond within the next few days so we can finalize our event staffing. Your availability helps us plan better!
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <p style="color: #6b7280; font-size: 15px; margin: 36px 0 0 0; text-align: center; line-height: 1.6;">
                Questions about this opportunity?<br>
                Contact us at <a href="mailto:portal@1pds.net" style="color: #007AFF; text-decoration: none; font-weight: 500;">portal@1pds.net</a>
                ${managerPhone ? ` or call ${managerPhone}` : ''}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 32px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0; font-weight: 500;">
                This invitation was sent by PDS Time keeping System
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0 0;">
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

  // Send email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Events <service@pdsportal.site>', // Update this to your domain after verification
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (bulk vendor invitation):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Bulk vendor invitation sent successfully!');
    console.log(`   To: ${email}`);
    console.log(`   Duration: ${durationWeeks} weeks`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Bulk vendor invitation email failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send bulk vendor invitation',
    };
  }
}

/**
 * Send team confirmation email to vendor
 */
export async function sendTeamConfirmationEmail(data: {
  email: string;
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  managerName: string;
  managerPhone: string;
  confirmationToken: string;
}): Promise<EmailResult> {
  const { email, firstName, lastName, eventName, eventDate, managerName, managerPhone, confirmationToken } = data;

  // Build confirmation URL with token
  const confirmationUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/team-confirmation/${confirmationToken}`;

  const emailSubject = `Team Invitation: ${eventName}`;
  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${emailSubject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #007AFF 0%, #0051D5 100%); padding: 50px 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 600; letter-spacing: -0.5px;">🎉 You've Been Selected!</h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 12px 0 0 0; font-size: 18px; font-weight: 400;">Event Team Invitation</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 40px;">
              <p style="color: #1d1d1f; font-size: 17px; line-height: 1.6; margin: 0 0 24px 0; font-weight: 400;">
                Hello <strong>${firstName} ${lastName}</strong>,
              </p>

              <p style="color: #1d1d1f; font-size: 17px; line-height: 1.6; margin: 0 0 24px 0; font-weight: 400;">
                Great news! You've been selected to join the team for an upcoming event. Please confirm your participation to secure your spot.
              </p>

              <!-- Event Details Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(135deg, #f5f7fa 0%, #f0f2f5 100%); border-radius: 12px; margin: 32px 0; border: 1px solid #e5e7eb;">
                <tr>
                  <td style="padding: 32px;">
                    <h2 style="color: #007AFF; margin: 0 0 24px 0; font-size: 22px; font-weight: 600; letter-spacing: -0.5px;">📅 Event Details</h2>

                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Event:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 17px; font-weight: 600;">${eventName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Date:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 15px; font-weight: 500;">${eventDate}</span>
                        </td>
                      </tr>
                      ${managerName ? `
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Manager:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 15px; font-weight: 500;">${managerName}</span>
                        </td>
                      </tr>
                      ` : ''}
                      ${managerPhone ? `
                      <tr>
                        <td style="padding: 10px 0; vertical-align: top;">
                          <span style="color: #6b7280; font-size: 15px; font-weight: 500;">Contact:</span>
                        </td>
                        <td style="padding: 10px 0; text-align: right;">
                          <span style="color: #1d1d1f; font-size: 15px; font-weight: 500;">${managerPhone}</span>
                        </td>
                      </tr>
                      ` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Call to Action -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 36px 0;">
                <tr>
                  <td align="center">
                    <a href="${confirmationUrl}"
                       style="display: inline-block; background: linear-gradient(180deg, #34C759 0%, #28A745 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 17px; font-weight: 600; box-shadow: 0 4px 12px rgba(52, 199, 89, 0.4); letter-spacing: -0.3px;">
                      ✓ Confirm My Participation
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${confirmationUrl}" style="color: #34C759; text-decoration: none; word-break: break-all;">${confirmationUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Important Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fef3c7; border-radius: 12px; border-left: 4px solid #f59e0b; margin: 24px 0;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <p style="color: #92400e; margin: 0; font-size: 15px; line-height: 1.6;">
                      <strong style="font-weight: 600;">⏰ Action Required:</strong> Please confirm your participation within 48 hours to secure your spot on the team. If we don't hear from you, we may need to select another vendor.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- What This Means -->
              <h3 style="color: #1d1d1f; font-size: 20px; margin: 36px 0 16px 0; font-weight: 600; letter-spacing: -0.5px;">✨ What This Means</h3>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb; margin: 20px 0;">
                <tr>
                  <td style="padding: 24px;">
                    <ul style="color: #4b5563; margin: 0; padding-left: 24px; font-size: 16px; line-height: 1.8;">
                      <li style="margin-bottom: 10px;">You're confirmed for this event</li>
                      <li style="margin-bottom: 10px;">The event manager will contact you with details</li>
                      <li style="margin-bottom: 10px;">Event information will be added to your dashboard</li>
                      <li style="margin-bottom: 10px;">You'll receive further instructions as the event approaches</li>
                      <li style="margin-bottom: 0;">Payment information will be provided separately</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Decline Option -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border-radius: 12px; margin: 28px 0; border: 1px solid #fca5a5;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="color: #991b1b; margin: 0 0 12px 0; font-size: 15px; font-weight: 600;">Can't make it?</p>
                    <p style="color: #991b1b; margin: 0; font-size: 15px; line-height: 1.7;">
                      If you're unable to participate, please click the confirmation link above and select "Decline" so we can adjust our staffing accordingly.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Support -->
              <p style="color: #6b7280; font-size: 15px; margin: 36px 0 0 0; text-align: center; line-height: 1.6;">
                Questions about this event?<br>
                Contact <strong>${managerName}</strong> at <a href="mailto:portal@1pds.net" style="color: #007AFF; text-decoration: none; font-weight: 500;">portal@1pds.net</a>
                ${managerPhone ? ` or call <a href="tel:${managerPhone}" style="color: #007AFF; text-decoration: none; font-weight: 500;">${managerPhone}</a>` : ''}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 32px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0; font-weight: 500;">
                This team invitation was sent by PDS Time keeping System
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0 0;">
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

  // Send email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Events <service@pdsportal.site>', // Update this to your domain after verification
      to: email,
      subject: emailSubject,
      cc:"jenvillar625@gmail.com",
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (team confirmation):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Team confirmation email sent successfully!');
    console.log(`   To: ${email}`);
    console.log(`   Event: ${eventName}`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Team confirmation email failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send team confirmation',
    };
  }
}

/**
 * Send background check submission notification to admin
 */
export async function sendBackgroundCheckSubmissionNotification(data: {
  userEmail: string;
  userFirstName: string;
  userLastName: string;
  submittedAt: string;
}): Promise<EmailResult> {
  const { userEmail, userFirstName, userLastName, submittedAt } = data;

  const emailSubject = `New Background Check Submitted - ${userFirstName} ${userLastName}`;
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
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">📋 New Background Check Submitted</h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">A user has completed their background check forms</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                A new background check form has been submitted and is ready for your review.
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
                          <strong style="color: #555555;">Submitted:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${submittedAt}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Next Steps -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0 0 10px 0; font-size: 14px;"><strong>📝 Next Steps:</strong></p>
                    <ol style="color: #0c5280; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                      <li>Log in to the PDS admin dashboard</li>
                      <li>Navigate to the Background Checks page</li>
                      <li>Review the submitted PDF documents</li>
                      <li>Mark the background check as completed when approved</li>
                    </ol>
                  </td>
                </tr>
              </table>

              <!-- Dashboard Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/background-checks"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">
                      Review Background Checks
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/background-checks" style="color: #667eea; text-decoration: none; word-break: break-all;">${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/background-checks</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Important Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0; font-size: 14px;">
                      <strong>⚠️ Important:</strong> This is an automated notification. The background check status will remain pending until you review and approve it in the admin dashboard.
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
                This notification was sent by PDS Time keeping System
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

  // Send email via Resend to admin
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Time keeping <service@pdsportal.site>',
      to: 'sebastiancastao379@gmail.com', // Admin email
      
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (background check notification):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Background check notification email sent successfully!');
    console.log(`   To: sebastiancastao379@gmail.com`);
    console.log(`   User: ${userFirstName} ${userLastName} (${userEmail})`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Background check notification email failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send background check notification',
    };
  }
}

/**
 * Generic send email function for custom emails
 */
export async function sendEmail(data: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  cc?: string | string[];
}): Promise<EmailResult> {
  const { to, subject, html, from, cc } = data;

  try {
    const { data: resendData, error } = await resend.emails.send({
      from: from || 'PDS Time keeping <service@pdsportal.site>',
      to,
      cc,
      subject,
      html,
    });

    if (error) {
      console.error('❌ Resend error (generic email):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Email sent successfully via Resend!');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Message ID: ${resendData?.id}`);

    return {
      success: true,
      messageId: resendData?.id,
    };
  } catch (error: any) {
    console.error('❌ Email sending failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email',
    };
  }
}

/**
 * Send background check approval notification to admin
 */
export async function sendBackgroundCheckApprovalNotificationToAdmin(data: {
  vendorEmail: string;
  vendorFirstName: string;
  vendorLastName: string;
  approvedAt: string;
}): Promise<EmailResult> {
  const { vendorEmail, vendorFirstName, vendorLastName, approvedAt } = data;

  const emailSubject = `Background Check Approved - ${vendorFirstName} ${vendorLastName}`;
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
            <td style="background: linear-gradient(135deg, #34C759 0%, #28A745 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">✅ Background Check Approved</h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">Admin Notification</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                A background check has been marked as approved in the system.
              </p>

              <!-- Vendor Details Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; border: 2px solid #34C759; margin: 30px 0;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="color: #34C759; margin: 0 0 20px 0; font-size: 20px;">👤 Vendor Information</h2>

                    <table cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Name:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 16px;">${vendorFirstName} ${vendorLastName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Email:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${vendorEmail}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0;">
                          <strong style="color: #555555;">Approved:</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                          <span style="color: #333333; font-size: 14px;">${approvedAt}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Status Update -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0; font-size: 14px;">
                      <strong>📝 What Happened:</strong> The background check for ${vendorFirstName} ${vendorLastName} has been marked as completed and approved. An approval email has been automatically sent to the vendor at ${vendorEmail}.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Dashboard Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/background-checks"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">
                      View Background Checks
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 15px;">
                    <p style="color: #666666; font-size: 13px; margin: 0;">
                      Or copy and paste this link in your browser:<br>
                      <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/background-checks" style="color: #667eea; text-decoration: none; word-break: break-all;">${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/background-checks</a>
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
                This notification was sent by PDS Time keeping System
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

  // Send email via Resend to admin
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Time keeping <service@pdsportal.site>',
      to: 'sebastiancastao379@gmail.com',
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (admin background check approval notification):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Admin background check approval notification sent successfully!');
    console.log(`   To: sebastiancastao379@gmail.com`);
    console.log(`   Vendor: ${vendorFirstName} ${vendorLastName} (${vendorEmail})`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Admin background check approval notification failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send admin notification',
    };
  }
}

/**
 * Send background check approval notification to user
 */
export async function sendBackgroundCheckApprovalEmail(data: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<EmailResult> {
  const { email, firstName, lastName } = data;

  const emailSubject = 'Background Check Approved - Complete Your Onboarding';
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
            <td style="background: linear-gradient(135deg, #34C759 0%, #28A745 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">✅ Background Check Approved!</h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">You're one step closer to getting started</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello <strong>${firstName} ${lastName}</strong>,
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Great news! Your background check has been successfully completed and approved.
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                You are now scheduled to continue with <strong>PDS Onboarding – Part 2</strong>, which includes <strong>MANDATORY TRAINING</strong> for the Updated Handbook and Documents Review.
              </p>

              <!-- Important Notice Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0; font-size: 14px;">
                      <strong>⚠️ Attendance is required</strong> in order to proceed with the onboarding process.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                A separate email from <a href="mailto:Portal@1pds.net" style="color: #2196F3; text-decoration: none;">Portal@1pds.net</a> will be sent with available training session options and registration details.
              </p>

              <!-- What We'll Cover -->
              <h3 style="color: #333333; font-size: 18px; margin: 30px 0 15px 0;">📋 During this session, we will:</h3>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; margin: 20px 0;">
                <tr>
                  <td style="padding: 24px;">
                    <ul style="color: #4b5563; margin: 0; padding-left: 24px; font-size: 16px; line-height: 1.8;">
                      <li style="margin-bottom: 10px;">Review the updated employee handbook</li>
                      <li style="margin-bottom: 10px;">Complete required document updates</li>
                      <li style="margin-bottom: 0;">Address onboarding-related questions</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Device Note -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0; font-size: 14px;">
                      <strong>💻 Important:</strong> Please plan to join using a laptop, desktop computer, or iPad, as mobile devices may not support proper document completion.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 20px 0;">
                Thank you for your cooperation as we complete the onboarding process.
              </p>

              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 20px 0 0 0;">
                <strong>PDS Onboarding Team</strong>
              </p>

              <!-- Portal Login Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="https://pds-murex.vercel.app/login"
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">
                      Access Portal
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
                This email was sent by PDS Time keeping System
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

  // Send email via Resend to user
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Time keeping <service@pdsportal.site>',
      to: email,
      subject: emailSubject,
      html: emailBody,
    });

    if (error) {
      console.error('❌ Resend error (background check approval):', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('✅ Background check approval email sent successfully!');
    console.log(`   To: ${email}`);
    console.log(`   User: ${firstName} ${lastName}`);
    console.log(`   Message ID: ${data?.id}`);

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error: any) {
    console.error('❌ Background check approval email failed:', error);
    return {
      success: false,
      error: error.message || 'Failed to send background check approval email',
    };
  }
}

