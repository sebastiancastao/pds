// PDS Time Tracking System - SMS MFA Setup API
// Handles phone number registration and verification code sending

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '@/lib/audit';
import { isValidUUID } from '@/lib/supabase';
import { sendSMSVerificationCode, generateVerificationCode, isValidPhoneNumber, formatPhoneNumber } from '@/lib/sms';

function getClientIP(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0] || 
         headers.get('x-real-ip') || 
         'unknown';
}

function getUserAgent(headers: Headers): string {
  return headers.get('user-agent') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const clientIP = getClientIP(request.headers);
    const userAgent = getUserAgent(request.headers);

    // Get authenticated user from Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the JWT token and get the user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error('Failed to verify user token:', userError);
      return NextResponse.json(
        { error: 'Authentication failed. Please log in again.' },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email || '';

    if (!isValidUUID(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { phoneNumber, action } = body;

    // Action can be 'send_code' or 'verify_code'
    if (action === 'send_code') {
      // Validate phone number
      if (!phoneNumber || typeof phoneNumber !== 'string') {
        return NextResponse.json(
          { error: 'Phone number is required' },
          { status: 400 }
        );
      }

      if (!isValidPhoneNumber(phoneNumber)) {
        return NextResponse.json(
          { error: 'Invalid phone number. Please enter a valid US (10 digits) or Colombian (57 + 10 digits) phone number.' },
          { status: 400 }
        );
      }

      const formattedPhone = formatPhoneNumber(phoneNumber);

      console.log('[DEBUG] SMS MFA Setup - Sending code to phone:', formattedPhone);

      // Generate verification code
      const code = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store code in database
      const { error: insertError } = await supabaseAdmin
        .from('mfa_sms_codes')
        .insert({
          user_id: userId,
          phone_number: formattedPhone,
          code,
          expires_at: expiresAt.toISOString(),
          verified: false,
          attempts: 0,
        });

      if (insertError) {
        console.error('[DEBUG] Failed to store SMS code:', insertError);
        return NextResponse.json(
          { error: 'Failed to generate verification code' },
          { status: 500 }
        );
      }

      // Send SMS
      const smsResult = await sendSMSVerificationCode(formattedPhone, code);

      if (!smsResult.success) {
        console.error('[DEBUG] Failed to send SMS:', smsResult.error);
        
        // Delete the code since SMS failed
        await supabaseAdmin
          .from('mfa_sms_codes')
          .delete()
          .eq('user_id', userId)
          .eq('phone_number', formattedPhone);

        return NextResponse.json(
          { error: smsResult.error || 'Failed to send verification code' },
          { status: 500 }
        );
      }

      console.log('[DEBUG] SMS sent successfully');

      // Log audit event
      await logAuditEvent({
        userId,
        action: 'mfa_sms_code_sent',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: true,
        metadata: { 
          phoneNumber: formattedPhone,
          messageId: smsResult.messageId,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Verification code sent to your phone',
        phoneNumber: formattedPhone,
      });

    } else if (action === 'verify_code') {
      const { code } = body;

      if (!code || typeof code !== 'string' || code.length !== 6) {
        return NextResponse.json(
          { error: 'Please enter a valid 6-digit code' },
          { status: 400 }
        );
      }

      console.log('[DEBUG] SMS MFA Setup - Verifying code for user:', userId);

      // Get the most recent unverified code for this user
      const { data: smsCodeData, error: fetchError } = await supabaseAdmin
        .from('mfa_sms_codes')
        .select('*')
        .eq('user_id', userId)
        .eq('verified', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (fetchError || !smsCodeData) {
        console.error('[DEBUG] No verification code found:', fetchError);
        return NextResponse.json(
          { error: 'No verification code found. Please request a new code.' },
          { status: 400 }
        );
      }

      // Check if code is expired
      if (new Date(smsCodeData.expires_at) < new Date()) {
        return NextResponse.json(
          { error: 'Verification code has expired. Please request a new code.' },
          { status: 400 }
        );
      }

      // Check attempts
      if (smsCodeData.attempts >= 3) {
        return NextResponse.json(
          { error: 'Too many failed attempts. Please request a new code.' },
          { status: 400 }
        );
      }

      // Verify code
      if (smsCodeData.code !== code) {
        // Increment attempts
        await supabaseAdmin
          .from('mfa_sms_codes')
          .update({ attempts: smsCodeData.attempts + 1 })
          .eq('id', smsCodeData.id);

        return NextResponse.json(
          { error: `Invalid code. ${2 - smsCodeData.attempts} attempts remaining.` },
          { status: 400 }
        );
      }

      console.log('[DEBUG] Code verified successfully');

      // Mark code as verified
      await supabaseAdmin
        .from('mfa_sms_codes')
        .update({ verified: true })
        .eq('id', smsCodeData.id);

      // Update user's phone number
      await supabaseAdmin
        .from('users')
        .update({ phone_number: smsCodeData.phone_number })
        .eq('id', userId);

      // Update profile to mark MFA as enabled
      const { data: profileData } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (profileData) {
        await supabaseAdmin
          .from('profiles')
          .update({
            mfa_enabled: true,
            mfa_secret: 'SMS_ENABLED', // Marker to indicate SMS MFA is enabled
          })
          .eq('id', profileData.id);
      }

      // Generate backup codes (same as before)
      const backupCodes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        backupCodes.push(code);
      }

      // Hash and store backup codes
      const bcrypt = require('bcryptjs');
      const hashedBackupCodes = await Promise.all(
        backupCodes.map(code => bcrypt.hash(code, 10))
      );

      if (profileData) {
        await supabaseAdmin
          .from('profiles')
          .update({ backup_codes: hashedBackupCodes })
          .eq('id', profileData.id);
      }

      // Log audit event
      await logAuditEvent({
        userId,
        action: 'mfa_sms_enabled',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: true,
        metadata: { 
          phoneNumber: smsCodeData.phone_number,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Phone number verified successfully',
        backupCodes, // Return unhashed codes to user for download
      });

    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use send_code or verify_code.' },
        { status: 400 }
      );
    }

  } catch (error: any) {
    console.error('SMS MFA setup error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

