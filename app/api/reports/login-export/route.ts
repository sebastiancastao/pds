// app/api/reports/login-export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_ROLES = ["manager", "supervisor", "supervisor2", "hr", "exec"];

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

function dec(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try { return safeDecrypt(value.trim()); } catch { return value.trim(); }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * GET /api/reports/login-export
 * Returns an Excel (.xlsx) file with the full login sheet for all users.
 */
export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: callerData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", authedUser.id)
      .maybeSingle();

    const role = (callerData?.role || "").toLowerCase().trim();
    if (!ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch all auth users
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
    if (authError) throw new Error(authError.message);

    // Fetch user profiles for names and roles
    const { data: profileRows } = await supabaseAdmin
      .from("users")
      .select("id, role, is_active, profiles(first_name, last_name)");

    const profileByAuthId = new Map<string, any>();
    (profileRows || []).forEach((u: any) => {
      const p = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
      profileByAuthId.set(u.id, { role: u.role, is_active: u.is_active, profile: p });
    });

    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;

    const rows = (authData?.users || [])
      .map((au: any) => {
        const userData = profileByAuthId.get(au.id);
        const profile = userData?.profile;
        return {
          id: au.id,
          first_name: dec(profile?.first_name) || "",
          last_name: dec(profile?.last_name) || "",
          email: au.email || "",
          role: userData?.role || "",
          is_active: userData?.is_active ?? true,
          last_sign_in_at: au.last_sign_in_at || null,
          created_at: au.created_at || null,
        };
      })
      .sort((a: any, b: any) => {
        if (!a.last_sign_in_at) return 1;
        if (!b.last_sign_in_at) return -1;
        return new Date(b.last_sign_in_at).getTime() - new Date(a.last_sign_in_at).getTime();
      });

    // Build worksheet data
    const wsData: (string | number | boolean)[][] = [
      ["#", "Name", "Email", "Role", "Active", "Last Sign-In", "Active Last 7 Days", "Joined"],
    ];

    rows.forEach((r: any, idx: number) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || "—";
      const recentLogin = r.last_sign_in_at
        ? new Date(r.last_sign_in_at).getTime() > sevenDaysAgo
        : false;
      wsData.push([
        idx + 1,
        name,
        r.email,
        r.role || "—",
        r.is_active ? "Yes" : "No",
        r.last_sign_in_at ? fmtDate(r.last_sign_in_at) : "Never",
        recentLogin ? "Yes" : "No",
        r.created_at ? fmtDate(r.created_at) : "—",
      ]);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws["!cols"] = [
      { wch: 5 },  // #
      { wch: 28 }, // Name
      { wch: 36 }, // Email
      { wch: 16 }, // Role
      { wch: 8 },  // Active
      { wch: 24 }, // Last Sign-In
      { wch: 18 }, // Active Last 7 Days
      { wch: 24 }, // Joined
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Login Sheet");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const today = new Date().toISOString().slice(0, 10);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="login-sheet-${today}.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("[LOGIN-EXPORT]", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
