import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/invitations/[token]
 * Retrieve invitation details and existing availability
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Look up the invitation
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('vendor_invitations')
      .select(`
        *,
        event:events(*),
        vendor:users!vendor_id(
          email,
          profiles(first_name, last_name)
        )
      `)
      .eq('token', token)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      // Update status to expired
      await supabaseAdmin
        .from('vendor_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id);

      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 });
    }

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        eventName: invitation.event.event_name,
        eventDate: invitation.event.event_date,
        venue: invitation.event.venue,
        status: invitation.status,
        expiresAt: invitation.expires_at
      },
      availability: invitation.availability || null,
      notes: invitation.notes || ''
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error fetching invitation:', error);
    return NextResponse.json({
      error: error.message || 'Failed to fetch invitation'
    }, { status: 500 });
  }
}

/**
 * POST /api/invitations/[token]
 * Save vendor's availability response
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const token = params.token;
    const body = await req.json();
    const { availability } = body;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    if (!availability) {
      return NextResponse.json({ error: 'Availability data is required' }, { status: 400 });
    }

    // Look up the invitation
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from('vendor_invitations')
      .select('*')
      .eq('token', token)
      .single();

    if (invitationError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 });
    }

    // Check if any days are marked as available
    const hasAvailability = availability.some((day: any) => day.available === true);
    const newStatus = hasAvailability ? 'accepted' : 'declined';

    // Update invitation with availability and status
    const { error: updateError } = await supabaseAdmin
      .from('vendor_invitations')
      .update({
        availability: availability,
        status: newStatus,
        responded_at: new Date().toISOString()
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation:', updateError);
      return NextResponse.json({ error: 'Failed to save availability' }, { status: 500 });
    }

    // Also persist per-day availability into vendor_availability table (idempotent upsert)
    try {
      const rows = (availability as any[])
        .filter((d) => d && typeof d.date === 'string')
        .map((d) => ({
          vendor_id: invitation.vendor_id,
          date: d.date,
          available: !!d.available,
          notes: d.notes || null,
          updated_at: new Date().toISOString()
        }));
      if (rows.length > 0) {
        // Upsert on (vendor_id, date)
        await supabaseAdmin
          .from('vendor_availability')
          .upsert(rows, { onConflict: 'vendor_id,date' });
      }
    } catch (e) {
      console.warn('vendor_availability upsert failed (non-fatal):', e);
    }

    return NextResponse.json({
      success: true,
      message: 'Availability saved successfully',
      status: newStatus
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error saving availability:', error);
    return NextResponse.json({
      error: error.message || 'Failed to save availability'
    }, { status: 500 });
  }
}
