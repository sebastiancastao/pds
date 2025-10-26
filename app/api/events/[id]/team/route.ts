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
    const { vendorIds } = body;

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return NextResponse.json({ error: 'Vendor IDs are required' }, { status: 400 });
    }

    // Verify event exists and user owns it
    const { data: event, error: eventError } = await supabaseAdmin
      .from('events')
      .select('id, created_by, event_name')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    if (event.created_by !== user.id) {
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

    // Create team assignments with confirmation tokens
    const teamMembers = vendorIds.map(vendorId => ({
      event_id: eventId,
      vendor_id: vendorId,
      assigned_by: user.id,
      status: 'pending_confirmation',
      confirmation_token: crypto.randomBytes(32).toString('hex'),
      created_at: new Date().toISOString()
    }));

    console.log('🔍 DEBUG - Team members to insert:', teamMembers);

    // Delete existing team members for this event first
    await supabaseAdmin
      .from('event_teams')
      .delete()
      .eq('event_id', eventId);

    // Insert new team members
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

    // Send confirmation emails to each vendor
    const emailResults = await Promise.allSettled(
      vendors.map(async (vendor: any) => {
        const teamMember = insertedTeams?.find((t: any) => t.vendor_id === vendor.id);
        if (!teamMember) return null;

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

        // Decrypt manager names
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

        // Format event date
        const eventDate = new Date(event.event_name).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        return await sendTeamConfirmationEmail({
          email: vendor.email,
          firstName: vendorFirstName,
          lastName: vendorLastName,
          eventName: event.event_name,
          eventDate: eventDate,
          managerName: managerName,
          managerPhone: managerPhone,
          confirmationToken: teamMember.confirmation_token
        });
      })
    );

    const emailsSent = emailResults.filter(r => r.status === 'fulfilled').length;
    const emailsFailed = emailResults.filter(r => r.status === 'rejected').length;

    console.log(`📧 Sent ${emailsSent} confirmation emails, ${emailsFailed} failed`);

    return NextResponse.json({
      success: true,
      message: `Team invitations sent to ${vendorIds.length} vendor${vendorIds.length !== 1 ? 's' : ''}. Awaiting confirmation.`,
      teamSize: vendorIds.length,
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
