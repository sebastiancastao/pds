import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Require HR/admin role to send paystub emails
    const { data: callerRecord } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    const callerRole = String(callerRecord?.role || "").toLowerCase();
    if (!HR_ROLES.has(callerRole)) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
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
    const payPeriodStart = String(form.get("payPeriodStart") || "").trim();
    const payPeriodEnd = String(form.get("payPeriodEnd") || "").trim();

    // Fetch employee email from users table
    const { data: userData, error: userErr } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    if (userErr) {
      return NextResponse.json({ error: `Failed to look up employee: ${userErr.message}` }, { status: 500 });
    }
    if (!userData?.email) {
      return NextResponse.json({ error: "No email address found for this employee." }, { status: 404 });
    }

    const employeeEmail = userData.email as string;
    const pdfBytes = await pdfFile.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfBytes);

    const payPeriodLabel =
      payPeriodStart && payPeriodEnd
        ? `${payPeriodStart} – ${payPeriodEnd}`
        : payDate || "this pay period";

    const subject = `Your Paystub – ${payPeriodLabel}`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);padding:36px 30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:26px;">Your Paystub is Ready</h1>
              <p style="color:#d1fae5;margin:8px 0 0 0;font-size:15px;">Pay period: ${payPeriodLabel}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 30px;">
              <p style="color:#333333;font-size:16px;line-height:1.6;margin:0 0 16px 0;">
                Hello <strong>${employeeName}</strong>,
              </p>
              <p style="color:#333333;font-size:16px;line-height:1.6;margin:0 0 20px 0;">
                Please find your paystub attached for the pay period <strong>${payPeriodLabel}</strong>.
                Keep this document for your records.
              </p>
              <p style="color:#6b7280;font-size:13px;margin-top:32px;padding-top:20px;border-top:1px solid #e5e7eb;">
                This is an automated notification from PDS. If you have any questions about your paystub,
                please contact HR.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const filename = `paystub-${employeeName.replace(/\s+/g, "_")}-${payDate || "recent"}.pdf`;

    const emailResult = await sendEmail({
      to: employeeEmail,
      subject,
      html,
      bcc: ['sebastiancastao379@gmail.com'],
      attachments: [
        {
          filename,
          content: pdfBuffer,
        },
      ],
    });

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error || "Failed to send email." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, messageId: emailResult.messageId });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}
