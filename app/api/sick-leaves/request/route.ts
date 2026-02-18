import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { safeDecrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email";

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

const REQUEST_RECIPIENTS = [
  "sebastiancastao379@gmail.com",
  "jenvillar@1pds.net",
];

type UserWithProfile = {
  id: string;
  email: string | null;
  profiles:
    | {
        first_name: string | null;
        last_name: string | null;
      }
    | Array<{
        first_name: string | null;
        last_name: string | null;
      }>
    | null;
};

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : undefined;

    if (token) {
      const { data: tokenUser } = await supabaseAnon.auth.getUser(token);
      if (tokenUser?.user?.id) {
        user = { id: tokenUser.user.id } as any;
      }
    }
  }

  return user?.id || null;
}

function parseDateInput(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function safeDecryptName(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return safeDecrypt(raw).trim();
  } catch {
    return raw;
  }
}

function buildRequestEmailHtml(params: {
  employeeName: string;
  employeeEmail: string;
  sickDate: string;
  durationHours: number;
}) {
  const dateLabel = new Date(`${params.sickDate}T00:00:00Z`).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }
  );
  const requestedAt = new Date().toLocaleString("en-US");

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Sick Leave Request</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #111827;">
    <h2 style="margin: 0 0 12px 0;">Employee Sick Leave Request</h2>
    <p style="margin: 0 0 16px 0;">A worker submitted a sick leave request from the employee portal.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      <tr>
        <td style="padding: 6px 10px; color: #374151;">Employee</td>
        <td style="padding: 6px 10px; font-weight: 600;">${params.employeeName}</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; color: #374151;">Email</td>
        <td style="padding: 6px 10px; font-weight: 600;">${params.employeeEmail || "Unknown"}</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; color: #374151;">Date</td>
        <td style="padding: 6px 10px; font-weight: 600;">${dateLabel}</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; color: #374151;">Requested Hours</td>
        <td style="padding: 6px 10px; font-weight: 600;">${params.durationHours.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 6px 10px; color: #374151;">Requested At</td>
        <td style="padding: 6px 10px; font-weight: 600;">${requestedAt}</td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sickDate = parseDateInput(body?.date);
    const durationHoursRaw = Number(body?.hours);
    const durationHours = Number(durationHoursRaw.toFixed(2));

    if (!sickDate) {
      return NextResponse.json(
        { error: "A valid sick leave date is required" },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(durationHours) ||
      durationHours <= 0 ||
      durationHours > 24
    ) {
      return NextResponse.json(
        { error: "Hours must be a number greater than 0 and at most 24" },
        { status: 400 }
      );
    }

    const { data: userRow, error: userError } = await supabaseAdmin
      .from("users")
      .select(
        `
          id,
          email,
          profiles (
            first_name,
            last_name
          )
        `
      )
      .eq("id", authenticatedUserId)
      .maybeSingle();

    if (userError) {
      return NextResponse.json(
        { error: userError.message || "Failed to load employee profile" },
        { status: 500 }
      );
    }

    const typedUser = (userRow || null) as UserWithProfile | null;
    const profile = Array.isArray(typedUser?.profiles)
      ? typedUser?.profiles[0]
      : typedUser?.profiles;
    const firstName = safeDecryptName(profile?.first_name);
    const lastName = safeDecryptName(profile?.last_name);
    const employeeEmail = String(typedUser?.email || "").trim();
    const employeeName = `${firstName} ${lastName}`.trim() || employeeEmail || "Unknown Employee";

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("sick_leaves")
      .insert({
        user_id: authenticatedUserId,
        start_date: sickDate,
        end_date: sickDate,
        duration_hours: durationHours,
        status: "pending",
        reason: "Employee sick leave request from /employees profile page",
      })
      .select(
        "id, start_date, end_date, duration_hours, status, reason, approved_at, approved_by, created_at"
      )
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message || "Failed to save sick leave request" },
        { status: 500 }
      );
    }

    const emailSubject = `Sick Leave Request - ${employeeName}`;
    const emailHtml = buildRequestEmailHtml({
      employeeName,
      employeeEmail,
      sickDate,
      durationHours,
    });

    const emailResult = await sendEmail({
      to: REQUEST_RECIPIENTS,
      subject: emailSubject,
      html: emailHtml,
    });

    if (!emailResult.success) {
      return NextResponse.json(
        {
          error:
            emailResult.error ||
            "Request was saved but notification email could not be sent",
          record: inserted,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        message: "Sick leave request submitted",
        record: inserted,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("[SICK LEAVE REQUEST][POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
