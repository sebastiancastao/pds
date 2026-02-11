import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { sendEmail } from '@/lib/email';
import { isValidEmail } from '@/lib/supabase';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const allowedRoles = new Set(['admin', 'exec', 'hr', 'hr_admin']);

const requestSchema = z.object({
  audience: z.enum(['manual', 'role', 'all']).default('manual'),
  to: z.string().optional(),
  role: z.string().optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(200_000),
  bodyFormat: z.enum(['html', 'text']).default('text'),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  confirm: z.boolean().optional(),
});

const parsedMaxAttachments = Number(process.env.MAX_EMAIL_ATTACHMENTS || 5);
const MAX_EMAIL_ATTACHMENTS =
  Number.isFinite(parsedMaxAttachments) && parsedMaxAttachments > 0
    ? parsedMaxAttachments
    : 5;

const parsedMaxAttachmentBytes = Number(
  process.env.MAX_EMAIL_ATTACHMENT_BYTES || 25 * 1024 * 1024
);
const MAX_EMAIL_ATTACHMENT_BYTES =
  Number.isFinite(parsedMaxAttachmentBytes) && parsedMaxAttachmentBytes > 0
    ? parsedMaxAttachmentBytes
    : 25 * 1024 * 1024;

const parsedMaxAttachmentFileBytes = Number(
  process.env.MAX_EMAIL_ATTACHMENT_FILE_BYTES || 10 * 1024 * 1024
);
const MAX_EMAIL_ATTACHMENT_FILE_BYTES =
  Number.isFinite(parsedMaxAttachmentFileBytes) &&
  parsedMaxAttachmentFileBytes > 0
    ? parsedMaxAttachmentFileBytes
    : 10 * 1024 * 1024;

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseEmailList(value: string | undefined): string[] {
  if (!value) return [];
  const parts = value
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(parts.map((e) => e.toLowerCase())));
  return unique;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: 'RESEND_API_KEY not configured' },
        { status: 500 }
        );
    }

    const contentType = (req.headers.get('content-type') || '').toLowerCase();

    let attachments:
      | { filename: string; content: string; contentType?: string }[]
      | undefined;

    let parsed: ReturnType<typeof requestSchema.safeParse>;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();

      const payload = {
        audience: String(formData.get('audience') || 'manual'),
        to: formData.get('to') ? String(formData.get('to')) : undefined,
        role: formData.get('role') ? String(formData.get('role')) : undefined,
        subject: String(formData.get('subject') || ''),
        body: String(formData.get('body') || ''),
        bodyFormat: String(formData.get('bodyFormat') || 'text'),
        cc: formData.get('cc') ? String(formData.get('cc')) : undefined,
        bcc: formData.get('bcc') ? String(formData.get('bcc')) : undefined,
        confirm:
          String(formData.get('confirm') || '').toLowerCase() === 'true'
            ? true
            : undefined,
      };

      parsed = requestSchema.safeParse(payload);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid request', details: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const files = formData
        .getAll('attachments')
        .filter((v): v is File => v instanceof File)
        .filter((f) => f.size > 0);

      if (files.length > MAX_EMAIL_ATTACHMENTS) {
        return NextResponse.json(
          { error: `Too many attachments (max ${MAX_EMAIL_ATTACHMENTS}).` },
          { status: 400 }
        );
      }

      let totalBytes = 0;
      const parsedAttachments: {
        filename: string;
        content: string;
        contentType?: string;
      }[] = [];

      for (const file of files) {
        if (!file.name) continue;

        if (file.size > MAX_EMAIL_ATTACHMENT_FILE_BYTES) {
          return NextResponse.json(
            {
              error: `Attachment "${file.name}" is too large (max ${MAX_EMAIL_ATTACHMENT_FILE_BYTES} bytes).`,
            },
            { status: 400 }
          );
        }

        totalBytes += file.size;
        if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
          return NextResponse.json(
            {
              error: `Total attachment size too large (max ${MAX_EMAIL_ATTACHMENT_BYTES} bytes).`,
            },
            { status: 400 }
          );
        }

        const ab = await file.arrayBuffer();
        // Resend expects attachment content to be base64 (string). Passing a Buffer here
        // would JSON.stringify to a huge `{ type: 'Buffer', data: number[] }` payload,
        // which is slow and can cause API errors.
        const base64 = Buffer.from(ab).toString('base64');
        parsedAttachments.push({
          filename: file.name,
          content: base64,
          contentType: file.type || undefined,
        });
      }

      attachments = parsedAttachments.length ? parsedAttachments : undefined;
    } else {
      parsed = requestSchema.safeParse(await req.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid request', details: parsed.error.flatten() },
          { status: 400 }
        );
      }
    }

    const { audience, to, role, subject, body, bodyFormat, cc, bcc, confirm } =
      parsed.data;

    const cookieStore = await cookies();
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabaseAuth.auth.getUser();

    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabaseAuth.auth.getUser(token);
        if (tokenUser) user = tokenUser;
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleRow, error: roleErr } = await adminClient
      .from('users')
      .select('role, email')
      .eq('id', user.id)
      .single();

    if (roleErr) {
      return NextResponse.json(
        { error: 'Failed to verify access', details: roleErr.message },
        { status: 500 }
      );
    }

    const normalizedRole = (roleRow?.role || '').toString().trim().toLowerCase();
    if (!allowedRoles.has(normalizedRole)) {
      return NextResponse.json(
        { error: 'Access denied. Admin privileges required.', currentRole: normalizedRole },
        { status: 403 }
      );
    }

    const parsedMax = Number(process.env.MAX_BULK_EMAIL_RECIPIENTS || 200);
    const maxRecipients = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 200;

    let recipients: string[] = [];

    if (audience === 'manual') {
      recipients = parseEmailList(to);
    } else if (audience === 'role') {
      if (!confirm) {
        return NextResponse.json(
          { error: 'Bulk send requires confirm=true' },
          { status: 400 }
        );
      }
      if (!role) {
        return NextResponse.json(
          { error: 'role is required when audience=role' },
          { status: 400 }
        );
      }
      const normalizedTargetRole = role.toString().trim().toLowerCase();
      const { data: rows, error } = await adminClient
        .from('users')
        .select('email')
        .eq('role', normalizedTargetRole)
        .not('email', 'is', null)
        .limit(maxRecipients + 1);

      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch recipients', details: error.message },
          { status: 500 }
        );
      }

      recipients = (rows || [])
        .map((r: any) => String(r.email || '').toLowerCase().trim())
        .filter(Boolean);
    } else if (audience === 'all') {
      if (!confirm) {
        return NextResponse.json(
          { error: 'Bulk send requires confirm=true' },
          { status: 400 }
        );
      }
      const { data: rows, error } = await adminClient
        .from('users')
        .select('email')
        .not('email', 'is', null)
        .limit(maxRecipients + 1);

      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch recipients', details: error.message },
          { status: 500 }
        );
      }

      recipients = (rows || [])
        .map((r: any) => String(r.email || '').toLowerCase().trim())
        .filter(Boolean);
    }

    recipients = Array.from(new Set(recipients));

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'No valid recipients provided' },
        { status: 400 }
      );
    }

    const invalid = recipients.filter((e) => !isValidEmail(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: 'Invalid email(s) in recipient list', invalid: invalid.slice(0, 25) },
        { status: 400 }
      );
    }

    if (recipients.length > maxRecipients) {
      return NextResponse.json(
        {
          error: `Too many recipients (max ${maxRecipients})`,
          recipientCount: recipients.length,
          maxRecipients,
        },
        { status: 400 }
      );
    }

    const ccList = parseEmailList(cc);
    const bccList = parseEmailList(bcc);
    const invalidCc = ccList.filter((e) => !isValidEmail(e));
    if (invalidCc.length > 0) {
      return NextResponse.json(
        { error: 'Invalid email(s) in CC list', invalid: invalidCc.slice(0, 25) },
        { status: 400 }
      );
    }
    const invalidBcc = bccList.filter((e) => !isValidEmail(e));
    if (invalidBcc.length > 0) {
      return NextResponse.json(
        { error: 'Invalid email(s) in BCC list', invalid: invalidBcc.slice(0, 25) },
        { status: 400 }
      );
    }

    const html =
      bodyFormat === 'html'
        ? body
        : `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; white-space: pre-wrap;">${escapeHtml(
            body
          )}</pre>`;

    const from = process.env.RESEND_FROM || undefined;

    const result = await sendEmail({
      to: recipients,
      subject,
      html,
      from,
      cc: ccList.length ? ccList : undefined,
      bcc: bccList.length ? bccList : undefined,
      attachments,
    });

    try {
      await adminClient.from('audit_logs').insert({
        user_id: user.id,
        action: 'admin_email_sent',
        resource_type: 'email',
        resource_id: result.messageId || null,
        ip_address:
          req.headers.get('x-forwarded-for') ||
          req.headers.get('x-real-ip') ||
          null,
        user_agent: req.headers.get('user-agent') || null,
        metadata: {
          audience,
          recipientCount: recipients.length,
          recipientsSample: recipients.slice(0, 3),
          subject,
          bodyFormat,
          ccCount: ccList.length,
          bccCount: bccList.length,
          attachmentsCount: attachments?.length || 0,
          attachmentsNames: attachments?.slice(0, 10).map((a) => a.filename),
        },
        success: result.success,
        error_message: result.success ? null : result.error || 'Email send failed',
      });
    } catch (e) {
      console.warn('[ADMIN SEND EMAIL] Failed to write audit log:', e);
    }

    if (!result.success) {
      return NextResponse.json(
        { error: 'Email sending failed', code: result.errorName, details: result.error },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      recipientCount: recipients.length,
    });
  } catch (error: any) {
    console.error('[ADMIN SEND EMAIL] Unexpected error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
