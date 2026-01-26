// PDS Time keeping System - MFA Verification API
// Verifies MFA code and enables MFA for user account

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMFAToken, generateBackupCodes, hashBackupCodes } from '@/lib/auth';
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
    const { code, secret } = body;

    // Validate inputs
    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      );
    }

    if (!secret || typeof secret !== 'string') {
      return NextResponse.json(
        { error: 'MFA secret is required' },
        { status: 400 }
      );
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

    console.log('[DEBUG] MFA Verify - Verifying code for user:', userId);

    // Verify the MFA code
    const isValid = verifyMFAToken(code, secret);

    if (!isValid) {
      console.log('[DEBUG] MFA Verify - Invalid code');
      
      await logAuditEvent({
        userId,
        action: 'mfa_verification_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          reason: 'invalid_code'
        },
      });

      return NextResponse.json(
        { error: 'Invalid verification code. Please try again.' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] MFA Verify - Code verified successfully');

    // Generate backup codes
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    console.log('[DEBUG] MFA Verify - Backup codes generated');

    // Update user profile with MFA settings using service role
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        mfa_secret: secret,
        mfa_enabled: true,
        backup_codes: hashedBackupCodes,
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('[DEBUG] MFA Verify - Failed to update profile:', updateError);
      
      await logAuditEvent({
        userId,
        action: 'mfa_enable_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          error: updateError.message
        },
      });

      return NextResponse.json(
        { error: 'Failed to enable MFA. Please try again.' },
        { status: 500 }
      );
    }

    console.log('[DEBUG] MFA Verify - MFA enabled successfully');

    // Log success
    await logAuditEvent({
      userId,
      action: 'mfa_enabled',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        backupCodesGenerated: backupCodes.length
      },
    });

    return NextResponse.json({
      success: true,
      message: 'MFA enabled successfully',
      backupCodes: backupCodes, // Return unhashed codes for user to save
    });

  } catch (error: any) {
    console.error('MFA verification error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}












