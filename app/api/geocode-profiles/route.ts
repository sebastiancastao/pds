import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { geocodeAddress, delay } from "@/lib/geocoding";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
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

    // Get profiles that need geocoding (missing latitude or longitude)
    const { data: profiles, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id, address, city, state, zip_code, latitude, longitude')
      .or('latitude.is.null,longitude.is.null')
      .not('address', 'is', null)
      .not('city', 'is', null)
      .not('state', 'is', null);

    if (fetchError) {
      console.error('Error fetching profiles:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({
        message: 'No profiles need geocoding',
        processed: 0,
        successful: 0,
        failed: 0
      }, { status: 200 });
    }

    console.log(`Starting geocoding for ${profiles.length} profiles...`);

    let successful = 0;
    let failed = 0;
    const results = [];

    for (const profile of profiles) {
      try {
        // Geocode the address
        const result = await geocodeAddress(
          profile.address,
          profile.city,
          profile.state,
          profile.zip_code
        );

        if (result) {
          // Update the profile with coordinates
          const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({
              latitude: result.latitude,
              longitude: result.longitude
            })
            .eq('id', profile.id);

          if (updateError) {
            console.error(`Failed to update profile ${profile.id}:`, updateError);
            failed++;
            results.push({
              id: profile.id,
              status: 'failed',
              error: 'Database update failed'
            });
          } else {
            successful++;
            results.push({
              id: profile.id,
              status: 'success',
              latitude: result.latitude,
              longitude: result.longitude
            });
            console.log(`✓ Geocoded profile ${profile.id}: ${result.latitude}, ${result.longitude}`);
          }
        } else {
          failed++;
          results.push({
            id: profile.id,
            status: 'failed',
            error: 'Geocoding failed'
          });
          console.warn(`✗ Failed to geocode profile ${profile.id}`);
        }

        // Rate limit: wait 1.1 seconds between requests
        if (profiles.indexOf(profile) < profiles.length - 1) {
          await delay(1100);
        }
      } catch (err: any) {
        failed++;
        results.push({
          id: profile.id,
          status: 'error',
          error: err.message
        });
        console.error(`Error processing profile ${profile.id}:`, err);
      }
    }

    return NextResponse.json({
      message: 'Geocoding completed',
      processed: profiles.length,
      successful,
      failed,
      results
    }, { status: 200 });

  } catch (err: any) {
    console.error('Server error in geocode-profiles:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
