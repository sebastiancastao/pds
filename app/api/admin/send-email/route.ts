import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Attachment } from "resend";
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

const allowedSenderRoles = new Set(["admin", "exec", "hr", "hr_admin", "manager", "supervisor"]);
const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_DELAY_MS = 300;
const MIN_BATCH_DELAY_MS = 200;
const MAX_BATCH_DELAY_MS = 5000;
const DEFAULT_MAX_RECIPIENTS_PER_REQUEST = 1000;
const ABSOLUTE_MAX_RECIPIENTS_PER_REQUEST = 2000;
const DEFAULT_RATE_LIMIT_RETRY_COUNT = 3;
const MAX_RATE_LIMIT_RETRY_COUNT = 5;
const DEFAULT_RATE_LIMIT_RETRY_BASE_DELAY_MS = 1200;
const MIN_RATE_LIMIT_RETRY_BASE_DELAY_MS = 250;
const MAX_RATE_LIMIT_RETRY_BASE_DELAY_MS = 20000;

type Audience = "manual" | "role" | "region" | "all";
type BodyFormat = "html" | "text";

function parseEmailList(value: string): string[] {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,;]+/g)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveIntSetting(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.min(max, Math.max(min, normalized));
}

function getRetryDelayMs(baseDelayMs: number, attempt: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return exponential + jitter;
}

function isRateLimitError(message?: string) {
  const text = String(message || "").toLowerCase();
  return text.includes("429") || text.includes("rate limit") || text.includes("too many");
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
    if (!tokenErr && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: requester, error: requesterErr } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (requesterErr) {
      return NextResponse.json({ error: requesterErr.message }, { status: 500 });
    }
    const requesterRole = String(requester?.role || "").trim().toLowerCase();
    if (!allowedSenderRoles.has(requesterRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await req.formData();
    const audience = String(form.get("audience") || "manual").trim().toLowerCase() as Audience;
    const subject = String(form.get("subject") || "").trim();
    const body = String(form.get("body") || "");
    const bodyFormat = String(form.get("bodyFormat") || "text").trim().toLowerCase() as BodyFormat;
    const ccRaw = String(form.get("cc") || "");
    const bccRaw = String(form.get("bcc") || "");
    const confirm = String(form.get("confirm") || "").toLowerCase() === "true";

    if (!["manual", "role", "region", "all"].includes(audience)) {
      return NextResponse.json({ error: "Invalid audience" }, { status: 400 });
    }
    if ((requesterRole === "manager" || requesterRole === "supervisor") && audience !== "manual") {
      return NextResponse.json(
        { error: "Managers can only send to manual recipient lists." },
        { status: 403 }
      );
    }
    if (!subject) return NextResponse.json({ error: "Subject is required." }, { status: 400 });
    if (!body.trim()) return NextResponse.json({ error: "Body is required." }, { status: 400 });
    if (!["html", "text"].includes(bodyFormat)) {
      return NextResponse.json({ error: "Invalid bodyFormat" }, { status: 400 });
    }

    let to: string[] = [];
    if (audience === "manual") {
      to = parseEmailList(String(form.get("to") || ""));
      if (!to.length) {
        return NextResponse.json({ error: "Recipient list is required." }, { status: 400 });
      }
    } else if (audience === "role") {
      const role = String(form.get("role") || "").trim().toLowerCase();
      if (!role) {
        return NextResponse.json({ error: "Role is required for audience=role." }, { status: 400 });
      }
      const { data: usersByRole, error: usersErr } = await supabaseAdmin
        .from("users")
        .select("email")
        .eq("role", role);
      if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
      to = parseEmailList((usersByRole || []).map((u: any) => u.email || "").join(","));
    } else if (audience === "region") {
      const regionId = String(form.get("region_id") || "").trim();
      if (!regionId) {
        return NextResponse.json({ error: "region_id is required for audience=region." }, { status: 400 });
      }
      // Get users whose profile is linked to this region
      const { data: usersByRegion, error: usersErr } = await supabaseAdmin
        .from("users")
        .select("email, profiles!inner(region_id)")
        .eq("profiles.region_id", regionId);
      if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
      to = parseEmailList((usersByRegion || []).map((u: any) => u.email || "").join(","));
    } else {
      const { data: allUsers, error: usersErr } = await supabaseAdmin
        .from("users")
        .select("email");
      if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
      to = parseEmailList((allUsers || []).map((u: any) => u.email || "").join(","));
    }

    to = to.filter(isValidEmail);
    const cc = parseEmailList(ccRaw).filter(isValidEmail);
    const bcc = parseEmailList(bccRaw).filter(isValidEmail);

    if (!to.length) {
      return NextResponse.json({ error: "No valid recipients found." }, { status: 400 });
    }
    const maxRecipientsPerRequest = resolveIntSetting(
      process.env.MAX_BULK_EMAIL_RECIPIENTS || process.env.MAX_RECIPIENTS_PER_REQUEST,
      DEFAULT_MAX_RECIPIENTS_PER_REQUEST,
      1,
      ABSOLUTE_MAX_RECIPIENTS_PER_REQUEST
    );
    if (to.length > maxRecipientsPerRequest) {
      return NextResponse.json(
        { error: `Too many recipients. Max allowed is ${maxRecipientsPerRequest} per request.` },
        { status: 400 }
      );
    }

    const isBulk = audience !== "manual" || to.length > 25;
    if (isBulk && !confirm) {
      return NextResponse.json(
        { error: "Bulk sending requires explicit confirmation." },
        { status: 400 }
      );
    }

    const files = form.getAll("attachments").filter((v) => v instanceof File) as File[];
    const attachments: Attachment[] = [];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const content = Buffer.from(bytes).toString("base64");
      attachments.push({
        filename: file.name,
        content,
      } as Attachment);
    }

    const html =
      bodyFormat === "html"
        ? body
        : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(body)}</pre>`;

    const batchSize = resolveIntSetting(
      process.env.EMAIL_SEND_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MIN_BATCH_SIZE,
      MAX_BATCH_SIZE
    );
    const batchDelayMs = resolveIntSetting(
      process.env.EMAIL_SEND_BATCH_DELAY_MS,
      DEFAULT_BATCH_DELAY_MS,
      MIN_BATCH_DELAY_MS,
      MAX_BATCH_DELAY_MS
    );
    const rateLimitRetryCount = resolveIntSetting(
      process.env.EMAIL_SEND_RATE_LIMIT_RETRY_COUNT,
      DEFAULT_RATE_LIMIT_RETRY_COUNT,
      0,
      MAX_RATE_LIMIT_RETRY_COUNT
    );
    const retryBaseDelayMs = resolveIntSetting(
      process.env.EMAIL_SEND_RATE_LIMIT_RETRY_BASE_DELAY_MS,
      DEFAULT_RATE_LIMIT_RETRY_BASE_DELAY_MS,
      MIN_RATE_LIMIT_RETRY_BASE_DELAY_MS,
      MAX_RATE_LIMIT_RETRY_BASE_DELAY_MS
    );
    const batches = chunkArray(to, batchSize);

    let sentCount = 0;
    const messageIds: string[] = [];
    const basePayload = {
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject,
      html,
      from: process.env.RESEND_FROM || undefined,
      attachments: attachments.length ? attachments : undefined,
    };

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      let result: Awaited<ReturnType<typeof sendEmail>> | null = null;

      for (let attempt = 0; attempt <= rateLimitRetryCount; attempt += 1) {
        result = await sendEmail({
          ...basePayload,
          to: batch,
        });

        if (result.success) {
          break;
        }

        if (!isRateLimitError(result.error) || attempt >= rateLimitRetryCount) {
          break;
        }

        await sleep(getRetryDelayMs(retryBaseDelayMs, attempt));
      }

      if (!result?.success) {
        return NextResponse.json(
          {
            error: result?.error || "Failed to send email.",
            sentCount,
            attemptedRecipients: to.length,
          },
          { status: 500 }
        );
      }

      sentCount += batch.length;
      if (result.messageId) messageIds.push(result.messageId);

      if (i < batches.length - 1 && batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }

    return NextResponse.json({
      success: true,
      messageId: messageIds[0],
      messageIds,
      recipientCount: sentCount,
      batches: batches.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unhandled server error" }, { status: 500 });
  }
}
