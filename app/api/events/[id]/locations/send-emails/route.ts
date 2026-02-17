import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendEmail } from "@/lib/email";
import { decrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2"]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BATCH_DELAY_MS = 350;
const DEFAULT_PER_EMAIL_DELAY_MS = 120;
const DEFAULT_MAX_RECIPIENTS = 600;

type AuthContext = {
  user: { id: string };
  role: string;
};

type EventLocationRow = {
  id: string;
  name: string;
  notes: string | null;
};

type AssignmentRow = {
  vendor_id: string;
  location_id: string;
};

type ProfileRow = {
  first_name?: string | null;
  last_name?: string | null;
};

type UserRow = {
  id: string;
  email: string | null;
  profiles?: ProfileRow | ProfileRow[] | null;
};

type Recipient = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  locationName: string;
  locationNotes: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunkSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : DEFAULT_BATCH_SIZE;
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimitError(errorMessage?: string): boolean {
  const text = String(errorMessage || "").toLowerCase();
  return text.includes("429") || text.includes("rate limit") || text.includes("too many");
}

function resolveProfile(profiles: UserRow["profiles"]): ProfileRow | null {
  if (!profiles) return null;
  if (Array.isArray(profiles)) return profiles[0] || null;
  return profiles;
}

function formatEventDate(value: string | null | undefined): string {
  if (!value) return "TBD";
  const normalized = String(value).trim();
  // event_date is stored as a date-like value; parse Y-M-D directly to avoid timezone day-shift.
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

function buildEmailHtml(params: {
  firstName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  city: string;
  state: string;
  locationName: string;
  locationNotes: string;
}) {
  const firstName = escapeHtml(params.firstName || "Team Member");
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue || "TBD");
  const city = escapeHtml(params.city || "");
  const state = escapeHtml(params.state || "");
  const locationName = escapeHtml(params.locationName);
  const locationNotes = escapeHtml(params.locationNotes);
  const cityState = [city, state].filter(Boolean).join(", ") || "TBD";

  return `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <h2 style="margin:0 0 12px;">Your Event Location Assignment</h2>
    <p>Hello <strong>${firstName}</strong>,</p>
    <p>You have been assigned to the following location for this event:</p>
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;background:#f8fafc;">
      <p style="margin:0 0 8px;"><strong>Event:</strong> ${eventName}</p>
      <p style="margin:0 0 8px;"><strong>Date:</strong> ${eventDate}</p>
      <p style="margin:0 0 8px;"><strong>Venue:</strong> ${venue}</p>
      <p style="margin:0 0 8px;"><strong>City/State:</strong> ${cityState}</p>
      <p style="margin:0 0 8px;"><strong>Assigned Location:</strong> ${locationName}</p>
      ${locationNotes ? `<p style="margin:0;"><strong>Notes:</strong> ${locationNotes}</p>` : ""}
    </div>
    <p style="margin-top:16px;color:#4b5563;">If your assignment looks incorrect, contact your manager.</p>
  </div>
</body>
</html>
  `.trim();
}

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

async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  const user = await getAuthedUser(req);
  if (!user?.id) return null;

  const { data: requester, error: requesterError } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (requesterError) {
    throw new Error(requesterError.message);
  }

  return {
    user: { id: user.id },
    role: String(requester?.role || "").toLowerCase().trim(),
  };
}

async function canAccessEvent(eventId: string, auth: AuthContext): Promise<boolean> {
  const { data: event, error: eventError } = await supabaseAdmin
    .from("events")
    .select("id, created_by")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!event) return false;
  if (auth.role === "exec" || auth.role === "admin") return true;
  if (event.created_by === auth.user.id) return true;

  if (auth.role === "supervisor" || auth.role === "supervisor2") {
    const { data: links, error: linksError } = await supabaseAdmin
      .from("manager_team_members")
      .select("manager_id")
      .eq("member_id", auth.user.id)
      .eq("is_active", true);

    if (linksError) {
      throw new Error(linksError.message);
    }

    if ((links || []).some((row) => row.manager_id === event.created_by)) return true;
  }

  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const auth = await getAuthContext(req);
    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allowed = await canAccessEvent(eventId, auth);
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (!MANAGE_ROLES.has(auth.role)) {
      return NextResponse.json(
        { error: "You do not have permission to send location assignment emails" },
        { status: 403 }
      );
    }

    const [eventResult, locationsResult, assignmentsResult] = await Promise.all([
      supabaseAdmin
        .from("events")
        .select("event_name, event_date, venue, city, state")
        .eq("id", eventId)
        .maybeSingle(),
      supabaseAdmin
        .from("event_locations")
        .select("id, name, notes")
        .eq("event_id", eventId),
      supabaseAdmin
        .from("event_location_assignments")
        .select("vendor_id, location_id")
        .eq("event_id", eventId),
    ]);

    if (eventResult.error) {
      return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
    }
    if (locationsResult.error) {
      return NextResponse.json({ error: locationsResult.error.message }, { status: 500 });
    }
    if (assignmentsResult.error) {
      return NextResponse.json({ error: assignmentsResult.error.message }, { status: 500 });
    }

    const eventData = eventResult.data;
    const locations = (locationsResult.data || []) as EventLocationRow[];
    const assignments = (assignmentsResult.data || []) as AssignmentRow[];

    if (assignments.length === 0) {
      return NextResponse.json(
        { error: "No location assignments found for this event." },
        { status: 400 }
      );
    }

    const uniqueVendorIds = Array.from(new Set(assignments.map((a) => normalizeText(a.vendor_id)).filter(Boolean)));
    const maxRecipientsRaw = Number(process.env.LOCATION_EMAIL_MAX_RECIPIENTS || DEFAULT_MAX_RECIPIENTS);
    const maxRecipients = Number.isFinite(maxRecipientsRaw) && maxRecipientsRaw > 0
      ? Math.floor(maxRecipientsRaw)
      : DEFAULT_MAX_RECIPIENTS;

    if (uniqueVendorIds.length > maxRecipients) {
      return NextResponse.json(
        {
          error: `Too many recipients (${uniqueVendorIds.length}). Max allowed is ${maxRecipients}.`,
        },
        { status: 400 }
      );
    }

    const { data: usersData, error: usersError } = await supabaseAdmin
      .from("users")
      .select("id, email, profiles(first_name, last_name)")
      .in("id", uniqueVendorIds);

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const userById = new Map<string, UserRow>();
    ((usersData || []) as UserRow[]).forEach((user) => {
      userById.set(normalizeText(user.id), user);
    });

    const locationById = new Map<string, EventLocationRow>();
    locations.forEach((location) => {
      locationById.set(normalizeText(location.id), location);
    });

    const recipients: Recipient[] = [];
    const seenUsers = new Set<string>();
    let skippedDuplicateUsers = 0;
    let skippedMissingLocation = 0;
    let skippedMissingUser = 0;
    let skippedInvalidEmail = 0;

    for (const assignment of assignments) {
      const userId = normalizeText(assignment.vendor_id);
      const locationId = normalizeText(assignment.location_id);
      if (!userId || !locationId) continue;

      if (seenUsers.has(userId)) {
        skippedDuplicateUsers += 1;
        continue;
      }

      const location = locationById.get(locationId);
      if (!location) {
        skippedMissingLocation += 1;
        continue;
      }

      const user = userById.get(userId);
      if (!user) {
        skippedMissingUser += 1;
        continue;
      }

      const email = normalizeText(user.email).toLowerCase();
      if (!isValidEmail(email)) {
        skippedInvalidEmail += 1;
        continue;
      }

      const profile = resolveProfile(user.profiles);
      let firstName = normalizeText(profile?.first_name);
      let lastName = normalizeText(profile?.last_name);
      try {
        if (firstName) firstName = normalizeText(decrypt(firstName));
      } catch {}
      try {
        if (lastName) lastName = normalizeText(decrypt(lastName));
      } catch {}

      recipients.push({
        userId,
        email,
        firstName,
        lastName,
        locationName: normalizeText(location.name),
        locationNotes: normalizeText(location.notes),
      });
      seenUsers.add(userId);
    }

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "No valid recipients with location assignments were found." },
        { status: 400 }
      );
    }

    const eventName = normalizeText(eventData?.event_name) || "Event";
    const eventDate = formatEventDate(eventData?.event_date || null);
    const venue = normalizeText(eventData?.venue);
    const city = normalizeText(eventData?.city);
    const state = normalizeText(eventData?.state);

    const batchSizeRaw = Number(process.env.LOCATION_EMAIL_SEND_BATCH_SIZE || DEFAULT_BATCH_SIZE);
    const batchDelayMsRaw = Number(process.env.LOCATION_EMAIL_SEND_BATCH_DELAY_MS || DEFAULT_BATCH_DELAY_MS);
    const perEmailDelayMsRaw = Number(
      process.env.LOCATION_EMAIL_SEND_PER_EMAIL_DELAY_MS || DEFAULT_PER_EMAIL_DELAY_MS
    );

    const batchSize = Number.isFinite(batchSizeRaw) && batchSizeRaw > 0 ? Math.floor(batchSizeRaw) : DEFAULT_BATCH_SIZE;
    const batchDelayMs = Number.isFinite(batchDelayMsRaw) && batchDelayMsRaw >= 0
      ? Math.floor(batchDelayMsRaw)
      : DEFAULT_BATCH_DELAY_MS;
    const perEmailDelayMs = Number.isFinite(perEmailDelayMsRaw) && perEmailDelayMsRaw >= 0
      ? Math.floor(perEmailDelayMsRaw)
      : DEFAULT_PER_EMAIL_DELAY_MS;

    const batches = chunkArray(recipients, batchSize);
    const failures: Array<{ userId: string; email: string; error: string }> = [];
    let sentCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      for (let j = 0; j < batch.length; j++) {
        const recipient = batch[j];
        const fullName = `${recipient.firstName} ${recipient.lastName}`.trim();
        const html = buildEmailHtml({
          firstName: fullName || recipient.firstName || "Team Member",
          eventName,
          eventDate,
          venue,
          city,
          state,
          locationName: recipient.locationName,
          locationNotes: recipient.locationNotes,
        });

        let result = await sendEmail({
          to: recipient.email,
          subject: `Location Assignment - ${eventName}`,
          html,
          from: process.env.RESEND_FROM_EVENTS || process.env.RESEND_FROM || undefined,
        });

        if (!result.success && isRateLimitError(result.error)) {
          await sleep(1200);
          result = await sendEmail({
            to: recipient.email,
            subject: `Location Assignment - ${eventName}`,
            html,
            from: process.env.RESEND_FROM_EVENTS || process.env.RESEND_FROM || undefined,
          });
        }

        if (!result.success) {
          failures.push({
            userId: recipient.userId,
            email: recipient.email,
            error: result.error || "Failed to send email",
          });
        } else {
          sentCount += 1;
        }

        if (j < batch.length - 1 && perEmailDelayMs > 0) {
          await sleep(perEmailDelayMs);
        }
      }

      if (i < batches.length - 1 && batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }

    const skippedCount =
      skippedDuplicateUsers + skippedMissingLocation + skippedMissingUser + skippedInvalidEmail;

    return NextResponse.json(
      {
        success: failures.length === 0,
        sentCount,
        failedCount: failures.length,
        skippedCount,
        recipientCount: recipients.length,
        batches: batches.length,
        failures: failures.slice(0, 25),
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to send location assignment emails" },
      { status: 500 }
    );
  }
}
