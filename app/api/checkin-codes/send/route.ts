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

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BATCH_DELAY_MS = 400;
const RETRY_DELAY_MS = 1200;
const DEFAULT_PER_EMAIL_DELAY_MS = 600;
const DB_CHUNK_SIZE = 200;
const DB_RETRY_ATTEMPTS = 3;

type Audience = "all" | "one" | "onboarding_completed" | "onboarding_completed_test";
type Recipient = {
  id: string;
  email: string;
  first_name: string;
};
const ONBOARDING_COMPLETED_TEST_EMAILS = [
  "sebastiancastao379@gmail.com",
  "sebastiancastanosepul@gmail.com",
  "brownseb379@gmail.com",
];

async function getAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

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
  return ["manager", "supervisor", "hr", "exec", "admin"].includes(String(role || ""));
}

function isValidUuid(id: unknown) {
  if (typeof id !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(message?: string) {
  const text = String(message || "").toLowerCase();
  return text.includes("429") || text.includes("rate limit") || text.includes("too many");
}

async function withDbRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const message = String(err?.message || "").toLowerCase();
      const isTransient =
        message.includes("fetch failed") ||
        message.includes("econnreset") ||
        message.includes("etimedout") ||
        message.includes("network");
      if (!isTransient || attempt === DB_RETRY_ATTEMPTS) break;
      await sleep(300 * attempt);
    }
  }
  throw new Error(`DB query failed (${label}): ${lastError?.message || "unknown error"}`);
}

function buildEmailHtml(params: { firstName: string; code: string }) {
  const firstName = params.firstName || "there";
  const code = params.code;

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr>
        <td style="padding:24px 24px 16px 24px;">
          <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.2;">Employee Check-In Code</h1>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#374151;">Hi ${firstName}, use the code below to check in:</p>
          <div style="display:inline-block;padding:12px 16px;border-radius:8px;background:#eef2ff;border:1px solid #c7d2fe;font-size:28px;letter-spacing:4px;font-weight:700;color:#1e3a8a;font-family:monospace;">${code}</div>
          <p style="margin:16px 0 0 0;font-size:13px;line-height:1.5;color:#6b7280;">If you were not expecting this message, please ignore it.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

async function getRecipients(params: {
  audience: Audience;
  recipientUserId?: string;
}): Promise<{ recipients: Recipient[]; skippedCount: number }> {
  const { audience, recipientUserId } = params;

  if (audience === "onboarding_completed_test") {
    const normalizedEmails = ONBOARDING_COMPLETED_TEST_EMAILS.map((e) =>
      String(e || "").trim().toLowerCase()
    ).filter(Boolean);

    const { data: users, error: usersError } = await supabaseAdmin
      .from("users")
      .select("id, email, is_active")
      .in("email", normalizedEmails as any)
      .eq("is_active", true);

    if (usersError) throw usersError;

    const activeUsers = (users || []).filter((u: any) =>
      normalizedEmails.includes(String(u?.email || "").trim().toLowerCase())
    );

    if (activeUsers.length === 0) {
      return { recipients: [], skippedCount: normalizedEmails.length };
    }

    const userIds = activeUsers.map((u: any) => String(u.id));
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("user_id, first_name")
      .in("user_id", userIds as any);

    if (profilesError) throw profilesError;

    const profileByUserId = new Map<string, { first_name: string }>();
    for (const p of profiles || []) {
      profileByUserId.set(String((p as any).user_id), {
        first_name: safeDecrypt(String((p as any).first_name || "").trim()),
      });
    }

    const recipients = activeUsers
      .map((u: any) => ({
        id: String(u.id),
        email: String(u.email || "").trim(),
        first_name: profileByUserId.get(String(u.id))?.first_name || "there",
      }))
      .filter((r: Recipient) => Boolean(r.email));

    const skippedCount = Math.max(0, normalizedEmails.length - recipients.length);
    return { recipients, skippedCount };
  }

  if (audience === "one") {
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, email, is_active")
      .eq("id", recipientUserId)
      .single();

    if (userError || !user || user.is_active !== true) {
      throw new Error("Recipient not found");
    }

    const oneProfileRes = await withDbRetry(
      async () =>
        await supabaseAdmin
          .from("profiles")
          .select("first_name")
          .eq("user_id", user.id)
          .maybeSingle(),
      "profiles:single"
    );

    const profile = (oneProfileRes as any)?.data;

    return {
      recipients: [
        {
          id: String(user.id),
          email: String(user.email || "").trim(),
          first_name: safeDecrypt(String(profile?.first_name || "").trim()),
        },
      ].filter((r) => Boolean(r.email)),
      skippedCount: 0,
    };
  }

  const usersRes = await withDbRetry(
    async () =>
      await supabaseAdmin
        .from("users")
        .select("id, email, is_active")
        .eq("is_active", true)
        .order("email", { ascending: true }),
    "users:list"
  );

  const users = (usersRes as any)?.data;
  const usersError = (usersRes as any)?.error;

  if (usersError) throw usersError;

  const usersWithEmail = (users || []).filter((u: any) => Boolean(String(u.email || "").trim()));
  const userIds = usersWithEmail.map((u: any) => String(u.id));
  if (userIds.length === 0) {
    return { recipients: [], skippedCount: users?.length || 0 };
  }

  const profiles: any[] = [];
  for (let i = 0; i < userIds.length; i += DB_CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + DB_CHUNK_SIZE);
    const profileChunkRes = await withDbRetry(
      async () =>
        await supabaseAdmin
          .from("profiles")
          .select("id, user_id, first_name, onboarding_completed_at")
          .in("user_id", chunk as any),
      "profiles:chunk"
    );
    const chunkError = (profileChunkRes as any)?.error;
    if (chunkError) throw chunkError;
    profiles.push(...(((profileChunkRes as any)?.data || []) as any[]));
  }

  const profileByUserId = new Map<
    string,
    { id: string; first_name: string; workflow_completed: boolean }
  >();
  for (const p of profiles || []) {
    profileByUserId.set(String((p as any).user_id), {
      id: String((p as any).id),
      first_name: safeDecrypt(String((p as any).first_name || "").trim()),
      workflow_completed: Boolean((p as any).onboarding_completed_at),
    });
  }

  let allowedUserIds: Set<string> | null = null;

  if (audience === "onboarding_completed") {
    const profileIds = (profiles || []).map((p: any) => String(p.id));
    const adminCompletedProfileIds = new Set<string>();
    for (let i = 0; i < profileIds.length; i += DB_CHUNK_SIZE) {
      const chunk = profileIds.slice(i, i + DB_CHUNK_SIZE);
      const onboardingRes = await withDbRetry(
        async () =>
          await supabaseAdmin
            .from("vendor_onboarding_status")
            .select("profile_id")
            .in("profile_id", chunk as any)
            .eq("onboarding_completed", true),
        "vendor_onboarding_status:chunk"
      );
      const rows = (onboardingRes as any)?.data;
      const onboardingError = (onboardingRes as any)?.error;

      if (onboardingError) throw onboardingError;

      for (const row of rows || []) {
        if ((row as any)?.profile_id) {
          adminCompletedProfileIds.add(String((row as any).profile_id));
        }
      }
    }

    allowedUserIds = new Set<string>();
    for (const [userId, profile] of profileByUserId.entries()) {
      // "Onboarding completed workflow" includes:
      // 1) workflow finished marker on profiles.onboarding_completed_at, or
      // 2) admin-completed status in vendor_onboarding_status.onboarding_completed.
      if (profile.workflow_completed || adminCompletedProfileIds.has(profile.id)) {
        allowedUserIds.add(userId);
      }
    }
  }

  const recipients = usersWithEmail
    .filter((u: any) => {
      if (!allowedUserIds) return true;
      return allowedUserIds.has(String(u.id));
    })
    .map((u: any) => {
      const profile = profileByUserId.get(String(u.id));
      return {
        id: String(u.id),
        email: String(u.email || "").trim(),
        first_name: profile?.first_name || "",
      };
    })
    .filter((r: Recipient) => Boolean(r.email));

  const skippedCount = Math.max(0, (users?.length || 0) - recipients.length);
  return { recipients, skippedCount };
}

async function getActivePersonalCodeByUserId(
  userIds: string[]
): Promise<Map<string, string>> {
  const personalCodeByUserId = new Map<string, { code: string; createdAt: string }>();
  if (userIds.length === 0) return new Map<string, string>();

  for (let i = 0; i < userIds.length; i += DB_CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + DB_CHUNK_SIZE);
    const codeChunkRes = await withDbRetry(
      async () =>
        await supabaseAdmin
          .from("checkin_codes")
          .select("target_user_id, code, created_at")
          .eq("is_active", true)
          .in("target_user_id", chunk as any),
      "checkin_codes:personal:chunk"
    );
    const chunkError = (codeChunkRes as any)?.error;
    if (chunkError) throw chunkError;

    const rows = (((codeChunkRes as any)?.data || []) as any[]).filter(
      (r: any) => r?.target_user_id && r?.code
    );

    for (const row of rows) {
      const userId = String(row.target_user_id);
      const code = String(row.code);
      const createdAt = String(row.created_at || "");
      const existing = personalCodeByUserId.get(userId);
      if (!existing || new Date(createdAt) > new Date(existing.createdAt)) {
        personalCodeByUserId.set(userId, { code, createdAt });
      }
    }
  }

  return new Map<string, string>(
    Array.from(personalCodeByUserId.entries()).map(([userId, row]) => [userId, row.code])
  );
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: requester } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (!canManageCodes(requester?.role as any)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const audience = String(body?.audience || "all") as Audience;
    const codeId = String(body?.codeId || "").trim();
    const recipientUserId = body?.recipientUserId;

    if (!["all", "one", "onboarding_completed", "onboarding_completed_test"].includes(audience)) {
      return NextResponse.json({ error: "Invalid audience" }, { status: 400 });
    }

    if (!isValidUuid(codeId)) {
      return NextResponse.json({ error: "codeId is required" }, { status: 400 });
    }

    if (audience === "one" && !isValidUuid(recipientUserId)) {
      return NextResponse.json(
        { error: "recipientUserId is required for audience=one" },
        { status: 400 }
      );
    }

    const { data: code, error: codeError } = await supabaseAdmin
      .from("checkin_codes")
      .select("id, code, is_active, target_user_id")
      .eq("id", codeId)
      .maybeSingle();

    if (codeError) {
      return NextResponse.json({ error: codeError.message }, { status: 400 });
    }

    if (!code || !code.is_active) {
      return NextResponse.json({ error: "Code not found or inactive" }, { status: 404 });
    }

    if (audience !== "one" && code.target_user_id) {
      return NextResponse.json(
        { error: "Personal codes can only be sent to one user" },
        { status: 400 }
      );
    }

    if (audience === "one" && code.target_user_id && String(code.target_user_id) !== String(recipientUserId)) {
      return NextResponse.json(
        { error: "This personal code is assigned to another user" },
        { status: 400 }
      );
    }

    const { recipients, skippedCount } = await getRecipients({
      audience,
      recipientUserId: audience === "one" ? String(recipientUserId) : undefined,
    });

    if (recipients.length === 0) {
      return NextResponse.json({ error: "No recipients found" }, { status: 400 });
    }

    const batchSize = Number(process.env.CHECKIN_EMAIL_SEND_BATCH_SIZE || DEFAULT_BATCH_SIZE);
    const batchDelayMs = Number(process.env.CHECKIN_EMAIL_SEND_BATCH_DELAY_MS || DEFAULT_BATCH_DELAY_MS);
    const perEmailDelayMs = Number(
      process.env.CHECKIN_EMAIL_SEND_PER_EMAIL_DELAY_MS || DEFAULT_PER_EMAIL_DELAY_MS
    );
    const resolvedBatchSize = batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
    const chunks = chunkArray(recipients, resolvedBatchSize);
    const personalCodeByUserId =
      audience === "onboarding_completed" || audience === "onboarding_completed_test"
        ? await getActivePersonalCodeByUserId(recipients.map((r) => r.id))
        : null;

    let sentTo = 0;
    const sentUsers: Array<{ userId: string; email: string }> = [];
    const failures: Array<{ userId: string; email: string; error: string }> = [];

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      for (let j = 0; j < chunk.length; j += 1) {
        const recipient = chunk[j];
        let codeToSend = String(code.code);
        if (audience === "onboarding_completed" || audience === "onboarding_completed_test") {
          const personalCode = personalCodeByUserId?.get(recipient.id);
          if (!personalCode) {
            failures.push({
              userId: recipient.id,
              email: recipient.email,
              error: "No active personal code for recipient",
            });
            continue;
          }
          codeToSend = personalCode;
        }

        const subject = "Your Employee Check-In Code";
        const html = buildEmailHtml({
          firstName: recipient.first_name,
          code: codeToSend,
        });

        let result = await sendEmail({
          to: recipient.email,
          subject,
          html,
          from: process.env.RESEND_FROM || undefined,
        });

        if (!result.success && isRateLimitError(result.error)) {
          await sleep(RETRY_DELAY_MS);
          result = await sendEmail({
            to: recipient.email,
            subject,
            html,
            from: process.env.RESEND_FROM || undefined,
          });
        }

        if (!result.success) {
          failures.push({
            userId: recipient.id,
            email: recipient.email,
            error: result.error || "Failed to send",
          });
        } else {
          sentTo += 1;
          sentUsers.push({ userId: recipient.id, email: recipient.email });
        }

        if (j < chunk.length - 1 && perEmailDelayMs > 0) {
          await sleep(perEmailDelayMs);
        }
      }

      if (i < chunks.length - 1 && batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }

    if (sentTo === 0 && failures.length > 0) {
      const firstFailure = failures[0]?.error || "Failed to send all emails";
      return NextResponse.json(
        {
          success: false,
          error: firstFailure,
          sentTo,
          totalRecipients: recipients.length,
          skippedCount,
          failedCount: failures.length,
          failures,
          sentUsers,
          audience,
          batched: true,
          batchSize: batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE,
          batches: chunks.length,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: failures.length === 0,
      sentTo,
      totalRecipients: recipients.length,
      skippedCount,
      failedCount: failures.length,
      failures,
      sentUsers,
      audience,
      batched: true,
      batchSize: resolvedBatchSize,
      perEmailDelayMs: perEmailDelayMs > 0 ? perEmailDelayMs : 0,
      batches: chunks.length,
    });
  } catch (err: any) {
    console.error("Error sending check-in code emails:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
