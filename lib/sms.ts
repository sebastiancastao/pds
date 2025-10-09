// PDS Time Tracking System - SMS Service for MFA
// Twilio integration for sending SMS verification codes

import twilio from 'twilio';

// Initialize Twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

// Create client only if credentials are available
let twilioClient: ReturnType<typeof twilio> | null = null;

if (accountSid && authToken) {
  twilioClient = twilio(accountSid, authToken);
} else {
  console.warn('⚠️ Twilio credentials not configured. SMS sending will fail.');
}

interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Generate a random 6-digit verification code
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Format phone number to E.164 format
 * Supports: US (+1XXXXXXXXXX) and Colombia (+57XXXXXXXXXX)
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Colombian number: 57 + 10 digits (mobile starts with 3)
  if (digits.length === 12 && digits.startsWith('57')) {
    return `+${digits}`;
  }
  
  // US number: 10 digits
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // US with country code: 11 digits starting with 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // If it has + already, return as is
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // Default: assume US
  return `+1${digits}`;
}

/**
 * Validate phone number format
 * Supports: US (10 digits or 11 with country code) and Colombia (12 digits with 57)
 */
export function isValidPhoneNumber(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  
  // US: 10 digits or 11 digits starting with 1
  const isValidUS = digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
  
  // Colombia: 12 digits (57 + 10 digits, mobile starts with 3)
  const isValidColombian = digits.length === 12 && digits.startsWith('57') && digits.charAt(2) === '3';
  
  return isValidUS || isValidColombian;
}

/**
 * Send SMS verification code via Twilio
 * 
 * @param phoneNumber - Phone number in E.164 format (+1XXXXXXXXXX)
 * @param code - 6-digit verification code
 * @returns Promise with SMS result
 */
export async function sendSMSVerificationCode(
  phoneNumber: string,
  code: string
): Promise<SMSResult> {
  console.log('[SMS] Attempting to send verification code to:', phoneNumber);

  // Check if Twilio is configured
  if (!twilioClient || !fromNumber) {
    console.error('[SMS] ❌ Twilio not configured');
    return {
      success: false,
      error: 'SMS service not configured',
    };
  }

  // Validate phone number
  if (!isValidPhoneNumber(phoneNumber)) {
    return {
      success: false,
      error: 'Invalid phone number format',
    };
  }

  // Format phone number
  const formattedPhone = formatPhoneNumber(phoneNumber);

  // SMS message
  const message = `Your PDS Time Tracking verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this code, please contact support immediately.`;

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: fromNumber,
      to: formattedPhone,
    });

    console.log('[SMS] ✅ SMS sent successfully');
    console.log('[SMS] Message SID:', result.sid);
    console.log('[SMS] Status:', result.status);

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error: any) {
    console.error('[SMS] ❌ Failed to send SMS:', error);
    
    // Handle specific Twilio errors
    if (error.code === 21614) {
      return {
        success: false,
        error: 'Invalid phone number',
      };
    }
    
    if (error.code === 21608) {
      return {
        success: false,
        error: 'Phone number is not verified for trial account',
      };
    }

    return {
      success: false,
      error: error.message || 'Failed to send SMS',
    };
  }
}

/**
 * Send MFA code for login verification
 */
export async function sendMFALoginCode(
  phoneNumber: string,
  code: string
): Promise<SMSResult> {
  console.log('[SMS] Sending MFA login code to:', phoneNumber);
  
  if (!twilioClient || !fromNumber) {
    console.error('[SMS] ❌ Twilio not configured');
    return {
      success: false,
      error: 'SMS service not configured',
    };
  }

  const formattedPhone = formatPhoneNumber(phoneNumber);
  const message = `Your PDS login code is: ${code}\n\nValid for 10 minutes.`;

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: fromNumber,
      to: formattedPhone,
    });

    console.log('[SMS] ✅ MFA login code sent');
    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error: any) {
    console.error('[SMS] ❌ Failed to send MFA code:', error);
    return {
      success: false,
      error: error.message || 'Failed to send SMS',
    };
  }
}

