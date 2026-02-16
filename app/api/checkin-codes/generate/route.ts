import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { generateCheckinCode } from "@/lib/checkin-code";

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

    // Check role
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!userData || !["manager", "supervisor", "hr", "exec"].includes(userData.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const label = body.label?.trim() || null;

    const { data: existingCodes, error: existingError } = await supabaseAdmin
      .from("checkin_codes")
      .select("code")
      .eq("is_active", true);

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    const existingActiveCodes = new Set(
      (existingCodes || []).map((row: any) => String(row.code))
    );

    let code = generateCheckinCode();
    let isUnique = !existingActiveCodes.has(code);
    for (let i = 0; i < 200 && !isUnique; i += 1) {
      code = generateCheckinCode();
      isUnique = !existingActiveCodes.has(code);
    }

    if (!isUnique) {
      return NextResponse.json(
        { error: "Failed to generate unique code" },
        { status: 500 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("checkin_codes")
      .insert({
        code,
        created_by: user.id,
        is_active: true,
        label,
        expires_at: "9999-12-31T23:59:59.999Z",
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating check-in code:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("Error in generate check-in code:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
