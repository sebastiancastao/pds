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

    const body = await req.json();
    const { profileId, address, city, state, zipCode } = body;

    if (!profileId || !address || !city || !state) {
      return NextResponse.json({
        error: 'Missing required fields: profileId, address, city, state'
      }, { status: 400 });
    }

    // Geocode the address
    const result = await geocodeAddress(address, city, state, zipCode);

    if (!result) {
      return NextResponse.json({
        error: 'Failed to geocode address'
      }, { status: 404 });
    }

    // Update the profile with coordinates
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        latitude: result.latitude,
        longitude: result.longitude
      })
      .eq('id', profileId);

    if (updateError) {
      console.error('Failed to update profile:', updateError);
      return NextResponse.json({
        error: 'Failed to update profile coordinates'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      latitude: result.latitude,
      longitude: result.longitude,
      display_name: result.display_name
    }, { status: 200 });

  } catch (err: any) {
    console.error('Server error in geocode-single:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
