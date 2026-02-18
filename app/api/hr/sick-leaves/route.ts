import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const HR_ROLES = new Set(["hr", "exec", "admin"]);
const VALID_STATUSES = new Set(["pending", "approved", "denied"]);

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : undefined;

    if (token) {
      const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
      if (tokenUser?.user?.id) {
        user = { id: tokenUser.user.id } as any;
      }
    }
  }

  return user?.id || null;
}

async function hasHrAccess(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) return false;
  return HR_ROLES.has(String(data?.role || "").toLowerCase());
}

type SickLeaveStatus = "pending" | "approved" | "denied";

function normalizeStatus(raw: unknown): SickLeaveStatus {
  const normalized = String(raw || "pending").toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "denied") return "denied";
  return "pending";
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const authorized = await hasHrAccess(userId);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const requestedStatus = String(searchParams.get("status") || "").toLowerCase();

    let query = supabaseAdmin
      .from("sick_leaves")
      .select(
        "id, user_id, start_date, end_date, duration_hours, status, reason, approved_by, approved_at, created_at, updated_at"
      )
      .order("start_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (VALID_STATUSES.has(requestedStatus)) {
      query = query.eq("status", requestedStatus);
    }

    const { data: sickLeaves, error: sickLeaveError } = await query;
    if (sickLeaveError) {
      return NextResponse.json(
        { error: sickLeaveError.message || "Failed to fetch sick leave records" },
        { status: 500 }
      );
    }

    const userIds = [...new Set((sickLeaves || []).map((row: any) => row.user_id).filter(Boolean))];
    const profileMap = new Map<
      string,
      { employee_name: string; employee_email: string; employee_state: string | null; employee_city: string | null }
    >();

    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabaseAdmin
        .from("users")
        .select(
          `
            id,
            email,
            profiles (
              first_name,
              last_name,
              state,
              city
            )
          `
        )
        .in("id", userIds);

      if (usersError) {
        return NextResponse.json(
          { error: usersError.message || "Failed to fetch employee profiles" },
          { status: 500 }
        );
      }

      for (const user of users || []) {
        const profile = Array.isArray((user as any).profiles)
          ? (user as any).profiles[0]
          : (user as any).profiles;
        const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : "";
        const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : "";
        const fullName = `${firstName} ${lastName}`.trim() || (user as any).email || "Unknown";

        profileMap.set((user as any).id, {
          employee_name: fullName,
          employee_email: (user as any).email || "",
          employee_state: profile?.state ?? null,
          employee_city: profile?.city ?? null,
        });
      }
    }

    const records = (sickLeaves || []).map((row: any) => {
      const profile = profileMap.get(row.user_id);
      return {
        id: row.id,
        user_id: row.user_id,
        start_date: row.start_date,
        end_date: row.end_date,
        duration_hours: Number(row.duration_hours || 0),
        status: normalizeStatus(row.status),
        reason: row.reason ?? null,
        approved_by: row.approved_by ?? null,
        approved_at: row.approved_at ?? null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        employee_name: profile?.employee_name || "Unknown",
        employee_email: profile?.employee_email || "",
        employee_state: profile?.employee_state ?? null,
        employee_city: profile?.employee_city ?? null,
      };
    });

    const stats = records.reduce(
      (acc, row) => {
        acc.total += 1;
        acc.total_hours += Number(row.duration_hours || 0);
        if (row.status === "pending") acc.pending += 1;
        if (row.status === "approved") acc.approved += 1;
        if (row.status === "denied") acc.denied += 1;
        return acc;
      },
      { total: 0, pending: 0, approved: 0, denied: 0, total_hours: 0 }
    );

    stats.total_hours = Number(stats.total_hours.toFixed(2));

    return NextResponse.json({ records, stats }, { status: 200 });
  } catch (err: any) {
    console.error("[HR SICK LEAVES][GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const authorized = await hasHrAccess(userId);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const id = String(body?.id || "").trim();
    const rawStatus = String(body?.status || "").toLowerCase();

    if (!id) {
      return NextResponse.json({ error: "Sick leave id is required" }, { status: 400 });
    }

    if (!VALID_STATUSES.has(rawStatus)) {
      return NextResponse.json(
        { error: "Invalid status. Allowed: pending, approved, denied" },
        { status: 400 }
      );
    }

    const status = rawStatus as SickLeaveStatus;

    const updates: Record<string, any> = { status };
    if (status === "approved") {
      updates.approved_by = userId;
      updates.approved_at = new Date().toISOString();
    } else {
      updates.approved_by = null;
      updates.approved_at = null;
    }

    const { data, error } = await supabaseAdmin
      .from("sick_leaves")
      .update(updates)
      .eq("id", id)
      .select("id, user_id, status, approved_by, approved_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to update sick leave record" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: "Sick leave status updated",
        record: data,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[HR SICK LEAVES][PATCH] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
