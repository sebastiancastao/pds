import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendVendorEventInvitationEmail } from "@/lib/email";
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

function formatEventDate(value: string | null | undefined): string {
  if (!value) return "Date TBD";
  const normalized = String(value).trim();
  const ymd = normalized.slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [yearRaw, monthRaw, dayRaw] = ymd.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const localDate = new Date(year, month - 1, day);
    return localDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatEventStartTime(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = String(value).trim();
  const hhmm = normalized.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const d = new Date();
      d.setHours(hour, minute, 0, 0);
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

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

    // Format event date for display without timezone day-shift.
    const rawDate = eventData.event_date || new Date().toISOString().split("T")[0];
    const eventDate = formatEventDate(rawDate);
    const eventStartTime = formatEventStartTime(eventData.start_time);

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

        // Store invitation in database
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
        let emailResult: Awaited<ReturnType<typeof sendVendorEventInvitationEmail>> | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          emailResult = await sendVendorEventInvitationEmail({
            email: normalizedEmail,
            firstName,
            lastName,
            eventName: eventData.event_name,
            eventDate,
            eventStartTime,
            venueName: eventData.venue,
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
    console.error('Error sending vendor invitations:', error);
    return NextResponse.json({
      error: error.message || 'Failed to send invitations'
    }, { status: 500 });
  }
}
