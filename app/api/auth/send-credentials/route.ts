import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isValidEmail } from '@/lib/supabase';
import { sendTemporaryPasswordEmail } from '@/lib/email';
import { logAuditEvent } from '@/lib/audit';

interface SendCredentialsRequest {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  temporaryPassword: string;
}

/**
 * POST /api/auth/send-credentials
 * Send temporary password email to user
 * 
 * This is separate from user creation to give admins control over when emails are sent.
 * Admin can create user, copy password, and then send email when ready.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, email, firstName, lastName, temporaryPassword } = body as SendCredentialsRequest;

    // Validation
    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }

    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: 'First and last name are required' },
        { status: 400 }
      );
    }

    if (!temporaryPassword) {
      return NextResponse.json(
        { error: 'Temporary password is required' },
        { status: 400 }
      );
    }

    // Initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Debug: Log the received data
    console.log('[DEBUG] Send credentials request:', {
      userId,
      email,
      firstName,
      lastName,
      hasTemporaryPassword: !!temporaryPassword,
    });

    // Verify user exists - try by ID first, then by email as fallback
    let user;
    let userError;
    
    // Try to find by ID first
    const idLookup = await (supabase
      .from('users')
      .select('id, email, password_expires_at')
      .eq('id', userId)
      .single() as any);

    user = idLookup.data;
    userError = idLookup.error;

    // Debug: Log database lookup result
    console.log('[DEBUG] Database lookup by ID result:', {
      found: !!user,
      error: userError?.message,
      userIdSearched: userId,
      userFound: user ? { id: user.id, email: user.email } : null,
    });

    // If not found by ID, try by email (fallback for legacy data)
    if (userError || !user) {
      console.log('[DEBUG] User not found by ID. Trying lookup by email...');
      
      const emailLookup = await (supabase
        .from('users')
        .select('id, email, password_expires_at')
        .eq('email', email.toLowerCase().trim())
        .single() as any);
      
      user = emailLookup.data;
      userError = emailLookup.error;
      
      console.log('[DEBUG] Database lookup by email result:', {
        emailSearched: email,
        found: !!user,
        error: userError?.message,
        userFound: user ? { id: user.id, email: user.email } : null,
      });
    }

    // If still not found, return error
    if (userError || !user) {
      console.error('[DEBUG] User not found by ID or email:', {
        userIdSearched: userId,
        emailSearched: email,
      });

      return NextResponse.json(
        { 
          error: 'User not found',
          debug: {
            searchedUserId: userId,
            searchedEmail: email,
          }
        },
        { status: 404 }
      );
    }

    // Send email with temporary password
    try {
      const expiresAt = user.password_expires_at 
        ? new Date(user.password_expires_at)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days

      const emailResult = await sendTemporaryPasswordEmail({
        email,
        firstName,
        lastName,
        temporaryPassword,
        expiresAt,
      });

      if (!emailResult.success) {
        return NextResponse.json(
          { 
            error: 'Email sending failed',
            details: emailResult.error 
          },
          { status: 500 }
        );
      }

      // Log audit event (use the actual database user ID)
      await logAuditEvent({
        userId: user.id,
        action: 'credentials_email_sent',
        resourceType: 'user',
        resourceId: user.id,
        success: true,
        metadata: {
          email,
          sentBy: 'admin', // TODO: Get actual admin user ID from session
          messageId: emailResult.messageId,
          requestedUserId: userId, // Log the ID that was requested for debugging
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Credentials email sent successfully',
        messageId: emailResult.messageId,
      });
    } catch (error: any) {
      console.error('Error sending credentials email:', error);
      
      // Log failed attempt (use the actual database user ID)
      await logAuditEvent({
        userId: user.id,
        action: 'credentials_email_failed',
        resourceType: 'user',
        resourceId: user.id,
        success: false,
        metadata: {
          email,
          error: error.message,
          requestedUserId: userId, // Log the ID that was requested for debugging
        },
      });

      return NextResponse.json(
        { 
          error: 'Failed to send email',
          details: error.message 
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Send credentials API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

