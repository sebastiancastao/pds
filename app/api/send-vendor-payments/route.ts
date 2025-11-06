import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendEmail } from "@/lib/email";

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
    // Cookie-based session first
    let { data: { user } } = await supabase.auth.getUser();
    // Fallback to Authorization: Bearer <token>
    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    // Only admin/exec can send vendor payment summaries
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = userData?.role as string | undefined;
    if (role !== "admin" && role !== "exec") {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { startDate, endDate, paymentsData, adjustments } = body || {};

    if (!startDate || !endDate) {
      return NextResponse.json({ success: false, error: "startDate and endDate are required" }, { status: 400 });
    }
    if (!paymentsData || typeof paymentsData !== "object") {
      return NextResponse.json({ success: false, error: "paymentsData is required" }, { status: 400 });
    }

    // Aggregate totals per vendor (by email). Shape expected from UI: paymentsData[venue].events[].payments[]
    type VendorTotals = {
      email: string;
      firstName?: string;
      lastName?: string;
      totalPay: number;
      totalHours: number;
      events: Array<{ eventName: string; eventDate: string; pay: number; hours: number }>;
    };

    const vendorByEmail = new Map<string, VendorTotals>();

    for (const venueKey of Object.keys(paymentsData || {})) {
      const venue = paymentsData[venueKey];
      for (const event of venue.events || []) {
        for (const p of event.payments || []) {
          const email = p.email || "";
          if (!email) continue;
          const regularizedPay = Number(p.finalPay ?? p.totalPay ?? 0);
          const hours = Number(p.actualHours ?? 0);
          const existing = vendorByEmail.get(email) || {
            email,
            firstName: p.firstName,
            lastName: p.lastName,
            totalPay: 0,
            totalHours: 0,
            events: [] as VendorTotals["events"],
          };
          existing.totalPay += regularizedPay;
          existing.totalHours += hours;
          existing.events.push({
            eventName: event.eventName,
            eventDate: event.eventDate,
            pay: regularizedPay,
            hours,
          });
          vendorByEmail.set(email, existing);
        }
      }
    }

    const currency = (n: number) => `$${n.toFixed(2)}`;

    let sentCount = 0;
    const recipients: Array<{ email: string; total: number; events: number }> = [];

    for (const [email, info] of vendorByEmail.entries()) {
      // Build a simple HTML summary
      const subject = `PDS Payment Summary ${startDate} to ${endDate}`;
      const html = `
<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #111827;">
    <h2 style="margin: 0 0 10px;">Payment Summary</h2>
    <div style="color:#6b7280; margin-bottom:16px;">Period: ${startDate} – ${endDate}</div>
    <div style="margin-bottom:16px;">Hello ${info.firstName || ""} ${info.lastName || ""}, here is your summary of approved event payments for the selected period.</div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      <thead>
        <tr>
          <th align="left" style="border-bottom:1px solid #e5e7eb; padding:8px 0;">Event</th>
          <th align="left" style="border-bottom:1px solid #e5e7eb; padding:8px 0;">Date</th>
          <th align="right" style="border-bottom:1px solid #e5e7eb; padding:8px 0;">Hours</th>
          <th align="right" style="border-bottom:1px solid #e5e7eb; padding:8px 0;">Pay</th>
        </tr>
      </thead>
      <tbody>
        ${info.events
          .map(
            (ev) => `
        <tr>
          <td style="padding:6px 0;">${ev.eventName}</td>
          <td style="padding:6px 0; color:#6b7280;">${ev.eventDate}</td>
          <td align="right" style="padding:6px 0; color:#111827;">${ev.hours.toFixed(2)}</td>
          <td align="right" style="padding:6px 0; color:#111827;">${currency(ev.pay)}</td>
        </tr>`
          )
          .join("")}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="border-top:1px solid #e5e7eb; padding-top:8px; font-weight:600;">Total</td>
          <td align="right" style="border-top:1px solid #e5e7eb; padding-top:8px; font-weight:600;">${info.totalHours.toFixed(2)}h</td>
          <td align="right" style="border-top:1px solid #e5e7eb; padding-top:8px; font-weight:600;">${currency(info.totalPay)}</td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:16px; color:#6b7280; font-size:13px;">This is an informational summary of event-level gross pay items. Final payroll is processed by ADP after approvals.</div>
  </body>
</html>`;

      const result = await sendEmail({ to: email, subject, html });
      if (result.success) {
        sentCount += 1;
        recipients.push({ email, total: info.totalPay, events: info.events.length });
      }
    }

    return NextResponse.json({ success: true, sentCount, recipients });
  } catch (err: any) {
    console.error("[SEND-VENDOR-PAYMENTS] Error:", err);
    return NextResponse.json({ success: false, error: err.message || "Failed to send vendor payments" }, { status: 500 });
  }
}


