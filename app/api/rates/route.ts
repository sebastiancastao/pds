import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface StateRate {
  id?: number;
  state_code: string;
  state_name: string;
  base_rate: number;
  overtime_enabled: boolean;
  overtime_rate: number;
  doubletime_enabled: boolean;
  doubletime_rate: number;
  effective_date: string;
}

/**
 * GET /api/rates
 * Fetch all state rates
 */
export async function GET(req: NextRequest) {
  try {
    // Fully public: no authentication required
    console.log('[RATES API] Public GET invoked');
    const { data: rates, error: ratesError } = await supabaseAdmin
      .from('state_rates')
      .select('*')
      .order('state_name', { ascending: true });

    if (ratesError) {
      console.error('Error fetching rates:', ratesError);
      return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
    }

    console.log('[RATES API] Returning rates count:', rates?.length || 0);
    return NextResponse.json({ rates: rates || [] }, { status: 200 });
  } catch (error: any) {
    console.error('Error in rates GET endpoint:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/rates
 * Update state rates
 */
export async function POST(req: NextRequest) {
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
        if (!tokenErr && tokenUser?.user) {
          user = tokenUser.user;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check user role - only executives can update rates
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (userData.role !== 'exec') {
      return NextResponse.json({ error: 'Access Denied: Only executives can update rates' }, { status: 403 });
    }

    // Parse request body
    const body = await req.json();
    const { rates } = body as { rates: StateRate[] };

    if (!rates || !Array.isArray(rates)) {
      return NextResponse.json({ error: 'Invalid rates data' }, { status: 400 });
    }

    // Validate rates data
    for (const rate of rates) {
      if (!rate.state_code || !rate.state_name) {
        return NextResponse.json({ error: 'Each rate must have state_code and state_name' }, { status: 400 });
      }

      if (typeof rate.base_rate !== 'number' || rate.base_rate < 0) {
        return NextResponse.json({ error: 'Invalid base_rate value' }, { status: 400 });
      }

      if (rate.overtime_enabled && (typeof rate.overtime_rate !== 'number' || rate.overtime_rate <= 0)) {
        return NextResponse.json({ error: 'Invalid overtime_rate value' }, { status: 400 });
      }

      if (rate.doubletime_enabled && (typeof rate.doubletime_rate !== 'number' || rate.doubletime_rate <= 0)) {
        return NextResponse.json({ error: 'Invalid doubletime_rate value' }, { status: 400 });
      }
    }

    // Update or insert each rate
    const results = [];
    for (const rate of rates) {
      const { data, error } = await supabaseAdmin
        .from('state_rates')
        .upsert({
          state_code: rate.state_code,
          state_name: rate.state_name,
          base_rate: rate.base_rate,
          overtime_enabled: rate.overtime_enabled,
          overtime_rate: rate.overtime_rate,
          doubletime_enabled: rate.doubletime_enabled,
          doubletime_rate: rate.doubletime_rate,
          effective_date: rate.effective_date,
        }, {
          onConflict: 'state_code',
        })
        .select();

      if (error) {
        console.error(`Error upserting rate for ${rate.state_code}:`, error);
        return NextResponse.json({
          error: `Failed to update rate for ${rate.state_code}: ${error.message}`
        }, { status: 500 });
      }

      results.push(data);
    }

    return NextResponse.json({
      success: true,
      message: 'Rates updated successfully',
      rates: results.flat()
    }, { status: 200 });
  } catch (error: any) {
    console.error('Error in rates POST endpoint:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
