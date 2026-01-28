import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const USERS_PER_PAGE = 100;

const findAuthUserByEmail = async (email: string) => {
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: USERS_PER_PAGE
    });

    if (error) {
      return { user: null, error };
    }

    const authUser = data?.users?.find(
      (user) => user.email?.toLowerCase() === email
    );

    if (authUser) {
      return { user: authUser, error: null };
    }

    const nextPage = data?.nextPage;
    if (!nextPage || nextPage === page) {
      return { user: null, error: null };
    }

    page = nextPage;
  }
};

/**
 * POST /api/auth/forgot-password
 * Send password reset email (only for users without temporary passwords)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    console.log('[FORGOT PASSWORD] Processing reset request for:', normalizedEmail);

    // Step 1: Check if user exists in auth.users
    const { user: authUser, error: authError } = await findAuthUserByEmail(
      normalizedEmail
    );

    if (authError) {
      console.error('[FORGOT PASSWORD] Error fetching auth users:', authError);
      return NextResponse.json(
        { error: 'Failed to process request' },
        { status: 500 }
      );
    }

    if (!authUser) {
      console.log('[FORGOT PASSWORD] User not found in auth:', normalizedEmail);
      // Don't reveal whether the email exists for security
      return NextResponse.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    console.log('[FORGOT PASSWORD] User found in auth:', authUser.id);

    // Step 2: Check if user has a temporary password
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('is_temporary_password, must_change_password')
      .eq('id', authUser.id)
      .single();

    if (userError) {
      console.error('[FORGOT PASSWORD] Error fetching user data:', userError);
      // Continue anyway - user might not be in users table yet
    }

    const hasTemporaryPassword = userData?.is_temporary_password || userData?.must_change_password;

    console.log('[FORGOT PASSWORD] User password status:', {
      userId: authUser.id,
      is_temporary_password: userData?.is_temporary_password,
      must_change_password: userData?.must_change_password,
      hasTemporaryPassword
    });

    if (hasTemporaryPassword) {
      console.log('[FORGOT PASSWORD] ❌ User has temporary password - reset not allowed');
      return NextResponse.json(
        {
          error: 'Password reset not available for your account. Please contact your administrator or use the temporary password provided to you.'
        },
        { status: 403 }
      );
    }

    // Step 3: Send password reset email using Supabase
    console.log('[FORGOT PASSWORD] ✅ Sending password reset email...');

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://pds-murex.vercel.app'}/reset-password`;

    // Create a regular (non-admin) client to send the email
    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo: resetUrl
      }
    );

    if (resetError) {
      console.error('[FORGOT PASSWORD] ❌ Error sending reset email:', resetError);
      return NextResponse.json(
        { error: 'Failed to send password reset email. Please try again.' },
        { status: 500 }
      );
    }

    console.log('[FORGOT PASSWORD] ✅ Password reset email sent successfully to:', normalizedEmail);

    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });

  } catch (error: any) {
    console.error('[FORGOT PASSWORD] Unexpected error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
