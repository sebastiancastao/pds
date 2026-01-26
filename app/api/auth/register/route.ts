// PDS Time keepingSystem - Secure Registration API
// Demonstrates SQL injection prevention and security best practices

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { validatePassword, hashPassword, generateMFASecret, generateBackupCodes, hashBackupCodes } from '@/lib/auth';
import { validateRegistrationData, isRateLimited, getClientIP, getUserAgent } from '@/lib/api-security';
import { logAuditEvent } from '@/lib/audit';
import { encrypt } from '@/lib/encryption';

/**
 * POST /api/auth/register
 * Secure user registration with comprehensive validation
 * 
 * Security Features:
 * ✅ Input validation & sanitization
 * ✅ SQL injection prevention (parameterized queries)
 * ✅ Password strength validation
 * ✅ Rate limiting
 * ✅ PII encryption at rest
 * ✅ Audit logging
 * ✅ MFA setup
 */
export async function POST(request: NextRequest) {
  try {
    // Extract client information for security logging
    const clientIP = getClientIP(request.headers);
    const userAgent = getUserAgent(request.headers);

    // Rate limiting to prevent abuse
    if (isRateLimited(`register:${clientIP}`, 3, 60 * 60 * 1000)) {
      await logAuditEvent({
        userId: null,
        action: 'register.rate_limited',
        resourceType: 'auth',
        resourceId: null,
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { reason: 'Too many registration attempts' },
      });

      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse and validate request body
    const body = await request.json();

    // Validate input data
    const validation = validateRegistrationData(body);
    if (!validation.isValid || !validation.data) {
      return NextResponse.json(
        { error: 'Invalid input data', details: validation.errors },
        { status: 400 }
      );
    }

    const { email, password, firstName, lastName, address, city, state, zipCode, role, division } = validation.data;

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: 'Password does not meet requirements', details: passwordValidation.errors },
        { status: 400 }
      );
    }

    // Create Supabase client (uses parameterized queries automatically)
    const supabase = createServerClient();

    // Check if user already exists
    // ✅ SQL Injection Safe - email is parameterized
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase()) // Parameterized query
      .single();

    if (existingUser) {
      // Log attempt for security monitoring
      await logAuditEvent({
        userId: null,
        action: 'register.duplicate_email',
        resourceType: 'auth',
        resourceId: null,
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { email },
      });

      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password securely
    const passwordHash = await hashPassword(password);

    // Generate MFA secret for the user
    const mfaSecret = generateMFASecret(email);

    // Generate backup codes for MFA recovery
    const backupCodes = generateBackupCodes();
    const hashedBackupCodes = await hashBackupCodes(backupCodes);

    // Encrypt PII data before storing
    const encryptedFirstName = encrypt(firstName);
    const encryptedLastName = encrypt(lastName);
    const encryptedAddress = encrypt(address);

    // Create user record
    // ✅ All values are parameterized - SQL injection safe
    const { data: newUser, error: userError } = await (supabase
      .from('users') as any)
      .insert({
        email: email.toLowerCase(),
        role,
        division,
        is_active: true,
        failed_login_attempts: 0,
      })
      .select()
      .single();

    if (userError) {
      console.error('User creation error:', userError.code);
      
      await logAuditEvent({
        userId: null,
        action: 'register.failed',
        resourceType: 'auth',
        resourceId: null,
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { error: userError.code, email },
      });

      return NextResponse.json(
        { error: 'Failed to create user account' },
        { status: 500 }
      );
    }

    // Create profile record with encrypted PII
    // ✅ All values are parameterized - SQL injection safe
    const { data: newProfile, error: profileError } = await (supabase
      .from('profiles') as any)
      .insert({
        user_id: newUser.id,
        first_name: encryptedFirstName,
        last_name: encryptedLastName,
        address: encryptedAddress,
        city,
        state,
        zip_code: zipCode,
        password_hash: passwordHash,
        mfa_secret: mfaSecret.secret,
        mfa_enabled: false, // Will be enabled after MFA setup
        backup_codes: hashedBackupCodes,
        onboarding_status: 'pending',
      })
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError.code);

      // Cleanup: Delete the user if profile creation fails
      await supabase.from('users').delete().eq('id', newUser.id);

      await logAuditEvent({
        userId: newUser.id,
        action: 'register.profile_failed',
        resourceType: 'auth',
        resourceId: newUser.id,
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { error: profileError.code },
      });

      return NextResponse.json(
        { error: 'Failed to create user profile' },
        { status: 500 }
      );
    }

    // Log successful registration
    await logAuditEvent({
      userId: newUser.id,
      action: 'register.success',
      resourceType: 'auth',
      resourceId: newUser.id,
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: {
        email: newUser.email,
        role: newUser.role,
        division: newUser.division,
      },
    });

    // Return success response with MFA setup data
    // ⚠️ Never return password_hash or mfa_secret in response
    return NextResponse.json(
      {
        success: true,
        message: 'Registration successful',
        user: {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role,
          division: newUser.division,
        },
        mfa: {
          otpauthUrl: mfaSecret.otpauthUrl,
          backupCodes: backupCodes, // Show once, user must save
        },
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Registration error:', error);

    // Log error without exposing sensitive details
    await logAuditEvent({
      userId: null,
      action: 'register.error',
      resourceType: 'auth',
      resourceId: null,
      ipAddress: getClientIP(request.headers),
      userAgent: getUserAgent(request.headers),
      success: false,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });

    return NextResponse.json(
      { error: 'An unexpected error occurred during registration' },
      { status: 500 }
    );
  }
}

