// app/api/reports/event-export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";
import { getTimezoneForState } from "@/lib/timezones";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_ROLES = ["manager", "supervisor", "supervisor2", "hr", "exec"];

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

function dec(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try { return safeDecrypt(value.trim()); } catch { return value.trim(); }
}

function fmtDate(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "";
  const tz = timezone || "UTC";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  }
}

const isMissingRelationError = (error: any): boolean => {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "");
  return code === "42P01" || /relation .* does not exist/i.test(message);
};

// Extract the kiosk client action id appended to notes: "... | clientActionId:<id>"
function parseClientActionId(notes: string): string {
  const m = (notes || "").match(/clientActionId:\s*([^\s|]+)/i);
  return m ? m[1] : "";
}

// Parse manager-edit notes: "Manual edit by manager | Reason: ... | Signature: <uuid>"
function parseEditNotes(notes: string) {
  const reasonMatch = notes.match(/\| Reason: (.+?) \| Signature:/);
  const sigMatch = notes.match(/\| Signature: ([0-9a-f-]{36})/i);
  const roleMatch = notes.match(/^Manual edit by (\w+)/i);
  return {
    reason: reasonMatch?.[1] ?? "",
    signatureId: sigMatch?.[1] ?? "",
    editedByRole: roleMatch?.[1] ?? "",
  };
}

/**
 * GET /api/reports/event-export?eventId=<uuid>
 * Returns an Excel (.xlsx) file with the full audit trail for a single event:
 *   - Event data + when it was created (and by whom)
 *   - Team selected: every transaction, when each person was requested and when they replied
 *   - All clock-ins (and other time entries) per person
 *   - All timesheet edits
 */
export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: callerData } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", authedUser.id)
      .maybeSingle();

    const callerRole = (callerData?.role || "").toLowerCase().trim();
    if (!ALLOWED_ROLES.includes(callerRole)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    if (!eventId) {
      return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    }

    // ── 1. Event ───────────────────────────────────────────────────────────
    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) {
      return NextResponse.json({ error: eventError.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const tz = getTimezoneForState((event as any).state);
    const eventName = (event as any).event_name || (event as any).venue || eventId;

    // ── 2. Team (all transactions) ─────────────────────────────────────────
    const { data: teamRows } = await supabaseAdmin
      .from("event_teams")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });

    // ── 3. Email-token invitations tied to this event ──────────────────────
    let invitations: any[] = [];
    try {
      const { data: inv, error: invErr } = await supabaseAdmin
        .from("vendor_invitations")
        .select("id, vendor_id, invited_by, status, invitation_type, created_at, responded_at, expires_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });
      if (!invErr) invitations = inv || [];
    } catch { /* table may not exist */ }
    // Index invitations by vendor for enrichment of team rows
    const inviteByVendor = new Map<string, any>();
    invitations.forEach((i: any) => { if (i.vendor_id) inviteByVendor.set(i.vendor_id, i); });

    // ── 4. Uninvite history ────────────────────────────────────────────────
    let uninvites: any[] = [];
    const { data: uninviteRows, error: uninviteErr } = await supabaseAdmin
      .from("event_team_uninvites")
      .select("id, vendor_id, previous_status, uninvited_by, uninvited_at, metadata")
      .eq("event_id", eventId)
      .order("uninvited_at", { ascending: false });
    if (uninviteErr && !isMissingRelationError(uninviteErr)) {
      console.error("[EVENT-EXPORT] event_team_uninvites failed:", uninviteErr.message);
    }
    if (!uninviteErr) {
      uninvites = (uninviteRows || []).map((r: any) => ({
        vendor_id: r.vendor_id || r.metadata?.vendor_id || "",
        previous_status: r.previous_status || r.metadata?.previous_status || "",
        actor_id: r.uninvited_by || r.metadata?.uninvited_by_user_id || "",
        at: r.uninvited_at || "",
        // Prefer the snapshotted invite time; fall back to an email-invitation
        // record when present (the deleted event_teams.created_at is otherwise lost).
        invited_at: r.metadata?.invited_at
          || inviteByVendor.get(r.vendor_id || r.metadata?.vendor_id)?.created_at
          || "",
      }));
    } else {
      // Legacy fallback: audit_logs
      const { data: auditUninvites } = await supabaseAdmin
        .from("audit_logs")
        .select("user_id, created_at, metadata")
        .eq("action", "team_member_uninvited")
        .eq("resource_type", "event")
        .eq("resource_id", eventId)
        .order("created_at", { ascending: false });
      uninvites = (auditUninvites || []).map((r: any) => ({
        vendor_id: r.metadata?.vendor_id || "",
        previous_status: r.metadata?.previous_status || "",
        actor_id: r.user_id || r.metadata?.uninvited_by_user_id || "",
        at: r.created_at || "",
        invited_at: r.metadata?.invited_at
          || inviteByVendor.get(r.metadata?.vendor_id)?.created_at
          || "",
      }));
    }

    // ── 5. Time entries for this event (clock-ins, etc. + edits) ───────────
    const { data: timeEntries } = await supabaseAdmin
      .from("time_entries")
      .select("id, user_id, action, timestamp, started_at, notes, event_id, attestation_accepted, created_at")
      .eq("event_id", eventId)
      .order("timestamp", { ascending: true });

    // ── 6. Timesheet edit requests for this event ──────────────────────────
    let editRequests: any[] = [];
    try {
      const { data: er, error: erErr } = await supabaseAdmin
        .from("timesheet_edit_requests")
        .select("id, user_id, status, reason, reviewed_by, reviewed_at, review_notes, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false });
      if (!erErr) editRequests = er || [];
    } catch { /* table may not exist */ }

    // ── 7. Event-scoped audit log ──────────────────────────────────────────
    const { data: auditLogs } = await supabaseAdmin
      .from("audit_logs")
      .select("action, user_id, success, ip_address, metadata, created_at")
      .eq("resource_type", "event")
      .eq("resource_id", eventId)
      .order("created_at", { ascending: false })
      .limit(500);

    // ── 8. Resolve names for every referenced user ─────────────────────────
    const userIds = new Set<string>();
    if ((event as any).created_by) userIds.add((event as any).created_by);
    (teamRows || []).forEach((t: any) => {
      if (t.vendor_id) userIds.add(t.vendor_id);
      if (t.assigned_by) userIds.add(t.assigned_by);
    });
    invitations.forEach((i: any) => { if (i.invited_by) userIds.add(i.invited_by); });
    uninvites.forEach((u: any) => { if (u.vendor_id) userIds.add(u.vendor_id); if (u.actor_id) userIds.add(u.actor_id); });
    (timeEntries || []).forEach((t: any) => { if (t.user_id) userIds.add(t.user_id); });
    editRequests.forEach((e: any) => { if (e.user_id) userIds.add(e.user_id); if (e.reviewed_by) userIds.add(e.reviewed_by); });
    (auditLogs || []).forEach((a: any) => { if (a.user_id) userIds.add(a.user_id); });

    const nameById = new Map<string, string>();
    const emailById = new Map<string, string>();
    const roleById = new Map<string, string>();
    if (userIds.size > 0) {
      const ids = Array.from(userIds);
      const [{ data: users }, { data: profiles }] = await Promise.all([
        supabaseAdmin.from("users").select("id, email, role").in("id", ids),
        supabaseAdmin.from("profiles").select("user_id, first_name, last_name").in("user_id", ids),
      ]);
      (users || []).forEach((u: any) => {
        emailById.set(u.id, u.email || "");
        roleById.set(u.id, u.role || "");
      });
      (profiles || []).forEach((p: any) => {
        const name = [dec(p.first_name), dec(p.last_name)].filter(Boolean).join(" ");
        if (name) nameById.set(p.user_id, name);
      });
    }
    const displayName = (id: string | null | undefined) =>
      (id && (nameById.get(id) || emailById.get(id) || id)) || "";

    // ─────────────────────────────────────────────────────────────────────
    // Build workbook
    // ─────────────────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: Event Data + creation
    const eventSheet = XLSX.utils.aoa_to_sheet([
      ["Field", "Value"],
      ["Event ID", (event as any).id],
      ["Event Name", (event as any).event_name || ""],
      ["Artist", (event as any).artist || ""],
      ["Venue", (event as any).venue || ""],
      ["City", (event as any).city || ""],
      ["State", (event as any).state || ""],
      ["Event Date", (event as any).event_date || ""],
      ["Start Time", (event as any).start_time || ""],
      ["End Time", (event as any).end_time || ""],
      ["Timezone", tz],
      [""],
      ["Ticket Sales", (event as any).ticket_sales ?? ""],
      ["Ticket Count", (event as any).ticket_count ?? ""],
      ["Commission Pool", (event as any).commission_pool ?? ""],
      ["Required Staff", (event as any).required_staff ?? ""],
      ["Confirmed Staff", (event as any).confirmed_staff ?? ""],
      ["Active", (event as any).is_active ? "Yes" : "No"],
      [""],
      ["── Created ──", ""],
      ["Created By", displayName((event as any).created_by)],
      ["Created By (Email)", emailById.get((event as any).created_by) || ""],
      ["Created At", fmtDate((event as any).created_at, tz)],
      ["Last Updated At", fmtDate((event as any).updated_at, tz)],
    ]);
    eventSheet["!cols"] = [{ wch: 24 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, eventSheet, "Event");

    // Sheet 2: Team & Transactions — when each person was requested and replied
    const teamHeaders = [
      "Member Name", "Email", "User Role", "Event Role", "Status",
      "Requested At", "Requested By", "Replied / Confirmed At",
      "Invite Responded At", "Confirmation Token",
    ];
    const teamBody = (teamRows || []).map((t: any) => {
      const inv = inviteByVendor.get(t.vendor_id);
      const requestedAt = t.invited_at || t.created_at || inv?.created_at || null;
      const repliedAt = t.confirmed_at || t.responded_at || inv?.responded_at || null;
      return [
        displayName(t.vendor_id),
        emailById.get(t.vendor_id) || "",
        roleById.get(t.vendor_id) || "",
        t.event_role || t.role || "",
        t.status || "",
        fmtDate(requestedAt, tz),
        displayName(t.assigned_by),
        fmtDate(repliedAt, tz),
        fmtDate(inv?.responded_at, tz),
        t.confirmation_token ? String(t.confirmation_token).slice(0, 12) + "…" : "",
      ];
    });
    const teamSheet = XLSX.utils.aoa_to_sheet([teamHeaders, ...teamBody]);
    teamSheet["!cols"] = [
      { wch: 24 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 20 },
      { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, teamSheet, "Team & Transactions");

    // Sheet 3: Uninvite History (removed team members)
    if (uninvites.length > 0) {
      const uninviteHeaders = ["Member Name", "Email", "Invited At", "Previous Status", "Uninvited By", "Uninvited At"];
      const uninviteBody = uninvites.map((u: any) => [
        displayName(u.vendor_id),
        emailById.get(u.vendor_id) || "",
        fmtDate(u.invited_at, tz),
        u.previous_status || "",
        displayName(u.actor_id),
        fmtDate(u.at, tz),
      ]);
      const uninviteSheet = XLSX.utils.aoa_to_sheet([uninviteHeaders, ...uninviteBody]);
      uninviteSheet["!cols"] = [{ wch: 24 }, { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 24 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, uninviteSheet, "Uninvite History");
    }

    // Sheet 4: All Clock-Ins / Time Entries per person
    // Source column: only the rows that were manually edited show the edit
    // comment (reason); every other row is a normal kiosk clock-in/out.
    const entryHeaders = ["Member Name", "Email", "Action", "Date & Time (Local)", "Timezone", "Attestation", "Source", "Edit Comment", "Action ID", "Recorded At"];
    const entryBody = (timeEntries || [])
      .slice()
      .sort((a: any, b: any) => {
        const an = displayName(a.user_id);
        const bn = displayName(b.user_id);
        if (an !== bn) return an.localeCompare(bn);
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      })
      .map((t: any) => {
        const isEdit = /manual edit by/i.test(t.notes || "");
        const parsed = isEdit ? parseEditNotes(t.notes || "") : null;
        return [
          displayName(t.user_id),
          emailById.get(t.user_id) || "",
          t.action || "",
          fmtDate(t.timestamp, tz),
          tz,
          t.attestation_accepted === true ? "Accepted" : t.attestation_accepted === false ? "Rejected" : "",
          isEdit ? `Edited${parsed?.editedByRole ? ` (${parsed.editedByRole})` : ""}` : "Kiosk entry",
          isEdit ? (parsed?.reason || "") : "",
          parseClientActionId(t.notes || "") || t.id || "",
          fmtDate(t.created_at, tz),
        ];
      });
    const entrySheet = XLSX.utils.aoa_to_sheet([entryHeaders, ...entryBody]);
    entrySheet["!cols"] = [{ wch: 24 }, { wch: 28 }, { wch: 12 }, { wch: 24 }, { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 30 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, entrySheet, "Clock-Ins & Entries");

    // Sheet 5: Hours summary per person (paired clock_in/clock_out)
    const byUser: Record<string, any[]> = {};
    (timeEntries || []).forEach((t: any) => {
      if (!t.user_id) return;
      (byUser[t.user_id] = byUser[t.user_id] || []).push(t);
    });
    const summaryHeaders = ["Member Name", "Email", "First Clock-In", "Last Clock-Out", "Clock-In Count", "Total Hours", "Manager Edited"];
    const summaryBody = Object.entries(byUser).map(([uid, entries]) => {
      const sorted = entries.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const clockIns = sorted.filter(e => e.action === "clock_in");
      const clockOuts = sorted.filter(e => e.action === "clock_out");
      let totalMs = 0;
      let open: string | null = null;
      for (const e of sorted) {
        if (e.action === "clock_in") { if (!open) open = e.timestamp; }
        else if (e.action === "clock_out" && open) {
          const d = new Date(e.timestamp).getTime() - new Date(open).getTime();
          if (d > 0) totalMs += d;
          open = null;
        }
      }
      const edited = sorted.some(e => /manual edit by/i.test(e.notes || ""));
      return [
        displayName(uid),
        emailById.get(uid) || "",
        clockIns.length > 0 ? fmtDate(clockIns[0].timestamp, tz) : "",
        clockOuts.length > 0 ? fmtDate(clockOuts[clockOuts.length - 1].timestamp, tz) : "",
        clockIns.length,
        Math.round((totalMs / 3600000) * 100) / 100,
        edited ? "Yes" : "No",
      ];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryBody]);
    summarySheet["!cols"] = [{ wch: 24 }, { wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Hours Summary");

    // Sheet 6: Timesheet Edits (manual edits recorded in time_entries notes)
    const editEntries = (timeEntries || []).filter((t: any) => /manual edit by/i.test(t.notes || ""));
    const editHeaders = ["Member Name", "Edited By (Role)", "Reason", "Action", "New Time (Local)", "Action ID", "Signature ID", "Recorded At"];
    const editBody = editEntries.map((t: any) => {
      const parsed = parseEditNotes(t.notes || "");
      return [
        displayName(t.user_id),
        parsed.editedByRole,
        parsed.reason,
        t.action || "",
        fmtDate(t.timestamp, tz),
        parseClientActionId(t.notes || "") || t.id || "",
        parsed.signatureId,
        fmtDate(t.created_at, tz),
      ];
    });
    // Append edit-request records (who requested a change and review outcome)
    const editRequestRows = editRequests.map((e: any) => [
      displayName(e.user_id),
      `request → ${e.status || ""}`,
      e.reason || e.review_notes || "",
      "",
      "",
      "",
      e.reviewed_by ? `reviewed by ${displayName(e.reviewed_by)}` : "",
      fmtDate(e.created_at, tz),
    ]);
    const editSheet = XLSX.utils.aoa_to_sheet([editHeaders, ...editBody, ...editRequestRows]);
    editSheet["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 40 }, { wch: 12 }, { wch: 22 }, { wch: 30 }, { wch: 38 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, editSheet, "Timesheet Edits");

    // Sheet 7: Event Audit Log
    if ((auditLogs || []).length > 0) {
      const auditHeaders = ["Action", "By", "Success", "IP Address", "Metadata", "Timestamp"];
      const auditBody = (auditLogs || []).map((a: any) => [
        a.action || "",
        displayName(a.user_id),
        a.success ? "Yes" : "No",
        a.ip_address || "",
        a.metadata ? JSON.stringify(a.metadata) : "",
        fmtDate(a.created_at, tz),
      ]);
      const auditSheet = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditBody]);
      auditSheet["!cols"] = [{ wch: 28 }, { wch: 24 }, { wch: 10 }, { wch: 18 }, { wch: 50 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, auditSheet, "Event Audit Log");
    }

    // ── Write to buffer ────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const safeName = String(eventName).replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 40);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="event_${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[EVENT-EXPORT]", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
