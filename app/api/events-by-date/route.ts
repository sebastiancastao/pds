import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    // Get date range from query parameters
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const includeHours = searchParams.get('includeHours') === 'true';
    const debug = searchParams.get('debug') === 'true';

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing required parameters: startDate and endDate' }, { status: 400 });
    }

    // Query events within the date range
    // Note: We're using event_date field which is timestamptz
    // Add one day to endDate to include events throughout the entire end date
    const endDatePlusOne = new Date(endDate);
    endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
    const endDateStr = endDatePlusOne.toISOString().split('T')[0];

    // Fetch events
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('event_date', startDate)
      .lt('event_date', endDateStr)
      .order('event_date', { ascending: true });

    if (eventsError) {
      console.error('SUPABASE SELECT ERROR:', eventsError);
      return NextResponse.json({ error: eventsError.message || eventsError.code || eventsError }, { status: 500 });
    }
    if (debug) {
      console.log('[EVENTS-BY-DATE][debug] request', {
        startDate,
        endDate,
        endDateStr,
        includeHours,
        eventsCount: (events || []).length,
      });
    }

    // Fetch event payment summaries in one query (used by Paystub Generator + HR Payroll parity)
    const eventIds = (events || []).map((e: any) => e?.id).filter(Boolean);
    const eventPaymentsByEventId: Record<string, any> = {};
    if (eventIds.length > 0) {
      const { data: eventPayments, error: eventPaymentsError } = await supabaseAdmin
        .from('event_payments')
        .select('*')
        .in('event_id', eventIds);

      if (eventPaymentsError) {
        console.error('Error fetching event payment summaries:', eventPaymentsError);
      } else {
        for (const row of eventPayments || []) {
          if (row?.event_id) eventPaymentsByEventId[row.event_id] = row;
        }
        if (debug) {
          console.log('[EVENTS-BY-DATE][debug] event_payments fetched', {
            count: (eventPayments || []).length,
            sample: (eventPayments || []).slice(0, 2).map((r: any) => ({ event_id: r.event_id, base_rate: r.base_rate })),
          });
        }
      }
    }

    // For each event, fetch assigned workers and their payment data
    const eventsWithPaymentData = await Promise.all(
      (events || []).map(async (event) => {
        // Get vendors assigned to this event
        const { data: eventTeams, error: teamsError } = await supabaseAdmin
          .from('event_teams')
          .select('vendor_id, status')
          .eq('event_id', event.id);

        if (teamsError) {
          console.error('Error fetching event teams:', teamsError);
          return { ...event, workers: [] };
        }

        const vendorIds = Array.from(new Set((eventTeams || []).map((t: any) => t.vendor_id).filter(Boolean)));

        // Payment adjustments (aka "Other" in HR Payroll tab)
        const adjustmentByVendorId: Record<string, number> = {};
        if (vendorIds.length > 0) {
          try {
            const { data: adjustments, error: adjustmentsError } = await supabaseAdmin
              .from('payment_adjustments')
              .select('user_id, adjustment_amount')
              .eq('event_id', event.id)
              .in('user_id', vendorIds);

            if (adjustmentsError) {
              console.error('Error fetching payment adjustments:', adjustmentsError);
            } else {
              for (const row of adjustments || []) {
                if (!row?.user_id) continue;
                adjustmentByVendorId[row.user_id] = Number((row as any).adjustment_amount || 0);
              }
              if (debug) {
                console.log('[EVENTS-BY-DATE][debug] adjustments fetched', {
                  eventId: event.id,
                  count: (adjustments || []).length,
                  sample: (adjustments || []).slice(0, 5).map((r: any) => ({ user_id: r.user_id, amount: r.adjustment_amount })),
                });
              }
            }
          } catch (error) {
            console.error('Error loading payment adjustments:', error);
          }
        }

        // Compute worked hours from time_entries (matches HR Dashboard payroll tab fallback logic)
        const workedHoursByVendorId: Record<string, number> = {};
        if (includeHours && vendorIds.length > 0) {
          try {
            const dateStr = (event.event_date || '').toString().split('T')[0];
            if (dateStr) {
              const startIso = new Date(`${dateStr}T00:00:00Z`).toISOString();
              const endIso = new Date(`${dateStr}T23:59:59.999Z`).toISOString();

              const { data: entries } = await supabaseAdmin
                .from('time_entries')
                .select('user_id, action, timestamp')
                .in('user_id', vendorIds)
                .gte('timestamp', startIso)
                .lte('timestamp', endIso)
                .order('timestamp', { ascending: true });
              if (debug) {
                console.log('[EVENTS-BY-DATE][debug] time_entries window', {
                  eventId: event.id,
                  dateStr,
                  vendorCount: vendorIds.length,
                  entriesCount: (entries || []).length,
                });
              }

              const entriesByUserId: Record<string, any[]> = {};
              for (const uid of vendorIds) entriesByUserId[uid] = [];
              for (const row of entries || []) {
                if (!entriesByUserId[row.user_id]) entriesByUserId[row.user_id] = [];
                entriesByUserId[row.user_id].push(row);
              }

              for (const uid of vendorIds) {
                const uEntries = entriesByUserId[uid] || [];
                let currentIn: string | null = null;
                let ms = 0;
                for (const row of uEntries) {
                  if (row.action === 'clock_in') {
                    if (!currentIn) currentIn = row.timestamp as any;
                  } else if (row.action === 'clock_out') {
                    if (currentIn) {
                      const start = new Date(currentIn).getTime();
                      const end = new Date(row.timestamp as any).getTime();
                      const dur = end - start;
                      if (dur > 0) ms += dur;
                      currentIn = null;
                    }
                  }
                }
                workedHoursByVendorId[uid] = ms / (1000 * 60 * 60);
              }
              if (debug) {
                const sample = vendorIds.slice(0, 5).map((uid) => ({
                  user_id: uid,
                  worked_hours: workedHoursByVendorId[uid] ?? 0,
                }));
                console.log('[EVENTS-BY-DATE][debug] worked hours computed', {
                  eventId: event.id,
                  sample,
                });
              }
            }
          } catch (error) {
            console.error('Error computing worked hours from time_entries:', error);
          }
        }

        // For each vendor, get their user info and payment data
        const workersWithPayment = await Promise.all(
          (eventTeams || []).map(async (team: any) => {
            // Get user email + division (needed for AZ/NY commission eligibility logic)
            const { data: userData } = await supabaseAdmin
              .from('users')
              .select('email, division')
              .eq('id', team.vendor_id)
              .single();

            // Get user profile (name, phone, address)
            const { data: profileData } = await supabaseAdmin
              .from('profiles')
              .select('first_name, last_name, phone, address')
              .eq('user_id', team.vendor_id)
              .single();

            // Get payment data
            const { data: paymentData, error: paymentError } = await supabaseAdmin
              .from('event_vendor_payments')
              .select('*')
              .eq('event_id', event.id)
              .eq('user_id', team.vendor_id)
              .single();

            if (paymentError && paymentError.code !== 'PGRST116') {
              console.error('Error fetching payment data:', paymentError);
            }

            // Decrypt encrypted profile fields
            let firstName = '';
            let lastName = '';
            let phone = '';
            let address = '';

            if (profileData) {
              try {
                firstName = profileData.first_name ? safeDecrypt(profileData.first_name) : '';
                lastName = profileData.last_name ? safeDecrypt(profileData.last_name) : '';
                phone = profileData.phone ? safeDecrypt(profileData.phone) : '';
                address = profileData.address ? safeDecrypt(profileData.address) : '';
              } catch (error) {
                console.error('Error decrypting profile data:', error);
              }
            }

            const fullName = firstName || lastName
              ? `${firstName} ${lastName}`.trim()
              : 'Unknown';

            return {
              user_id: team.vendor_id,
              user_name: fullName || 'Unknown',
              user_email: userData?.email || '',
              division: (userData as any)?.division ?? null,
              phone: phone,
              address: address,
              status: team.status,
              payment_data: paymentData || null,
              adjustment_amount: adjustmentByVendorId[team.vendor_id] ?? 0,
              worked_hours: includeHours ? (workedHoursByVendorId[team.vendor_id] ?? 0) : undefined
            };
          })
        );

        return {
          ...event,
          event_payment: eventPaymentsByEventId[event.id] || null,
          workers: workersWithPayment
        };
      })
    );

    return NextResponse.json({ events: eventsWithPaymentData }, { status: 200 });
  } catch (err: any) {
    console.error('SERVER ERROR in events-by-date:', err);
    return NextResponse.json({ error: err.message || err }, { status: 500 });
  }
}
