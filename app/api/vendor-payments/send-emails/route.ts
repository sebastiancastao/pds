import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { Resend } from 'resend';
import { decrypt } from '@/lib/encryption';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

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

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const eventIds: string[] = Array.isArray(body?.event_ids)
      ? body.event_ids
      : (typeof body?.event_ids === 'string' ? body.event_ids.split(',').filter(Boolean) : []);
    if (!eventIds || eventIds.length === 0) {
      return NextResponse.json({ error: 'event_ids required' }, { status: 400 });
    }

    // Basic role check (exec/admin/hr) — optional, mirrors save-payment
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();
    const role = (userData?.role || '').toString().trim().toLowerCase();
    const isPrivileged = role === 'exec' || role === 'admin' || role === 'hr';
    if (!isPrivileged) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Fetch vendor payments joined with users
    const { data: vendorPayments, error: vpErr } = await supabaseAdmin
      .from('event_vendor_payments')
      .select(`
        *,
        users:user_id (
          id,
          email,
          profiles (
            first_name,
            last_name
          )
        )
      `)
      .in('event_id', eventIds);
    if (vpErr) return NextResponse.json({ error: vpErr.message }, { status: 500 });

    // Fetch adjustments for those events
    const { data: adjustments, error: adjErr } = await supabaseAdmin
      .from('payment_adjustments')
      .select('event_id, user_id, adjustment_amount')
      .in('event_id', eventIds);
    if (adjErr) return NextResponse.json({ error: adjErr.message }, { status: 500 });
    const adjMap = new Map<string, number>();
    (adjustments || []).forEach(a => {
      adjMap.set(`${a.event_id}::${a.user_id}`, Number(a.adjustment_amount || 0));
    });

    // Fetch event info for context
    const { data: events, error: evErr } = await supabaseAdmin
      .from('events')
      .select('id, event_name, event_date, venue, city, state')
      .in('id', eventIds);
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    const eventById: Record<string, any> = {};
    (events || []).forEach(e => { eventById[e.id] = e; });

    // Group rows per (event_id, user_id) and send emails
    let sent = 0; const failures: any[] = [];
    for (const row of vendorPayments || []) {
      const eventId = row.event_id;
      const userId = row.user_id;
      const user = row.users;
      const email = user?.email;
      const prof = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
      let firstName = prof?.first_name || '';
      let lastName = prof?.last_name || '';
      try { if (firstName) firstName = decrypt(firstName); } catch {}
      try { if (lastName) lastName = decrypt(lastName); } catch {}

      if (!email) continue;

      const adjustment = adjMap.get(`${eventId}::${userId}`) || 0;
      const finalPay = Number(row.total_pay || 0) + Number(adjustment || 0);

      const ev = eventById[eventId] || {};
      const subject = `PDS Payment Summary - ${ev.event_name || 'Event'} (${ev.event_date || ''})`;
      const html = `
        <div style="font-family: Arial, sans-serif; line-height:1.6">
          <h2>Payment Summary</h2>
          <p>Hello ${firstName || ''} ${lastName || ''},</p>
          <p>Your final payment for <strong>${ev.event_name || 'Event'}</strong> on <strong>${ev.event_date || ''}</strong>:</p>
          <ul>
            <li>Regular Pay: $${Number(row.regular_pay || 0).toFixed(2)}</li>
            <li>Overtime Pay: $${Number(row.overtime_pay || 0).toFixed(2)}</li>
            <li>Doubletime Pay: $${Number(row.doubletime_pay || 0).toFixed(2)}</li>
            <li>Commissions: $${Number(row.commissions || 0).toFixed(2)}</li>
            <li>Tips: $${Number(row.tips || 0).toFixed(2)}</li>
            <li>Adjustment: $${Number(adjustment || 0).toFixed(2)}</li>
          </ul>
          <h3>Total: $${finalPay.toFixed(2)}</h3>
          <p>Venue: ${ev.venue || ''}${ev.city ? `, ${ev.city}` : ''}${ev.state ? `, ${ev.state}` : ''}</p>
        </div>
      `;

      try {
        const { error } = await resend.emails.send({
          from: 'PDS Payments <service@furnituretaxi.site>',
          to: email,
          subject,
          html,
        });
        if (error) throw error;
        sent += 1;
      } catch (e: any) {
        failures.push({ eventId, userId, email, error: e?.message || 'send failed' });
      }
    }

    return NextResponse.json({ success: true, sent, failures });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

