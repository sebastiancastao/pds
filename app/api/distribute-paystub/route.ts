import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const PAYSTUBS_BUCKET = "paystubs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

async function uploadPdfToStorage(
  pdfBytes: ArrayBuffer,
  employeeUserId: string,
  logId: string
): Promise<string | null> {
  try {
    const storagePath = `${employeeUserId}/${logId}.pdf`;
    const { error } = await supabaseAdmin.storage
      .from(PAYSTUBS_BUCKET)
      .upload(storagePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: false,
      });

    if (error) {
      console.error("[distribute-paystub] Storage upload failed:", error.message);
      return null;
    }
    return storagePath;
  } catch (e) {
    console.error("[distribute-paystub] Storage upload threw:", e);
    return null;
  }
}

async function deleteStoredPdf(storagePath: string) {
  try {
    const { error } = await supabaseAdmin.storage.from(PAYSTUBS_BUCKET).remove([storagePath]);
    if (error) {
      console.error("[distribute-paystub] Storage cleanup failed:", error.message);
    }
  } catch (e) {
    console.error("[distribute-paystub] Storage cleanup threw:", e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const form = await req.formData();

    const pdfFile = form.get("pdf");
    if (!pdfFile || !(pdfFile instanceof File)) {
      return NextResponse.json({ error: "Missing PDF file." }, { status: 400 });
    }

    const userId = String(form.get("userId") || "").trim();
    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    const employeeName = String(form.get("employeeName") || "Employee").trim();
    const payDate = String(form.get("payDate") || "").trim();
    const payPeriodStart = String(form.get("payPeriodStart") || "").trim() || null;
    const payPeriodEnd = String(form.get("payPeriodEnd") || "").trim() || null;
    const distributionMode = (String(form.get("distributionMode") || "single").trim() as "single" | "batch");
    if (distributionMode !== "single" && distributionMode !== "batch") {
      return NextResponse.json({ error: "Invalid distributionMode." }, { status: 400 });
    }

    const pdfBytes = await pdfFile.arrayBuffer();

    const logId = crypto.randomUUID();

    const pdfStoragePath = await uploadPdfToStorage(pdfBytes, userId, logId);
    if (!pdfStoragePath) {
      return NextResponse.json({ error: "Failed to store paystub PDF." }, { status: 500 });
    }

    const { error: insertErr } = await supabaseAdmin.from("paystub_distribution_log").insert({
      id: logId,
      employee_user_id: userId,
      employee_name: employeeName,
      pay_date: payDate || null,
      pay_period_start: payPeriodStart,
      pay_period_end: payPeriodEnd,
      triggered_by_user_id: caller.id,
      triggered_by_email: caller.email ?? null,
      distribution_mode: distributionMode,
      status: "sent",
      pdf_storage_path: pdfStoragePath,
    });

    if (insertErr) {
      console.error("[distribute-paystub] Log insert failed:", insertErr.message);
      await deleteStoredPdf(pdfStoragePath);
      return NextResponse.json({ error: "Failed to record paystub distribution." }, { status: 500 });
    }

    return NextResponse.json({ success: true, logId, pdfStoragePath });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}
