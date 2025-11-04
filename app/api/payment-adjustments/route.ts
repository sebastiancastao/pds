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

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

// GET: Fetch adjustments for specified event IDs
export async function GET(req: NextRequest) {
  console.log('[PAYMENT-ADJUSTMENTS] Fetching payment adjustments');

  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const eventIdsParam = searchParams.get('event_ids');

    if (!eventIdsParam) {
      return NextResponse.json({ error: 'event_ids parameter required' }, { status: 400 });
    }

    const eventIds = eventIdsParam.split(',').filter(Boolean);
    console.log('[PAYMENT-ADJUSTMENTS] Fetching adjustments for events:', eventIds);

    // Fetch adjustments for all event IDs
    const { data: adjustments, error } = await supabaseAdmin
      .from('payment_adjustments')
      .select('*')
      .in('event_id', eventIds);

    if (error) {
      console.error('[PAYMENT-ADJUSTMENTS] Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[PAYMENT-ADJUSTMENTS] Found', adjustments?.length || 0, 'adjustments');

    // Group by event_id and user_id for easy lookup
    const adjustmentMap: Record<string, Record<string, any>> = {};
    (adjustments || []).forEach((adj: any) => {
      if (!adjustmentMap[adj.event_id]) {
        adjustmentMap[adj.event_id] = {};
      }
      adjustmentMap[adj.event_id][adj.user_id] = adj;
    });

    return NextResponse.json({
      success: true,
      adjustments: adjustmentMap,
    });
  } catch (err: any) {
    console.error('[PAYMENT-ADJUSTMENTS] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Save/update adjustments
export async function POST(req: NextRequest) {
  console.log('[PAYMENT-ADJUSTMENTS] Saving payment adjustments');

  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await req.json();
    const { adjustments } = body; // Array of { event_id, user_id, adjustment_amount, adjustment_note }

    if (!adjustments || !Array.isArray(adjustments)) {
      return NextResponse.json({ error: 'adjustments array is required' }, { status: 400 });
    }

    console.log('[PAYMENT-ADJUSTMENTS] Saving', adjustments.length, 'adjustments');

    // Prepare adjustment records
    const adjustmentRecords = adjustments.map((adj: any) => ({
      event_id: adj.event_id,
      user_id: adj.user_id,
      adjustment_amount: adj.adjustment_amount || 0,
      adjustment_note: adj.adjustment_note || null,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    }));

    // Upsert adjustments
    const { data, error } = await supabaseAdmin
      .from('payment_adjustments')
      .upsert(adjustmentRecords, {
        onConflict: 'event_id,user_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      console.error('[PAYMENT-ADJUSTMENTS] Error saving:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[PAYMENT-ADJUSTMENTS] Successfully saved', data?.length || 0, 'adjustments');

    return NextResponse.json({
      success: true,
      adjustments: data,
      message: 'Adjustments saved successfully',
    });
  } catch (err: any) {
    console.error('[PAYMENT-ADJUSTMENTS] Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
