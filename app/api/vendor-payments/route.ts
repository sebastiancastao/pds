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

// Updated with detailed debugging - v2
export async function GET(req: NextRequest) {
  console.log('[VENDOR-PAYMENTS-API] 🔍 Fetching vendor payments - DEBUG MODE');

  try {
    const user = await getAuthedUser(req);
    console.log('[VENDOR-PAYMENTS-API] 👤 User:', { userId: user?.id, email: user?.email });

    if (!user?.id) {
      console.log('[VENDOR-PAYMENTS-API] ❌ Not authenticated');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get event IDs from query params (comma-separated)
    const { searchParams } = new URL(req.url);
    const eventIdsParam = searchParams.get('event_ids');

    if (!eventIdsParam) {
      return NextResponse.json({ error: 'event_ids parameter required' }, { status: 400 });
    }

    const eventIds = eventIdsParam.split(',').filter(Boolean);
    console.log('[VENDOR-PAYMENTS-API] 📦 Fetching payments for', eventIds.length, 'events');
    console.log('[VENDOR-PAYMENTS-API] 🔍 Event IDs requested:', eventIds);

    // First, check what event_ids actually exist in the table
    const { data: allVendorPayments, error: allPaymentsError } = await supabaseAdmin
      .from('event_vendor_payments')
      .select('event_id, id, user_id');

    if (allPaymentsError) {
      console.error('[VENDOR-PAYMENTS-API] ❌ Error fetching all payments:', allPaymentsError);
    } else {
      console.log('[VENDOR-PAYMENTS-API] 📊 ALL event_ids in event_vendor_payments table:',
        [...new Set(allVendorPayments?.map(p => p.event_id) || [])]);
      console.log('[VENDOR-PAYMENTS-API] 📊 Total rows in table:', allVendorPayments?.length || 0);
    }

    // Fetch vendor payments for all event IDs using admin client (bypasses RLS)
    const { data: vendorPayments, error: paymentsError } = await supabaseAdmin
      .from('event_vendor_payments')
      .select(`
        *,
        users:user_id (
          id,
          email,
          profiles (
            first_name,
            last_name,
            phone
          )
        )
      `)
      .in('event_id', eventIds);

    if (paymentsError) {
      console.error('[VENDOR-PAYMENTS-API] ❌ Error:', paymentsError);
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    console.log('[VENDOR-PAYMENTS-API] ✅ Found', vendorPayments?.length || 0, 'vendor payment records matching requested event IDs');

    if (vendorPayments && vendorPayments.length === 0 && allVendorPayments && allVendorPayments.length > 0) {
      console.warn('[VENDOR-PAYMENTS-API] ⚠️ WARNING: Rows exist in table but none match the requested event_ids!');
      console.warn('[VENDOR-PAYMENTS-API] ⚠️ This means the event_id saved in event_vendor_payments does not match the event_id from the events table');
    }

    // Also fetch event payment summaries
    const { data: eventPayments, error: eventPaymentsError } = await supabaseAdmin
      .from('event_payments')
      .select('*')
      .in('event_id', eventIds);

    if (eventPaymentsError) {
      console.error('[VENDOR-PAYMENTS-API] ⚠️ Error fetching event payment summaries:', eventPaymentsError);
    }

    console.log('[VENDOR-PAYMENTS-API] ✅ Found', eventPayments?.length || 0, 'event payment summaries');

    // Also fetch payment adjustments
    const { data: adjustments, error: adjustmentsError } = await supabaseAdmin
      .from('payment_adjustments')
      .select('*')
      .in('event_id', eventIds);

    if (adjustmentsError) {
      console.error('[VENDOR-PAYMENTS-API] ⚠️ Error fetching adjustments:', adjustmentsError);
    }

    console.log('[VENDOR-PAYMENTS-API] ✅ Found', adjustments?.length || 0, 'payment adjustments');

    // Group by event_id
    const paymentsByEvent: Record<string, any> = {};

    eventIds.forEach(eventId => {
      const eventVendorPayments = (vendorPayments || []).filter(vp => vp.event_id === eventId);
      const eventAdjustments = (adjustments || []).filter((adj: any) => adj.event_id === eventId);

      // Merge adjustments into vendor payments
      const paymentsWithAdjustments = eventVendorPayments.map(vp => {
        const adjustment = eventAdjustments.find((adj: any) => adj.user_id === vp.user_id);
        return {
          ...vp,
          adjustment_amount: adjustment?.adjustment_amount || 0,
          adjustment_note: adjustment?.adjustment_note || '',
        };
      });

      paymentsByEvent[eventId] = {
        vendorPayments: paymentsWithAdjustments,
        eventPayment: (eventPayments || []).find(ep => ep.event_id === eventId) || null,
      };
    });

    return NextResponse.json({
      success: true,
      paymentsByEvent,
      totalVendorPayments: vendorPayments?.length || 0,
      totalEventPayments: eventPayments?.length || 0,
      totalAdjustments: adjustments?.length || 0,
    });
  } catch (err: any) {
    console.error('[VENDOR-PAYMENTS-API] ❌ Unhandled error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
