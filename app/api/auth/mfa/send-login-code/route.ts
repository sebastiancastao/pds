// PDS Time Keeping System - Send Email MFA Code (Login)
// Sends verification code via email during login

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateEmailMFACode, hashEmailMFACode } from '@/lib/auth';
import { sendMFAVerificationEmail } from '@/lib/email';
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
    const userEmail = user.email || '';

    if (!isValidUUID(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] Send Email MFA Code (Login) - User:', userId);

    // Check if MFA is enabled for this user
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('mfa_enabled')
      .eq('user_id', userId)
      .single();

    if (profileError || !profileData) {
      console.error('[DEBUG] Failed to fetch profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to verify MFA status. Please try again.' },
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

    // Generate 6-digit verification code
    const code = generateEmailMFACode();
    const hashedCode = await hashEmailMFACode(code);
    
    // Store code in database with 10-minute expiration
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store hashed code in users table (temporary storage)
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        mfa_login_code: hashedCode,
        mfa_login_code_expires_at: expiresAt.toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[DEBUG] Failed to store MFA login code:', updateError);
      return NextResponse.json(
        { error: 'Failed to generate verification code. Please try again.' },
        { status: 500 }
      );
    }

    // Send email with verification code
    const emailResult = await sendMFAVerificationEmail(userEmail, code, 'login');

    if (!emailResult.success) {
      console.error('[DEBUG] Failed to send email:', emailResult.error);
      return NextResponse.json(
        { error: 'Failed to send verification email. Please try again.' },
        { status: 500 }
      );
    }

    console.log('[DEBUG] MFA login code sent successfully to:', userEmail);

    // Log audit event
    await logAuditEvent({
      userId,
      action: 'mfa_login_code_sent',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        email: userEmail,
        codeExpires: expiresAt.toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Verification code sent to your email',
      expiresAt: expiresAt.toISOString(),
    });

  } catch (error: any) {
    console.error('Send login MFA code error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

