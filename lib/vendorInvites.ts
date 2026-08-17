// Shared helpers for sending a vendor "calendar availability" invite
// (a vendor_invitations row + the invite email) and for the approval rule
// enforced at /global-calendar and /dashboard: a vendor who already
// submitted availability for their current invitation period can't be sent
// another invite until that period ends (or without approval). Used by both
// the normal send path (app/api/invitations/bulk-invite/route.ts) and the
// approval path (app/api/vendor-invite-override-requests/route.ts PATCH) so
// both produce an identical invitation record and email.
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { decrypt } from "@/lib/encryption";
import { sendVendorBulkInvitationEmail } from "@/lib/email";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());
const isRateLimitError = (errorMessage: string) => /429|too many requests|rate limit/i.test(errorMessage);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_AVAILABILITY_DURATION_MONTHS = 4;

// Vendors exempt from the approval rule — always inviteable on demand, no
// approval request needed. Keyed by (plaintext) email since profile names
// are stored encrypted.
const APPROVAL_EXEMPT_EMAILS = new Set(["zeidakokun@gmail.com"]);

export function isVendorInviteApprovalExempt(email: string | null | undefined): boolean {
  return APPROVAL_EXEMPT_EMAILS.has(String(email || "").trim().toLowerCase());
}

export type LatestVendorInvitation = {
  id: string;
  created_at: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  responded_at: string | null;
};

/** The vendor's most recently created invitation, or null if they've never been invited. */
export async function getLatestVendorInvitation(
  supabaseAdmin: SupabaseClient,
  vendorId: string
): Promise<LatestVendorInvitation | null> {
  const { data, error } = await supabaseAdmin
    .from("vendor_invitations")
    .select("id, created_at, start_date, end_date, status, responded_at")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error checking latest vendor invitation:", error);
    return null;
  }
  return data || null;
}

/**
 * Whether sending this vendor a new invite right now requires approval: they
 * already submitted availability for their most recent invitation AND that
 * invitation's coverage period (start_date–end_date, normally 4 months)
 * hasn't ended yet. Once the period ends, or if they haven't submitted yet
 * (still pending), a fresh invite can be sent directly — no approval needed.
 */
export function isVendorInviteBlocked(
  invitation: Pick<LatestVendorInvitation, "end_date" | "responded_at"> | null
): boolean {
  if (!invitation) return false;
  if (!invitation.responded_at) return false; // hasn't submitted yet — OK to (re)send
  if (!invitation.end_date) return false; // no period info recorded — don't block on missing data
  return new Date(invitation.end_date).getTime() >= Date.now();
}

type ProfileNameFields = { first_name: string | null; last_name: string | null };

export type VendorForInvite = {
  id: string;
  email: string;
  profiles: ProfileNameFields | ProfileNameFields[] | null;
};

export function getSingleProfile<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Creates a vendor_invitations row + sends the "share your calendar
 * availability" email for exactly one vendor. Does NOT check the cooldown —
 * callers decide whether the send is allowed (normal path checks it and
 * blocks; the override-approval path calls this precisely because the
 * cooldown was overridden).
 */
export async function sendSingleVendorInvite(params: {
  supabaseAdmin: SupabaseClient;
  vendor: VendorForInvite;
  invitedBy: string;
  managerName: string;
  managerPhone: string;
  eventCount: number;
  durationMonths?: number;
}): Promise<{ success: true; invitationId: string } | { success: false; error: string }> {
  const { supabaseAdmin, vendor, invitedBy, managerName, managerPhone, eventCount } = params;
  const durationMonths = params.durationMonths ?? DEFAULT_AVAILABILITY_DURATION_MONTHS;

  const normalizedEmail = (vendor.email || "").toString().trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    return { success: false, error: `Invalid recipient email: ${vendor.email || "missing"}` };
  }

  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + durationMonths);
  const durationWeeks = Math.round(
    (endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  const invitationToken = crypto.randomBytes(32).toString("hex");

  const { data: inserted, error: inviteError } = await supabaseAdmin
    .from("vendor_invitations")
    .insert({
      token: invitationToken,
      event_id: null,
      vendor_id: vendor.id,
      invited_by: invitedBy,
      status: "pending",
      invitation_type: "bulk",
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      duration_weeks: durationWeeks,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .select("id")
    .single();

  if (inviteError || !inserted) {
    console.error("Error storing invitation:", inviteError);
    return { success: false, error: `Failed to store invitation for ${normalizedEmail}` };
  }

  const profile = getSingleProfile(vendor.profiles);
  let firstName = "Vendor";
  let lastName = "";
  try {
    firstName = profile?.first_name ? decrypt(profile.first_name) : "Vendor";
    lastName = profile?.last_name ? decrypt(profile.last_name) : "";
  } catch (decryptError) {
    console.error("Error decrypting vendor name:", decryptError);
  }

  let emailResult: Awaited<ReturnType<typeof sendVendorBulkInvitationEmail>> | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    emailResult = await sendVendorBulkInvitationEmail({
      email: normalizedEmail,
      firstName,
      lastName,
      durationMonths,
      eventCount,
      startDate: startDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      endDate: endDate.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      managerName,
      managerPhone,
      invitationToken,
    });

    if (emailResult.success) break;
    const err = emailResult.error || "Unknown email error";
    if (attempt < 3 && isRateLimitError(err)) {
      await sleep(1200 * attempt);
      continue;
    }
    return { success: false, error: `Failed to send email to ${normalizedEmail}: ${err}` };
  }

  if (!emailResult?.success) {
    return { success: false, error: `Failed to send email to ${normalizedEmail}` };
  }

  return { success: true, invitationId: inserted.id };
}

/** Manager display-name/phone + active event count used in the invite email — mirrors bulk-invite's own lookups. */
export async function getInviterEmailContext(
  supabaseAdmin: SupabaseClient,
  inviterId: string
): Promise<{ managerName: string; managerPhone: string; eventCount: number }> {
  const [{ data: managerProfile }, { data: events }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("user_id", inviterId)
      .maybeSingle(),
    supabaseAdmin
      .from("events")
      .select("id")
      .eq("created_by", inviterId)
      .eq("is_active", true),
  ]);

  let managerFirstName = "Event";
  let managerLastName = "Manager";
  let managerPhone = "";
  if (managerProfile) {
    try {
      managerFirstName = managerProfile.first_name ? decrypt(managerProfile.first_name) : "Event";
      managerLastName = managerProfile.last_name ? decrypt(managerProfile.last_name) : "Manager";
      managerPhone = managerProfile.phone ? decrypt(managerProfile.phone) : "";
    } catch (decryptError) {
      console.error("Error decrypting manager profile:", decryptError);
    }
  }

  return {
    managerName: `${managerFirstName} ${managerLastName}`,
    managerPhone,
    eventCount: events?.length || 0,
  };
}
