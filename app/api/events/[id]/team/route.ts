import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendTeamConfirmationEmail } from "@/lib/email";
import { decrypt, decryptData } from "@/lib/encryption";
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

    // Role-based authorization:
    // - exec/admin: can create teams for any event
    // - manager: can create teams for own events
    const { data: requester, error: requesterError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (requesterError || !requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const requesterRole = String(requester.role || '').toLowerCase();
    const canManageAllEvents = requesterRole === 'exec' || requesterRole === 'admin';
    const canManageOwnedEvents = requesterRole === 'manager';

    if (!canManageAllEvents && !canManageOwnedEvents) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get request body
    const body = await req.json();
    const { vendorIds } = body;

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

    if (!canManageAllEvents && event.created_by !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
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
        message: `All selected vendors are already on the team. No new invitations sent.`,
        teamSize: existingVendorIds.size,
        emailStats: {
          sent: 0,
          failed: 0
        }
      }, { status: 200 });
    }

    // Create team assignments only for new vendors with confirmation tokens
    const teamMembers = newVendorIds.map(vendorId => ({
      event_id: eventId,
      vendor_id: vendorId,
      assigned_by: user.id,
      status: 'pending_confirmation',
      confirmation_token: crypto.randomBytes(32).toString('hex'),
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

    // Send confirmation emails only to newly added vendors
    const newVendors = vendors.filter((v: any) => newVendorIds.includes(v.id));
    let emailsSent = 0;
    let emailsFailed = 0;

    for (const vendor of newVendors as any[]) {
      const teamMember = insertedTeams?.find((t: any) => t.vendor_id === vendor.id);
      if (!teamMember) {
        emailsFailed++;
        continue;
      }

      const normalizedEmail = (vendor.email || "").toString().trim().toLowerCase();
      if (!isValidEmail(normalizedEmail)) {
        console.warn('Skipping team confirmation email due to invalid address:', vendor.email);
        emailsFailed++;
        continue;
      }

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
        console.error('Error decrypting vendor name for email:', error);
      }

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
        console.error('Error decrypting manager details:', error);
      }

      const eventDate = new Date((event as any).event_date || Date.now()).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      let sent = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const emailResult = await sendTeamConfirmationEmail({
          email: normalizedEmail,
          firstName: vendorFirstName,
          lastName: vendorLastName,
          eventName: event.event_name,
          eventDate,
          managerName,
          managerPhone,
          confirmationToken: teamMember.confirmation_token
        });

        if (emailResult.success) {
          sent = true;
          break;
        }

        const err = emailResult.error || "Unknown email error";
        if (attempt < 3 && isRateLimitError(err)) {
          await sleep(1200 * attempt);
          continue;
        }

        console.error(`Failed to send team confirmation email to ${normalizedEmail}:`, err);
        break;
      }

      if (sent) emailsSent++;
      else emailsFailed++;

      await sleep(125);
    }

    console.log(`📧 Sent ${emailsSent} confirmation emails, ${emailsFailed} failed`);

    const totalTeamSize = existingVendorIds.size + newVendorIds.length;
    const alreadyOnTeam = vendorIds.filter(id => existingVendorIds.has(id)).length;

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

    // Role-based read authorization:
    // - exec/admin: can read team for any event
    // - manager: can read team for own events
    const { data: requester, error: requesterError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (requesterError || !requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    const requesterRole = String(requester.role || '').toLowerCase();
    const canManageAllEvents = requesterRole === 'exec' || requesterRole === 'admin';
    const canManageOwnedEvents = requesterRole === 'manager';
    if (!canManageAllEvents && !canManageOwnedEvents) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Verify event scope for managers
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, created_by')
      .eq('id', eventId)
      .single();
    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    if (!canManageAllEvents && event.created_by !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get team members for this event
    const { data: teamMembers, error: teamError } = await supabaseAdmin
      .from('event_teams')
      .select(`
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
            profile_photo_data
          )
        )
      `)
      .eq('event_id', eventId);

    console.log('🔍 DEBUG - Team members query result:', teamMembers);
    console.log('🔍 DEBUG - Team members query error:', teamError);

    if (teamError) {
      console.error('❌ Error fetching team:', teamError);
      return NextResponse.json({
        team: [],
        error: teamError.message
      }, { status: 200 });
    }

    // Decrypt sensitive profile data and convert binary photo to data URL
    const decryptedTeamMembers = teamMembers?.map((member: any) => {
      if (member.users?.profiles) {
        try {
          let profilePhotoUrl = null;

          // Convert binary profile photo (bytea) to data URL if exists
          if (member.users.profiles.profile_photo_data) {
            try {
              let photoData = member.users.profiles.profile_photo_data;
              console.log('🔍 DEBUG - Photo data type:', typeof photoData);
              console.log('🔍 DEBUG - Is Buffer?:', Buffer.isBuffer(photoData));

              // First, convert hex bytea to string if needed
              if (typeof photoData === 'string' && photoData.startsWith('\\x')) {
                console.log('🔍 DEBUG - Photo is hex bytea, converting to string');
                const hexString = photoData.slice(2); // Remove \x prefix
                const buffer = Buffer.from(hexString, 'hex');
                photoData = buffer.toString('utf-8'); // Convert to string for decryption
                console.log('🔍 DEBUG - Converted hex to string, sample:', photoData.substring(0, 50));
              }

              // Check if photo data is encrypted (starts with U2FsdGVk = "Salted__" in base64)
              if (typeof photoData === 'string' && (photoData.startsWith('U2FsdGVk') || photoData.includes('Salted'))) {
                console.log('🔍 DEBUG - Photo appears to be encrypted, decrypting binary data...');
                try {
                  // Decrypt the binary photo data using decryptData() for binary data
                  const decryptedBytes = decryptData(photoData);
                  console.log('✅ Decrypted photo binary data, size:', decryptedBytes.length, 'bytes');

                  // Convert Uint8Array to base64
                  const base64 = Buffer.from(decryptedBytes).toString('base64');
                  profilePhotoUrl = `data:image/jpeg;base64,${base64}`;
                  console.log('✅ Converted decrypted bytes to data URL');
                } catch (decryptError) {
                  console.error('❌ Error decrypting photo:', decryptError);
                  // Fallback: try treating it as a data URL string instead of binary
                  try {
                    console.log('🔄 Trying to decrypt as text data URL...');
                    const decryptedText = decrypt(photoData);
                    if (decryptedText.startsWith('data:')) {
                      profilePhotoUrl = decryptedText;
                      console.log('✅ Decrypted text data URL');
                    }
                  } catch (fallbackError) {
                    console.error('❌ Fallback decryption also failed:', fallbackError);
                  }
                }
              } else if (Buffer.isBuffer(photoData)) {
                // Raw buffer - convert directly
                const base64 = photoData.toString('base64');
                profilePhotoUrl = `data:image/jpeg;base64,${base64}`;
                console.log('✅ Converted raw buffer to data URL, size:', photoData.length, 'bytes');
              } else if (typeof photoData === 'string') {
                // String that's not encrypted
                if (photoData.startsWith('data:')) {
                  profilePhotoUrl = photoData;
                  console.log('✅ Photo is already a data URL');
                } else {
                  // Assume base64
                  profilePhotoUrl = `data:image/jpeg;base64,${photoData}`;
                  console.log('✅ Added data URL prefix to base64 string');
                }
              } else {
                console.log('⚠️ Unknown photo data format:', typeof photoData);
              }
            } catch (photoError) {
              console.error('❌ Error processing profile photo:', photoError);
            }
          } else {
            console.log('⚠️ No profile_photo_data found for this member');
          }

          return {
            ...member,
            users: {
              ...member.users,
              profiles: {
                ...member.users.profiles,
                first_name: member.users.profiles.first_name
                  ? decrypt(member.users.profiles.first_name)
                  : '',
                last_name: member.users.profiles.last_name
                  ? decrypt(member.users.profiles.last_name)
                  : '',
                phone: member.users.profiles.phone
                  ? decrypt(member.users.profiles.phone)
                  : '',
                profile_photo_url: profilePhotoUrl, // Add converted photo URL
              }
            }
          };
        } catch (error) {
          console.error('❌ Error decrypting profile data:', error);
          return member;
        }
      }
      return member;
    });

    console.log('✅ Decrypted team members ready to send');

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

