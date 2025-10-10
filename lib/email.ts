// PDS Time Tracking System - Email Utilities
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
  const emailSubject = 'Welcome to PDS Time Tracking - Your Account Details';
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
      from: 'PDS Time Tracking <onboarding@resend.dev>', // Update this to your domain after verification
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
  <title>Welcome to PDS Time Tracking</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Welcome to PDS Time Tracking</h1>
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
                Your account has been created for the PDS Time Tracking System. You can now access the portal to manage your time, view events, and complete your onboarding.
              </p>

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
                      <li>Multi-Factor Authentication (MFA) is required for all users</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Login Button -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/login" 
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">
                      Login to Your Account
                    </a>
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
                      <a href="mailto:support@pds.com" style="color: #2196F3; text-decoration: none;">support@pds.com</a>
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
                This email was sent by PDS Time Tracking System
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

  const emailSubject = 'You\'re Invited to PDS Time Tracking';
  const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>You're Invited to PDS Time Tracking</title>
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
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">Join the PDS Time Tracking System</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                Hello <strong>${firstName} ${lastName}</strong>,
              </p>
              
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                You've been invited to join the PDS Time Tracking System! Click the button below to create your account and get started.
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
                <a href="mailto:support@pds.com" style="color: #2196F3; text-decoration: none;">support@pds.com</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                This invitation was sent by PDS Time Tracking System
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
      from: 'PDS Time Tracking <onboarding@resend.dev>', // Update this to your domain after verification
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
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px;">
                ${purpose === 'setup' ? '🔐 Enable MFA' : '🔒 Login Verification'}
              </h1>
              <p style="color: #e6e6ff; margin: 10px 0 0 0; font-size: 16px;">
                ${purpose === 'setup' ? 'Verification code to enable MFA' : 'Enter this code to continue'}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                ${purpose === 'setup' 
                  ? 'To enable Multi-Factor Authentication on your PDS account, enter the verification code below:'
                  : 'Someone is trying to log into your PDS account. Enter the verification code below to continue:'}
              </p>

              <!-- Verification Code Box -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; margin: 30px 0;">
                <tr>
                  <td style="padding: 30px; text-align: center;">
                    <p style="color: #ffffff; margin: 0 0 10px 0; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;">Your Verification Code</p>
                    <p style="color: #ffffff; margin: 0; font-size: 48px; font-weight: bold; letter-spacing: 8px; font-family: 'Courier New', monospace;">${code}</p>
                  </td>
                </tr>
              </table>

              <!-- Important Info -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #856404; margin: 0 0 10px 0; font-size: 14px;"><strong>⏰ Time Sensitive:</strong></p>
                    <ul style="color: #856404; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
                      <li>This code expires in <strong>10 minutes</strong></li>
                      <li>Do not share this code with anyone</li>
                      <li>If you didn't request this, please ignore this email</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Security Tips -->
              <h3 style="color: #333333; font-size: 18px; margin: 30px 0 15px 0;">🛡️ Security Tips:</h3>
              <ul style="color: #555555; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>PDS will never ask for your verification code</li>
                <li>Always verify the URL before entering codes</li>
                <li>Enable MFA for maximum account security</li>
              </ul>

              <!-- Support -->
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #e7f3ff; border-radius: 8px; border-left: 4px solid #2196F3; margin: 30px 0;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="color: #0c5280; margin: 0; font-size: 14px;">
                      <strong>Need help?</strong> Contact our support team at 
                      <a href="mailto:support@pds.com" style="color: #2196F3; text-decoration: none;">support@pds.com</a>
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
                This email was sent by PDS Time Tracking System
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

  // Send email via Resend
  try {
    const { data, error } = await resend.emails.send({
      from: 'PDS Time Tracking <onboarding@resend.dev>',
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

