import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { decrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const code = body.code?.trim();

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid code format" }, { status: 400 });
    }

    // Find active code
    const { data: codeRecord } = await supabaseAdmin
      .from("checkin_codes")
      .select("id, code, is_active, target_user_id")
      .eq("code", code)
      .eq("is_active", true)
      .single();

    if (!codeRecord) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 404 });
    }

    // If personal code, only the target user can use it
    if (codeRecord.target_user_id && codeRecord.target_user_id !== user.id) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 404 });
    }

    // Check if already checked in today
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    const { data: existingLogs } = await supabaseAdmin
      .from("checkin_logs")
      .select("id")
      .eq("code_id", codeRecord.id)
      .eq("user_id", user.id)
      .gte("checked_in_at", start.toISOString())
      .lt("checked_in_at", end.toISOString())
      .limit(1);

    const alreadyCheckedIn = existingLogs && existingLogs.length > 0;

    // Get user profile name
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", user.id)
      .single();

    let firstName = "";
    let lastName = "";
    if (profile) {
      firstName = profile.first_name ? decrypt(profile.first_name) : "";
      lastName = profile.last_name ? decrypt(profile.last_name) : "";
    }

    const displayName = [firstName, lastName].filter(Boolean).join(" ") || "User";

    return NextResponse.json({
      valid: true,
      name: displayName,
      codeId: codeRecord.id,
      alreadyCheckedIn,
    });
  } catch (err) {
    console.error("Error validating check-in code:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
