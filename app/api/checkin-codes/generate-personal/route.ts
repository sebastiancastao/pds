import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendEmail } from "@/lib/email";
import { safeDecrypt } from "@/lib/encryption";
import { deriveCheckinInitials, generateCheckinCode } from "@/lib/checkin-code";

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

type Audience = "all" | "one";

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

async function listAllAuthUsers(): Promise<Map<string, string>> {
  const authMap = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    const users = data?.users || [];
    for (const u of users as any[]) {
      if (!u?.id) continue;
      const email = String(u.email || "").trim();
      if (email) authMap.set(String(u.id), email);
    }
    if (users.length < perPage) break;
  }
  return authMap;
}

function escapeHtml(input: string) {
  return String(input || "")
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
  const title = "PDS Check-In Code";
  const message = recipientName
    ? `Hi ${recipientName},\n\nPlease use the code below to check in today.`
    : "Please use the code below to check in today.";

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
      <div style="margin: 0 0 16px 0; color: #374151; line-height: 1.5;">${nl2br(
        message
      )}</div>

      <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; background: #f9fafb;">
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">Check-in code</div>
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

      <div style="margin-top: 16px;">
        <a href="${escapeHtml(
          checkInUrl
        )}" style="display:inline-block; background:#1d4ed8; color:#ffffff; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:600;">
          Open Check-In Page
        </a>
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

async function generateUniqueCodes(params: {
  recipients: Array<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  }>;
  existingActiveCodes: Set<string>;
}) {
  const { recipients, existingActiveCodes } = params;
  const codes: string[] = [];
  const used = new Set<string>();

  const maxAttemptsPerRecipient = 10000;

  for (const recipient of recipients) {
    const initials = deriveCheckinInitials({
      firstName: recipient.first_name,
      lastName: recipient.last_name,
      email: recipient.email,
      fallback: recipient.id,
    });

    let attempts = 0;
    let code = "";
    while (attempts < maxAttemptsPerRecipient) {
      attempts += 1;
      code = generateCheckinCode(initials);
      if (existingActiveCodes.has(code)) continue;
      if (used.has(code)) continue;
      break;
    }

    if (!code || existingActiveCodes.has(code) || used.has(code)) {
      throw new Error("Failed to generate unique codes");
    }

    used.add(code);
    codes.push(code);
  }

  return codes;
}

async function chunkedAllSettled<T>(
  tasks: Array<() => Promise<T>>,
  chunkSize: number
) {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const chunk = tasks.slice(i, i + chunkSize).map((t) => t());
    const r = await Promise.allSettled(chunk);
    results.push(...r);
  }
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (!canManageCodes(userData?.role as any)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const audience = (body.audience || "all") as Audience;
    const recipientUserId = body.recipientUserId;
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;

    if (audience === "one" && !isValidUuid(recipientUserId)) {
      return NextResponse.json(
        { error: "recipientUserId is required for audience=one" },
        { status: 400 }
      );
    }

    const checkInUrl = `${req.nextUrl.origin}/check-in`;

    let recipients: Array<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
    }> = [];

    const authUsers = await listAllAuthUsers();

    if (audience === "one") {
      if (!authUsers.has(String(recipientUserId))) {
        return NextResponse.json(
          { error: "Recipient does not have an auth account (auth.users)" },
          { status: 400 }
        );
      }

      const { data: u, error: uErr } = await supabaseAdmin
        .from("users")
        .select("id, email, is_active")
        .eq("id", recipientUserId)
        .single();

      if (uErr || !u?.email || u.is_active !== true) {
        return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
      }

      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("first_name, last_name")
        .eq("user_id", u.id)
        .single();

      recipients = [
        {
          id: u.id,
          email: String(u.email || "").trim() || authUsers.get(String(u.id)) || "",
          first_name: p?.first_name ? safeDecrypt(p.first_name) : "",
          last_name: p?.last_name ? safeDecrypt(p.last_name) : "",
        },
      ];
    } else {
      const { data: users, error: usersErr } = await supabaseAdmin
        .from("users")
        .select("id, email, is_active")
        .eq("is_active", true)
        .order("email", { ascending: true });

      if (usersErr) {
        return NextResponse.json({ error: usersErr.message }, { status: 400 });
      }

      const userIds = (users || [])
        .map((u: any) => String(u.id))
        .filter((id: string) => authUsers.has(id));

      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", userIds);

      const profileMap = new Map(
        (profiles || []).map((p: any) => [
          p.user_id,
          {
            first_name: p.first_name ? safeDecrypt(p.first_name) : "",
            last_name: p.last_name ? safeDecrypt(p.last_name) : "",
          },
        ])
      );

      recipients = (users || [])
        .filter((u: any) => Boolean(u.email))
        .filter((u: any) => authUsers.has(String(u.id)))
        .map((u: any) => {
          const profile = profileMap.get(u.id);
          return {
            id: u.id,
            email: String(u.email || "").trim() || authUsers.get(String(u.id)) || "",
            first_name: profile?.first_name || "",
            last_name: profile?.last_name || "",
          };
        });
    }

    const validRecipients = recipients.filter((r) => r.email && authUsers.has(String(r.id)));
    const skippedCount = recipients.length - validRecipients.length;

    if (validRecipients.length === 0) {
      return NextResponse.json(
        { error: "No recipients found (must exist in auth.users and have email)" },
        { status: 400 }
      );
    }

    // Ensure only one active personal code per user by deactivating previous personal codes
    const deactivateChunkSize = 200;
    for (let i = 0; i < validRecipients.length; i += deactivateChunkSize) {
      const chunkIds = validRecipients.slice(i, i + deactivateChunkSize).map((r) => r.id);
      const { error: deactivateError } = await supabaseAdmin
        .from("checkin_codes")
        .update({ is_active: false })
        .in("target_user_id", chunkIds as any)
        .eq("is_active", true);

      if (deactivateError) {
        console.error("Error deactivating previous personal codes:", deactivateError);
      }
    }

    const { data: existingCodes } = await supabaseAdmin
      .from("checkin_codes")
      .select("code")
      .eq("is_active", true);

    const existingActiveCodes = new Set(
      (existingCodes || []).map((r: any) => String(r.code))
    );

    const codes = await generateUniqueCodes({
      recipients: validRecipients,
      existingActiveCodes,
    });

    const rows = validRecipients.map((r, idx) => ({
      code: codes[idx],
      created_by: userId,
      target_user_id: r.id,
      is_active: true,
      label,
    }));

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("checkin_codes")
      .insert(rows as any)
      .select("id, code, target_user_id");

    if (insertError) {
      console.error("Error creating personal check-in codes:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    const subject = "PDS Check-In Code";
    const sendTasks = validRecipients.map((r, idx) => {
      const recipientName = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
      const html = buildCheckinEmailHtml({
        recipientName: recipientName || undefined,
        code: codes[idx],
        label,
        checkInUrl,
      });

      return () =>
        sendEmail({
          to: r.email,
          subject,
          html,
        });
    });

    const results = await chunkedAllSettled(sendTasks, 10);
    const sentCount = results.filter((r) => r.status === "fulfilled" && (r as any).value?.success).length;
    const failedCount = results.length - sentCount;

    return NextResponse.json({
      success: true,
      generatedCount: inserted?.length || validRecipients.length,
      sentCount,
      failedCount,
      skippedCount,
    });
  } catch (err: any) {
    console.error("Error generating personal check-in codes:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
