import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendEmail } from "@/lib/email";
import { getVenueManagerContacts } from "@/lib/venue-bcc";
import { safeDecrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2", "supervisor3"]);
// Always kept in the loop on cancellations, per management request.
const CANCELLATION_CC_RECIPIENTS = ["sebastiancastao379@gmail.com", "jenvillar625@gmail.com", "hr@1pds.net"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }

  return null;
}

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "TBD";
  const normalized = String(value).trim();
  const ymd = normalized.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [yearRaw, monthRaw, dayRaw] = ymd.split("-");
    const localDate = new Date(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw));
    return localDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;
  return date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveProfileRow(profiles: any): { first_name?: string; last_name?: string } | null {
  if (!profiles) return null;
  return Array.isArray(profiles) ? profiles[0] || null : profiles;
}

function buildCancellationEmailHtml(params: {
  eventName: string;
  eventDateLabel: string;
  venue: string;
  cityState: string;
  vendorName: string;
  vendorEmail: string;
  cancellationDateLabel: string;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  roomManagerNote: string;
}) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Event Cancellation Notice</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827; margin:0; padding:20px;">
    <div style="max-width:600px;margin:0 auto;">
      <h2 style="margin:0 0 12px 0; color:#b91c1c;">Cancellation Notice</h2>
      <p style="margin:0 0 16px 0;">A confirmed team member has cancelled for the event below. Please plan staffing accordingly.</p>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width:100%;">
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Event</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.eventName)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Event Date</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.eventDateLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Venue</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.venue)}${params.cityState ? ` (${escapeHtml(params.cityState)})` : ""}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Vendor / Staff</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.vendorName)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Vendor Email</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.vendorEmail || "N/A")}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Cancellation Date</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.cancellationDateLabel)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151; vertical-align: top;">Reason</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.reason)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Reported By</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.requestedByName)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 10px; color: #374151;">Reported At</td>
          <td style="padding: 6px 10px; font-weight: 600;">${escapeHtml(params.requestedAt)}</td>
        </tr>
      </table>
      ${
        params.roomManagerNote
          ? `<p style="margin-top:16px; color:#92400e; background:#fef3c7; border-left:4px solid #f59e0b; padding:10px 14px;">${escapeHtml(params.roomManagerNote)}</p>`
          : ""
      }
    </div>
  </body>
</html>
`.trim();
}

export async function POST(req: NextRequest, { params }: { params: { id: string; memberId: string } }) {
  try {
    const eventId = String(params?.id || "").trim();
    const memberId = String(params?.memberId || "").trim();

    if (!eventId || !memberId) {
      return NextResponse.json({ error: "Event ID and member ID are required" }, { status: 400 });
    }

    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const cancellationDate = String(body?.cancellation_date || "").trim();
    const reason = String(body?.reason || "").trim();

    if (!DATE_PATTERN.test(cancellationDate) || Number.isNaN(Date.parse(`${cancellationDate}T00:00:00Z`))) {
      return NextResponse.json({ error: "A valid cancellation date is required" }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "A reason for the cancellation is required" }, { status: 400 });
    }

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, created_by, event_name, event_date, venue, city, state")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const isCreator = event.created_by === user.id;
    if (!isCreator) {
      const { data: requester, error: requesterError } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (requesterError) {
        return NextResponse.json({ error: requesterError.message }, { status: 500 });
      }

      const role = String(requester?.role || "").toLowerCase().trim();
      if (!MANAGE_ROLES.has(role)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const { data: teamMember, error: teamMemberError } = await supabaseAdmin
      .from("event_teams")
      .select("id, vendor_id, status")
      .eq("id", memberId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (teamMemberError) {
      return NextResponse.json({ error: teamMemberError.message }, { status: 500 });
    }
    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found for this event" }, { status: 404 });
    }
    if (String(teamMember.status || "").toLowerCase() !== "confirmed") {
      return NextResponse.json(
        { error: "Only confirmed team members can be filed as a cancellation" },
        { status: 400 }
      );
    }

    const vendorId = String(teamMember.vendor_id || "").trim();
    let vendorName = "Unknown";
    let vendorEmail = "";
    if (vendorId) {
      const { data: vendorRow } = await supabaseAdmin
        .from("users")
        .select("email, profiles(first_name, last_name)")
        .eq("id", vendorId)
        .maybeSingle();

      vendorEmail = String(vendorRow?.email || "").trim();
      const profile = resolveProfileRow(vendorRow?.profiles);
      let firstName = "";
      let lastName = "";
      try {
        firstName = profile?.first_name ? safeDecrypt(String(profile.first_name)) : "";
      } catch {}
      try {
        lastName = profile?.last_name ? safeDecrypt(String(profile.last_name)) : "";
      } catch {}
      vendorName = `${firstName} ${lastName}`.trim() || vendorEmail || "Unknown";
    }

    let requestedByName = "Unknown";
    {
      const { data: requesterRow } = await supabaseAdmin
        .from("users")
        .select("email, profiles(first_name, last_name)")
        .eq("id", user.id)
        .maybeSingle();
      const profile = resolveProfileRow(requesterRow?.profiles);
      let firstName = "";
      let lastName = "";
      try {
        firstName = profile?.first_name ? safeDecrypt(String(profile.first_name)) : "";
      } catch {}
      try {
        lastName = profile?.last_name ? safeDecrypt(String(profile.last_name)) : "";
      } catch {}
      requestedByName = `${firstName} ${lastName}`.trim() || String(requesterRow?.email || "").trim() || "Unknown";
    }

    const roomManagerContacts = await getVenueManagerContacts(event.venue, supabaseAdmin);
    const roomManagerEmails = roomManagerContacts.map((contact) => contact.email);

    const { data: insertedRecord, error: insertError } = await supabaseAdmin
      .from("event_cancellation_requests")
      .insert({
        event_id: eventId,
        team_member_id: teamMember.id,
        vendor_id: vendorId || null,
        cancellation_date: cancellationDate,
        reason,
        requested_by: user.id,
        room_manager_emails: roomManagerEmails,
      })
      .select(
        "id, event_id, team_member_id, vendor_id, cancellation_date, reason, requested_by, room_manager_emails, notification_sent, created_at"
      )
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message || "Failed to record cancellation" }, { status: 500 });
    }

    const eventName = String(event.event_name || "Event");
    const eventDateLabel = formatDateLabel(event.event_date);
    const cityState = [event.city, event.state].filter(Boolean).join(", ");
    const cancellationDateLabel = formatDateLabel(cancellationDate);
    const requestedAt = new Date().toLocaleString("en-US");

    const noManagerNote =
      roomManagerEmails.length === 0
        ? "No room manager is currently assigned to this venue. Assign one from the Venue Managers admin page so future cancellations reach them directly."
        : "";

    const emailHtml = buildCancellationEmailHtml({
      eventName,
      eventDateLabel,
      venue: String(event.venue || "TBD"),
      cityState,
      vendorName,
      vendorEmail,
      cancellationDateLabel,
      reason,
      requestedByName,
      requestedAt,
      roomManagerNote: noManagerNote,
    });

    // Send every recipient (room manager + management/HR) via "to" rather than
    // splitting to/cc. This mirrors the sick-leave-request notification pattern,
    // which reliably delivers to the same hr@1pds.net inbox via lib/email.ts's
    // sendEmail() — keeping delivery-relevant behavior identical avoids a
    // separate, less-proven code path for this transactional notice.
    const emailTo = [...new Set([...roomManagerEmails, ...CANCELLATION_CC_RECIPIENTS])];

    const emailResult = await sendEmail({
      to: emailTo,
      subject: `Event Cancellation Notice - ${vendorName} - ${eventName}`,
      html: emailHtml,
    });

    await supabaseAdmin
      .from("event_cancellation_requests")
      .update({
        notification_sent: Boolean(emailResult.success),
        notification_error: emailResult.success ? null : emailResult.error || "Unknown email error",
      })
      .eq("id", insertedRecord.id);

    return NextResponse.json(
      {
        success: true,
        message: emailResult.success
          ? roomManagerEmails.length > 0
            ? "Cancellation recorded and the room manager was notified."
            : "Cancellation recorded. No room manager is assigned to this venue, so the notice was sent to HR only."
          : `Cancellation was recorded, but the notification email failed to send: ${emailResult.error || "Unknown error"}`,
        record: {
          ...insertedRecord,
          vendor_name: vendorName,
          vendor_email: vendorEmail,
          requested_by_name: requestedByName,
          notification_sent: Boolean(emailResult.success),
        },
        roomManagerEmails,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[EVENT CANCELLATION REQUEST][POST] error:", error);
    return NextResponse.json({ error: error?.message || "Failed to record cancellation request" }, { status: 500 });
  }
}
