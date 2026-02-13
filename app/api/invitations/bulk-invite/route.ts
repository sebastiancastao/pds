import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendVendorBulkInvitationEmail } from "@/lib/email";
import { decrypt } from "@/lib/encryption";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());
const isRateLimitError = (errorMessage: string) => /429|too many requests|rate limit/i.test(errorMessage);

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

    // Decrypt manager profile names
    let managerFirstName = 'Event';
    let managerLastName = 'Manager';
    let managerPhone = '';
    if (managerProfile) {
      try {
        managerFirstName = managerProfile.first_name ? decrypt(managerProfile.first_name) : 'Event';
        managerLastName = managerProfile.last_name ? decrypt(managerProfile.last_name) : 'Manager';
        managerPhone = managerProfile.phone ? decrypt(managerProfile.phone) : '';
      } catch (decryptError) {
        console.error('Error decrypting manager profile:', decryptError);
      }
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

    // Calculate invitation period
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (durationWeeks * 7));

    // Send invitations sequentially to avoid provider burst rate limiting (429)
    let successes = 0;
    const failedEmails: string[] = [];

    for (const vendor of vendors as any[]) {
      const normalizedEmail = (vendor.email || "").toString().trim().toLowerCase();

      if (!isValidEmail(normalizedEmail)) {
        failedEmails.push(`Skipped ${vendor.id}: invalid email "${vendor.email || "missing"}"`);
        continue;
      }

      try {
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
          throw new Error(`Failed to store invitation for ${normalizedEmail}`);
        }

        // Decrypt vendor names
        let firstName = 'Vendor';
        let lastName = '';
        try {
          firstName = vendor.profiles.first_name ? decrypt(vendor.profiles.first_name) : 'Vendor';
          lastName = vendor.profiles.last_name ? decrypt(vendor.profiles.last_name) : '';
        } catch (decryptError) {
          console.error('Error decrypting vendor name:', decryptError);
          firstName = 'Vendor';
          lastName = '';
        }

        // Retry on 429 responses from provider
        let emailResult: Awaited<ReturnType<typeof sendVendorBulkInvitationEmail>> | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          emailResult = await sendVendorBulkInvitationEmail({
            email: normalizedEmail,
            firstName,
            lastName,
            durationWeeks,
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
            managerName: `${managerFirstName} ${managerLastName}`,
            managerPhone,
            invitationToken
          });

          if (emailResult.success) break;
          const err = emailResult.error || "Unknown email error";
          if (attempt < 3 && isRateLimitError(err)) {
            await sleep(1200 * attempt);
            continue;
          }
          throw new Error(`Failed to send email to ${normalizedEmail}: ${err}`);
        }

        if (!emailResult?.success) {
          throw new Error(`Failed to send email to ${normalizedEmail}`);
        }

        successes++;
        // Light throttling between sends to reduce 429 likelihood
        await sleep(125);
      } catch (error: any) {
        failedEmails.push(error?.message || `Failed to send email to ${normalizedEmail}`);
      }
    }

    const failures = failedEmails.length;

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
