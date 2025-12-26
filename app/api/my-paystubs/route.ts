import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    // Get authenticated user
    const routeClient = createRouteHandlerClient({ cookies });
    const { data: { user }, error: userError } = await routeClient.auth.getUser();

    if (!user) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

      if (!token) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = user.id;

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Get query parameters
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    // Fetch vendor payments for this user
    let query = supabaseAdmin
      .from('vendor_payments')
      .select(`
        *,
        event_payments!inner(
          event_id,
          events!inner(
            event_name,
            event_date,
            venue
          )
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Apply date filters if provided
    if (startDate || endDate) {
      // We need to filter by event date, which requires a join
      query = query.gte('event_payments.events.event_date', startDate || '1900-01-01');
      if (endDate) {
        query = query.lte('event_payments.events.event_date', endDate);
      }
    }

    const { data: payments, error: paymentsError } = await query;

    if (paymentsError) {
      console.error('[MY_PAYSTUBS] Error fetching payments:', paymentsError);
      return NextResponse.json({ error: 'Failed to fetch paystubs' }, { status: 500 });
    }

    // Transform the data into paystub format
    const paystubs = (payments || []).map((payment: any) => {
      const eventData = payment.event_payments?.events;
      return {
        id: payment.id,
        event_id: payment.event_id,
        event_name: eventData?.event_name || 'Unknown Event',
        event_date: eventData?.event_date || payment.created_at,
        venue: eventData?.venue || 'Unknown Venue',
        regular_hours: Number(payment.regular_hours || 0),
        regular_pay: Number(payment.regular_pay || 0),
        overtime_hours: Number(payment.overtime_hours || 0),
        overtime_pay: Number(payment.overtime_pay || 0),
        doubletime_hours: Number(payment.doubletime_hours || 0),
        doubletime_pay: Number(payment.doubletime_pay || 0),
        commissions: Number(payment.commissions || 0),
        tips: Number(payment.tips || 0),
        adjustment_amount: Number(payment.adjustment_amount || 0),
        total_pay: Number(payment.total_pay || 0),
        final_pay: Number(payment.total_pay || 0) + Number(payment.adjustment_amount || 0),
        base_rate: Number(payment.base_rate || 17.28),
        created_at: payment.created_at,
      };
    });

    return NextResponse.json({ paystubs }, { status: 200 });
  } catch (err: any) {
    console.error('[MY_PAYSTUBS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
