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

        // For each vendor, get their user info and payment data
        const workersWithPayment = await Promise.all(
          (eventTeams || []).map(async (team: any) => {
            // Get user email
            const { data: userData } = await supabaseAdmin
              .from('users')
              .select('email')
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
              phone: phone,
              address: address,
              status: team.status,
              payment_data: paymentData || null
            };
          })
        );

        return {
          ...event,
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
