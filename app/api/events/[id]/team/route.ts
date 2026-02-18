import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendTeamConfirmationEmail } from "@/lib/email";
import { decrypt, safeDecrypt } from "@/lib/encryption";
import crypto from "crypto";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRateLimitError = (errorMessage: string) => /429|too many requests|rate limit/i.test(errorMessage);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ATTESTATION_TIME_MATCH_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/events/[id]/team
 * Create a team for an event by assigning vendors
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
    const { vendorIds, autoConfirm } = body;
    const shouldAutoConfirm = autoConfirm === true;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return NextResponse.json({ error: 'Vendor IDs are required' }, { status: 400 });
    }

    // Verify event exists and user owns it
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, created_by, event_name, event_date')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Allow event creator, exec, or manager roles
    if (event.created_by !== user.id) {
      const { data: requester } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      const role = String(requester?.role || '').toLowerCase().trim();
      if (role !== 'exec' && role !== 'manager' && role !== 'supervisor') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
    }

    // Get vendor details for sending emails
    const { data: vendors, error: vendorsError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        profiles (
          first_name,
          last_name
        )
      `)
      .in('id', vendorIds);

    if (vendorsError || !vendors || vendors.length === 0) {
      return NextResponse.json({
        error: 'Vendors not found'
      }, { status: 404 });
    }

    // Get manager details for email context
    const { data: managerProfile } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name, phone')
      .eq('user_id', user.id)
      .single();

    // Get existing team members to avoid duplicates and support incremental team building
    const { data: existingTeam, error: existingError } = await supabaseAdmin
      .from('event_teams')
      .select('vendor_id')
      .eq('event_id', eventId);

    if (existingError) {
      console.error('❌ Error fetching existing team:', existingError);
      return NextResponse.json({
        error: 'Failed to check existing team members: ' + existingError.message
      }, { status: 500 });
    }

    // Get list of vendor IDs already on the team
    const existingVendorIds = new Set(existingTeam?.map(t => t.vendor_id) || []);

    // Filter out vendors that are already on the team
    const newVendorIds = vendorIds.filter(vendorId => !existingVendorIds.has(vendorId));

    console.log('🔍 DEBUG - Existing team size:', existingVendorIds.size);
    console.log('🔍 DEBUG - New vendors to add:', newVendorIds.length);
    console.log('🔍 DEBUG - Vendors already on team:', vendorIds.filter(id => existingVendorIds.has(id)).length);

    // If no new vendors to add, return success with message
    if (newVendorIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: shouldAutoConfirm
          ? `All selected vendors are already on the team. No new members were added.`
          : `All selected vendors are already on the team. No new invitations sent.`,
        teamSize: existingVendorIds.size,
        emailStats: {
          sent: 0,
          failed: 0
        }
      }, { status: 200 });
    }

    // Create team assignments only for new vendors
    const teamMembers = newVendorIds.map(vendorId => ({
      event_id: eventId,
      vendor_id: vendorId,
      assigned_by: user.id,
      status: shouldAutoConfirm ? 'confirmed' : 'pending_confirmation',
      confirmation_token: shouldAutoConfirm ? null : crypto.randomBytes(32).toString('hex'),
      created_at: new Date().toISOString()
    }));

    console.log('🔍 DEBUG - Team members to insert:', teamMembers);

    // Insert only new team members (incremental team building - no deletion!)
    const { data: insertedTeams, error: insertError } = await supabaseAdmin
      .from('event_teams')
      .insert(teamMembers)
      .select();

    console.log('🔍 DEBUG - Inserted teams:', insertedTeams);
    console.log('🔍 DEBUG - Insert error:', insertError);

    if (insertError) {
      console.error('❌ Error creating team:', insertError);
      return NextResponse.json({
        error: 'Failed to create team: ' + insertError.message
      }, { status: 500 });
    }

    const totalTeamSize = existingVendorIds.size + newVendorIds.length;
    const alreadyOnTeam = vendorIds.filter(id => existingVendorIds.has(id)).length;

    if (shouldAutoConfirm) {
      return NextResponse.json({
        success: true,
        message: alreadyOnTeam > 0
          ? `Added ${newVendorIds.length} new vendor${newVendorIds.length !== 1 ? 's' : ''} as confirmed (${alreadyOnTeam} already on team). Total team size: ${totalTeamSize}.`
          : `Added ${newVendorIds.length} vendor${newVendorIds.length !== 1 ? 's' : ''} to the team as confirmed. Total team size: ${totalTeamSize}.`,
        teamSize: totalTeamSize,
        newMembers: newVendorIds.length,
        alreadyOnTeam: alreadyOnTeam,
        autoConfirmed: true
      }, { status: 200 });
    }

    // Send confirmation emails sequentially to avoid rate limiting (429)
    const newVendors = vendors.filter((v: any) => newVendorIds.includes(v.id));

    // Decrypt manager details once (shared across all emails)
    let managerName = 'Event Manager';
    let managerPhone = '';
    try {
      if (managerProfile) {
        const managerFirst = managerProfile.first_name
          ? decrypt(managerProfile.first_name)
          : '';
        const managerLast = managerProfile.last_name
          ? decrypt(managerProfile.last_name)
          : '';
        managerName = `${managerFirst} ${managerLast}`.trim() || 'Event Manager';
        managerPhone = managerProfile.phone
          ? decrypt(managerProfile.phone)
          : '';
      }
    } catch (error) {
      console.error('❌ Error decrypting manager details:', error);
    }

    // Format event date once
    const eventDate = event.event_date
      ? new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : 'Date TBD';

    let emailsSent = 0;
    let emailsFailed = 0;

    for (const vendor of newVendors as any[]) {
      const teamMember = insertedTeams?.find((t: any) => t.vendor_id === vendor.id);
      if (!teamMember) {
        emailsFailed++;
        continue;
      }

      // Decrypt vendor names
      let vendorFirstName = 'Vendor';
      let vendorLastName = '';
      try {
        vendorFirstName = vendor.profiles?.first_name
          ? decrypt(vendor.profiles.first_name)
          : 'Vendor';
        vendorLastName = vendor.profiles?.last_name
          ? decrypt(vendor.profiles.last_name)
          : '';
      } catch (error) {
        console.error('❌ Error decrypting vendor name for email:', error);
      }

      // Retry on 429 responses from provider
      try {
        let emailResult: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          emailResult = await sendTeamConfirmationEmail({
            email: vendor.email,
            firstName: vendorFirstName,
            lastName: vendorLastName,
            eventName: event.event_name,
            eventDate: eventDate,
            managerName: managerName,
            managerPhone: managerPhone,
            confirmationToken: teamMember.confirmation_token
          });

          if (emailResult?.success) break;
          const err = emailResult?.error || 'Unknown email error';
          if (attempt < 3 && isRateLimitError(err)) {
            await sleep(1200 * attempt);
            continue;
          }
          throw new Error(`Failed to send email to ${vendor.email}: ${err}`);
        }

        if (!emailResult?.success) {
          throw new Error(`Failed to send email to ${vendor.email}`);
        }

        emailsSent++;
        // Light throttling between sends to reduce 429 likelihood
        await sleep(125);
      } catch (error: any) {
        console.error(`❌ Email failed for ${vendor.email}:`, error?.message);
        emailsFailed++;
      }
    }

    console.log(`📧 Sent ${emailsSent} confirmation emails, ${emailsFailed} failed`);

    return NextResponse.json({
      success: true,
      message: alreadyOnTeam > 0
        ? `Added ${newVendorIds.length} new vendor${newVendorIds.length !== 1 ? 's' : ''} to the team (${alreadyOnTeam} already on team). Total team size: ${totalTeamSize}. Awaiting confirmation.`
        : `Team invitations sent to ${newVendorIds.length} vendor${newVendorIds.length !== 1 ? 's' : ''}. Total team size: ${totalTeamSize}. Awaiting confirmation.`,
      teamSize: totalTeamSize,
      newMembers: newVendorIds.length,
      alreadyOnTeam: alreadyOnTeam,
      emailStats: {
        sent: emailsSent,
        failed: emailsFailed
      }
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in team creation endpoint:', error);
    return NextResponse.json({
      error: error.message || 'Failed to create team'
    }, { status: 500 });
  }
}

/**
 * GET /api/events/[id]/team
 * Get the current team for an event
 */
export async function GET(
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

    // Keep payload lean and stable: do not include raw profile photo blobs here.
    const selectFields = `
      id,
      vendor_id,
      status,
      created_at,
      users!event_teams_vendor_id_fkey (
        id,
        email,
        division,
        profiles (
          first_name,
          last_name,
          phone
        )
      )
    `;

    const { data: teamMembers, error: teamError } = await supabaseAdmin
      .from('event_teams')
      .select(selectFields)
      .eq('event_id', eventId);

    if (teamError) {
      console.error('❌ Error fetching team:', teamError);
      return NextResponse.json({
        team: [],
        error: teamError.message
      }, { status: 200 });
    }

    const teamUserIds = (teamMembers || [])
      .map((member: any) => (member?.vendor_id || member?.users?.id || '').toString())
      .filter((id: string) => id.length > 0);

    let hasAttestationByUserId = new Map<string, boolean>();
    if (teamUserIds.length > 0) {
      const { data: clockOutRows, error: clockOutError } = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, timestamp')
        .eq('event_id', eventId)
        .eq('action', 'clock_out')
        .in('user_id', teamUserIds);

      if (clockOutError) {
        console.error('Error fetching clock-out entries for attestation checks:', clockOutError);
      } else {
        const clockOutRowsByUser = new Map<
          string,
          Array<{ formId: string; timestampMs: number | null }>
        >();
        const clockOutMs: number[] = [];

        for (const row of clockOutRows || []) {
          const userId = String((row as any)?.user_id || '').trim();
          const entryId = String((row as any)?.id || '').trim();
          if (!userId || !entryId) continue;

          const parsedMs = Date.parse(String((row as any)?.timestamp || ''));
          const timestampMs = Number.isNaN(parsedMs) ? null : parsedMs;
          if (timestampMs !== null) clockOutMs.push(timestampMs);

          const existing = clockOutRowsByUser.get(userId) || [];
          existing.push({ formId: `clock-out-${entryId}`, timestampMs });
          clockOutRowsByUser.set(userId, existing);
        }

        if (clockOutRowsByUser.size > 0) {
          let attestationQuery = supabaseAdmin
            .from('form_signatures')
            .select('user_id, form_id, signed_at')
            .eq('form_type', 'clock_out_attestation')
            .in('user_id', teamUserIds);

          if (clockOutMs.length > 0) {
            const minMs = Math.min(...clockOutMs) - ATTESTATION_TIME_MATCH_WINDOW_MS;
            const maxMs = Math.max(...clockOutMs) + ATTESTATION_TIME_MATCH_WINDOW_MS;
            attestationQuery = attestationQuery
              .gte('signed_at', new Date(minMs).toISOString())
              .lte('signed_at', new Date(maxMs).toISOString());
          }

          const { data: attestationRows, error: attestationError } = await attestationQuery;

          if (attestationError) {
            console.error('Error fetching attestations for team members:', attestationError);
          } else {
            for (const row of attestationRows || []) {
              const userId = String((row as any)?.user_id || '').trim();
              if (!userId) continue;

              const userClockOutRows = clockOutRowsByUser.get(userId) || [];
              if (userClockOutRows.length === 0) continue;

              const formId = String((row as any)?.form_id || '').trim();
              const signedAtMs = Date.parse(String((row as any)?.signed_at || ''));
              const hasDirectFormMatch = userClockOutRows.some((entry) => entry.formId === formId);
              const hasTimeMatch =
                !Number.isNaN(signedAtMs) &&
                userClockOutRows.some(
                  (entry) =>
                    entry.timestampMs !== null &&
                    Math.abs(entry.timestampMs - signedAtMs) <= ATTESTATION_TIME_MATCH_WINDOW_MS
                );

              if (hasDirectFormMatch || hasTimeMatch) {
                hasAttestationByUserId.set(userId, true);
              }
            }
          }
        }
      }
    }

    let employeePhoneByUserId = new Map<string, string>();
    if (teamUserIds.length > 0) {
      const { data: employeeInfoRows, error: employeeInfoError } = await supabaseAdmin
        .from('employee_information')
        .select('user_id, phone')
        .in('user_id', teamUserIds);

      if (employeeInfoError) {
        console.error('Error fetching employee info phone fallback:', employeeInfoError);
      } else {
        employeePhoneByUserId = new Map(
          (employeeInfoRows || []).map((row: any) => [
            String(row.user_id),
            (row.phone || '').toString(),
          ])
        );
      }
    }

    // Decrypt sensitive profile data and fallback to employee_information.phone when needed
    const decryptedTeamMembers = teamMembers?.map((member: any) => {
      if (!member?.users) return member;

      const memberUserId = (member?.vendor_id || member?.users?.id || '').toString();
      const profile = Array.isArray(member.users?.profiles)
        ? member.users.profiles[0]
        : (member.users?.profiles || {});

      const profilePhone = profile?.phone
        ? safeDecrypt(String(profile.phone))
        : '';
      const employeeInfoPhone = memberUserId
        ? safeDecrypt(employeePhoneByUserId.get(memberUserId) || '')
        : '';
      const hasAttestation = memberUserId
        ? Boolean(hasAttestationByUserId.get(memberUserId))
        : false;

      return {
        ...member,
        has_attestation: hasAttestation,
        users: {
          ...member.users,
          profiles: {
            ...profile,
            first_name: profile?.first_name
              ? safeDecrypt(String(profile.first_name))
              : '',
            last_name: profile?.last_name
              ? safeDecrypt(String(profile.last_name))
              : '',
            phone: profilePhone || employeeInfoPhone,
            profile_photo_url: null,
          }
        }
      };
    });

    return NextResponse.json({
      team: decryptedTeamMembers || []
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in team fetch endpoint:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch team'
    }, { status: 500 });
  }
}
