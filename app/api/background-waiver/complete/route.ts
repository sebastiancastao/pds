import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { sendBackgroundCheckSubmissionNotification } from '@/lib/email';
import { decrypt } from '@/lib/encryption';

/**
 * POST /api/background-waiver/complete
 * Mark background check as completed for a user
 */
export async function POST(request: NextRequest) {
  try {
    // Get session from request
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

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

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    console.log('[BACKGROUND CHECK COMPLETE] Marking background check as completed for user:', user.id);

    // Update users table to mark background check as completed
    const { error: updateError } = await ((supabase
      .from('users') as any)
      .update({
        background_check_completed: true,
        background_check_completed_at: new Date().toISOString()
      })
      .eq('id', user.id));

    if (updateError) {
      console.error('[BACKGROUND CHECK COMPLETE] Failed to update user:', updateError);
      return NextResponse.json(
        { error: 'Failed to mark background check as completed', details: updateError.message },
        { status: 500 }
      );
    }

    console.log('[BACKGROUND CHECK COMPLETE] ✅ Background check marked as completed in users table');

    // Get the profile_id for this user
    const { data: profileData, error: profileError } = await (supabase
      .from('profiles') as any)
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profileData) {
      console.error('[BACKGROUND CHECK COMPLETE] Failed to get profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to find user profile', details: profileError?.message },
        { status: 500 }
      );
    }

    console.log('[BACKGROUND CHECK COMPLETE] Found profile_id:', profileData.id);

    // Check if vendor_background_checks record exists
    const { data: existingCheck } = await supabase
      .from('vendor_background_checks')
      .select('id')
      .eq('profile_id', profileData.id)
      .single();

    if (existingCheck) {
      // Update existing record - only update the timestamp, keep background_check_completed as is
      // Admin will set it to true via the checkbox in the UI
      console.log('[BACKGROUND CHECK COMPLETE] Updating existing vendor_background_checks record (timestamp only)');
      const { error: updateCheckError } = await (supabase
        .from('vendor_background_checks') as any)
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('profile_id', profileData.id);

      if (updateCheckError) {
        console.error('[BACKGROUND CHECK COMPLETE] Failed to update vendor_background_checks:', updateCheckError);
        return NextResponse.json(
          { error: 'Failed to update vendor background check record', details: updateCheckError.message },
          { status: 500 }
        );
      }
    } else {
      // Insert new record with background_check_completed = FALSE
      // Admin will set it to true via the checkbox in the UI
      console.log('[BACKGROUND CHECK COMPLETE] Creating new vendor_background_checks record (completed = FALSE)');
      const { error: insertCheckError } = await (supabase
        .from('vendor_background_checks') as any)
        .insert({
          profile_id: profileData.id,
          background_check_completed: false,
          completed_date: null
        });

      if (insertCheckError) {
        console.error('[BACKGROUND CHECK COMPLETE] Failed to insert vendor_background_checks:', insertCheckError);
        return NextResponse.json(
          { error: 'Failed to create vendor background check record', details: insertCheckError.message },
          { status: 500 }
        );
      }
    }

    console.log('[BACKGROUND CHECK COMPLETE] ✅ Vendor background check record created/updated (awaiting admin approval)');

    // Get user profile information for email notification
    const { data: profileInfo, error: profileInfoError } = await (supabase
      .from('profiles') as any)
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .single();

    if (!profileInfoError && profileInfo) {
      // Decrypt name fields
      let firstName = 'User';
      let lastName = '';

      try {
        firstName = profileInfo.first_name ? decrypt(profileInfo.first_name) : 'User';
      } catch (decryptError) {
        // If decryption fails, use original value
        firstName = profileInfo.first_name || 'User';
      }

      try {
        lastName = profileInfo.last_name ? decrypt(profileInfo.last_name) : '';
      } catch (decryptError) {
        // If decryption fails, use original value
        lastName = profileInfo.last_name || '';
      }

      // Send email notification to admin
      console.log('[BACKGROUND CHECK COMPLETE] Sending email notification to admin...');
      const emailResult = await sendBackgroundCheckSubmissionNotification({
        userEmail: user.email || 'N/A',
        userFirstName: firstName,
        userLastName: lastName,
        submittedAt: new Date().toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York'
        })
      });

      if (emailResult.success) {
        console.log('[BACKGROUND CHECK COMPLETE] ✅ Email notification sent successfully');
      } else {
        console.error('[BACKGROUND CHECK COMPLETE] ❌ Failed to send email notification:', emailResult.error);
        // Don't fail the request if email fails - log it but continue
      }
    } else {
      console.error('[BACKGROUND CHECK COMPLETE] ⚠️ Could not fetch profile info for email notification:', profileInfoError);
      // Don't fail the request - continue without sending email
    }

    return NextResponse.json({
      success: true,
      message: 'Background check marked as completed'
    });

  } catch (error: any) {
    console.error('[BACKGROUND CHECK COMPLETE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
