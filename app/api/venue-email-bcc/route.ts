import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

async function getAuthedExec(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!userData || !["exec", "admin"].includes(userData.role)) return null;

  return { userId: user.id, supabaseAdmin };
}

// GET /api/venue-email-bcc?venue_id=<uuid>
// Returns all BCC entries for a venue with user details
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthedExec(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const venueId = searchParams.get("venue_id");
    if (!venueId) {
      return NextResponse.json({ error: "venue_id is required" }, { status: 400 });
    }

    const { data: rows, error } = await auth.supabaseAdmin
      .from("venue_email_bcc")
      .select("id, venue_id, user_id, created_at")
      .eq("venue_id", venueId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ entries: [] }, { status: 200, headers: NO_STORE });
    }

    const userIds = rows.map((r: any) => r.user_id);

    const [usersRes, profilesRes] = await Promise.all([
      auth.supabaseAdmin.from("users").select("id, email, role").in("id", userIds),
      auth.supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", userIds),
    ]);

    const usersById: Record<string, any> = {};
    (usersRes.data || []).forEach((u: any) => (usersById[u.id] = u));

    const profilesByUserId: Record<string, any> = {};
    (profilesRes.data || []).forEach((p: any) => (profilesByUserId[p.user_id] = p));

    const entries = rows.map((row: any) => {
      const user = usersById[row.user_id] || {};
      const profile = profilesByUserId[row.user_id] || {};
      return {
        id: row.id,
        venue_id: row.venue_id,
        user_id: row.user_id,
        email: user.email || "",
        role: user.role || "",
        first_name: safeDecrypt(profile.first_name || ""),
        last_name: safeDecrypt(profile.last_name || ""),
        created_at: row.created_at,
      };
    });

    return NextResponse.json({ entries }, { status: 200, headers: NO_STORE });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

// POST /api/venue-email-bcc
// Body: { venue_id: string, user_id: string }
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthedExec(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { venue_id, user_id } = body;

    if (!venue_id || !user_id) {
      return NextResponse.json(
        { error: "venue_id and user_id are required" },
        { status: 400 }
      );
    }

    // Verify venue exists
    const { data: venue, error: venueError } = await auth.supabaseAdmin
      .from("venue_reference")
      .select("id")
      .eq("id", venue_id)
      .maybeSingle();

    if (venueError || !venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    // Verify user exists
    const { data: user, error: userError } = await auth.supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("id", user_id)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: entry, error: insertError } = await auth.supabaseAdmin
      .from("venue_email_bcc")
      .upsert(
        { venue_id, user_id, created_by: auth.userId },
        { onConflict: "venue_id,user_id" }
      )
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/venue-email-bcc?id=<uuid>
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthedExec(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { error } = await auth.supabaseAdmin
      .from("venue_email_bcc")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Removed successfully" }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
