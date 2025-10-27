import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { encryptData, encrypt } from '@/lib/encryption';
import { geocodeAddress } from '@/lib/geocoding';

// Create service role client for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
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

    // Parse the form data
    const formData = await request.formData();
    const photo = formData.get('photo') as File;
    const profileData = formData.get('profileData') as string;
    
    if (!photo) {
      return NextResponse.json(
        { error: 'No photo file provided' },
        { status: 400 }
      );
    }

    // Parse profile data
    let parsedProfileData;
    try {
      parsedProfileData = JSON.parse(profileData || '{}');
    } catch (e) {
      return NextResponse.json(
        { error: 'Invalid profile data format' },
        { status: 400 }
      );
    }

    // Validate file type and size
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(photo.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPG and PNG files are allowed.' },
        { status: 400 }
      );
    }

    if (photo.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }

    // Convert file to binary data
    const arrayBuffer = await photo.arrayBuffer();
    const binaryData = new Uint8Array(arrayBuffer);

    // Encrypt the binary data
    const encryptedPhotoData = encryptData(binaryData);

    // Prepare encrypted profile data
    const encryptedProfileData = {
      first_name: parsedProfileData.firstName ? encrypt(parsedProfileData.firstName) : null,
      last_name: parsedProfileData.lastName ? encrypt(parsedProfileData.lastName) : null,
      address: parsedProfileData.address ? encrypt(parsedProfileData.address) : null,
      city: parsedProfileData.city || null,
      state: parsedProfileData.state || null,
      zip_code: parsedProfileData.zipCode || null,
    };

    // Geocode the address to get latitude and longitude
    let latitude: number | null = null;
    let longitude: number | null = null;

    if (parsedProfileData.address) {
      console.log('[DEBUG] Geocoding address:', parsedProfileData.address);

      // Normalize address: add space after street number if missing (e.g., "3848W" -> "3848 W")
      let normalizedAddress = parsedProfileData.address.replace(/^(\d+)([A-Z])/i, '$1 $2');
      console.log('[DEBUG] Normalized address:', normalizedAddress);

      // Check if address already contains city/state/zip (full address format)
      const addressLower = normalizedAddress.toLowerCase();
      const hasCity = parsedProfileData.city && addressLower.includes(parsedProfileData.city.toLowerCase());
      const hasState = parsedProfileData.state && addressLower.includes(parsedProfileData.state.toLowerCase());

      let geocodeResult = null;

      if (hasCity && hasState) {
        // Address field contains full address, use it as-is
        console.log('[DEBUG] Using full address format');
        geocodeResult = await geocodeAddress(
          normalizedAddress,
          '', // Empty city
          '', // Empty state
          ''  // Empty zip
        );
      }

      // If first attempt failed or we have separate components, try with separate fields
      if (!geocodeResult && parsedProfileData.city && parsedProfileData.state) {
        console.log('[DEBUG] Trying with separate components');
        // Extract just the street address (before city name if it exists)
        let streetAddress = normalizedAddress;
        if (hasCity && parsedProfileData.city) {
          const cityIndex = normalizedAddress.toLowerCase().indexOf(parsedProfileData.city.toLowerCase());
          if (cityIndex > 0) {
            streetAddress = normalizedAddress.substring(0, cityIndex).trim();
            console.log('[DEBUG] Extracted street address:', streetAddress);
          }
        }

        geocodeResult = await geocodeAddress(
          streetAddress,
          parsedProfileData.city,
          parsedProfileData.state,
          parsedProfileData.zipCode
        );
      }

      if (geocodeResult) {
        latitude = geocodeResult.latitude;
        longitude = geocodeResult.longitude;
        console.log('[DEBUG] Geocoding successful:', latitude, longitude);
      } else {
        console.warn('[DEBUG] Geocoding failed for address');
      }
    }

    // Insert or update profile with photo data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        user_id: user.id,
        ...encryptedProfileData,
        latitude,
        longitude,
        profile_photo_data: encryptedPhotoData,
        profile_photo_type: photo.type,
        profile_photo_size: photo.size,
        profile_photo_uploaded_at: new Date().toISOString(),
        onboarding_status: 'pending',
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      return NextResponse.json(
        { error: 'Failed to save profile data' },
        { status: 500 }
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      message: 'Profile and photo uploaded successfully',
      profileId: profile.id,
      photoUploaded: true,
      redirectPath: getRedirectPath(parsedProfileData.state)
    });

  } catch (error) {
    console.error('Photo upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to determine redirect path based on state
function getRedirectPath(state: string): string {
  const normalized = state?.trim().toLowerCase() || '';
  
  if (['ny', 'new york'].includes(normalized)) {
    return '/payroll-packet-ny';
  } else if (['ca', 'california'].includes(normalized)) {
    return '/payroll-packet-ca';
  } else if (['az', 'arizona'].includes(normalized)) {
    return '/payroll-packet-az';
  } else if (['wi', 'wisconsin'].includes(normalized)) {
    return '/payroll-packet-wi';
  }
  
  return '/dashboard'; // Default redirect
}
