import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";
import { calculateDistanceMiles } from "@/lib/geocoding";

export const dynamic = "force-dynamic";

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
  latitude: number | null;
  longitude: number | null;
};

function safeDecrypt(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return decrypt(value);
  } catch {
    return value;
  }
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

  return { userId: user.id, role: String(userData?.role || "").toLowerCase().trim(), email: String(userData?.email || "") };
}

async function loadUsers(userIds: string[]): Promise<Map<string, LoadedUser>> {
  const uniqueIds = Array.from(new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const [{ data: users, error: usersError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabaseAdmin.from("users").select("id, email").in("id", uniqueIds),
    supabaseAdmin.from("profiles").select("user_id, first_name, last_name, latitude, longitude").in("user_id", uniqueIds),
  ]);

  if (usersError) {
    throw new Error(usersError.message);
  }

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const profileMap = new Map<string, { first_name: string | null; last_name: string | null; latitude: number | null; longitude: number | null }>();
  for (const profile of profiles || []) {
    profileMap.set(String((profile as any).user_id), {
      first_name: (profile as any).first_name ?? null,
      last_name: (profile as any).last_name ?? null,
      latitude: (profile as any).latitude != null ? Number((profile as any).latitude) : null,
      longitude: (profile as any).longitude != null ? Number((profile as any).longitude) : null,
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
      latitude: profile?.latitude ?? null,
      longitude: profile?.longitude ?? null,
    });
  }

  return mapped;
}

/**
 * GET /api/vendor-proposals
 * List all proposals (exec/admin only). Filter by ?status=pending|approved|declined
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext(req);
    if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!["exec", "admin"].includes(auth.role)) {
      return NextResponse.json({ error: "Exec or admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    let query = supabaseAdmin
      .from("vendor_location_proposals")
      .select(`
        id,
        event_id,
        location_id,
        vendor_id,
        proposed_by,
        reviewed_by,
        status,
        notes,
        created_at,
        reviewed_at,
        events(id, event_name, event_date, venue),
        event_locations(id, name)
      `)
      .order("created_at", { ascending: false });

    if (statusFilter && ["pending", "approved", "declined"].includes(statusFilter)) {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const userIds = Array.from(
      new Set(
        (data || [])
          .flatMap((proposal: any) => [
            String(proposal.vendor_id || ""),
            String(proposal.proposed_by || ""),
            String(proposal.reviewed_by || ""),
          ])
          .filter(Boolean)
      )
    );

    // Collect unique venue names to fetch coordinates
    const venueNames = Array.from(
      new Set(
        (data || [])
          .map((proposal: any) => {
            const eventData = coerceSingle(proposal.events as any);
            return String(eventData?.venue || "").trim();
          })
          .filter(Boolean)
      )
    );

    const [users, venueRefData] = await Promise.all([
      loadUsers(userIds),
      venueNames.length > 0
        ? supabaseAdmin
            .from("venue_reference")
            .select("venue_name, latitude, longitude")
            .in("venue_name", venueNames)
            .then(({ data: vd }) => vd || [])
        : Promise.resolve([]),
    ]);

    const venueCoordMap = new Map<string, { latitude: number; longitude: number }>();
    for (const vr of venueRefData as any[]) {
      if (vr.venue_name && vr.latitude != null && vr.longitude != null) {
        venueCoordMap.set(String(vr.venue_name), {
          latitude: Number(vr.latitude),
          longitude: Number(vr.longitude),
        });
      }
    }

    const proposals = (data || []).map((proposal: any) => {
      const eventData = coerceSingle(proposal.events as any);
      const locationData = coerceSingle(proposal.event_locations as any);
      const vendor = users.get(String(proposal.vendor_id || ""));
      const proposer = users.get(String(proposal.proposed_by || ""));
      const reviewer = users.get(String(proposal.reviewed_by || ""));

      const venueName = eventData?.venue || "";
      const venueCoords = venueCoordMap.get(venueName) ?? null;
      let distance_miles: number | null = null;
      if (
        vendor?.latitude != null &&
        vendor?.longitude != null &&
        venueCoords != null
      ) {
        distance_miles = Math.round(
          calculateDistanceMiles(vendor.latitude, vendor.longitude, venueCoords.latitude, venueCoords.longitude) * 10
        ) / 10;
      }

      return {
        id: proposal.id,
        status: proposal.status,
        created_at: proposal.created_at,
        reviewed_at: proposal.reviewed_at,
        notes: proposal.notes,
        event_id: proposal.event_id,
        event_name: eventData?.event_name || "",
        event_date: eventData?.event_date || "",
        venue_name: venueName,
        location_id: proposal.location_id,
        location_name: locationData?.name || "",
        vendor_id: proposal.vendor_id,
        vendor_name: displayName(vendor, vendor?.email || ""),
        vendor_email: vendor?.email || "",
        proposed_by: proposal.proposed_by,
        proposer_name: displayName(proposer, proposer?.email || ""),
        proposer_email: proposer?.email || "",
        reviewed_by: proposal.reviewed_by,
        reviewer_name: reviewer ? displayName(reviewer, reviewer.email) : null,
        distance_miles,
      };
    });

    return NextResponse.json({ proposals }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load proposals" }, { status: 500 });
  }
}
