import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { randomBytes } from "crypto";
import { sendCheckinLinkEmail } from "@/lib/email";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isValidUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

async function getAuthedUser(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

/**
 * POST /api/events/[id]/checkin-link-token
 *
 * Generates a 24-hour check-in link token for the event and sends it to the
 * confirmed team members via email. Requires manager or exec role.
 *
 * Body: { sendEmail?: boolean }  (default: true)
 *
 * Returns: { token, url, expiresAt, emailsSent }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const eventId = params.id;
  if (!isValidUuid(eventId)) return jsonError("Invalid event ID", 400);

  const authedUser = await getAuthedUser(req);
  if (!authedUser?.id) return jsonError("Not authenticated", 401);

  // Require manager or exec role
  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", authedUser.id)
    .maybeSingle();

  const role = userRow?.role ?? "";
  const allowedRoles = ["manager", "exec", "finance", "supervisor3"];
  if (!allowedRoles.includes(role)) {
    return jsonError("Insufficient permissions", 403);
  }

  // Fetch the event
  const { data: event, error: eventErr } = await supabaseAdmin
    .from("events")
    .select("id, event_name, event_date, venue, city, state, event_type")
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr || !event) return jsonError("Event not found", 404);

  // Revoke any existing active tokens for this event (one active token at a time)
  await supabaseAdmin
    .from("checkin_link_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .is("revoked_at", null);

  // Generate a cryptographically random token (256-bit entropy)
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const { error: insertErr } = await supabaseAdmin
    .from("checkin_link_tokens")
    .insert({
      token,
      event_id: eventId,
      created_by: authedUser.id,
      expires_at: expiresAt.toISOString(),
    });

  if (insertErr) {
    console.error("Failed to insert checkin link token:", insertErr);
    return jsonError("Failed to generate token", 500);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://pds-murex.vercel.app";
  const checkinUrl = `${appUrl}/check-in?token=${token}`;

  const body = await req.json().catch(() => ({}));
  const shouldSendEmail = body?.sendEmail !== false;
  let emailsSent = 0;

  if (shouldSendEmail) {
    // Fetch confirmed team member emails
    const { data: teamRows } = await supabaseAdmin
      .from("event_teams")
      .select("vendor_id, status")
      .eq("event_id", eventId)
      .eq("status", "confirmed");

    const vendorIds = (teamRows || []).map((r: any) => r.vendor_id).filter(Boolean);

    let recipientEmails: string[] = [];
    if (vendorIds.length > 0) {
      const { data: userRows } = await supabaseAdmin
        .from("users")
        .select("email")
        .in("id", vendorIds)
        .eq("is_active", true);
      recipientEmails = (userRows || []).map((u: any) => u.email).filter(Boolean);
    }

    if (recipientEmails.length > 0) {
      const { data: senderProfile } = await supabaseAdmin
        .from("profiles")
        .select("first_name, last_name")
        .eq("user_id", authedUser.id)
        .maybeSingle();

      const senderName =
        [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") ||
        "A manager";

      const result = await sendCheckinLinkEmail({
        recipientEmails,
        eventName: event.event_name,
        eventDate: event.event_date,
        eventVenue: `${event.venue}${event.city ? `, ${event.city}` : ""}${event.state ? `, ${event.state}` : ""}`,
        checkinUrl,
        expiresAt,
        senderName,
      });

      if (result.success) {
        emailsSent = recipientEmails.length;
      } else {
        console.error("Failed to send check-in link email:", result.error);
      }
    }
  }

  return NextResponse.json({
    token,
    url: checkinUrl,
    expiresAt: expiresAt.toISOString(),
    emailsSent,
  });
}

/**
 * DELETE /api/events/[id]/checkin-link-token
 * Revokes all active check-in link tokens for the event.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const eventId = params.id;
  if (!isValidUuid(eventId)) return jsonError("Invalid event ID", 400);

  const authedUser = await getAuthedUser(req);
  if (!authedUser?.id) return jsonError("Not authenticated", 401);

  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", authedUser.id)
    .maybeSingle();

  const role = userRow?.role ?? "";
  if (!["manager", "exec", "finance", "supervisor3"].includes(role)) {
    return jsonError("Insufficient permissions", 403);
  }

  await supabaseAdmin
    .from("checkin_link_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .is("revoked_at", null);

  return NextResponse.json({ success: true });
}
