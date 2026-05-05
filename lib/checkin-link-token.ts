import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const CHECKIN_LINK_TOKEN_HEADER = "x-checkin-link-token";

/**
 * Validates a checkin link token from the request header.
 * Returns the associated event_id if valid, null otherwise.
 */
export async function validateCheckinLinkToken(
  req: Request
): Promise<{ eventId: string } | null> {
  const token =
    req.headers.get(CHECKIN_LINK_TOKEN_HEADER) ||
    req.headers.get("X-Checkin-Link-Token");
  if (!token) return null;

  const { data, error } = await supabaseAdmin
    .from("checkin_link_tokens")
    .select("event_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  // Best-effort last_used_at update — don't fail the request on error
  supabaseAdmin
    .from("checkin_link_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token", token)
    .then(() => {})
    .catch(() => {});

  return { eventId: data.event_id };
}
