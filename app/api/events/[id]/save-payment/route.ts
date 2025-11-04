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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  console.log('💾 Save Payment API called', { eventId: params.id });

  try {
    const user = await getAuthedUser(req);
    console.log('👤 Authenticated user:', { userId: user?.id, userEmail: user?.email });

    if (!user?.id) {
      console.log('❌ Authentication failed');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const eventId = params.id;
    if (!eventId) {
      console.log('❌ No event ID provided');
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 });
    }

    // Verify requester owns the event or is an exec
    console.log('🔍 Verifying event ownership:', { eventId, userId: user.id });
    const { data: event, error: evtErr } = await supabaseAdmin
      .from('events')
      .select('id, created_by')
      .eq('id', eventId)
      .maybeSingle();

    if (evtErr) {
      console.error('❌ Event query error:', evtErr);
      return NextResponse.json({ error: evtErr.message }, { status: 500 });
    }
    if (!event) {
      console.log('❌ Event not found');
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Check if user is the event creator
    const isEventCreator = event.created_by === user.id;

    // Check if user is an exec
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    const isExec = userData?.role === 'exec';

    if (!isEventCreator && !isExec) {
      console.log('❌ User not authorized to save payment data');
      return NextResponse.json(
        { error: 'Not authorized to save payment data for this event' },
        { status: 403 }
      );
    }

    console.log('✅ User authorized:', { isEventCreator, isExec });

    // Parse request body
    const body = await req.json();
    const {
      commissionPoolPercent,
      commissionPoolDollars,
      totalTips,
      baseRate,
      netSales,
      vendorPayments, // Array of individual vendor payment objects
    } = body;

    console.log('📦 Payment data received:', {
      commissionPoolPercent,
      commissionPoolDollars,
      totalTips,
      baseRate,
      netSales,
      vendorPaymentsCount: vendorPayments?.length || 0,
    });

    if (!vendorPayments || !Array.isArray(vendorPayments)) {
      return NextResponse.json(
        { error: 'vendorPayments array is required' },
        { status: 400 }
      );
    }

    // Calculate event-level totals
    const totalRegularHours = vendorPayments.reduce((sum, v) => sum + (v.regularHours || 0), 0);
    const totalOvertimeHours = vendorPayments.reduce((sum, v) => sum + (v.overtimeHours || 0), 0);
    const totalDoubletimeHours = vendorPayments.reduce((sum, v) => sum + (v.doubletimeHours || 0), 0);
    const totalRegularPay = vendorPayments.reduce((sum, v) => sum + (v.regularPay || 0), 0);
    const totalOvertimePay = vendorPayments.reduce((sum, v) => sum + (v.overtimePay || 0), 0);
    const totalDoubletimePay = vendorPayments.reduce((sum, v) => sum + (v.doubletimePay || 0), 0);
    const totalCommissions = vendorPayments.reduce((sum, v) => sum + (v.commissions || 0), 0);
    const totalTipsDistributed = vendorPayments.reduce((sum, v) => sum + (v.tips || 0), 0);
    const totalPayment = vendorPayments.reduce((sum, v) => sum + (v.totalPay || 0), 0);

    // Upsert event-level payment summary
    const { data: eventPayment, error: eventPaymentErr } = await supabaseAdmin
      .from('event_payments')
      .upsert(
        {
          event_id: eventId,
          commission_pool_percent: commissionPoolPercent || 0,
          commission_pool_dollars: commissionPoolDollars || 0,
          total_tips: totalTips || 0,
          total_regular_hours: totalRegularHours,
          total_overtime_hours: totalOvertimeHours,
          total_doubletime_hours: totalDoubletimeHours,
          total_regular_pay: totalRegularPay,
          total_overtime_pay: totalOvertimePay,
          total_doubletime_pay: totalDoubletimePay,
          total_commissions: totalCommissions,
          total_tips_distributed: totalTipsDistributed,
          total_payment: totalPayment,
          base_rate: baseRate,
          net_sales: netSales,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'event_id',
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (eventPaymentErr) {
      console.error('❌ Error saving event payment:', eventPaymentErr);
      return NextResponse.json(
        { error: 'Failed to save event payment data', details: eventPaymentErr.message },
        { status: 500 }
      );
    }

    console.log('✅ Event payment saved:', eventPayment);

    // Delete existing vendor payments for this event (to handle removed team members)
    const { error: deleteErr } = await supabaseAdmin
      .from('event_vendor_payments')
      .delete()
      .eq('event_id', eventId);

    if (deleteErr) {
      console.error('⚠️ Error deleting old vendor payments:', deleteErr);
      // Continue anyway - upsert will handle it
    }

    // Insert vendor payments
    const vendorPaymentRecords = vendorPayments.map((vp: any) => ({
      event_payment_id: eventPayment.id,
      event_id: eventId,
      user_id: vp.userId,
      actual_hours: vp.actualHours || 0,
      regular_hours: vp.regularHours || 0,
      overtime_hours: vp.overtimeHours || 0,
      doubletime_hours: vp.doubletimeHours || 0,
      regular_pay: vp.regularPay || 0,
      overtime_pay: vp.overtimePay || 0,
      doubletime_pay: vp.doubletimePay || 0,
      commissions: vp.commissions || 0,
      tips: vp.tips || 0,
      total_pay: vp.totalPay || 0,
      updated_at: new Date().toISOString(),
    }));

    const { data: vendorPaymentsData, error: vendorPaymentsErr } = await supabaseAdmin
      .from('event_vendor_payments')
      .upsert(vendorPaymentRecords, {
        onConflict: 'event_id,user_id',
        ignoreDuplicates: false,
      })
      .select();

    if (vendorPaymentsErr) {
      console.error('❌ Error saving vendor payments:', vendorPaymentsErr);
      return NextResponse.json(
        { error: 'Failed to save vendor payment data', details: vendorPaymentsErr.message },
        { status: 500 }
      );
    }

    console.log('✅ Vendor payments saved:', vendorPaymentsData?.length || 0, 'records');

    return NextResponse.json({
      success: true,
      eventPayment,
      vendorPayments: vendorPaymentsData,
      message: 'Payment data saved successfully',
    });
  } catch (err: any) {
    console.error('❌ Error in save-payment endpoint:', err);
    return NextResponse.json(
      { error: err.message || 'Unhandled error' },
      { status: 500 }
    );
  }
}
