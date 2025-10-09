// API endpoint to verify SMS code during login
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '@/lib/audit';
import bcrypt from 'bcryptjs';

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

    // Get authenticated user
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { code, isBackupCode } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { error: 'Verification code is required' },
        { status: 400 }
      );
    }

    // Handle backup code verification
    if (isBackupCode) {
      console.log('[DEBUG] Verifying backup code for user:', user.id);

      // Get user's backup codes from profile
      const { data: profileData } = await supabaseAdmin
        .from('profiles')
        .select('backup_codes')
        .eq('user_id', user.id)
        .single();

      if (!profileData || !profileData.backup_codes || profileData.backup_codes.length === 0) {
        return NextResponse.json(
          { error: 'No backup codes available' },
          { status: 400 }
        );
      }

      // Check if code matches any backup code
      let matchedIndex = -1;
      for (let i = 0; i < profileData.backup_codes.length; i++) {
        const matches = await bcrypt.compare(code, profileData.backup_codes[i]);
        if (matches) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        await logAuditEvent({
          userId: user.id,
          action: 'mfa_backup_code_failed',
          resourceType: 'auth',
          ipAddress: clientIP,
          userAgent,
          success: false,
        });

        return NextResponse.json(
          { error: 'Invalid backup code' },
          { status: 400 }
        );
      }

      // Remove used backup code
      const updatedBackupCodes = profileData.backup_codes.filter((_, i) => i !== matchedIndex);
      await supabaseAdmin
        .from('profiles')
        .update({ backup_codes: updatedBackupCodes })
        .eq('user_id', user.id);

      console.log('[DEBUG] Backup code verified successfully');

      await logAuditEvent({
        userId: user.id,
        action: 'mfa_backup_code_used',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: true,
        metadata: {
          remainingCodes: updatedBackupCodes.length,
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Backup code verified',
        remainingBackupCodes: updatedBackupCodes.length,
      });
    }

    // Handle SMS code verification
    console.log('[DEBUG] Verifying SMS code for user:', user.id);

    // Get the most recent unverified code
    const { data: smsCodeData, error: fetchError } = await supabaseAdmin
      .from('mfa_sms_codes')
      .select('*')
      .eq('user_id', user.id)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !smsCodeData) {
      console.error('[DEBUG] No SMS code found:', fetchError);
      return NextResponse.json(
        { error: 'No verification code found. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check if code is expired
    if (new Date(smsCodeData.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'Verification code has expired. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check attempts
    if (smsCodeData.attempts >= 3) {
      return NextResponse.json(
        { error: 'Too many failed attempts. Please request a new code.' },
        { status: 400 }
      );
    }

    // Verify code
    if (smsCodeData.code !== code) {
      // Increment attempts
      await supabaseAdmin
        .from('mfa_sms_codes')
        .update({ attempts: smsCodeData.attempts + 1 })
        .eq('id', smsCodeData.id);

      await logAuditEvent({
        userId: user.id,
        action: 'mfa_login_code_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: {
          attempts: smsCodeData.attempts + 1,
        },
      });

      return NextResponse.json(
        { error: `Invalid code. ${2 - smsCodeData.attempts} attempts remaining.` },
        { status: 400 }
      );
    }

    console.log('[DEBUG] SMS code verified successfully');

    // Mark code as verified
    await supabaseAdmin
      .from('mfa_sms_codes')
      .update({ verified: true })
      .eq('id', smsCodeData.id);

    // Log successful verification
    await logAuditEvent({
      userId: user.id,
      action: 'mfa_login_verified',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: 'SMS code verified',
    });

  } catch (error: any) {
    console.error('Verify SMS login error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

