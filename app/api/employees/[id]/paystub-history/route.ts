export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const HR_ROLES = new Set([
  "admin", "exec", "hr", "hr_admin", "manager", "supervisor", "supervisor3",
]);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const employeeId = params.id;

    // Authorise: must be the employee themselves or an HR/admin role
    const isOwner = caller.id === employeeId;
    if (!isOwner) {
      const { data: callerRecord } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();
      const role = String(callerRecord?.role || "").toLowerCase();
      if (!HR_ROLES.has(role)) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    const { data, error } = await supabaseAdmin
      .from("paystub_distribution_log")
      .select(
        "id, employee_name, pay_date, pay_period_start, pay_period_end, triggered_by_email, distribution_mode, status, error_message, pdf_storage_path, sent_at"
      )
      .eq("employee_user_id", employeeId)
      .order("sent_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ records: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}
