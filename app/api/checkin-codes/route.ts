import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

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

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
        if (tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check role
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!userData || !["manager", "supervisor", "hr", "exec"].includes(userData.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { data: codes, error: codesError } = await supabaseAdmin
      .from("checkin_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (codesError) {
      return NextResponse.json({ error: codesError.message }, { status: 400 });
    }

    // Get check-in logs for these codes with user info
    const codeIds = (codes || []).map((c: any) => c.id);
    let logs: any[] = [];

    if (codeIds.length > 0) {
      const { data: logsData } = await supabaseAdmin
        .from("checkin_logs")
        .select("*")
        .in("code_id", codeIds)
        .order("checked_in_at", { ascending: false });

      if (logsData && logsData.length > 0) {
        // Get user profiles for the logs
        const userIds = [...new Set(logsData.map((l: any) => l.user_id))];
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("user_id, first_name, last_name")
          .in("user_id", userIds);

        const profileMap = new Map(
          (profiles || []).map((p: any) => [p.user_id, p])
        );

        logs = logsData.map((l: any) => ({
          ...l,
          profile: profileMap.get(l.user_id) || null,
        }));
      }
    }

    // Attach logs to codes
    const codesWithLogs = (codes || []).map((code: any) => ({
      ...code,
      checkins: logs.filter((l: any) => l.code_id === code.id),
    }));

    return NextResponse.json(codesWithLogs);
  } catch (err) {
    console.error("Error fetching Employee ID Codes:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
