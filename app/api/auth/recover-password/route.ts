// Password recovery completion
// Used after user clicks Supabase reset link and sets a new password without knowing the old one.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '@/lib/audit';
import { isValidUUID } from '@/lib/supabase';

function getClientIP(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0] || headers.get('x-real-ip') || 'unknown';
}

function getUserAgent(headers: Headers): string {
  return headers.get('user-agent') || 'unknown';
}

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request.headers);
  const userAgent = getUserAgent(request.headers);

  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authentication required. Please request a new reset link.' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // Verify the JWT to determine the user.
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication failed. Please request a new reset link.' }, { status: 401 });
    }

    const userId = user.id;
    if (!isValidUUID(userId)) {
      return NextResponse.json({ error: 'Invalid user ID format' }, { status: 400 });
    }

    // Update user flags. Even if these were already false, this is idempotent.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const nowIso = new Date().toISOString();
    const { error: updateUserError } = await supabaseAdmin
      .from('users')
      .update({
        is_temporary_password: false,
        must_change_password: false,
        password_expires_at: null,
        last_password_change: nowIso,
        updated_at: nowIso,
      })
      .eq('id', userId);

    if (updateUserError) {
      await logAuditEvent({
        userId,
        action: 'password_recovery_db_update_failed',
        resourceType: 'auth',
        ipAddress: clientIP,
        userAgent,
        success: false,
        metadata: { error: updateUserError.message },
      });

      // Non-fatal to the end-user; password was already changed in Auth.
      return NextResponse.json({ error: 'Password updated, but failed to update user flags.' }, { status: 200 });
    }

    await logAuditEvent({
      userId,
      action: 'password_recovered',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { method: 'supabase_recovery_link' },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Recover password API error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 });
  }
}

