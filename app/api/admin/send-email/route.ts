import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Attachment } from "resend";
import { sendEmail } from "@/lib/email";
import { getVenueBccEmails } from "@/lib/venue-bcc";
import { parseEmailInput } from "@/lib/email-list";

export const runtime = "nodejs";
// A 5,600-recipient blast is ~115 sequential provider calls plus throttle
// delays, which is far past the platform default. The send loop also stops
// itself before this limit (see SEND_TIME_BUDGET_MS) so it can still respond.
export const maxDuration = 300;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const allowedSenderRoles = new Set(["admin", "exec", "hr", "hr_admin", "manager", "supervisor", "supervisor3"]);
const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_DELAY_MS = 300;
const MIN_BATCH_DELAY_MS = 200;
const MAX_BATCH_DELAY_MS = 5000;
const DEFAULT_MAX_RECIPIENTS_PER_REQUEST = 5600;
const ABSOLUTE_MAX_RECIPIENTS_PER_REQUEST = 5600;
const DEFAULT_RATE_LIMIT_RETRY_COUNT = 3;
const MAX_RATE_LIMIT_RETRY_COUNT = 5;
const DEFAULT_RATE_LIMIT_RETRY_BASE_DELAY_MS = 1200;
const MIN_RATE_LIMIT_RETRY_BASE_DELAY_MS = 250;
const MAX_RATE_LIMIT_RETRY_BASE_DELAY_MS = 20000;
// Stop starting new batches after this long so the response is still returned
// (with the unsent addresses listed) instead of the function being killed.
const SEND_TIME_BUDGET_MS = 270_000;
// Give up on the rest of the list after this many batches in a row deliver
// nothing, which points at a systemic problem (bad key, unverified domain).
const MAX_CONSECUTIVE_FAILED_BATCHES = 3;
// When a batch is rejected for a bad address, it is split in half repeatedly
// to isolate the offender. This caps how many splits one request may spend.
const MAX_ISOLATION_SPLITS = 60;

type Audience = "manual" | "role" | "region" | "all";
type BodyFormat = "html" | "text";

// Always BCC'd on every email sent from /admin-email-team
const ALWAYS_BCC = ["jenvillar@1pds.net"];

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

// The provider rejects a whole send when any single address in it is
// malformed, and reports that as a 422 validation error about the recipients.
function isRecipientValidationError(message?: string) {
  const text = String(message || "").toLowerCase();
  if (isRateLimitError(text)) return false;
  return (
    text.includes("422") ||
    /invalid[^.]*(email|address|recipient|`?(to|bcc|cc)`? field)/.test(text) ||
    /email address[^.]*(format|valid)/.test(text)
  );
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
    const bccRaw = String(form.get("bcc") || "");
    const venue = String(form.get("venue") || "").trim();
    const confirm = String(form.get("confirm") || "").toLowerCase() === "true";
    const bccMode = String(form.get("bcc_mode") || "").toLowerCase() === "true";
    const eventId = String(form.get("eventId") || "").trim();
    const eventName = String(form.get("eventName") || "").trim();
    const eventDate = String(form.get("eventDate") || "").trim();

    if (!["manual", "role", "region", "all"].includes(audience)) {
      return NextResponse.json({ error: "Invalid audience" }, { status: 400 });
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

    // Entries that looked like addresses but were malformed. They are skipped
    // (never sent to the provider) and reported back to the caller.
    const skippedInvalid = new Set<string>();
    const takeValid = (parsed: { valid: string[]; invalid: string[] }) => {
      parsed.invalid.forEach((entry) => skippedInvalid.add(entry));
      return parsed.valid;
    };

    let to: string[] = [];
    if (audience === "manual") {
      to = takeValid(parseEmailInput(String(form.get("to") || "")));
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
      to = takeValid(parseEmailInput((usersByRole || []).map((u: any) => u.email || "").join(",")));
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
      to = takeValid(parseEmailInput((usersByRegion || []).map((u: any) => u.email || "").join(",")));
    } else {
      const { data: allUsers, error: usersErr } = await supabaseAdmin
        .from("users")
        .select("email");
      if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 });
      to = takeValid(parseEmailInput((allUsers || []).map((u: any) => u.email || "").join(",")));
    }

    const bcc = takeValid(parseEmailInput(bccRaw));

    // A manual send may carry everyone in BCC and leave "To" empty.
    if (!to.length && !(audience === "manual" && bcc.length)) {
      const skippedPreview = Array.from(skippedInvalid).slice(0, 5).join(", ");
      return NextResponse.json(
        {
          error: skippedInvalid.size
            ? `No valid email addresses found. Check these entries: ${skippedPreview}${skippedInvalid.size > 5 ? ", ..." : ""}`
            : audience === "manual"
              ? "Recipient list is required."
              : "No valid recipients found.",
          skippedInvalid: Array.from(skippedInvalid),
        },
        { status: 400 }
      );
    }
    const maxRecipientsPerRequest = resolveIntSetting(
      process.env.MAX_BULK_EMAIL_RECIPIENTS || process.env.MAX_RECIPIENTS_PER_REQUEST,
      DEFAULT_MAX_RECIPIENTS_PER_REQUEST,
      1,
      ABSOLUTE_MAX_RECIPIENTS_PER_REQUEST
    );
    // Everyone ends up hidden in BCC, so the cap applies to To and BCC together.
    const requestedRecipientCount = new Set([...to, ...bcc]).size;
    if (requestedRecipientCount > maxRecipientsPerRequest) {
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

    const bodyHtml =
      bodyFormat === "html"
        ? body
        : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(body)}</pre>`;

    // When the send is tied to a specific event, prepend a header that links the
    // event name to its dashboard so recipients can jump straight to the event.
    let html = bodyHtml;
    if (eventId && eventName) {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://pds-murex.vercel.app").replace(/\/+$/, "");
      const eventUrl = `${appUrl}/event-dashboard/${encodeURIComponent(eventId)}`;
      const dateLine = eventDate
        ? `<div style="margin-top:4px;color:#6b7280;font-size:13px;">${escapeHtml(eventDate)}</div>`
        : "";
      const eventHeader = `<div style="margin-bottom:16px;padding:12px 16px;background:#f3f4f6;border-radius:6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;">Event: <a href="${eventUrl}" style="color:#2563eb;text-decoration:underline;font-weight:600;">${escapeHtml(eventName)}</a>${dateLine}</div>`;
      html = eventHeader + bodyHtml;
    }

    const venueBcc = venue ? await getVenueBccEmails(venue, supabaseAdmin) : [];
    let mergedBcc = [...new Set([...bcc, ...venueBcc, ...ALWAYS_BCC])];

    if (bccMode) {
      mergedBcc = [...new Set([...to, ...mergedBcc])];
      to = ["service@pdsportal.site"];
    }

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
    // Every send is addressed to a single fixed `To` (service@pdsportal.site);
    // all real recipients are hidden in BCC. Resend rejects any single send
    // whose TOTAL recipients (to + cc + bcc) exceed 50, so the BCC pool is
    // chunked to fit alongside the fixed `To` and the global BCC that lib/email
    // merges into every send.
    const RESEND_TOTAL_RECIPIENT_LIMIT = 50;
    const FIXED_TO = (process.env.RESEND_BLAST_TO || "service@pdsportal.site")
      .trim()
      .toLowerCase();
    const globalBccCount = (process.env.EMAIL_GLOBAL_BCC || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length;

    // Audience recipients + manual/venue BCC all become hidden BCC recipients.
    // Drop the fixed `To` from the pool to avoid an obvious duplicate copy.
    const bccPool = [...new Set([...to, ...mergedBcc])].filter(
      (email) => email !== FIXED_TO
    );

    // BCC slots available per send: total cap minus the 1 fixed `To` and the
    // global BCC, also honoring the configured batch-size throttle.
    const perSendBccCap = Math.max(
      1,
      Math.min(RESEND_TOTAL_RECIPIENT_LIMIT - 1 - globalBccCount, batchSize)
    );

    const chunks: string[][] = [];
    for (let i = 0; i < bccPool.length; i += perSendBccCap) {
      chunks.push(bccPool.slice(i, i + perSendBccCap));
    }
    // Fallback: the only recipient was the fixed `To` itself.
    if (chunks.length === 0) {
      chunks.push([]);
    }

    let sentCount = 0;
    const messageIds: string[] = [];
    const failedRecipients: string[] = [];
    const failureReasons = new Set<string>();
    const notAttempted: string[] = [];
    let isolationSplitsLeft = MAX_ISOLATION_SPLITS;
    const basePayload = {
      subject,
      html,
      from: process.env.RESEND_FROM || undefined,
      attachments: attachments.length ? attachments : undefined,
    };

    // One provider call, retried with backoff when it is rate limited.
    const sendChunk = async (recipients: string[]) => {
      let result: Awaited<ReturnType<typeof sendEmail>> | null = null;
      for (let attempt = 0; attempt <= rateLimitRetryCount; attempt += 1) {
        try {
          result = await sendEmail({
            ...basePayload,
            to: [FIXED_TO],
            bcc: recipients.length ? recipients : undefined,
          });
        } catch (err: any) {
          result = { success: false, error: err?.message || "Failed to send email." };
        }

        if (result.success) break;
        if (!isRateLimitError(result.error) || attempt >= rateLimitRetryCount) break;

        await sleep(getRetryDelayMs(retryBaseDelayMs, attempt));
      }
      return result as NonNullable<typeof result>;
    };

    // Sends `recipients` as one batch. If the provider rejects it because of a
    // bad address, the batch is split in half and each half retried, so one bad
    // address costs only itself instead of the other ~49 in its batch.
    const deliver = async (recipients: string[]): Promise<void> => {
      const result = await sendChunk(recipients);
      if (result.success) {
        sentCount += recipients.length;
        if (result.messageId) messageIds.push(result.messageId);
        return;
      }

      const reason = result.error || "Failed to send email.";
      if (
        recipients.length > 1 &&
        isolationSplitsLeft > 0 &&
        isRecipientValidationError(reason)
      ) {
        isolationSplitsLeft -= 1;
        const mid = Math.ceil(recipients.length / 2);
        await deliver(recipients.slice(0, mid));
        await deliver(recipients.slice(mid));
        return;
      }

      failureReasons.add(reason);
      failedRecipients.push(...(recipients.length ? recipients : [FIXED_TO]));
    };

    const deadline = Date.now() + SEND_TIME_BUDGET_MS;
    let consecutiveFailedBatches = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (
        consecutiveFailedBatches >= MAX_CONSECUTIVE_FAILED_BATCHES ||
        Date.now() > deadline
      ) {
        for (const rest of chunks.slice(i)) notAttempted.push(...rest);
        if (consecutiveFailedBatches < MAX_CONSECUTIVE_FAILED_BATCHES) {
          failureReasons.add("Stopped early to stay within the server time limit.");
        }
        break;
      }

      const sentBefore = sentCount;
      await deliver(chunks[i]);
      consecutiveFailedBatches =
        sentCount > sentBefore || chunks[i].length === 0 ? 0 : consecutiveFailedBatches + 1;

      if (i < chunks.length - 1 && batchDelayMs > 0) {
        await sleep(batchDelayMs);
      }
    }

    const skippedList = Array.from(skippedInvalid);
    const undelivered = [...failedRecipients, ...notAttempted];

    if (undelivered.length > 0) {
      const reasons = Array.from(failureReasons).join(" | ");
      return NextResponse.json(
        {
          error: sentCount > 0
            ? `Sent to ${sentCount} of ${bccPool.length} recipients. ${undelivered.length} not delivered${reasons ? `: ${reasons}` : "."}`
            : reasons || "Failed to send email.",
          partial: sentCount > 0,
          sentCount,
          attemptedRecipients: bccPool.length,
          failedRecipients,
          notAttempted,
          skippedInvalid: skippedList,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: messageIds[0],
      messageIds,
      recipientCount: sentCount,
      batches: chunks.length,
      bccCount: mergedBcc.length,
      skippedInvalid: skippedList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unhandled server error" }, { status: 500 });
  }
}
