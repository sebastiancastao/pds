import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendTeamConfirmationEmail, sendTeamBuildingNotification } from "@/lib/email";
import { getVenueBccEmails } from "@/lib/venue-bcc";
import { decrypt, safeDecrypt } from "@/lib/encryption";
import { calculateDistanceMiles } from "@/lib/geocoding";
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

const isMissingRelationError = (error: any): boolean => {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "");
  return code === "42P01" || /relation .* does not exist/i.test(message);
};

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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

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
      .select('id, created_by, event_name, event_date, start_time, venue')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const { data: requester, error: requesterError } = await supabaseAdmin
      .from('users')
      .select('role, email')
      .eq('id', user.id)
      .maybeSingle();

    if (requesterError) {
      return NextResponse.json({ error: requesterError.message }, { status: 500 });
    }

    const requesterRole = String(requester?.role || '').toLowerCase().trim();
    const requesterEmail = String(requester?.email || '').trim().toLowerCase();

    // Allow event creator, exec, manager, or supervisor roles
    if (event.created_by !== user.id) {
      if (requesterRole !== 'exec' && requesterRole !== 'manager' && requesterRole !== 'supervisor' && requesterRole !== 'supervisor2' && requesterRole !== 'supervisor3') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }
    }

    let managerCcEmail: string | null = null;
    const requesterIsSupervisor = requesterRole === 'supervisor' || requesterRole === 'supervisor2';

    if (!shouldAutoConfirm && requesterIsSupervisor) {
      const managerCandidateIds: string[] = [];

      const eventCreatorId = String(event.created_by || '').trim();
      if (eventCreatorId && eventCreatorId !== user.id) {
        managerCandidateIds.push(eventCreatorId);
      }

      const { data: managerLinks, error: managerLinksError } = await supabaseAdmin
        .from('manager_team_members')
        .select('manager_id')
        .eq('member_id', user.id)
        .eq('is_active', true);

      if (managerLinksError && !isMissingRelationError(managerLinksError)) {
        console.error('Error loading manager links for supervisor invite CC:', managerLinksError);
      }

      for (const link of managerLinks || []) {
        const managerId = String((link as any)?.manager_id || '').trim();
        if (managerId && managerId !== user.id && !managerCandidateIds.includes(managerId)) {
          managerCandidateIds.push(managerId);
        }
      }

      if (managerCandidateIds.length > 0) {
        const { data: managerUsers, error: managerUsersError } = await supabaseAdmin
          .from('users')
          .select('id, email, role')
          .in('id', managerCandidateIds);

        if (managerUsersError) {
          console.error('Error loading manager emails for supervisor invite CC:', managerUsersError);
        } else {
          const normalizedManagers = (managerUsers || []).map((row: any) => ({
            id: String(row?.id || '').trim(),
            role: String(row?.role || '').toLowerCase().trim(),
            email: String(row?.email || '').trim().toLowerCase(),
          }));

          const byEventCreator = normalizedManagers.find((row) => row.id === eventCreatorId && row.email);
          const byManagerRole = normalizedManagers.find((row) => row.role === 'manager' && row.email);
          const fallback = normalizedManagers.find((row) => row.email);
          const selected = byEventCreator || byManagerRole || fallback;

          if (selected?.email && selected.email !== requesterEmail) {
            managerCcEmail = selected.email;
          }
        }
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
      .upsert(teamMembers, { onConflict: 'event_id,vendor_id', ignoreDuplicates: true })
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

    let notifyManagerName = 'Event Manager';
    try {
      if (managerProfile) {
        const f = managerProfile.first_name ? decrypt(managerProfile.first_name) : '';
        const l = managerProfile.last_name ? decrypt(managerProfile.last_name) : '';
        notifyManagerName = `${f} ${l}`.trim() || 'Event Manager';
      }
    } catch {}

    const newVendorsForNotify = (vendors as any[]).filter(v => newVendorIds.includes(v.id));
    const notifyVendorNames: string[] = newVendorsForNotify.map(v => {
      try {
        const f = v.profiles?.first_name ? decrypt(v.profiles.first_name) : '';
        const l = v.profiles?.last_name ? decrypt(v.profiles.last_name) : '';
        return `${f} ${l}`.trim() || v.email || 'Unknown';
      } catch {
        return v.email || 'Unknown';
      }
    });

    await sendTeamBuildingNotification({
      managerName: notifyManagerName,
      managerEmail: requesterEmail,
      eventName: event.event_name,
      eventDate: formatEventDate(event.event_date),
      eventStartTime: formatEventStartTime((event as any).start_time),
      vendorNames: notifyVendorNames,
      autoConfirmed: shouldAutoConfirm,
    }).catch(err => console.error('❌ Team building notification failed:', err));

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

    // Format event date once without timezone day-shift.
    const eventDate = formatEventDate(event.event_date);
    const eventStartTime = formatEventStartTime((event as any).start_time);

    // Resolve per-venue BCC recipients
    const venueBccEmails = await getVenueBccEmails((event as any).venue, supabaseAdmin);

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
        const vendorEmailNormalized = String(vendor.email || '').trim().toLowerCase();
        const ccForVendor = managerCcEmail && managerCcEmail !== vendorEmailNormalized
          ? managerCcEmail
          : undefined;
        for (let attempt = 1; attempt <= 3; attempt++) {
          emailResult = await sendTeamConfirmationEmail({
            email: vendor.email,
            firstName: vendorFirstName,
            lastName: vendorLastName,
            eventName: event.event_name,
            eventDate: eventDate,
            eventStartTime,
            managerName: managerName,
            managerPhone: managerPhone,
            confirmationToken: teamMember.confirmation_token,
            cc: ccForVendor,
            bcc: venueBccEmails.length > 0 ? venueBccEmails : undefined,
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

    const { data: eventData, error: eventError } = await supabaseAdmin
      .from('events')
      .select('venue, city, state')
      .eq('id', eventId)
      .maybeSingle();

    if (eventError) {
      console.error('Error loading event for team distance calculation:', eventError);
    }

    let venueCoordinates: { latitude: number; longitude: number } | null = null;
    if (eventData?.venue) {
      const { data: venueMatches, error: venueError } = await supabaseAdmin
        .from('venue_reference')
        .select('latitude, longitude, city, state')
        .eq('venue_name', eventData.venue);

      if (venueError) {
        console.error('Error loading venue coordinates for team distance calculation:', venueError);
      } else if (Array.isArray(venueMatches) && venueMatches.length > 0) {
        const eventCity = normalizeText(eventData.city);
        const eventState = normalizeText(eventData.state);
        const matchedVenue =
          venueMatches.find((candidate: any) => {
            const cityMatches = !eventCity || normalizeText(candidate?.city) === eventCity;
            const stateMatches = !eventState || normalizeText(candidate?.state) === eventState;
            return cityMatches && stateMatches;
          }) || venueMatches[0];

        const latitude = toFiniteNumber((matchedVenue as any)?.latitude);
        const longitude = toFiniteNumber((matchedVenue as any)?.longitude);
        if (latitude != null && longitude != null) {
          venueCoordinates = { latitude, longitude };
        }
      }
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
          phone,
          city,
          state,
          region_id,
          latitude,
          longitude
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

    const outOfVenueVendorIds = new Set<string>();
    if (eventData?.venue && teamUserIds.length > 0) {
      const { data: venueMatches, error: venueError } = await supabaseAdmin
        .from('venue_reference')
        .select('id, city, state')
        .eq('venue_name', eventData.venue);

      if (venueError) {
        console.error('Error loading venue assignment reference for team members:', venueError);
      } else if (Array.isArray(venueMatches) && venueMatches.length > 0) {
        const eventCity = normalizeText(eventData.city);
        const eventState = normalizeText(eventData.state);
        const matchedVenue =
          venueMatches.find((candidate: any) => {
            const cityMatches = !eventCity || normalizeText(candidate?.city) === eventCity;
            const stateMatches = !eventState || normalizeText(candidate?.state) === eventState;
            return cityMatches && stateMatches;
          }) || venueMatches[0];

        const venueId = String((matchedVenue as any)?.id || '').trim();
        if (venueId) {
          const { data: venueAssignments, error: venueAssignmentsError } = await supabaseAdmin
            .from('vendor_venue_assignments')
            .select('vendor_id')
            .eq('venue_id', venueId)
            .in('vendor_id', teamUserIds);

          if (venueAssignmentsError) {
            console.error('Error loading vendor venue assignments for team members:', venueAssignmentsError);
          } else {
            const assignedToVenueIds = new Set(
              (venueAssignments || [])
                .map((assignment: any) => String(assignment?.vendor_id || '').trim())
                .filter(Boolean)
            );

            for (const vendorId of teamUserIds) {
              if (!assignedToVenueIds.has(vendorId)) {
                outOfVenueVendorIds.add(vendorId);
              }
            }
          }
        }
      }
    }

    let hasAttestationByUserId = new Map<string, boolean>();
    let latestClockOutByUserId = new Map<
      string,
      { timestampMs: number | null; attestationAccepted: boolean | null }
    >();
    if (teamUserIds.length > 0) {
      let clockOutRows: any[] | null = null;
      let clockOutError: any = null;
      const clockOutWithAttestationResult = await supabaseAdmin
        .from('time_entries')
        .select('id, user_id, timestamp, attestation_accepted')
        .eq('event_id', eventId)
        .eq('action', 'clock_out')
        .in('user_id', teamUserIds);

      if (
        clockOutWithAttestationResult.error &&
        String((clockOutWithAttestationResult.error as any)?.code || '').trim() === '42703'
      ) {
        const fallbackClockOutResult = await supabaseAdmin
          .from('time_entries')
          .select('id, user_id, timestamp')
          .eq('event_id', eventId)
          .eq('action', 'clock_out')
          .in('user_id', teamUserIds);
        clockOutRows = fallbackClockOutResult.data || null;
        clockOutError = fallbackClockOutResult.error || null;
      } else {
        clockOutRows = clockOutWithAttestationResult.data || null;
        clockOutError = clockOutWithAttestationResult.error || null;
      }

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
          const rawAttestationAccepted = (row as any)?.attestation_accepted;
          const attestationAccepted =
            typeof rawAttestationAccepted === 'boolean' ? rawAttestationAccepted : null;
          if (timestampMs !== null) clockOutMs.push(timestampMs);

          const existing = clockOutRowsByUser.get(userId) || [];
          existing.push({ formId: `clock-out-${entryId}`, timestampMs });
          clockOutRowsByUser.set(userId, existing);

          const previousLatest = latestClockOutByUserId.get(userId);
          const previousMs = previousLatest?.timestampMs ?? Number.NEGATIVE_INFINITY;
          const currentMs = timestampMs ?? Number.NEGATIVE_INFINITY;
          if (!previousLatest || currentMs >= previousMs) {
            latestClockOutByUserId.set(userId, { timestampMs, attestationAccepted });
          }
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
      const profileLatitude = toFiniteNumber(profile?.latitude);
      const profileLongitude = toFiniteNumber(profile?.longitude);
      const distance =
        venueCoordinates && profileLatitude != null && profileLongitude != null
          ? Math.round(
              calculateDistanceMiles(
                venueCoordinates.latitude,
                venueCoordinates.longitude,
                profileLatitude,
                profileLongitude
              ) * 10
            ) / 10
          : null;

      const profilePhone = profile?.phone
        ? safeDecrypt(String(profile.phone))
        : '';
      const employeeInfoPhone = memberUserId
        ? safeDecrypt(employeePhoneByUserId.get(memberUserId) || '')
        : '';
      const hasAttestation = memberUserId
        ? Boolean(hasAttestationByUserId.get(memberUserId))
        : false;
      const latestClockOut = memberUserId
        ? latestClockOutByUserId.get(memberUserId)
        : undefined;
      const attestationStatus = memberUserId
        ? latestClockOut?.attestationAccepted === false
            ? 'rejected'
            : hasAttestation
              ? 'submitted'
              : 'not_submitted'
        : 'not_submitted';
      const hasSubmittedAttestation = attestationStatus === 'submitted';

      return {
        ...member,
        distance,
        isOutOfVenue: memberUserId ? outOfVenueVendorIds.has(memberUserId) : false,
        has_attestation: hasSubmittedAttestation,
        attestation_status: attestationStatus,
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

    type RawUninviteHistoryRow = {
      id: string;
      vendor_id: string;
      previous_status: string;
      uninvited_by_user_id: string;
      uninvited_at: string;
      team_member_id: string;
      metadata: Record<string, any>;
    };

    let rawUninviteRows: RawUninviteHistoryRow[] = [];

    const { data: uninviteRows, error: uninviteRowsError } = await supabaseAdmin
      .from('event_team_uninvites')
      .select('id, vendor_id, previous_status, uninvited_by, uninvited_at, team_member_id, metadata')
      .eq('event_id', eventId)
      .order('uninvited_at', { ascending: false })
      .limit(200);

    if (uninviteRowsError) {
      if (!isMissingRelationError(uninviteRowsError)) {
        console.error('Error fetching event_team_uninvites history:', uninviteRowsError);
      }

      const { data: uninviteAuditRows, error: uninviteAuditError } = await supabaseAdmin
        .from('audit_logs')
        .select('id, user_id, created_at, metadata')
        .eq('action', 'team_member_uninvited')
        .eq('resource_type', 'event')
        .eq('resource_id', eventId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (uninviteAuditError) {
        console.error('Error fetching legacy team uninvite audit history:', uninviteAuditError);
      } else {
        rawUninviteRows = (uninviteAuditRows || []).map((row: any) => {
          const metadata =
            row && typeof row.metadata === 'object' && row.metadata !== null
              ? (row.metadata as Record<string, any>)
              : {};
          return {
            id: String(row?.id || ''),
            vendor_id: String(metadata.vendor_id || '').trim(),
            previous_status: String(metadata.previous_status || '').trim(),
            uninvited_by_user_id: String(row?.user_id || metadata.uninvited_by_user_id || '').trim(),
            uninvited_at: String(row?.created_at || ''),
            team_member_id: String(metadata.team_member_id || '').trim(),
            metadata,
          };
        });
      }
    } else {
      rawUninviteRows = (uninviteRows || []).map((row: any) => {
        const metadata =
          row && typeof row.metadata === 'object' && row.metadata !== null
            ? (row.metadata as Record<string, any>)
            : {};

        return {
          id: String(row?.id || ''),
          vendor_id: String(row?.vendor_id || metadata.vendor_id || '').trim(),
          previous_status: String(row?.previous_status || metadata.previous_status || '').trim(),
          uninvited_by_user_id: String(row?.uninvited_by || metadata.uninvited_by_user_id || '').trim(),
          uninvited_at: String(row?.uninvited_at || ''),
          team_member_id: String(row?.team_member_id || metadata.team_member_id || '').trim(),
          metadata,
        };
      });
    }

    const vendorIds = new Set<string>();
    const actorIds = new Set<string>();

    for (const row of rawUninviteRows) {
      if (row.vendor_id) vendorIds.add(row.vendor_id);
      if (row.uninvited_by_user_id) actorIds.add(row.uninvited_by_user_id);
    }

    const relatedUserIds = Array.from(new Set<string>([...vendorIds, ...actorIds]));
    const userLookup = new Map<string, { name: string; email: string }>();

    if (relatedUserIds.length > 0) {
      const { data: relatedUsers, error: relatedUsersError } = await supabaseAdmin
        .from('users')
        .select(`
          id,
          email,
          profiles (
            first_name,
            last_name
          )
        `)
        .in('id', relatedUserIds);

      if (relatedUsersError) {
        console.error('Error fetching uninvite history users:', relatedUsersError);
      } else {
        for (const relatedUser of relatedUsers || []) {
          const profile = Array.isArray((relatedUser as any)?.profiles)
            ? (relatedUser as any).profiles[0]
            : ((relatedUser as any)?.profiles || {});
          const firstName = profile?.first_name ? safeDecrypt(String(profile.first_name)) : '';
          const lastName = profile?.last_name ? safeDecrypt(String(profile.last_name)) : '';
          const fullName = `${firstName} ${lastName}`.trim();
          userLookup.set(String((relatedUser as any)?.id || ''), {
            name: fullName,
            email: String((relatedUser as any)?.email || '').trim(),
          });
        }
      }
    }

    const uninvitedHistory = rawUninviteRows.map((row) => {
      const metadata = row.metadata || {};
      const vendorUser = row.vendor_id ? userLookup.get(row.vendor_id) : undefined;
      const uninvitedByUser = row.uninvited_by_user_id
        ? userLookup.get(row.uninvited_by_user_id)
        : undefined;

      return {
        id: row.id,
        vendor_id: row.vendor_id || null,
        vendor_name:
          vendorUser?.name ||
          String(metadata.vendor_name || '').trim() ||
          'Unknown',
        vendor_email:
          vendorUser?.email ||
          String(metadata.vendor_email || '').trim(),
        previous_status: row.previous_status || null,
        uninvited_by_user_id: row.uninvited_by_user_id || null,
        uninvited_by_name:
          uninvitedByUser?.name ||
          String(metadata.uninvited_by_name || '').trim() ||
          'Unknown',
        uninvited_by_email:
          uninvitedByUser?.email ||
          String(metadata.uninvited_by_email || '').trim(),
        uninvited_at: row.uninvited_at || null,
        team_member_id: row.team_member_id || null,
      };
    });

    return NextResponse.json({
      team: decryptedTeamMembers || [],
      uninvited_history: uninvitedHistory,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in team fetch endpoint:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch team'
    }, { status: 500 });
  }
}
