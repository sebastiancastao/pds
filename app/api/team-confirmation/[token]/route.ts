import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeEventDate(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";

  const ymdMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toISOString().slice(0, 10);
}

/**
 * GET /api/team-confirmation/[token]
 * Get team invitation details by confirmation token
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;

    console.log('🔍 DEBUG GET - Token received:', token);

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // First, try a simple query to see if token exists
    const { data: simpleCheck, error: simpleError } = await supabaseAdmin
      .from('event_teams')
      .select('id, event_id, vendor_id, status, confirmation_token')
      .eq('confirmation_token', token)
      .single();

    console.log('🔍 DEBUG GET - Simple check result:', simpleCheck);
    console.log('🔍 DEBUG GET - Simple check error:', simpleError);

    if (simpleError || !simpleCheck) {
      console.error('❌ Token not found in database:', simpleError);
      return NextResponse.json({
        error: 'Invalid or expired confirmation link',
        details: simpleError?.message || 'Token not found'
      }, { status: 404 });
    }

    // Now fetch full details with joins
    const { data: teamInvitation, error: teamError } = await supabaseAdmin
      .from('event_teams')
      .select(`
        id,
        event_id,
        vendor_id,
        status,
        created_at,
        events (
          id,
          event_name,
          event_date,
          venue
        ),
        users!event_teams_vendor_id_fkey (
          id,
          email,
          profiles (
            first_name,
            last_name
          )
        )
      `)
      .eq('id', simpleCheck.id)
      .single();

    console.log('🔍 DEBUG GET - Full data result:', teamInvitation);
    console.log('🔍 DEBUG GET - Full data error:', teamError);

    if (teamError || !teamInvitation) {
      console.error('❌ Failed to fetch full team details:', teamError);
      return NextResponse.json({
        error: 'Failed to load invitation details',
        details: teamError?.message
      }, { status: 500 });
    }

    // Decrypt vendor names
    let vendorFirstName = '';
    let vendorLastName = '';
    try {
      // users is returned as an array from Supabase, but vendor_id is a single foreign key
      const user = Array.isArray(teamInvitation.users) ? teamInvitation.users[0] : teamInvitation.users;
      const profiles = Array.isArray(user?.profiles) ? user.profiles[0] : user?.profiles;

      if (profiles) {
        vendorFirstName = profiles.first_name
          ? decrypt(profiles.first_name)
          : '';
        vendorLastName = profiles.last_name
          ? decrypt(profiles.last_name)
          : '';
      }
    } catch (error) {
      console.error('❌ Error decrypting vendor names:', error);
    }

    const rawEvent = Array.isArray((teamInvitation as any).events)
      ? (teamInvitation as any).events[0]
      : (teamInvitation as any).events;
    const eventPayload = rawEvent
      ? {
          ...rawEvent,
          event_date: normalizeEventDate(rawEvent.event_date),
        }
      : null;

    // Check if already responded
    if (teamInvitation.status === 'confirmed' || teamInvitation.status === 'declined') {
      return NextResponse.json({
        alreadyResponded: true,
        status: teamInvitation.status,
        event: eventPayload
      }, { status: 200 });
    }

    return NextResponse.json({
      invitation: {
        id: teamInvitation.id,
        eventId: teamInvitation.event_id,
        vendorId: teamInvitation.vendor_id,
        status: teamInvitation.status,
        createdAt: teamInvitation.created_at,
        event: eventPayload,
        vendor: {
          firstName: vendorFirstName,
          lastName: vendorLastName
        }
      }
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error fetching team invitation:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch invitation'
    }, { status: 500 });
  }
}

/**
 * POST /api/team-confirmation/[token]
 * Confirm or decline team invitation
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    const body = await req.json();
    const { action } = body; // 'confirm' or 'decline'

    console.log('🔍 DEBUG - Confirmation request:', { token, action });

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    if (!action || !['confirm', 'decline'].includes(action)) {
      return NextResponse.json({
        error: 'Invalid action. Must be "confirm" or "decline"'
      }, { status: 400 });
    }

    // Find the team invitation
    const { data: teamInvitation, error: findError } = await supabaseAdmin
      .from('event_teams')
      .select('id, status, event_id, vendor_id, confirmation_token')
      .eq('confirmation_token', token)
      .single();

    console.log('🔍 DEBUG - Found invitation:', teamInvitation);
    console.log('🔍 DEBUG - Find error:', findError);

    if (findError || !teamInvitation) {
      console.error('❌ Team invitation not found:', findError);
      return NextResponse.json({
        error: 'Invalid or expired confirmation link',
        details: findError?.message
      }, { status: 404 });
    }

    // Check if already responded
    if (teamInvitation.status !== 'pending_confirmation') {
      console.log('⚠️ Already responded with status:', teamInvitation.status);
      return NextResponse.json({
        error: 'This invitation has already been responded to',
        currentStatus: teamInvitation.status
      }, { status: 400 });
    }

    // Update status based on action
    const newStatus = action === 'confirm' ? 'confirmed' : 'declined';

    console.log('🔄 Updating status to:', newStatus);

    const { data: updatedData, error: updateError } = await supabaseAdmin
      .from('event_teams')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', teamInvitation.id)
      .select();

    console.log('🔍 DEBUG - Updated data:', updatedData);
    console.log('🔍 DEBUG - Update error:', updateError);

    if (updateError) {
      console.error('❌ Error updating team invitation:', updateError);
      return NextResponse.json({
        error: 'Failed to update invitation status: ' + updateError.message
      }, { status: 500 });
    }

    console.log('✅ Successfully updated status to:', newStatus);

    return NextResponse.json({
      success: true,
      status: newStatus,
      message: action === 'confirm'
        ? 'Thank you for confirming! You have been added to the event team.'
        : 'Your decline has been recorded. We appreciate your response.'
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error processing team confirmation:', error);
    return NextResponse.json({
      error: error.message || 'Failed to process confirmation'
    }, { status: 500 });
  }
}
