// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const dynamic = 'force-dynamic';

// Admin client bypasses RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    console.log('[PROFILE API] Fetching profile for user:', user.id);

    // Fetch profile using admin client (bypasses RLS)
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[PROFILE API] Error fetching profile:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[PROFILE API] Profile found:', {
      found: !!profile,
      hasCoordinates: !!(profile?.latitude && profile?.longitude)
    });

    return NextResponse.json({
      profile: profile || null,
      hasCoordinates: !!(profile?.latitude && profile?.longitude)
    });
  } catch (err: any) {
    console.error('[PROFILE API] Unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
