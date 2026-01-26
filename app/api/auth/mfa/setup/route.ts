// PDS Time keepingSystem - MFA Setup API
// Generates MFA secret and QR code for user enrollment

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateMFASecret, generateMFAQRCode } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { isValidUUID } from '@/lib/supabase';

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

    // Get authenticated user from Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Create Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    // Verify the JWT token and get the user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (userError || !user) {
      console.error('Failed to verify user token:', userError);
      return NextResponse.json(
        { error: 'Authentication failed. Please log in again.' },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email || '';

    if (!isValidUUID(userId)) {
      return NextResponse.json(
        { error: 'Invalid user ID format' },
        { status: 400 }
      );
    }

    console.log('[DEBUG] MFA Setup - Generating secret for user:', userId);

    // Generate MFA secret and QR code
    const { secret, otpauthUrl } = generateMFASecret(userEmail);
    const qrCodeUrl = await generateMFAQRCode(otpauthUrl);

    console.log('[DEBUG] MFA Setup - Secret generated successfully');

    // Log audit event
    await logAuditEvent({
      userId,
      action: 'mfa_setup_initiated',
      resourceType: 'auth',
      ipAddress: clientIP,
      userAgent,
      success: true,
      metadata: { 
        email: userEmail
      },
    });

    return NextResponse.json({
      success: true,
      secret,
      qrCodeUrl,
      email: userEmail,
    });

  } catch (error: any) {
    console.error('MFA setup error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
}












