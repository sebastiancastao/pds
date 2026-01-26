// PDS Time keepingSystem - Pre-Login Account Check API
// Uses service role to bypass RLS for pre-authentication account validation

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isValidEmail } from '@/lib/supabase';
import { isRateLimited, getClientIP, getUserAgent } from '@/lib/api-security';
import { logAuditEvent } from '@/lib/audit';

/**
 * POST /api/auth/pre-login-check
 * 
 * Checks account status BEFORE authentication (bypasses RLS)
 * This is necessary because:
 * - RLS requires auth.uid() to be set
 * - We need to check account locks/status before login
 * - Service role key bypasses RLS safely for this specific check
 * 
 * Security: Only returns minimal, non-sensitive account status info
 */
export async function POST(request: NextRequest) {
  try {
    // Extract client information
    const clientIP = getClientIP(request.headers);
    const userAgent = getUserAgent(request.headers);

    // Rate limiting
    const rateLimitKey = `pre-login-check:${clientIP}`;
    if (isRateLimited(rateLimitKey, 10, 60000)) { // 10 requests per minute
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email } = body;

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Create service role client (bypasses RLS)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Query user status (bypasses RLS)
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, is_active, account_locked_until, failed_login_attempts, is_temporary_password')
      .eq('email', email.toLowerCase().trim())
      .single();

    // User not found - return generic response for security
    if (userError && userError.code === 'PGRST116') {
      // Log for security monitoring
      await logAuditEvent({
        userId: null,
        action: 'pre_login_check_user_not_found',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { email }
      });

      return NextResponse.json({
        userExists: false,
        canProceed: true, // Allow login attempt (will fail at auth step)
      });
    }

    // Database error
    if (userError) {
      console.error('Pre-login check database error:', userError);
      return NextResponse.json(
        { error: 'Database error occurred' },
        { status: 500 }
      );
    }

    // Check if account is inactive
    if (!userData.is_active) {
      await logAuditEvent({
        userId: userData.id,
        action: 'pre_login_check_inactive_account',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { email }
      });

      return NextResponse.json({
        userExists: true,
        canProceed: false,
        reason: 'inactive',
        message: 'Your account has been deactivated. Please contact support.',
      });
    }

    // Check if account is locked
    if (userData.account_locked_until) {
      const lockoutTime = new Date(userData.account_locked_until);
      if (lockoutTime > new Date()) {
        const minutesRemaining = Math.ceil((lockoutTime.getTime() - Date.now()) / 60000);

        await logAuditEvent({
          userId: userData.id,
          action: 'pre_login_check_locked_account',
          resourceType: 'auth',
          ipAddress: clientIP,
          userAgent,
          success: false,
          metadata: { email, lockoutTime, minutesRemaining }
        });

        return NextResponse.json({
          userExists: true,
          canProceed: false,
          reason: 'locked',
          message: `Account locked due to failed login attempts. Try again in ${minutesRemaining} minute(s).`,
          minutesRemaining,
        });
      }
    }

    // Account is valid - can proceed with login
    await logAuditEvent({
      userId: userData.id,
      action: 'pre_login_check_success',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        email,
        failedAttempts: userData.failed_login_attempts,
        isTemporaryPassword: userData.is_temporary_password
      }
    });

    return NextResponse.json({
      userExists: true,
      canProceed: true,
      userId: userData.id,
      failedAttempts: userData.failed_login_attempts,
      isTemporaryPassword: userData.is_temporary_password,
    });

  } catch (error: any) {
    console.error('Pre-login check error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}





