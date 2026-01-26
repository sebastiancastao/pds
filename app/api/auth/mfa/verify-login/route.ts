// PDS Time Keeping System - MFA Login Verification API
// Verifies MFA code or backup code during login

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMFAToken, verifyBackupCode } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { isValidUUID } from '@/lib/supabase';

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

    // Parse request body
    const body = await request.json();
    const { code, isBackupCode } = body;

    // Validate inputs
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      );
    }

    // Validate code format based on type
    if (isBackupCode) {
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        return NextResponse.json(
          { error: 'Backup code must be 8 alphanumeric characters' },
          { status: 400 }
        );
      }
    } else {
      if (!/^\d{6}$/.test(code)) {
        return NextResponse.json(
          { error: 'TOTP code must be 6 digits' },
          { status: 400 }
        );
      }
    }

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

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

    if (!isValidUUID(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] MFA Login Verify - User:', userId, 'Using backup code:', isBackupCode);

    // Get user's MFA settings using service role
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('mfa_secret, mfa_enabled, backup_codes')
      .eq('user_id', userId)
      .single();

    if (profileError || !profileData) {
      console.error('[DEBUG] Failed to get profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to verify MFA. Please try again.' },
        { status: 500 }
      );
    }

    if (!profileData.mfa_enabled) {
      console.log('[DEBUG] MFA not enabled for user');
      return NextResponse.json(
        { error: 'MFA is not enabled for your account' },
        { status: 400 }
      );
    }

    let isValid = false;
    let usedBackupCodeIndex = -1;

    if (isBackupCode) {
      // Verify backup code
      console.log('[DEBUG] Verifying backup code...');
      
      if (!profileData.backup_codes || profileData.backup_codes.length === 0) {
        console.log('[DEBUG] No backup codes available');
        await logAuditEvent({
          userId,
          action: 'mfa_login_failed',
          resourceType: 'auth',
          ipAddress: clientIP,
          userAgent,
          success: false,
          metadata: { 
            reason: 'no_backup_codes'
          },
        });

        return NextResponse.json(
          { error: 'No backup codes available' },
          { status: 400 }
        );
      }

      usedBackupCodeIndex = await verifyBackupCode(code, profileData.backup_codes);
      isValid = usedBackupCodeIndex !== -1;

      console.log('[DEBUG] Backup code valid:', isValid, 'Index:', usedBackupCodeIndex);
    } else {
      // Verify TOTP code
      console.log('[DEBUG] Verifying TOTP code...');
      
      if (!profileData.mfa_secret) {
        console.log('[DEBUG] No MFA secret found');
        return NextResponse.json(
          { error: 'MFA secret not found' },
          { status: 500 }
        );
      }

      isValid = verifyMFAToken(code, profileData.mfa_secret);
      console.log('[DEBUG] TOTP code valid:', isValid);
    }

    if (!isValid) {
      console.log('[DEBUG] MFA verification failed');
      
      await logAuditEvent({
        userId,
        action: 'mfa_login_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          reason: isBackupCode ? 'invalid_backup_code' : 'invalid_totp_code'
        },
      });

      return NextResponse.json(
        { error: 'Invalid code. Please try again.' },
        { status: 400 }
      );
    }

    // If backup code was used, remove it from the array
    if (isBackupCode && usedBackupCodeIndex !== -1) {
      console.log('[DEBUG] Removing used backup code...');
      
      const updatedBackupCodes = [...profileData.backup_codes];
      updatedBackupCodes.splice(usedBackupCodeIndex, 1);

      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          backup_codes: updatedBackupCodes,
        })
        .eq('user_id', userId);

      if (updateError) {
        console.error('[DEBUG] Failed to update backup codes:', updateError);
        // Don't fail the login, just log the error
      } else {
        console.log('[DEBUG] Backup code removed, remaining:', updatedBackupCodes.length);
      }
    }

    // Success! Log the event
    await logAuditEvent({
      userId,
      action: 'mfa_login_success',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        method: isBackupCode ? 'backup_code' : 'totp',
        backupCodesRemaining: isBackupCode ? profileData.backup_codes.length - 1 : undefined
      },
    });

    console.log('[DEBUG] MFA verification successful');

    return NextResponse.json({
      success: true,
      message: 'MFA verified successfully',
    });

  } catch (error: any) {
    console.error('MFA login verification error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}











