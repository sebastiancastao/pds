import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Attachment } from "resend";
import { sendEmail } from "@/lib/email";
import {
  formatBytes,
  sanitizeAttachmentFilename,
  validateResendAttachments,
} from "@/lib/email-attachments";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const allowedSenderRoles = new Set(["admin", "exec", "hr", "hr_admin", "manager", "supervisor", "supervisor3"]);
const DEFAULT_HIDDEN_RECIPIENT_TO = "service@pdsportal.site";
const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_DELAY_MS = 300;
const MIN_BATCH_DELAY_MS = 200;
const MAX_BATCH_DELAY_MS = 5000;
const DEFAULT_ATTACHMENT_BATCH_SIZE = 15;
const DEFAULT_MAX_RECIPIENTS_PER_REQUEST = 1000;
const ABSOLUTE_MAX_RECIPIENTS_PER_REQUEST = 2000;
const DEFAULT_RATE_LIMIT_RETRY_COUNT = 3;
const MAX_RATE_LIMIT_RETRY_COUNT = 5;
const DEFAULT_RATE_LIMIT_RETRY_BASE_DELAY_MS = 1200;
const MIN_RATE_LIMIT_RETRY_BASE_DELAY_MS = 250;
const MAX_RATE_LIMIT_RETRY_BASE_DELAY_MS = 20000;

type Audience = "manual" | "role" | "region" | "all";
type BodyFormat = "html" | "text";
type RecipientMode = "standard" | "hidden_bcc";

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

function isProviderInternalError(errorName?: string, message?: string) {
  const name = String(errorName || "").toLowerCase();
  const text = String(message || "").toLowerCase();
  return (
    name === "application_error" ||
    name === "internal_server_error" ||
    text.includes("internal server error") ||
    text.includes("unable to process your request right now")
  );
}

async function sendEmailWithRetries(
  payload: Parameters<typeof sendEmail>[0],
  rateLimitRetryCount: number,
  retryBaseDelayMs: number
) {
  let result: Awaited<ReturnType<typeof sendEmail>> | null = null;

  for (let attempt = 0; attempt <= rateLimitRetryCount; attempt += 1) {
    result = await sendEmail(payload);

    if (result.success) {
      return result;
    }

    const retryable =
      isRateLimitError(result.error) ||
      isProviderInternalError(result.errorName, result.error);

    if (!retryable || attempt >= rateLimitRetryCount) {
      return result;
    }

    await sleep(getRetryDelayMs(retryBaseDelayMs, attempt));
  }

  return result;
}

function normalizeRole(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "execs" ? "exec" : normalized;
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
    const requesterRole = normalizeRole(requester?.role);
    if (!allowedSenderRoles.has(requesterRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await req.formData();
    const audience = String(form.get("audience") || "manual").trim().toLowerCase() as Audience;
    const subject = String(form.get("subject") || "").trim();
    const body = String(form.get("body") || "");
    const bodyFormat = String(form.get("bodyFormat") || "text").trim().toLowerCase() as BodyFormat;
    const bccRaw = String(form.get("bcc") || "");
    const recipientMode = String(form.get("recipientMode") || "standard").trim().toLowerCase() as RecipientMode;
    const confirm = String(form.get("confirm") || "").toLowerCase() === "true";

    if (!["manual", "role", "region", "all"].includes(audience)) {
      return NextResponse.json({ error: "Invalid audience" }, { status: 400 });
    }
    if (!["standard", "hidden_bcc"].includes(recipientMode)) {
      return NextResponse.json({ error: "Invalid recipientMode" }, { status: 400 });
    }
    if (recipientMode === "hidden_bcc" && audience !== "manual") {
      return NextResponse.json(
        { error: "Hidden BCC delivery is only supported for manual sends." },
        { status: 400 }
      );
    }
    if ((requesterRole === "manager" || requesterRole === "supervisor" || requesterRole === "supervisor3") && audience !== "manual") {
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
      if (!to.length && recipientMode !== "hidden_bcc") {
        return NextResponse.json({ error: "Recipient list is required." }, { status: 400 });
      }
    } else if (audience === "role") {
      const role = normalizeRole(form.get("role"));
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
    let hiddenRecipientTo = to;
    let primaryRecipients = to;
    let oneTimeBcc = parseEmailList(bccRaw).filter(isValidEmail);

    if (recipientMode === "hidden_bcc") {
      hiddenRecipientTo = to.length > 0 ? to : [DEFAULT_HIDDEN_RECIPIENT_TO];
      primaryRecipients = parseEmailList(bccRaw).filter(isValidEmail);
      oneTimeBcc = [];

      const hiddenRecipientSet = new Set(hiddenRecipientTo);
      primaryRecipients = primaryRecipients.filter((email) => !hiddenRecipientSet.has(email));
      if (!primaryRecipients.length) {
        return NextResponse.json({ error: "No valid team recipients found." }, { status: 400 });
      }
    } else {
      const primaryRecipientSet = new Set(primaryRecipients);
      oneTimeBcc = oneTimeBcc.filter((email) => !primaryRecipientSet.has(email));
      if (!primaryRecipients.length && !oneTimeBcc.length) {
        return NextResponse.json({ error: "No valid recipients found." }, { status: 400 });
      }
    }

    const recipientCount =
      recipientMode === "hidden_bcc"
        ? primaryRecipients.length
        : primaryRecipients.length + oneTimeBcc.length;

    const maxRecipientsPerRequest = resolveIntSetting(
      process.env.MAX_BULK_EMAIL_RECIPIENTS || process.env.MAX_RECIPIENTS_PER_REQUEST,
      DEFAULT_MAX_RECIPIENTS_PER_REQUEST,
      1,
      ABSOLUTE_MAX_RECIPIENTS_PER_REQUEST
    );
    if (recipientCount > maxRecipientsPerRequest) {
      return NextResponse.json(
        { error: `Too many recipients. Max allowed is ${maxRecipientsPerRequest} per request.` },
        { status: 400 }
      );
    }

    const isBulk = audience !== "manual" || recipientCount > 25;
    if (isBulk && !confirm) {
      return NextResponse.json(
        { error: "Bulk sending requires explicit confirmation." },
        { status: 400 }
      );
    }

    const files = form.getAll("attachments").filter((v) => v instanceof File) as File[];
    const attachmentValidation = validateResendAttachments(files);
    if (!attachmentValidation.ok) {
      return NextResponse.json({ error: attachmentValidation.error }, { status: 400 });
    }

    const attachments: Attachment[] = [];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      attachments.push({
        filename: file.name,
        content: Buffer.from(bytes),
        contentType: file.type || undefined,
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
    const attachmentBatchSize = resolveIntSetting(
      process.env.EMAIL_ATTACHMENT_BATCH_SIZE,
      DEFAULT_ATTACHMENT_BATCH_SIZE,
      MIN_BATCH_SIZE,
      MAX_BATCH_SIZE
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
    const effectiveBatchSize = attachments.length > 0
      ? recipientMode === "hidden_bcc"
        ? 1
        : Math.min(batchSize, attachmentBatchSize)
      : batchSize;
    const batches = chunkArray(primaryRecipients, effectiveBatchSize);
    const directRecipientAttachmentMode = attachments.length > 0 && recipientMode === "hidden_bcc";

    let sentCount = 0;
    const messageIds: string[] = [];
    const failedRecipients: string[] = [];
    const failureDetails: Array<{ recipient: string; error?: string; errorName?: string }> = [];
    const basePayload = {
      subject,
      html,
      from: process.env.RESEND_FROM || undefined,
      attachments: attachments.length ? attachments : undefined,
      skipGlobalBcc: attachments.length > 0,
    };

    if (attachments.length > 0) {
      console.log("[admin/send-email] Attachments prepared:", {
        count: attachments.length,
        totalBytes: attachmentValidation.totalBytes,
        totalBytesFormatted: formatBytes(attachmentValidation.totalBytes),
        estimatedEncodedBytes: attachmentValidation.estimatedEncodedBytes,
        estimatedEncodedBytesFormatted: formatBytes(attachmentValidation.estimatedEncodedBytes),
        batchSize: effectiveBatchSize,
        deliveryStrategy: directRecipientAttachmentMode ? "direct_single_recipient" : "batch",
        contentTypes: files.map((file) => file.type || "(empty)"),
        filenames: files.map((file) => file.name),
        sanitizedFilenames: files.map((file) => sanitizeAttachmentFilename(file.name)),
      });
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const result = await sendEmailWithRetries(
        {
          ...basePayload,
          to:
            directRecipientAttachmentMode
              ? batch
              : recipientMode === "hidden_bcc"
                ? hiddenRecipientTo
                : batch,
          bcc:
            directRecipientAttachmentMode
              ? undefined
              : recipientMode === "hidden_bcc"
                ? batch
                : i === 0 && oneTimeBcc.length > 0
                  ? oneTimeBcc
                  : undefined,
        },
        rateLimitRetryCount,
        retryBaseDelayMs
      );

      if (!result?.success) {
        failedRecipients.push(...batch);
        for (const recipient of batch) {
          failureDetails.push({
            recipient,
            errorName: result?.errorName,
            error: result?.error,
          });
        }

        console.error("[admin/send-email] Batch send failed:", {
          batchNumber: i + 1,
          batchCount: batches.length,
          batchRecipients: batch.length,
          batchTargets: batch,
          recipientMode: directRecipientAttachmentMode ? "direct_single_recipient" : recipientMode,
          attachments: attachments.length,
          attachmentBytes: attachmentValidation.totalBytes,
          estimatedEncodedBytes: attachmentValidation.estimatedEncodedBytes,
          errorName: result?.errorName,
          error: result?.error,
        });
        continue;
      }

      sentCount +=
        directRecipientAttachmentMode || recipientMode === "hidden_bcc"
          ? batch.length
          : batch.length + (i === 0 ? oneTimeBcc.length : 0);
      if (result.messageId) messageIds.push(result.messageId);

      if (i < batches.length - 1 && batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }

    if (failedRecipients.length > 0) {
      const attachmentHint = attachments.length > 0
        ? ` Attachment payload: ${attachments.length} file(s), ${formatBytes(attachmentValidation.totalBytes)} raw, ${formatBytes(attachmentValidation.estimatedEncodedBytes)} estimated after encoding.`
        : "";

      if (sentCount === 0) {
        return NextResponse.json(
          {
            error: `No emails were sent.${attachmentHint}`,
            sentCount,
            attemptedRecipients: recipientCount,
            failureCount: failedRecipients.length,
            failedRecipients,
            failureDetails,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        partial: true,
        messageId: messageIds[0],
        messageIds,
        recipientCount: sentCount,
        attemptedRecipients: recipientCount,
        failureCount: failedRecipients.length,
        failedRecipients,
        failureDetails,
        batches: batches.length,
      });
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
