import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { canUserAccessEventById } from "@/lib/event-access";
import { decrypt } from "@/lib/encryption";
import { sendVenueProposalAlertEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const MANAGE_ROLES = new Set(["exec", "admin", "manager", "supervisor", "supervisor2", "supervisor3"]);

type LoadedUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

type ProposalRow = {
  id: string;
  vendor_id: string;
  status: "pending" | "approved" | "declined";
};

function safeDecrypt(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decrypt(value);
  } catch {
    return value;
  }
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

function coerceSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function displayName(user: LoadedUser | undefined | null, fallback = ""): string {
  const fullName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  return fullName || user?.email || fallback;
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

  return {
    userId: user.id,
    role: String(userData?.role || "").toLowerCase().trim(),
    email: String(userData?.email || ""),
  };
}

async function loadUsers(userIds: string[]): Promise<Map<string, LoadedUser>> {
  const uniqueIds = Array.from(new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const [{ data: users, error: usersError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabaseAdmin.from("users").select("id, email").in("id", uniqueIds),
    supabaseAdmin.from("profiles").select("user_id, first_name, last_name").in("user_id", uniqueIds),
  ]);

  if (usersError) {
    throw new Error(`Failed to load users: ${usersError.message}`);
  }

  if (profilesError) {
    throw new Error(`Failed to load user profiles: ${profilesError.message}`);
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

async function sendProposalAlertEmail(args: {
  proposalId: string;
  proposerName: string;
  proposerEmail: string;
  vendor: LoadedUser;
  eventName: string;
  eventDate: string;
  venueName: string;
  locationName: string;
}) {
  await sendVenueProposalAlertEmail({
    proposedByName: args.proposerName,
    proposedByEmail: args.proposerEmail,
    vendorName: displayName(args.vendor, args.vendor.email),
    vendorEmail: args.vendor.email,
    eventName: args.eventName,
    eventDate: args.eventDate,
    venueName: args.venueName,
    locationName: args.locationName,
    proposalId: args.proposalId,
    reviewUrl: `${process.env.NEXT_PUBLIC_SITE_URL || "https://pds-murex.vercel.app"}/vendor-proposals`,
  });
}

/**
 * POST /api/events/[id]/location-proposals
 * Submit proposals to invite out-of-venue vendors to a specific location.
 * Body: { locationId: string, vendorIds: string[] }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const eventId = params.id;
    const auth = await getAuthContext(req);

    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!MANAGE_ROLES.has(auth.role)) {
      return NextResponse.json(
        { error: "You do not have permission to submit proposals" },
        { status: 403 }
      );
    }

    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, {
      userId: auth.userId,
      role: auth.role,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const locationId = body?.locationId ? String(body.locationId).trim() : null;
    const rawVendorIds: unknown[] = Array.isArray(body?.vendorIds) ? body.vendorIds : [];
    const vendorIds: string[] = Array.from(
      new Set(rawVendorIds.map((vendorId) => String(vendorId || "").trim()))
    ).filter((vendorId) => vendorId.length > 0);

    if (vendorIds.length === 0) {
      return NextResponse.json({ error: "vendorIds is required" }, { status: 400 });
    }

    let existingQuery = supabaseAdmin
      .from("vendor_location_proposals")
      .select("id, vendor_id, status")
      .eq("event_id", eventId)
      .in("vendor_id", vendorIds);
    if (locationId) {
      existingQuery = existingQuery.eq("location_id", locationId);
    } else {
      existingQuery = existingQuery.is("location_id", null);
    }

    const [eventResult, locationResult, existingResult, userMap] = await Promise.all([
      supabaseAdmin
        .from("events")
        .select("id, event_name, event_date, venue")
        .eq("id", eventId)
        .maybeSingle(),
      locationId
        ? supabaseAdmin
            .from("event_locations")
            .select("id, name")
            .eq("id", locationId)
            .eq("event_id", eventId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      existingQuery,
      loadUsers([auth.userId, ...vendorIds]),
    ]);

    if (eventResult.error) {
      return NextResponse.json({ error: eventResult.error.message }, { status: 500 });
    }

    if (locationResult.error) {
      return NextResponse.json({ error: locationResult.error.message }, { status: 500 });
    }

    if (existingResult.error) {
      return NextResponse.json({ error: existingResult.error.message }, { status: 500 });
    }

    if (!eventResult.data) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (locationId && !locationResult.data) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const proposer = userMap.get(auth.userId);
    const proposerName = displayName(proposer, auth.email || "Staff");
    const vendorRecords = vendorIds
      .map((vendorId) => userMap.get(vendorId))
      .filter((vendor): vendor is LoadedUser => Boolean(vendor));

    if (vendorRecords.length === 0) {
      return NextResponse.json({ error: "No vendors found for the provided IDs" }, { status: 404 });
    }

    const event = eventResult.data;
    const eventDate = formatEventDate(event.event_date);

    const existingByVendorId = new Map<string, ProposalRow>();
    for (const row of existingResult.data || []) {
      existingByVendorId.set(String((row as any).vendor_id), {
        id: String((row as any).id),
        vendor_id: String((row as any).vendor_id),
        status: String((row as any).status) as ProposalRow["status"],
      });
    }

    const results: Array<{
      vendorId: string;
      status: "submitted" | "resubmitted" | "already_pending" | "already_approved" | "error";
      error?: string;
    }> = [];

    for (const vendor of vendorRecords) {
      const existing = existingByVendorId.get(vendor.id);

      if (existing?.status === "pending") {
        results.push({ vendorId: vendor.id, status: "already_pending" });
        continue;
      }

      let proposalId = "";
      let submissionStatus: "submitted" | "resubmitted" = "submitted";

      const { data: insertedProposal, error: insertError } = await supabaseAdmin
        .from("vendor_location_proposals")
        .insert({
          event_id: eventId,
          location_id: locationId,
          vendor_id: vendor.id,
          proposed_by: auth.userId,
          status: "pending",
        })
        .select("id")
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          let fallbackQuery = supabaseAdmin
            .from("vendor_location_proposals")
            .select("id, vendor_id, status")
            .eq("event_id", eventId)
            .eq("vendor_id", vendor.id);
          if (locationId) {
            fallbackQuery = fallbackQuery.eq("location_id", locationId);
          } else {
            fallbackQuery = fallbackQuery.is("location_id", null);
          }
          const fallbackExisting =
            existingByVendorId.get(vendor.id) ||
            (await fallbackQuery.maybeSingle()).data;

          const fallbackStatus = String((fallbackExisting as any)?.status || "").trim();

          if (fallbackStatus === "pending") {
            results.push({ vendorId: vendor.id, status: "already_pending" });
            continue;
          }

          if (fallbackStatus === "approved") {
            results.push({ vendorId: vendor.id, status: "already_approved" });
            continue;
          }

          if ((fallbackExisting as any)?.id) {
            const { data: reopenedProposal, error: reopenError } = await supabaseAdmin
              .from("vendor_location_proposals")
              .update({
                proposed_by: auth.userId,
                status: "pending",
                reviewed_by: null,
                reviewed_at: null,
                notes: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", (fallbackExisting as any).id)
              .select("id")
              .single();

            if (reopenError) {
              results.push({ vendorId: vendor.id, status: "error", error: reopenError.message });
              continue;
            }

            proposalId = String(reopenedProposal?.id || "");
            submissionStatus = "resubmitted";
          } else {
            results.push({ vendorId: vendor.id, status: "error", error: insertError.message });
            continue;
          }
        } else {
          results.push({ vendorId: vendor.id, status: "error", error: insertError.message });
          continue;
        }
      } else {
        proposalId = String(insertedProposal?.id || "");
      }

      try {
        await sendProposalAlertEmail({
          proposalId,
          proposerName,
          proposerEmail: auth.email,
          vendor,
          eventName: event.event_name,
          eventDate,
          venueName: event.venue,
          locationName: locationResult.data?.name || "",
        });
      } catch (emailError: any) {
        console.warn("[LOCATION-PROPOSALS] Alert email failed:", emailError);
      }

      results.push({ vendorId: vendor.id, status: submissionStatus });
    }

    const submitted = results.filter((result) => result.status === "submitted" || result.status === "resubmitted").length;
    const alreadyPending = results.filter((result) => result.status === "already_pending").length;
    const alreadyApproved = results.filter((result) => result.status === "already_approved").length;
    const errors = results.filter((result) => result.status === "error");

    if (submitted === 0 && alreadyPending === 0 && alreadyApproved === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          error: `Proposals could not be submitted: ${errors[0].error}`,
          results,
        },
        { status: 500 }
      );
    }

    const messageParts: string[] = [];
    if (submitted > 0) messageParts.push(`${submitted} proposal(s) submitted for exec review`);
    if (alreadyPending > 0) messageParts.push(`${alreadyPending} already pending review`);
    if (alreadyApproved > 0) messageParts.push(`${alreadyApproved} already approved`);

    return NextResponse.json(
      {
        success: true,
        message: messageParts.join(". ") || "No new proposals were submitted.",
        results,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[LOCATION-PROPOSALS] POST error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to submit proposals" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events/[id]/location-proposals
 * Get proposals for a specific event.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const eventId = params.id;
    const auth = await getAuthContext(req);

    if (!auth) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!MANAGE_ROLES.has(auth.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const allowed = await canUserAccessEventById(supabaseAdmin, eventId, {
      userId: auth.userId,
      role: auth.role,
    });
    if (!allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: proposals, error } = await supabaseAdmin
      .from("vendor_location_proposals")
      .select("id, event_id, location_id, vendor_id, proposed_by, status, created_at, event_locations(name)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const userIds = Array.from(
      new Set(
        (proposals || []).flatMap((proposal: any) => [
          String(proposal.vendor_id || ""),
          String(proposal.proposed_by || ""),
        ]).filter(Boolean)
      )
    );

    const users = await loadUsers(userIds);

    const mapped = (proposals || []).map((proposal: any) => {
      const locationData = coerceSingle(proposal.event_locations as { name: string } | { name: string }[] | null);
      const vendor = users.get(String(proposal.vendor_id || ""));
      const proposer = users.get(String(proposal.proposed_by || ""));

      return {
        id: proposal.id,
        event_id: proposal.event_id,
        location_id: proposal.location_id,
        location_name: locationData?.name || "",
        vendor_id: proposal.vendor_id,
        vendor_name: displayName(vendor, vendor?.email || ""),
        vendor_email: vendor?.email || "",
        proposed_by: proposal.proposed_by,
        proposer_name: displayName(proposer, proposer?.email || ""),
        proposer_email: proposer?.email || "",
        status: proposal.status,
        created_at: proposal.created_at,
      };
    });

    return NextResponse.json({ proposals: mapped }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load proposals" }, { status: 500 });
  }
}
