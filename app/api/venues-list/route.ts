import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    // Try cookie-based session first
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
      console.error('No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check user role
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      console.error('Error fetching user role:', userError);
      return NextResponse.json({ error: 'Failed to fetch user role' }, { status: 500 });
    }

    let venues;
    let error;

    // If user is a manager or supervisor, only return assigned venues
    // Supervisors see the same venues as their lead manager(s)
    if (userData.role === 'manager' || userData.role === 'supervisor' || userData.role === 'supervisor2') {
      // For supervisors, look up their manager IDs to get their venue access
      const managerIds: string[] = [];
      if (userData.role === 'supervisor' || userData.role === 'supervisor2') {
        const { data: teamLinks } = await supabaseAdmin
          .from('manager_team_members')
          .select('manager_id')
          .eq('member_id', user.id)
          .eq('is_active', true);
        if (teamLinks) {
          for (const link of teamLinks) {
            managerIds.push(link.manager_id);
          }
        }
      } else {
        managerIds.push(user.id);
      }

      if (managerIds.length === 0) {
        venues = [];
      } else {
        const { data: managerVenues, error: managerError } = await supabaseAdmin
          .from('venue_managers')
          .select(`
            venue:venue_reference(*)
          `)
          .in('manager_id', managerIds)
          .eq('is_active', true);

        if (managerError) {
          console.error('SUPABASE SELECT ERROR (manager venues):', managerError);
          return NextResponse.json({ error: managerError.message || managerError.code || managerError }, { status: 500 });
        }

        // Extract venues, deduplicate, and sort
        const venueMap = new Map();
        for (const mv of (managerVenues || [])) {
          const v = (mv as any).venue;
          if (v && !venueMap.has(v.id)) {
            venueMap.set(v.id, v);
          }
        }
        venues = Array.from(venueMap.values())
          .sort((a: any, b: any) => a.venue_name.localeCompare(b.venue_name));
      }
    } else {
      // For exec, admin, and other roles, return all venues
      const { data: allVenues, error: venuesError } = await supabaseAdmin
        .from('venue_reference')
        .select('*')
        .order('venue_name', { ascending: true });

      venues = allVenues;
      error = venuesError;

      if (error) {
        console.error('SUPABASE SELECT ERROR:', error);
        return NextResponse.json({ error: error.message || error.code || error }, { status: 500 });
      }
    }

    return NextResponse.json({ venues: venues ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in venues list:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
