import { SupabaseClient } from "@supabase/supabase-js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());

// Static per-venue BCC overrides using substring matching (case-insensitive).
// Any venue whose name contains a `match` keyword will include the associated emails as BCC.
const VENUE_STATIC_BCC: Array<{ match: string; emails: string[] }> = [
  { match: "oakland",    emails: ["sebastiancastao379@gmail.com", "kenny@1pds.net"] },
  { match: "save mart",  emails: ["sebastiancastao379@gmail.com", "kenny@1pds.net"] },
  { match: "cow palace", emails: ["sebastiancastao379@gmail.com", "kenny@1pds.net"] },
];

function resolveStaticBcc(venueName: string): string[] {
  const lower = venueName.toLowerCase();
  return [
    ...new Set(
      VENUE_STATIC_BCC
        .filter((entry) => lower.includes(entry.match))
        .flatMap((entry) => entry.emails)
        .filter(isValidEmail)
    ),
  ];
}

/**
 * Returns the list of BCC email addresses configured for a venue.
 * Matches by venue name (as stored in events.venue = venue_reference.venue_name).
 * Returns an empty array if the venue is not found or has no BCC settings.
 * Never throws — errors are silently ignored so email sending is never blocked.
 */
export async function getVenueBccEmails(
  venueName: string | null | undefined,
  supabaseAdmin: SupabaseClient
): Promise<string[]> {
  const name = (venueName || "").toString().trim();
  if (!name) return [];

  const staticEmails = resolveStaticBcc(name);

  try {
    const { data: venueRow, error: venueErr } = await supabaseAdmin
      .from("venue_reference")
      .select("id")
      .eq("venue_name", name)
      .maybeSingle();

    if (venueErr || !venueRow?.id) return staticEmails;

    const { data: bccRows, error: bccErr } = await supabaseAdmin
      .from("venue_email_bcc")
      .select("user_id")
      .eq("venue_id", venueRow.id);

    if (bccErr || !bccRows || bccRows.length === 0) return staticEmails;

    const userIds = bccRows.map((r: { user_id: string }) => r.user_id);

    const { data: users, error: usersErr } = await supabaseAdmin
      .from("users")
      .select("email")
      .in("id", userIds);

    if (usersErr || !users) return staticEmails;

    const dbEmails = users
      .map((u: { email: string | null }) => (u.email || "").trim().toLowerCase())
      .filter(isValidEmail);

    return [...new Set([...dbEmails, ...staticEmails])];
  } catch {
    return staticEmails;
  }
}
