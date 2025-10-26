import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { decryptData } from '@/lib/encryption';

// Create service role client for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user using route handler client
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token> header for SSR/API contexts
    if (!user || !user.id) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const supabaseAnon = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error('No authenticated user');
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get user ID from query params (for HR access) or use current user
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || user.id;

    // Check if user can access this photo
    if (targetUserId !== user.id) {
      // Check if current user is HR admin
      const { data: currentProfile } = await supabaseAdmin
        .from('profiles')
        .select('onboarding_status')
        .eq('user_id', user.id)
        .single();

      if (currentProfile?.onboarding_status !== 'hr_admin') {
        return NextResponse.json(
          { error: 'Forbidden' },
          { status: 403 }
        );
      }
    }

    // Get profile with photo data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('profile_photo_data, profile_photo_type, profile_photo_size')
      .eq('user_id', targetUserId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    if (!profile.profile_photo_data) {
      return NextResponse.json(
        { error: 'No photo found' },
        { status: 404 }
      );
    }

    // Decrypt the photo data
    const decryptedData = decryptData(profile.profile_photo_data);
    
    // Convert back to ArrayBuffer for response
    const arrayBuffer = decryptedData.buffer.slice(
      decryptedData.byteOffset,
      decryptedData.byteOffset + decryptedData.byteLength
    );

    // Return the image with proper headers
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': profile.profile_photo_type || 'image/jpeg',
        'Content-Length': arrayBuffer.byteLength.toString(),
        'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
        'Content-Disposition': 'inline; filename="profile-photo.jpg"'
      }
    });

  } catch (error) {
    console.error('Photo retrieval error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
