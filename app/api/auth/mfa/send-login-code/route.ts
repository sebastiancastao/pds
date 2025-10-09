// API endpoint to send SMS code during login
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendMFALoginCode, generateVerificationCode } from '@/lib/sms';
import { logAuditEvent } from '@/lib/audit';

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

    // Get user's phone number
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('phone_number')
      .eq('id', user.id)
      .single();

    if (fetchError || !userData?.phone_number) {
      console.error('[DEBUG] No phone number found for user:', user.id);
      return NextResponse.json(
        { error: 'No phone number on file. Please contact support.' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] Sending login SMS code to:', userData.phone_number);

    // Generate verification code
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing unverified codes for this user
    await supabaseAdmin
      .from('mfa_sms_codes')
      .delete()
      .eq('user_id', user.id)
      .eq('verified', false);

    // Store new code
    const { error: insertError } = await supabaseAdmin
      .from('mfa_sms_codes')
      .insert({
        user_id: user.id,
        phone_number: userData.phone_number,
        code,
        expires_at: expiresAt.toISOString(),
        verified: false,
        attempts: 0,
      });

    if (insertError) {
      console.error('[DEBUG] Failed to store SMS code:', insertError);
      return NextResponse.json(
        { error: 'Failed to generate verification code' },
        { status: 500 }
      );
    }

    // Send SMS
    const smsResult = await sendMFALoginCode(userData.phone_number, code);

    if (!smsResult.success) {
      console.error('[DEBUG] Failed to send SMS:', smsResult.error);
      
      // Delete the code since SMS failed
      await supabaseAdmin
        .from('mfa_sms_codes')
        .delete()
        .eq('user_id', user.id)
        .eq('phone_number', userData.phone_number);

      return NextResponse.json(
        { error: smsResult.error || 'Failed to send verification code' },
        { status: 500 }
      );
    }

    console.log('[DEBUG] Login SMS code sent successfully');

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      action: 'mfa_login_code_sent',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        phoneNumber: userData.phone_number,
        messageId: smsResult.messageId,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Verification code sent to your phone',
    });

  } catch (error: any) {
    console.error('Send login code error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}

