export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const PAYSTUBS_BUCKET = "paystubs";
const SIGNED_URL_EXPIRES_IN = 60 * 60; // 1 hour

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const HR_ROLES = new Set(["admin", "exec", "hr", "hr_admin", "manager", "supervisor", "supervisor3"]);

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

export async function GET(req: NextRequest) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const logId = req.nextUrl.searchParams.get("logId");
    if (!logId) {
      return NextResponse.json({ error: "logId is required." }, { status: 400 });
    }

    // Fetch the log entry
    const { data: logEntry, error: logErr } = await supabaseAdmin
      .from("paystub_distribution_log")
      .select("id, employee_user_id, pdf_storage_path, employee_name, pay_date")
      .eq("id", logId)
      .maybeSingle();

    if (logErr) {
      return NextResponse.json({ error: logErr.message }, { status: 500 });
    }
    if (!logEntry) {
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    }
    if (!logEntry.pdf_storage_path) {
      return NextResponse.json({ error: "No PDF stored for this entry." }, { status: 404 });
    }

    // Authorise: must be the employee themselves OR an HR/admin role
    const { data: callerRecord } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    const callerRole = String(callerRecord?.role || "").toLowerCase();
    const isHR = HR_ROLES.has(callerRole);
    const isOwner = logEntry.employee_user_id === caller.id;

    if (!isHR && !isOwner) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Generate a short-lived signed URL
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(PAYSTUBS_BUCKET)
      .createSignedUrl(logEntry.pdf_storage_path, SIGNED_URL_EXPIRES_IN, {
        download: `paystub-${(logEntry.employee_name as string).replace(/\s+/g, "_")}-${logEntry.pay_date ?? "unknown"}.pdf`,
      });

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: signErr?.message || "Failed to generate download URL." },
        { status: 500 }
      );
    }

    return NextResponse.redirect(signed.signedUrl);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}
