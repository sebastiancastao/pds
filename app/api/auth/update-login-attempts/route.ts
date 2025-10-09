// PDS Time Tracking System - Update Login Attempts API
// Uses service role to bypass RLS for updating login attempts and account locks

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isRateLimited, getClientIP } from '@/lib/api-security';

/**
 * POST /api/auth/update-login-attempts
 * 
 * Updates failed login attempts and account lock status
 * Uses service role to bypass RLS
 * 
 * Security: Requires userId; rate limited to prevent abuse
 */
export async function POST(request: NextRequest) {
  try {
    // Extract client information
    const clientIP = getClientIP(request.headers);

    // Rate limiting
    const rateLimitKey = `update-login-attempts:${clientIP}`;
    if (isRateLimited(rateLimitKey, 20, 60000)) { // 20 requests per minute
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { userId, reset, increment, shouldLock } = body;

    // Validate userId
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
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

    let updateData: any = {};

    if (reset) {
      // Reset failed attempts on successful login
      updateData = {
        failed_login_attempts: 0,
        account_locked_until: null,
        last_login: new Date().toISOString(),
      };
    } else if (increment) {
      // Get current attempts count
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('failed_login_attempts')
        .eq('id', userId)
        .single();

      const newFailedAttempts = (userData?.failed_login_attempts || 0) + 1;

      updateData = {
        failed_login_attempts: newFailedAttempts,
      };

      // Lock account if too many failed attempts
      if (shouldLock) {
        updateData.account_locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
      }
    } else {
      return NextResponse.json(
        { error: 'Must specify either reset or increment' },
        { status: 400 }
      );
    }

    // Update user record
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId);

    if (updateError) {
      console.error('Update login attempts error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update login attempts' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: reset ? 'Login attempts reset' : 'Login attempts incremented',
    });

  } catch (error: any) {
    console.error('Update login attempts error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}





