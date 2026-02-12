import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { isValidCheckinCode, normalizeCheckinCode } from "@/lib/checkin-code";

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
    const code = normalizeCheckinCode(body.code);

    if (!isValidCheckinCode(code)) {
      return NextResponse.json({ error: "Invalid code format" }, { status: 400 });
    }

    // Find active code (permanent)
    const { data: codeRecord } = await supabaseAdmin
      .from("checkin_codes")
      .select("id, code, is_active, target_user_id")
      .eq("code", code)
      .eq("is_active", true)
      .single();

    if (!codeRecord) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 404 });
    }

    // If this is a personal code, only the target user can use it
    if (codeRecord.target_user_id && codeRecord.target_user_id !== user.id) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 404 });
    }

    // Check if user already checked in today with this code (permanent codes)
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

    if (existingLogs && existingLogs.length > 0) {
      return NextResponse.json({ error: "You have already checked in today" }, { status: 409 });
    }

    // Create check-in log
    const { data: logEntry, error: logError } = await supabaseAdmin
      .from("checkin_logs")
      .insert({
        code_id: codeRecord.id,
        user_id: user.id,
      })
      .select()
      .single();

    if (logError) {
      console.error("Error creating check-in log:", logError);
      return NextResponse.json({ error: logError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, checkedInAt: logEntry.checked_in_at });
  } catch (err) {
    console.error("Error verifying check-in code:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
