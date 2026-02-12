import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendEmail } from "@/lib/email";
import { safeDecrypt } from "@/lib/encryption";

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

type Audience = "workers" | "all" | "one";

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();

  if (!user || !user.id) {
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

function canManageCodes(role: string | null | undefined) {
  return ["manager", "hr", "exec", "admin"].includes(String(role || ""));
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nl2br(input: string) {
  return escapeHtml(input).replace(/\r?\n/g, "<br/>");
}

function buildCheckinEmailHtml(params: {
  recipientName?: string;
  code: string;
  label?: string | null;
  checkInUrl: string;
}) {
  const { recipientName, code, label, checkInUrl } = params;
  const title = "PDS Employee ID Code";
  const message = recipientName
    ? `Hi ${recipientName},\n\nPlease use the code below to check in today.`
    : "Please use the code below to check in.";
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="font-family: -apple-system, Segoe UI, Arial, sans-serif; color: #111827; background: #f9fafb; margin: 0; padding: 24px;">
    <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;">
      <h2 style="margin: 0 0 12px 0; font-size: 18px;">${escapeHtml(title)}</h2>
      <div style="margin: 0 0 16px 0; color: #374151; line-height: 1.5;">${nl2br(message)}</div>

      <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; background: #f9fafb;">
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">Employee ID code</div>
        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; letter-spacing: 0.25em; font-weight: 700; font-size: 28px; color: #1d4ed8;">
          ${escapeHtml(code)}
        </div>
        ${
          label
            ? `<div style="margin-top: 10px; font-size: 12px; color: #6b7280;">Label: <strong style="color:#111827;">${escapeHtml(
                label
              )}</strong></div>`
            : ""
        }
      </div>

      

      <div style="margin-top: 16px; font-size: 12px; color: #6b7280;">
        If you already checked in today, you can ignore this email.
      </div>
    </div>
  </body>
</html>`.trim();
}

function isValidUuid(id: unknown) {
  if (typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role, email")
      .eq("id", userId)
      .single();

    if (!canManageCodes(userData?.role as any)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const codeId = body.codeId;
    const audience = (body.audience || "workers") as Audience;
    const recipientUserId = body.recipientUserId;

    if (!isValidUuid(codeId)) {
      console.error("Send check-in code 400: Invalid codeId", codeId);
      return NextResponse.json({ error: "Invalid codeId" }, { status: 400 });
    }

    if (audience === "one" && !isValidUuid(recipientUserId)) {
      console.error("Send check-in code 400: recipientUserId missing for audience=one");
      return NextResponse.json(
        { error: "recipientUserId is required for audience=one" },
        { status: 400 }
      );
    }

    const { data: codeRow, error: codeError } = await supabaseAdmin
      .from("checkin_codes")
      .select("id, code, label, is_active, target_user_id")
      .eq("id", codeId)
      .single();

    if (codeError || !codeRow) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    if (!codeRow.is_active) {
      console.error("Send check-in code 400: Code is inactive", codeId);
      return NextResponse.json(
        { error: "Code is inactive" },
        { status: 400 }
      );
    }

    // Personal codes can only be sent to the target user
    if (codeRow.target_user_id && audience !== "one") {
      console.error("Send check-in code 400: Personal code sent with audience", audience, "target_user_id", codeRow.target_user_id);
      return NextResponse.json(
        { error: "This code is assigned to a specific user" },
        { status: 400 }
      );
    }

    const checkInUrl = `${req.nextUrl.origin}/check-in`;
    const subject = "PDS Check-In Code";
    const html = buildCheckinEmailHtml({
      code: String(codeRow.code || ""),
      label: codeRow.label,
      checkInUrl,
    });

    if (audience === "one") {
      if (codeRow.target_user_id && codeRow.target_user_id !== recipientUserId) {
        console.error("Send check-in code 400: Code target_user_id", codeRow.target_user_id, "!= recipientUserId", recipientUserId);
        return NextResponse.json(
          { error: "This code is assigned to a different user" },
          { status: 400 }
        );
      }

      const { data: recipientUser, error: recipientError } = await supabaseAdmin
        .from("users")
        .select("email, is_active")
        .eq("id", recipientUserId)
        .single();

      if (recipientError || !recipientUser?.email || recipientUser.is_active !== true) {
        return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
      }

      const { data: recipientProfile } = await supabaseAdmin
        .from("profiles")
        .select("first_name, last_name")
        .eq("user_id", recipientUserId)
        .single();

      const firstName = recipientProfile?.first_name
        ? safeDecrypt(recipientProfile.first_name)
        : "";
      const lastName = recipientProfile?.last_name
        ? safeDecrypt(recipientProfile.last_name)
        : "";

      const recipientName = [firstName, lastName].filter(Boolean).join(" ").trim();

      const personalizedHtml = buildCheckinEmailHtml({
        recipientName: recipientName || undefined,
        code: String(codeRow.code || ""),
        label: codeRow.label,
        checkInUrl,
      });

      const result = await sendEmail({
        to: recipientUser.email,
        subject,
        html: personalizedHtml,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Failed to send email" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, sentTo: 1 });
    }

    const roleFilter = audience === "workers" ? "worker" : null;
    let usersQuery = supabaseAdmin
      .from("users")
      .select("email, role, is_active")
      .eq("is_active", true);

    if (roleFilter) {
      usersQuery = usersQuery.eq("role", roleFilter as any);
    }

    const { data: recipients, error: recipientsError } = await usersQuery;
    if (recipientsError) {
      return NextResponse.json(
        { error: recipientsError.message },
        { status: 400 }
      );
    }

    const senderEmail = String(userData?.email || "").trim();
    const senderTo = senderEmail || "service@pdsportal.site";

    const bcc = Array.from(
      new Set(
        (recipients || [])
          .map((u: any) => String(u.email || "").trim())
          .filter(Boolean)
          .filter((email) => email.toLowerCase() !== senderTo.toLowerCase())
      )
    );

    if (bcc.length === 0) {
      console.error("Send check-in code 400: No recipients found. audience:", audience, "senderTo:", senderTo, "total users:", (recipients || []).length);
      return NextResponse.json(
        { error: "No recipients found for the selected audience" },
        { status: 400 }
      );
    }

    const result = await sendEmail({
      to: senderTo,
      bcc,
      subject,
      html,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, sentTo: bcc.length });
  } catch (err) {
    console.error("Error sending check-in code email:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
