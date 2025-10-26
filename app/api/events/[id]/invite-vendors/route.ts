import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendVendorEventInvitationEmail } from "@/lib/email";
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
 * POST /api/events/[id]/invite-vendors
 * Send invitations to selected vendors for an event
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
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
    const { vendorIds } = body;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return NextResponse.json({ error: 'Vendor IDs are required' }, { status: 400 });
    }

    // Get event details
    const { data: eventData, error: eventError } = await supabaseAdmin
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (eventError || !eventData) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

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

    // Format event date for display
    const eventDate = new Date(eventData.event_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Send invitations to each vendor
    const results = await Promise.allSettled(
      vendors.map(async (vendor: any) => {
        // Generate unique invitation token
        const invitationToken = crypto.randomBytes(32).toString('hex');

        // Store invitation in database (you may want to create a vendor_invitations table)
        const { error: inviteError } = await supabaseAdmin
          .from('vendor_invitations')
          .insert({
            token: invitationToken,
            event_id: eventId,
            vendor_id: vendor.id,
            invited_by: user.id,
            status: 'pending',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
          });

        if (inviteError) {
          console.error('Error storing invitation:', inviteError);
          throw new Error(`Failed to store invitation for ${vendor.email}`);
        }

        // Send invitation email
        const emailResult = await sendVendorEventInvitationEmail({
          email: vendor.email,
          firstName: vendor.profiles.first_name,
          lastName: vendor.profiles.last_name,
          eventName: eventData.event_name,
          eventDate: eventDate,
          venueName: eventData.venue,
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
    console.error('Error sending vendor invitations:', error);
    return NextResponse.json({
      error: error.message || 'Failed to send invitations'
    }, { status: 500 });
  }
}
