import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type InvitationRouteContext = {
  params: { token: string } | Promise<{ token: string }>;
};

type NormalizedAvailabilityDay = {
  date: string;
  available: boolean;
  notes: string | null;
};

type VendorAvailabilitySchema = {
  ownerColumn: "vendor_id" | "user_id" | null;
  availableColumn: "available" | "is_available" | null;
};

let vendorAvailabilitySchemaPromise: Promise<VendorAvailabilitySchema> | null = null;

async function getTokenFromContext(context: InvitationRouteContext): Promise<string | undefined> {
  const params = await context.params;
  return params?.token;
}

function normalizeAvailability(input: unknown): NormalizedAvailabilityDay[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter((day: any) => day && typeof day.date === "string")
    .map((day: any) => ({
      date: day.date.slice(0, 10),
      available: day.available === true,
      notes: typeof day.notes === "string" && day.notes.trim() !== "" ? day.notes.trim() : null
    }));
}

async function detectVendorAvailabilitySchema(): Promise<VendorAvailabilitySchema> {
  let ownerColumn: VendorAvailabilitySchema["ownerColumn"] = null;
  for (const candidate of ["vendor_id", "user_id"] as const) {
    const { error } = await supabaseAdmin
      .from("vendor_availability")
      .select(candidate)
      .limit(1);
    if (!error) {
      ownerColumn = candidate;
      break;
    }
  }

  let availableColumn: VendorAvailabilitySchema["availableColumn"] = null;
  for (const candidate of ["available", "is_available"] as const) {
    const { error } = await supabaseAdmin
      .from("vendor_availability")
      .select(candidate)
      .limit(1);
    if (!error) {
      availableColumn = candidate;
      break;
    }
  }

  return { ownerColumn, availableColumn };
}

async function getVendorAvailabilitySchema(): Promise<VendorAvailabilitySchema> {
  if (!vendorAvailabilitySchemaPromise) {
    vendorAvailabilitySchemaPromise = detectVendorAvailabilitySchema();
  }
  return vendorAvailabilitySchemaPromise;
}

/**
 * GET /api/invitations/[token]
 * Retrieve invitation details and existing availability
 */
export async function GET(
  req: NextRequest,
  context: InvitationRouteContext
) {
  try {
    const token = await getTokenFromContext(context);

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

    const event = Array.isArray(invitation.event) ? invitation.event[0] : invitation.event;

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        eventName: event?.event_name || null,
        eventDate: event?.event_date || invitation.start_date || null,
        venue: event?.venue || null,
        status: invitation.status,
        expiresAt: invitation.expires_at,
        invitationType: invitation.invitation_type || "event",
        startDate: invitation.start_date || null,
        endDate: invitation.end_date || null
      },
      availability: invitation.availability || null,
      notes: invitation.notes || ''
    }, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });

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
  context: InvitationRouteContext
) {
  try {
    const token = await getTokenFromContext(context);
    const body = await req.json();
    const { availability } = body;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    if (!Array.isArray(availability)) {
      return NextResponse.json({ error: 'Availability data is required' }, { status: 400 });
    }

    const normalizedAvailability = normalizeAvailability(availability);
    if (normalizedAvailability.length === 0) {
      return NextResponse.json({ error: 'Availability data is invalid' }, { status: 400 });
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
    const hasAvailability = normalizedAvailability.some((day) => day.available === true);
    const newStatus = hasAvailability ? 'accepted' : 'declined';

    // Update invitation with availability and status
    const { error: updateError } = await supabaseAdmin
      .from('vendor_invitations')
      .update({
        availability: normalizedAvailability,
        status: newStatus,
        responded_at: new Date().toISOString()
      })
      .eq('id', invitation.id);

    if (updateError) {
      console.error('Error updating invitation:', updateError);
      return NextResponse.json({ error: `Failed to save availability: ${updateError.message}` }, { status: 500 });
    }

    // Also persist per-day availability into vendor_availability table (idempotent upsert)
    try {
      const schema = await getVendorAvailabilitySchema();
      if (schema.ownerColumn && schema.availableColumn) {
        const ownerColumn = schema.ownerColumn;
        const availableColumn = schema.availableColumn;
        const rows = normalizedAvailability.map((day) => ({
          [ownerColumn]: invitation.vendor_id,
          date: day.date,
          [availableColumn]: day.available,
          notes: day.notes,
          updated_at: new Date().toISOString()
        }));

        if (rows.length > 0) {
          const { error: availabilityUpsertError } = await supabaseAdmin
            .from('vendor_availability')
            .upsert(rows, { onConflict: `${schema.ownerColumn},date` });

          if (availabilityUpsertError) {
            throw availabilityUpsertError;
          }
        }
      } else {
        console.warn('vendor_availability schema is not compatible with mirrored upsert; skipping');
      }
    } catch (e) {
      console.warn('vendor_availability upsert failed (non-fatal):', e);
    }

    return NextResponse.json({
      success: true,
      message: 'Availability saved successfully',
      status: newStatus,
      savedDays: normalizedAvailability.length
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error saving availability:', error);
    return NextResponse.json({
      error: error.message || 'Failed to save availability'
    }, { status: 500 });
  }
}
