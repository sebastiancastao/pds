import { SupabaseClient } from "@supabase/supabase-js";
import { safeDecrypt } from "./encryption";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());

// Static per-venue BCC overrides using substring matching (case-insensitive).
// Any venue whose name contains a `match` keyword will include the associated emails as BCC.
const VENUE_STATIC_BCC: Array<{ match: string; emails: string[] }> = [
  { match: "oakland",    emails: ["sebastiancastao379@gmail.com", "kenny@1pds.net"] },
  { match: "save mart",  emails: ["sebastiancastao379@gmail.com", "kenny@1pds.net"] },
  { match: "cow palace", emails: ["sebastiancastao379@gmail.com", "kenny@1pds.net"] },
  { match: "kia",        emails: ["kenny@1pds.net"] },
  { match: "intuit",     emails: ["kenny@1pds.net"] },
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

export type VenueManagerContact = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * Returns the active "room manager" contacts assigned to a venue via the
 * venue_managers table. Matches by venue name (as stored in
 * events.venue = venue_reference.venue_name). Returns an empty array if the
 * venue is not found or has no active manager assigned.
 * Never throws — errors are silently ignored so callers can decide on a fallback.
 */
export async function getVenueManagerContacts(
  venueName: string | null | undefined,
  supabaseAdmin: SupabaseClient
): Promise<VenueManagerContact[]> {
  const name = (venueName || "").toString().trim();
  if (!name) return [];

  try {
    const { data: venueRow, error: venueErr } = await supabaseAdmin
      .from("venue_reference")
      .select("id")
      .eq("venue_name", name)
      .maybeSingle();

    if (venueErr || !venueRow?.id) return [];

    const { data: managerRows, error: managerErr } = await supabaseAdmin
      .from("venue_managers")
      .select(
        "manager_id, is_active, manager:users!venue_managers_manager_id_fkey(id, email, profiles(first_name, last_name))"
      )
      .eq("venue_id", venueRow.id)
      .eq("is_active", true);

    if (managerErr || !managerRows) return [];

    const contacts: VenueManagerContact[] = [];
    for (const row of managerRows as any[]) {
      const manager = row?.manager;
      const email = (manager?.email || "").toString().trim().toLowerCase();
      if (!isValidEmail(email)) continue;

      const profile = Array.isArray(manager?.profiles) ? manager.profiles[0] : manager?.profiles;
      let firstName = "";
      let lastName = "";
      try {
        firstName = profile?.first_name ? safeDecrypt(String(profile.first_name)) : "";
      } catch {}
      try {
        lastName = profile?.last_name ? safeDecrypt(String(profile.last_name)) : "";
      } catch {}

      contacts.push({
        id: String(manager?.id || row.manager_id || ""),
        email,
        firstName,
        lastName,
      });
    }

    const seen = new Set<string>();
    return contacts.filter((contact) => {
      if (seen.has(contact.email)) return false;
      seen.add(contact.email);
      return true;
    });
  } catch {
    return [];
  }
}
