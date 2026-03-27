import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";

export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId } = params;

    // Allow user to view their own team members, or exec/admin to view any
    if (user.id !== userId) {
      const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();

      if (!userData || !["exec", "admin"].includes(userData.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Get active team members for this user (as manager)
    const { data: assignments, error: assignError } = await supabaseAdmin
      .from("manager_team_members")
      .select("id, member_id, assigned_at, notes")
      .eq("manager_id", userId)
      .eq("is_active", true);

    if (assignError) {
      return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 });
    }

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ teamMembers: [] }, { status: 200 });
    }

    const memberIds = assignments.map((a: any) => a.member_id);

    const { data: memberData, error: memberError } = await supabaseAdmin
      .from("users")
      .select("id, email, role, division, profiles!inner(first_name, last_name)")
      .in("id", memberIds);

    if (memberError) {
      return NextResponse.json({ error: "Failed to fetch member details" }, { status: 500 });
    }

    const members = (memberData || []).map((u: any) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      division: u.division,
      first_name: safeDecrypt(u.profiles?.first_name ?? ""),
      last_name: safeDecrypt(u.profiles?.last_name ?? ""),
    }));

    const teamMembers = assignments.map((a: any) => {
      const member = members.find((m: any) => m.id === a.member_id) || null;
      return {
        assignment_id: a.id,
        member_id: a.member_id,
        assigned_at: a.assigned_at,
        notes: a.notes,
        member,
      };
    });

    return NextResponse.json({ teamMembers }, { status: 200 });
  } catch (err: any) {
    console.error("[USER-TEAM-MEMBERS] Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
