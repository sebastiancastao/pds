import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { geocodeAddress } from "@/lib/geocoding";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * POST /api/users/geocode
 * Geocodes a user's address and updates their latitude/longitude
 * Body: { userId?: string, address: string, city: string, state: string, zipCode?: string }
 * If userId is not provided, uses the authenticated user's ID
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { userId, address, city, state, zipCode } = body;

    // If userId is provided, check if the current user has permission to update it
    const targetUserId = userId || user.id;

    // Check if user has permission (admin can update anyone, users can only update themselves)
    const { data: currentUserData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = currentUserData?.role === 'admin';

    if (targetUserId !== user.id && !isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Validate required fields
    if (!address || !city || !state) {
      return NextResponse.json(
        { error: 'Missing required fields: address, city, state' },
        { status: 400 }
      );
    }

    // Geocode the address
    console.log(`[GEOCODE] Geocoding address for user ${targetUserId}: ${address}, ${city}, ${state}`);
    const result = await geocodeAddress(address, city, state, zipCode);

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to geocode address' },
        { status: 500 }
      );
    }

    // Update user's profile with lat/lng
    const updateData = {
      latitude: result.latitude,
      longitude: result.longitude,
      geocoded_address: result.display_name || `${address}, ${city}, ${state}`,
      geocoded_at: new Date().toISOString()
    };

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', targetUserId)
      .select()
      .single();

    if (updateError) {
      console.error('[GEOCODE] Error updating profile:', updateError);
      return NextResponse.json(
        { error: 'Failed to update profile with coordinates' },
        { status: 500 }
      );
    }

    console.log(`[GEOCODE] Successfully geocoded user ${targetUserId}: ${result.latitude}, ${result.longitude}`);

    return NextResponse.json({
      success: true,
      latitude: result.latitude,
      longitude: result.longitude,
      geocoded_address: result.display_name,
      profile: updatedProfile
    }, { status: 200 });

  } catch (err: any) {
    console.error('[GEOCODE] Server error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/users/geocode/batch
 * Batch geocode multiple users (Admin only)
 * Body: { userIds: string[] } or { all: true }
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check if user is admin
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { userIds, all } = body;

    // Build query for users to geocode
    let query = supabaseAdmin
      .from('profiles')
      .select('id, address, city, state, zip_code, latitude, longitude');

    if (!all && userIds && Array.isArray(userIds)) {
      query = query.in('id', userIds);
    }

    // Only geocode users with addresses but no coordinates
    query = query.not('address', 'is', null);
    query = query.not('city', 'is', null);
    query = query.not('state', 'is', null);

    const { data: profiles, error } = await query;

    if (error) {
      console.error('[BATCH-GEOCODE] Error fetching profiles:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({
        message: 'No profiles found to geocode',
        success: true,
        geocoded: 0,
        failed: 0
      }, { status: 200 });
    }

    console.log(`[BATCH-GEOCODE] Starting batch geocode for ${profiles.length} profiles`);

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Geocode each profile (respecting rate limits)
    for (const profile of profiles) {
      try {
        // Decrypt address if needed (assuming encryption exists)
        // For now, assuming addresses are stored in plain text

        const result = await geocodeAddress(
          profile.address,
          profile.city,
          profile.state,
          profile.zip_code
        );

        if (result) {
          // Update profile with coordinates
          await supabaseAdmin
            .from('profiles')
            .update({
              latitude: result.latitude,
              longitude: result.longitude,
              geocoded_address: result.display_name || `${profile.address}, ${profile.city}, ${profile.state}`,
              geocoded_at: new Date().toISOString()
            })
            .eq('id', profile.id);

          successCount++;
          console.log(`[BATCH-GEOCODE] Geocoded ${profile.id}: ${result.latitude}, ${result.longitude}`);
        } else {
          failCount++;
          errors.push(`${profile.id}: Failed to geocode`);
        }

        // Rate limiting: wait 1.1 seconds between requests (Nominatim limit)
        await new Promise(resolve => setTimeout(resolve, 1100));

      } catch (err: any) {
        failCount++;
        errors.push(`${profile.id}: ${err.message}`);
        console.error(`[BATCH-GEOCODE] Error geocoding ${profile.id}:`, err);
      }
    }

    console.log(`[BATCH-GEOCODE] Complete. Success: ${successCount}, Failed: ${failCount}`);

    return NextResponse.json({
      success: true,
      message: `Batch geocoding complete`,
      geocoded: successCount,
      failed: failCount,
      total: profiles.length,
      errors: errors.length > 0 ? errors : undefined
    }, { status: 200 });

  } catch (err: any) {
    console.error('[BATCH-GEOCODE] Server error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
