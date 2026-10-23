import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { buildCaTempEmploymentAgreementPdf } from '@/lib/ca-temp-employment-agreement';

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    // Get the authenticated user using route handler client
    let supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    console.log('[CA] Cookie-based auth:', {
      hasUser: !!user,
      userId: user?.id
    });

    // Fallback to Authorization: Bearer <access_token> header
    if (!user) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[CA] Validating Bearer token...');
        supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        );
        const { data: tokenUser } = await supabase.auth.getUser(token);
        user = tokenUser?.user;
        console.log('[CA] Bearer token validation:', {
          hasUser: !!user,
          userId: user?.id
        });
      }
    }

    let userName = '';
    let regionName = '';
    let homeVenueName = '';
    if (user) {
      const [profileResult, venueResult] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('official_name, regions(name)')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabaseAdmin
          .from('vendor_venue_assignments')
          .select('venue:venue_reference(venue_name)')
          .eq('vendor_id', user.id)
          .limit(1)
          .maybeSingle(),
      ]);

      console.log('[CA] Profile query result:', profileResult);
      console.log('[CA] Venue query result:', venueResult);

      if (profileResult.data?.official_name) {
        userName = profileResult.data.official_name;
      }
      if ((profileResult.data as any)?.regions?.name) {
        regionName = (profileResult.data as any).regions.name;
      }
      if ((venueResult.data as any)?.venue?.venue_name) {
        homeVenueName = (venueResult.data as any).venue.venue_name;
      }
    }

    // Explicit region override from the form storage path (e.g. ?region=san-diego or ?region=la-norcal)
    // takes priority over the user's DB region so the correct variant is always served.
    const regionOverride = new URL(request.url).searchParams.get('region');
    if (regionOverride === 'san-diego') {
      regionName = 'San Diego';
    } else if (regionOverride === 'la-norcal') {
      regionName = 'LA Region';
    }

    console.log('[CA] Final user name:', userName);
    console.log('[CA] Region name:', regionName);

    const pdfDoc = await buildCaTempEmploymentAgreementPdf({
      regionName,
      userName,
      homeVenueName,
      includeNavigation: true,
    });
    console.log('CA - Total pages:', pdfDoc.getPageCount());

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="CA_Temporary_Employment_Services_Agreement.pdf"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
  } catch (error: any) {
    console.error('Temp Employment Agreement PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate Temp Employment Agreement PDF', details: error.message }, { status: 500 });
  }
}
