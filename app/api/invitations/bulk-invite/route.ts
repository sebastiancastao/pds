import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendVendorBulkInvitationEmail } from "@/lib/email";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * POST /api/invitations/bulk-invite
 * Send bulk invitations to selected vendors for multiple events over a period
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // Authenticate user
    let { data: { user } } = await supabase.auth.getUser();

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
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get request body
    const body = await req.json();
    const { vendorIds, durationWeeks = 3 } = body;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return NextResponse.json({ error: 'Vendor IDs are required' }, { status: 400 });
    }

    // Get all active events created by this user
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id, event_name, venue, event_date')
      .eq('created_by', user.id)
      .eq('is_active', true)
      .order('event_date', { ascending: true });

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }

    // Get manager profile for email context
    const { data: managerProfile } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name, phone')
      .eq('user_id', user.id)
      .single();

    // Get vendor details (only those selected)
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        profiles!inner (
          first_name,
          last_name
        )
      `)
      .in('id', vendorIds);

    if (vendorsError || !vendors || vendors.length === 0) {
      return NextResponse.json({ error: 'No vendors found' }, { status: 404 });
    }

    // Calculate invitation period
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (durationWeeks * 7));

    // Send invitations to each vendor
    const results = await Promise.allSettled(
      vendors.map(async (vendor: any) => {
        // Generate unique invitation token
        const invitationToken = crypto.randomBytes(32).toString('hex');

        // Store bulk invitation in database
        const { error: inviteError } = await supabaseAdmin
          .from('vendor_invitations')
          .insert({
            token: invitationToken,
            event_id: null, // Null for bulk invitations across multiple events
            vendor_id: vendor.id,
            invited_by: user.id,
            status: 'pending',
            invitation_type: 'bulk',
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            duration_weeks: durationWeeks,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days to respond
          });

        if (inviteError) {
          console.error('Error storing invitation:', inviteError);
          throw new Error(`Failed to store invitation for ${vendor.email}`);
        }

        // Send invitation email
        const emailResult = await sendVendorBulkInvitationEmail({
          email: vendor.email,
          firstName: vendor.profiles.first_name,
          lastName: vendor.profiles.last_name,
          durationWeeks: durationWeeks,
          eventCount: events?.length || 0,
          startDate: startDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          endDate: endDate.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          managerName: managerProfile
            ? `${managerProfile.first_name} ${managerProfile.last_name}`
            : 'Event Manager',
          managerPhone: managerProfile?.phone || '',
          invitationToken: invitationToken
        });

        if (!emailResult.success) {
          throw new Error(`Failed to send email to ${vendor.email}: ${emailResult.error}`);
        }

        return {
          vendorId: vendor.id,
          email: vendor.email,
          success: true,
          messageId: emailResult.messageId
        };
      })
    );

    // Count successes and failures
    const successes = results.filter(r => r.status === 'fulfilled').length;
    const failures = results.filter(r => r.status === 'rejected').length;

    const failedEmails = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason.message);

    return NextResponse.json({
      success: true,
      message: `Sent ${successes} invitation(s) successfully`,
      stats: {
        total: vendorIds.length,
        sent: successes,
        failed: failures
      },
      failures: failedEmails.length > 0 ? failedEmails : undefined
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error sending bulk vendor invitations:', error);
    return NextResponse.json({
      error: error.message || 'Failed to send invitations'
    }, { status: 500 });
  }
}
