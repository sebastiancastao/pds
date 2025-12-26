import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isValidEmail } from '@/lib/supabase';
import { logAuditEvent } from '@/lib/audit';
import crypto from 'crypto';

interface NewUser {
  id: string;
  email: string;
  role: 'worker' | 'manager' | 'finance' | 'exec';
  division: 'vendor' | 'trailers' | 'both';
  firstName: string;
  lastName: string;
  official_name: string;
}

interface CreateUserResult {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  division: string;
  temporaryPassword: string;
  status: 'success' | 'error';
  message?: string;
}

/**
 * Generate a secure temporary password
 */
function generateTemporaryPassword(): string {
  const length = 16;
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowercase = 'abcdefghijkmnopqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%&*';
  
  let password = '';
  password += uppercase[crypto.randomInt(0, uppercase.length)];
  password += lowercase[crypto.randomInt(0, lowercase.length)];
  password += numbers[crypto.randomInt(0, numbers.length)];
  password += special[crypto.randomInt(0, special.length)];
  
  const allChars = uppercase + lowercase + numbers + special;
  for (let i = password.length; i < length; i++) {
    password += allChars[crypto.randomInt(0, allChars.length)];
  }
  
  return password.split('').sort(() => crypto.randomInt(0, 2) - 1).join('');
}

/**
 * POST /api/auth/signup
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { users } = body;

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json(
        { error: 'Users array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (users.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 users can be created at once' },
        { status: 400 }
      );
    }

    // Validate each user
    for (const user of users) {
      if (!user.email || !isValidEmail(user.email)) {
        return NextResponse.json(
          { error: `Invalid email: ${user.email}` },
          { status: 400 }
        );
      }
      if (!user.firstName?.trim() || !user.lastName?.trim()) {
        return NextResponse.json(
          { error: `First and last name required for ${user.email}` },
          { status: 400 }
        );
      }
    }

    // Try to initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { 
          error: 'Service role key not configured. Please add SUPABASE_SERVICE_ROLE_KEY to .env.local',
          details: 'See SIGNUP_VS_INVITE_COMPARISON.md for alternatives without service role key'
        },
        { status: 500 }
      );
    }

    const results: CreateUserResult[] = [];

    for (const user of users) {
      try {
        const email = user.email.toLowerCase().trim();

        // Check if user already exists
        const { data: existingAuthUser } = await supabase.auth.admin.listUsers();
        const userExists = existingAuthUser?.users.some((u) => u.email === email);

        if (userExists) {
          results.push({
            ...user,
            temporaryPassword: '',
            status: 'error',
            message: 'User with this email already exists',
          });
          continue;
        }

        // Generate temporary password
        const temporaryPassword = generateTemporaryPassword();
        const passwordExpiresAt = new Date();
        passwordExpiresAt.setDate(passwordExpiresAt.getDate() + 7);

        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email,
          password: temporaryPassword,
          email_confirm: true,
          user_metadata: {
            first_name: user.firstName,
            last_name: user.lastName,
            role: user.role,
            division: user.division,
          },
        });

        if (authError || !authData.user) {
          results.push({
            ...user,
            temporaryPassword: '',
            status: 'error',
            message: `Auth creation failed: ${authError?.message || 'Unknown error'}`,
          });
          continue;
        }

        // Create user record
        const { error: userError } = await (supabase.from('users') as any).insert([{
          id: authData.user.id,
          email,
          role: user.role,
          division: user.division,
          is_active: true,
          is_temporary_password: true,
          must_change_password: true,
          password_expires_at: passwordExpiresAt.toISOString(),
          failed_login_attempts: 0,
          account_locked_until: null,
        }]);

        if (userError) {
          await supabase.auth.admin.deleteUser(authData.user.id);
          results.push({
            ...user,
            temporaryPassword: '',
            status: 'error',
            message: `Database user creation failed: ${userError.message}`,
          });
          continue;
        }

        // Create profile record
        // Note: State will be collected during onboarding process
        const { data: profileData, error: profileError } = await (supabase.from('profiles') as any)
          .insert([{
            user_id: authData.user.id,
            first_name: user.firstName,
            last_name: user.lastName,
            official_name: user.official_name || `${user.firstName} ${user.lastName}`.trim(),
            state: 'XX', // XX = Not set yet - will be collected during onboarding
            password_hash: '',
            mfa_enabled: false,
            mfa_secret: null,
            backup_codes: null,
            onboarding_status: 'pending',
            onboarding_completed_at: null,
          }])
          .select('id')
          .single();

        if (profileError || !profileData?.id) {
          await supabase.from('users').delete().eq('id', authData.user.id);
          await supabase.auth.admin.deleteUser(authData.user.id);
          results.push({
            ...user,
            temporaryPassword: '',
            status: 'error',
            message: `Profile creation failed: ${profileError?.message}`,
          });
          continue;
        }

        const profileId = profileData.id;
        const { error: bgCheckError } = await (supabase.from('vendor_background_checks') as any)
          .upsert({
            profile_id: profileId,
            background_check_completed: false,
            completed_date: null,
          }, { onConflict: 'profile_id' });

        if (bgCheckError) {
          console.error('[Signup API] Failed to create vendor_background_checks row:', bgCheckError);
        }

        // Note: Email sending is now done separately via the "Send Email" button
        // This gives admins control over when credentials are sent

        // Log audit event
        await logAuditEvent({
          userId: authData.user.id,
          action: 'user_created_with_temporary_password',
          resourceType: 'user',
          resourceId: authData.user.id,
          success: true,
          metadata: {
            email,
            role: user.role,
            division: user.division,
            state: user.state,
            createdBy: 'admin',
            passwordExpiresAt: passwordExpiresAt.toISOString(),
          },
        });

        // Debug: Log the IDs
        console.log('[DEBUG] User created successfully:', {
          frontendId: user.id,
          databaseId: authData.user.id,
          email,
        });

        results.push({
          ...user,
          id: authData.user.id, // IMPORTANT: Use the actual database ID, not the frontend UUID
          temporaryPassword,
          status: 'success',
        });
      } catch (error: any) {
        console.error('Error creating user:', error);
        results.push({
          ...user,
          temporaryPassword: '',
          status: 'error',
          message: error.message || 'Unexpected error occurred',
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      success: successCount > 0,
      message: `Created ${successCount} user(s), ${errorCount} failed`,
      results,
    });
  } catch (error: any) {
    console.error('Signup API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

