// PDS Time keeping System - Change Password API
// Allows authenticated users to change their password
// Updates temporary password status after successful change

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePassword } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { isValidUUID } from '@/lib/supabase';

// Rate limiting map (in-memory, replace with Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (record.count >= maxRequests) {
    return true;
  }

  record.count++;
  return false;
}

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
    // Extract client information
    const clientIP = getClientIP(request.headers);
    const userAgent = getUserAgent(request.headers);

    // Rate limiting: 5 password change attempts per 15 minutes
    const rateLimitKey = `change-password:${clientIP}`;
    if (isRateLimited(rateLimitKey, 5, 15 * 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many password change attempts. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate passwords
    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json(
        { error: 'Current password is required' },
        { status: 400 }
      );
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json(
        { error: 'New password is required' },
        { status: 400 }
      );
    }

    // Ensure passwords are different
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 }
      );
    }

    // Validate password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { 
          error: 'Password does not meet security requirements',
          details: passwordValidation.errors
        },
        { status: 400 }
      );
    }

    // Get authenticated user from Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    console.log('[DEBUG] Change Password - Token received:', token.substring(0, 20) + '...');

    // Create Supabase client (anon key for JWT verification)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    // Verify the JWT token and get the user
    console.log('[DEBUG] Verifying JWT token...');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError) {
      console.log('[DEBUG] Token verification error:', userError.message, userError.status);
    } else if (user) {
      console.log('[DEBUG] Token verified successfully for user:', user.id);
    }

    if (userError || !user) {
      console.error('Failed to verify user token:', userError);
      return NextResponse.json(
        { error: 'Authentication failed. Please log in again.' },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email || '';

    // Verify current password (double-check security)
    console.log('[DEBUG] Verifying current password in API...');
    const { error: signInError } = await supabaseClient.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword,
    });

    if (signInError) {
      console.log('[DEBUG] Current password verification failed in API');
      await logAuditEvent({
        userId,
        action: 'password_change_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          error: 'Current password incorrect',
          reason: 'invalid_current_password'
        },
      });

      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] Current password verified in API ✅');

    // Validate userId format
    if (!isValidUUID(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    // Note: Password is updated by the client directly via supabase.auth.updateUser()
    // This API only updates the database flags to mark password as no longer temporary

    console.log('[DEBUG] Password already updated by client, updating database flags...');

    // Create admin client for database updates
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Update temporary password status in users table
    console.log('[DEBUG] Updating user flags in database...');
    
    const { error: updateUserError } = await supabaseAdmin
      .from('users')
      .update({
        is_temporary_password: false,
        must_change_password: false,
        password_expires_at: null,
        last_password_change: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateUserError) {
      console.error('[DEBUG] Failed to update user record:', updateUserError);
      // Note: Password was already changed, so we log but don't fail the request
      await logAuditEvent({
        userId,
        action: 'password_change_partial_success',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { 
          error: updateUserError.message,
          note: 'Password updated but failed to update user flags'
        },
      });
    } else {
      console.log('[DEBUG] User flags updated successfully - is_temporary_password set to false');
    }

    // Success! Log the event
    await logAuditEvent({
      userId,
      action: 'password_changed',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        passwordStrength: passwordValidation.strength,
        temporaryPasswordCleared: true
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });

  } catch (error: any) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}

