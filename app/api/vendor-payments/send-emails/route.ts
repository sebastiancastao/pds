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

    // Group payments by vendor
    const vendorEmailData = new Map<string, {
      email: string;
      firstName: string;
      lastName: string;
      events: Array<{
        eventName: string;
        eventDate: string;
        venue: string;
        city: string;
        state: string;
        totalPay: number;
        adjustment: number;
        finalPay: number;
      }>;
    }>();

    // Organize data by vendor
    for (const row of vendorPayments || []) {
      const userId = row.user_id;
      const eventId = row.event_id;
      const user = row.users;
      const email = user?.email;

      if (!email) continue;

      const prof = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;
      let firstName = prof?.first_name || '';
      let lastName = prof?.last_name || '';
      try { if (firstName) firstName = decrypt(firstName); } catch {}
      try { if (lastName) lastName = decrypt(lastName); } catch {}

      if (!vendorEmailData.has(userId)) {
        vendorEmailData.set(userId, {
          email,
          firstName,
          lastName,
          events: []
        });
      }

      const adjustment = adjMap.get(`${eventId}::${userId}`) || 0;
      const totalPay = Number(row.total_pay || 0);
      const finalPay = totalPay + Number(adjustment || 0);

      const ev = eventById[eventId] || {};
      vendorEmailData.get(userId)!.events.push({
        eventName: ev.event_name || 'Event',
        eventDate: ev.event_date || 'N/A',
        venue: ev.venue || 'N/A',
        city: ev.city || '',
        state: ev.state || '',
        totalPay,
        adjustment,
        finalPay
      });
    }

    // Send one consolidated email per vendor
    let sent = 0;
    const failures: any[] = [];

    for (const [userId, data] of vendorEmailData.entries()) {
      const { email, firstName, lastName, events } = data;

      // Calculate grand total
      const grandTotal = events.reduce((sum, e) => sum + e.finalPay, 0);

      // Build events list HTML
      const eventsHtml = events.map(e => `
        <div style="background-color: #f3f4f6; border-left: 4px solid #3b82f6; padding: 15px; margin: 15px 0; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #1f2937;">Event: ${e.eventName}</h3>
          <p style="margin: 5px 0;"><strong>Date:</strong> ${e.eventDate}</p>
          <p style="margin: 5px 0;"><strong>Venue:</strong> ${e.venue}${e.city ? `, ${e.city}` : ''}${e.state ? `, ${e.state}` : ''}</p>
          ${e.adjustment !== 0 ? `<p style="margin: 5px 0;"><strong>Adjustment:</strong> $${e.adjustment.toFixed(2)}</p>` : ''}
          <h4 style="color: #059669; margin-top: 10px; margin-bottom: 0;">Event Payment: $${e.finalPay.toFixed(2)}</h4>
        </div>
      `).join('');

      const subject = `PDS Payment Summary - ${events.length} Event${events.length !== 1 ? 's' : ''}`;
      const html = `
        <div style="font-family: Arial, sans-serif; line-height:1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Payment Summary</h2>
          <p>Hello <strong>${firstName} ${lastName}</strong>,</p>
          <p>Your payment details for ${events.length} event${events.length !== 1 ? 's' : ''}:</p>

          ${eventsHtml}

          <div style="background-color: #dcfce7; border: 2px solid #059669; padding: 20px; margin: 20px 0; border-radius: 8px; text-align: center;">
            <h2 style="color: #1f2937; margin: 0 0 10px 0;">Total Payment</h2>
            <h1 style="color: #059669; margin: 0; font-size: 32px;">$${grandTotal.toFixed(2)}</h1>
          </div>

          <p style="color: #6b7280; font-size: 14px;">Thank you for your service!</p>
          <p style="color: #6b7280; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            This is an automated payment notification from PDS. Please contact HR if you have any questions.
          </p>
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
        failures.push({ userId, email, error: e?.message || 'send failed' });
      }
    }

    return NextResponse.json({ success: true, sent, failures });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

