import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";

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

    const users = await loadUsers(userIds);

    const proposals = (data || []).map((proposal: any) => {
      const eventData = coerceSingle(proposal.events as any);
      const locationData = coerceSingle(proposal.event_locations as any);
      const vendor = users.get(String(proposal.vendor_id || ""));
      const proposer = users.get(String(proposal.proposed_by || ""));
      const reviewer = users.get(String(proposal.reviewed_by || ""));

      return {
        id: proposal.id,
        status: proposal.status,
        created_at: proposal.created_at,
        reviewed_at: proposal.reviewed_at,
        notes: proposal.notes,
        event_id: proposal.event_id,
        event_name: eventData?.event_name || "",
        event_date: eventData?.event_date || "",
        venue_name: eventData?.venue || "",
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
      };
    });

    return NextResponse.json({ proposals }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load proposals" }, { status: 500 });
  }
}
