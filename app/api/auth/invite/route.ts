import { NextRequest, NextResponse } from 'next/server';
import { supabase, isValidEmail } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/email';
import crypto from 'crypto';

interface InviteRequest {
  email: string;
  role: 'worker' | 'manager' | 'finance' | 'exec';
  division: 'vendor' | 'trailers' | 'both';
  firstName: string;
  lastName: string;
}

/**
 * POST /api/auth/invite
 * Send invite link to user (NO service role key required!)
 * 
 * Flow:
 * 1. Admin creates invite record
 * 2. System generates secure invite token
 * 3. Email sent with invite link
 * 4. User clicks link and completes registration
 * 5. User sets their own password
 * 
 * Security:
 * - Uses regular Supabase client (anon key)
 * - No password creation by admin
 * - User owns their credentials from start
 * - Invite tokens expire in 7 days
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invites } = body;

    // Validation
    if (!Array.isArray(invites) || invites.length === 0) {
      return NextResponse.json(
        { error: 'Invites array is required' },
        { status: 400 }
      );
    }

    if (invites.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 invites can be sent at once' },
        { status: 400 }
      );
    }

    const results = [];

    for (const invite of invites) {
      try {
        const email = invite.email.toLowerCase().trim();

        // Validate email
        if (!isValidEmail(email)) {
          results.push({
            ...invite,
            status: 'error',
            message: 'Invalid email format',
          });
          continue;
        }

        // Check if user already exists
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .single();

        if (existingUser) {
          results.push({
            ...invite,
            status: 'error',
            message: 'User already exists',
          });
          continue;
        }

        // Check if pending invite exists
        const { data: existingInvite } = await (supabase
          .from('user_invites')
          .select('id, expires_at')
          .eq('email', email)
          .eq('status', 'pending')
          .single() as any);

        if (existingInvite && new Date(existingInvite.expires_at) > new Date()) {
          results.push({
            ...invite,
            status: 'error',
            message: 'Invite already sent and still valid',
          });
          continue;
        }

        // Generate secure invite token
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

        // Create invite record (no service role key needed!)
        const { data: inviteData, error: inviteError } = await (supabase
          .from('user_invites') as any)
          .insert({
            email,
            role: invite.role,
            division: invite.division,
            first_name: invite.firstName,
            last_name: invite.lastName,
            state: 'XX', // XX = Not set yet - will be collected during onboarding
            invite_token: inviteToken,
            expires_at: expiresAt.toISOString(),
            status: 'pending',
          })
          .select()
          .single();

        if (inviteError) {
          results.push({
            ...invite,
            status: 'error',
            message: `Failed to create invite: ${inviteError.message}`,
          });
          continue;
        }

        // Send invite email
        const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${inviteToken}`;
        
        try {
          await sendInviteEmail({
            email,
            firstName: invite.firstName,
            lastName: invite.lastName,
            inviteUrl,
            expiresAt,
          });
        } catch (emailError) {
          console.error('Email sending failed:', emailError);
          // Don't rollback - invite is created, just log the email failure
        }

        results.push({
          ...invite,
          status: 'success',
          inviteToken, // For admin reference
        });
      } catch (error: any) {
        console.error('Error creating invite:', error);
        results.push({
          ...invite,
          status: 'error',
          message: error.message || 'Unexpected error',
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      success: successCount > 0,
      message: `Sent ${successCount} invite(s), ${errorCount} failed`,
      results,
    });
  } catch (error: any) {
    console.error('Invite API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

