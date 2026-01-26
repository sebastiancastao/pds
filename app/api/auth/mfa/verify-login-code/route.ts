// PDS Time keepingSystem - Verify Email MFA Code (Login)
// Verifies email code during login

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyEmailMFACode } from '@/lib/auth';
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
    const { code } = body;

    // Validate code
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Valid 6-digit verification code is required' },
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

    console.log('[DEBUG] Verify Email MFA Code (Login) - User:', userId);

    // Get stored code from database
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('mfa_login_code, mfa_login_code_expires_at')
      .eq('id', userId)
      .single();

    if (fetchError || !userData) {
      console.error('[DEBUG] Failed to fetch user data:', fetchError);
      return NextResponse.json(
        { error: 'Failed to verify code. Please try again.' },
        { status: 500 }
      );
    }

    if (!userData.mfa_login_code || !userData.mfa_login_code_expires_at) {
      console.log('[DEBUG] No verification code found');
      return NextResponse.json(
        { error: 'No verification code found. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check if code expired
    const expiresAt = new Date(userData.mfa_login_code_expires_at);
    if (expiresAt < new Date()) {
      console.log('[DEBUG] Verification code expired');
      
      await logAuditEvent({
        userId,
        action: 'mfa_login_verification_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          reason: 'code_expired'
        },
      });

      return NextResponse.json(
        { error: 'Verification code has expired. Please request a new code.' },
        { status: 400 }
      );
    }

    // Verify the code
    const isValid = await verifyEmailMFACode(code, userData.mfa_login_code);

    if (!isValid) {
      console.log('[DEBUG] Invalid verification code');
      
      await logAuditEvent({
        userId,
        action: 'mfa_login_verification_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          reason: 'invalid_code'
        },
      });

      return NextResponse.json(
        { error: 'Invalid code. Please try again.' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] Email login code verified successfully');

    // Clear the login code from users table
    await supabaseAdmin
      .from('users')
      .update({
        mfa_login_code: null,
        mfa_login_code_expires_at: null,
      })
      .eq('id', userId);

    // Log success
    await logAuditEvent({
      userId,
      action: 'mfa_login_success',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        method: 'email_code'
      },
    });

    console.log('[DEBUG] MFA login verification successful');

    return NextResponse.json({
      success: true,
      message: 'MFA verified successfully',
    });

  } catch (error: any) {
    console.error('Verify login MFA code error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

