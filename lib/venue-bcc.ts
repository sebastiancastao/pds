import { SupabaseClient } from "@supabase/supabase-js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());

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

  try {
    const { data: venueRow, error: venueErr } = await supabaseAdmin
      .from("venue_reference")
      .select("id")
      .eq("venue_name", name)
      .maybeSingle();

    if (venueErr || !venueRow?.id) return [];

    const { data: bccRows, error: bccErr } = await supabaseAdmin
      .from("venue_email_bcc")
      .select("user_id")
      .eq("venue_id", venueRow.id);

    if (bccErr || !bccRows || bccRows.length === 0) return [];

    const userIds = bccRows.map((r: { user_id: string }) => r.user_id);

    const { data: users, error: usersErr } = await supabaseAdmin
      .from("users")
      .select("email")
      .in("id", userIds);

    if (usersErr || !users) return [];

    return users
      .map((u: { email: string | null }) => (u.email || "").trim().toLowerCase())
      .filter(isValidEmail);
  } catch {
    return [];
  }
}
