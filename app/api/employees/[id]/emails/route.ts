export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { sendInboxReplyEmail } from "@/lib/email";
import { safeDecrypt } from "@/lib/encryption";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const HR_ROLES = new Set([
  "admin", "exec", "hr", "hr_admin", "manager", "supervisor", "supervisor2", "supervisor3", "supervisor4",
]);

function decryptValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return safeDecrypt(value.trim()) || value.trim();
  } catch {
    return value.trim();
  }
}

function decryptProfileName(profile: { first_name?: unknown; last_name?: unknown } | null | undefined): string {
  if (!profile) return "";
  return `${decryptValue(profile.first_name)} ${decryptValue(profile.last_name)}`.trim();
}

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

// GET /api/employees/[id]/emails
// Returns the log of app-generated emails addressed (to/cc) to this employee,
// i.e. their "Inbox". Viewable by the employee themself or any HR/admin role.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const employeeId = params.id;

    // Authorise: must be the employee themselves or an HR/admin role. The role is
    // looked up regardless of ownership so `canRespond` is still accurate when an
    // HR/exec user is viewing their own profile (isOwner alone must not imply HR rights).
    const isOwner = caller.id === employeeId;
    const { data: callerRecord } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();
    const isHrRole = HR_ROLES.has(String(callerRecord?.role || "").toLowerCase());
    if (!isOwner && !isHrRole) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from("email_logs")
      .select(
        "id, subject, html_body, from_address, recipient_email, recipient_type, status, error_message, provider_message_id, created_at, read_at, read_by, sender_user_id, in_reply_to_id"
      )
      .eq("recipient_user_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Only HR/admin roles can reply to or compose a new message into an
    // employee's inbox from this page — the employee's own view is read-only.
    return NextResponse.json({ emails: data ?? [], canRespond: isHrRole });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}

// POST /api/employees/[id]/emails
// Sends a new message (or a reply to a specific prior email) to this
// employee's address, as a real email via Resend, logged into the same
// email_logs table so it appears in their Inbox thread. Restricted to
// HR/admin roles — the "Reply" / "New Message" actions on the Inbox.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const employeeId = params.id;

    const { data: callerRecord } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();
    const callerRole = String(callerRecord?.role || "").toLowerCase();
    if (!HR_ROLES.has(callerRole)) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { data: employeeRecord, error: employeeError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeError) {
      return NextResponse.json({ error: employeeError.message }, { status: 500 });
    }
    if (!employeeRecord?.id) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const subject = String(body?.subject || "").trim();
    const message = String(body?.message || "").trim();
    const inReplyToId = body?.inReplyToId ? String(body.inReplyToId) : undefined;

    if (!subject) {
      return NextResponse.json({ error: "Subject is required." }, { status: 400 });
    }
    if (subject.length > 200) {
      return NextResponse.json({ error: "Subject must be 200 characters or fewer." }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }
    if (message.length > 5000) {
      return NextResponse.json({ error: "Message must be 5000 characters or fewer." }, { status: 400 });
    }

    // If replying, make sure the original email actually belongs to this employee's inbox.
    if (inReplyToId) {
      const { data: original } = await supabaseAdmin
        .from("email_logs")
        .select("id")
        .eq("id", inReplyToId)
        .eq("recipient_user_id", employeeId)
        .maybeSingle();
      if (!original) {
        return NextResponse.json({ error: "The message being replied to could not be found." }, { status: 404 });
      }
    }

    const { data: employeeProfile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("user_id", employeeId)
      .maybeSingle();

    const employeeName = decryptProfileName(employeeProfile);
    const employeeLabel = employeeRecord.email
      ? `${employeeName || "Unnamed"} <${employeeRecord.email}>`
      : employeeName || employeeId;

    const sendResult = await sendInboxReplyEmail({
      subject,
      message,
      senderUserId: caller.id,
      inReplyToId,
      employeeUserId: employeeId,
      employeeLabel,
    });

    if (!sendResult.success) {
      return NextResponse.json({ error: sendResult.error || "Failed to send message." }, { status: 502 });
    }

    if (!sendResult.emailLogId) {
      // Sent successfully but the log row couldn't be resolved back (non-fatal edge case) —
      // the message went out; the client can refresh the inbox to pick it up.
      return NextResponse.json({ success: true });
    }

    const { data: loggedEmail, error: loggedEmailError } = await supabaseAdmin
      .from("email_logs")
      .select(
        "id, subject, html_body, from_address, recipient_email, recipient_type, status, error_message, provider_message_id, created_at, read_at, read_by, sender_user_id, in_reply_to_id"
      )
      .eq("id", sendResult.emailLogId)
      .maybeSingle();

    if (loggedEmailError || !loggedEmail) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ email: loggedEmail }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/employees/[id]/emails
// Marks a single email (by id) as read by the caller. Idempotent — the
// first open wins, later opens don't overwrite read_at/read_by.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const employeeId = params.id;

    const isOwner = caller.id === employeeId;
    if (!isOwner) {
      const { data: callerRecord } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();
      const role = String(callerRecord?.role || "").toLowerCase();
      if (!HR_ROLES.has(role)) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const emailId = body?.emailId;
    if (!emailId || typeof emailId !== "string") {
      return NextResponse.json({ error: "emailId is required." }, { status: 400 });
    }

    // Only set read_at/read_by if this email hasn't already been read, so the
    // chip reflects the first open rather than the most recent viewer.
    const { data, error } = await supabaseAdmin
      .from("email_logs")
      .update({ read_at: new Date().toISOString(), read_by: caller.id })
      .eq("id", emailId)
      .eq("recipient_user_id", employeeId)
      .is("read_at", null)
      .select("id, read_at, read_by")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data) {
      return NextResponse.json({ email: data });
    }

    // Already read (or no matching row) — return current state so the UI can
    // still reconcile without treating this as an error.
    const { data: existing } = await supabaseAdmin
      .from("email_logs")
      .select("id, read_at, read_by")
      .eq("id", emailId)
      .eq("recipient_user_id", employeeId)
      .maybeSingle();

    return NextResponse.json({ email: existing ?? null });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unhandled server error" },
      { status: 500 }
    );
  }
}
