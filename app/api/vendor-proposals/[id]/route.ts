import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";
import { sendProposalDeclinedEmail, sendVendorEventInvitationEmail } from "@/lib/email";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type LoadedUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

function safeDecrypt(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decrypt(value);
  } catch {
    return value || "";
  }
}

function displayName(user: LoadedUser | undefined | null, fallback = ""): string {
  const fullName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return fullName || user?.email || fallback;
}

function coerceSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formatEventDate(value: string | null | undefined): string {
  if (!value) return "Date TBD";
  const ymd = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return value;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const hhmm = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!hhmm) return value || "";
  const h = Number(hhmm[1]);
  const m = Number(hhmm[2]);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

async function getAuthContext(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
    if (token) {
      const { data } = await supabaseAnon.auth.getUser(token);
      if (data?.user?.id) user = data.user as any;
    }
  }

  if (!user?.id) return null;

  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();

  return { userId: user.id, role: String(userData?.role || "").toLowerCase().trim(), email: String(userData?.email || "") };
}

async function loadUsers(userIds: string[]): Promise<Map<string, LoadedUser>> {
  const uniqueIds = Array.from(new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const [{ data: users, error: usersError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabaseAdmin.from("users").select("id, email").in("id", uniqueIds),
    supabaseAdmin.from("profiles").select("user_id, first_name, last_name").in("user_id", uniqueIds),
  ]);

  if (usersError) {
    throw new Error(usersError.message);
  }

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const profileMap = new Map<string, { first_name: string | null; last_name: string | null }>();
  for (const profile of profiles || []) {
    profileMap.set(String((profile as any).user_id), {
      first_name: (profile as any).first_name ?? null,
      last_name: (profile as any).last_name ?? null,
    });
  }

  const mapped = new Map<string, LoadedUser>();
  for (const user of users || []) {
    const profile = profileMap.get(String((user as any).id));
    mapped.set(String((user as any).id), {
      id: String((user as any).id),
      email: String((user as any).email || ""),
      firstName: safeDecrypt(profile?.first_name),
      lastName: safeDecrypt(profile?.last_name),
    });
  }

  return mapped;
}

/**
 * PATCH /api/vendor-proposals/[id]
 * Approve or decline a proposal. Body: { action: "approved" | "declined", notes?: string }
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const proposalId = params.id;
    const auth = await getAuthContext(req);
    if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!["exec", "admin"].includes(auth.role)) {
      return NextResponse.json({ error: "Exec or admin access required" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const notes = String(body?.notes || "").trim() || null;

    if (!["approved", "declined"].includes(action)) {
      return NextResponse.json({ error: "action must be 'approved' or 'declined'" }, { status: 400 });
    }

    const { data: proposal, error: proposalError } = await supabaseAdmin
      .from("vendor_location_proposals")
      .select(`
        id,
        event_id,
        location_id,
        vendor_id,
        proposed_by,
        status,
        events(id, event_name, event_date, start_time, venue),
        event_locations(id, name)
      `)
      .eq("id", proposalId)
      .maybeSingle();

    if (proposalError) return NextResponse.json({ error: proposalError.message }, { status: 500 });
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.status !== "pending") {
      return NextResponse.json({ error: `Proposal is already ${proposal.status}` }, { status: 409 });
    }

    const users = await loadUsers([proposal.vendor_id, proposal.proposed_by, auth.userId]);
    const vendor = users.get(String(proposal.vendor_id || ""));
    const proposer = users.get(String(proposal.proposed_by || ""));
    const reviewer = users.get(auth.userId);

    const eventData = coerceSingle(proposal.events as any);
    const locationData = coerceSingle(proposal.event_locations as any);

    const vendorFirstName = vendor?.firstName || "Vendor";
    const vendorLastName = vendor?.lastName || "";
    const vendorName = displayName(vendor, vendor?.email || "Vendor");
    const vendorEmail = vendor?.email || "";

    const proposerFirstName = proposer?.firstName || "Staff";
    const proposerName = displayName(proposer, proposer?.email || "Staff");
    const proposerEmail = proposer?.email || "";

    const reviewerName = displayName(reviewer, auth.email || "Management");

    const eventName = String(eventData?.event_name || "");
    const eventDate = formatEventDate(eventData?.event_date);
    const eventStartTime = formatTime(eventData?.start_time);
    const venueName = String(eventData?.venue || "");
    const locationName = String(locationData?.name || "");

    const { error: updateError } = await supabaseAdmin
      .from("vendor_location_proposals")
      .update({
        status: action,
        reviewed_by: auth.userId,
        reviewed_at: new Date().toISOString(),
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposalId);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    if (action === "approved") {
      const { error: assignError } = await supabaseAdmin
        .from("event_location_assignments")
        .upsert(
          {
            event_id: proposal.event_id,
            location_id: proposal.location_id,
            vendor_id: proposal.vendor_id,
            assigned_by: auth.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "event_id,vendor_id" }
        );

      if (assignError) {
        await supabaseAdmin
          .from("vendor_location_proposals")
          .update({ status: "pending", reviewed_by: null, reviewed_at: null, notes: null })
          .eq("id", proposalId);

        return NextResponse.json({ error: `Failed to assign vendor: ${assignError.message}` }, { status: 500 });
      }

      await supabaseAdmin
        .from("event_teams")
        .upsert(
          {
            event_id: proposal.event_id,
            vendor_id: proposal.vendor_id,
            assigned_by: auth.userId,
            status: "assigned",
          },
          { onConflict: "event_id,vendor_id" }
        );

      if (vendorEmail) {
        try {
          const invitationToken = crypto.randomBytes(32).toString("hex");

          await supabaseAdmin.from("vendor_invitations").insert({
            token: invitationToken,
            event_id: proposal.event_id,
            vendor_id: proposal.vendor_id,
            invited_by: auth.userId,
            status: "pending",
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });

          await sendVendorEventInvitationEmail({
            email: vendorEmail,
            firstName: vendorFirstName,
            lastName: vendorLastName,
            eventName,
            eventDate,
            eventStartTime,
            venueName,
            invitationToken,
          });
        } catch (emailErr) {
          console.warn("[VENDOR-PROPOSALS] Invitation email failed:", emailErr);
        }
      }

      return NextResponse.json(
        {
          success: true,
          message: `Proposal approved. ${vendorName} has been assigned and notified.`,
        },
        { status: 200 }
      );
    }

    if (proposerEmail) {
      try {
        await sendProposalDeclinedEmail({
          proposedByEmail: proposerEmail,
          proposedByFirstName: proposerFirstName,
          vendorName,
          eventName,
          eventDate,
          venueName,
          locationName,
          reviewedByName: reviewerName,
        });
      } catch (emailErr) {
        console.warn("[VENDOR-PROPOSALS] Decline email failed:", emailErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: `Proposal declined. ${proposerName} has been notified.`,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[VENDOR-PROPOSALS] PATCH error:", err);
    return NextResponse.json({ error: err.message || "Failed to review proposal" }, { status: 500 });
  }
}
