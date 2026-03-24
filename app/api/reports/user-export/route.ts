// app/api/reports/user-export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { safeDecrypt } from "@/lib/encryption";
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * GET /api/reports/user-export?userId=<uuid>
 * Returns an Excel (.xlsx) file with all data for the given user.
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
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    // ── 1. User + Profile ──────────────────────────────────────────────────
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select(`
        id, email, role, division, is_active, created_at,
        background_check_completed,
        profiles (
          id, first_name, last_name, phone, address, city, state, zip_code,
          latitude, longitude, region_id, onboarding_completed_at,
          mfa_enabled, created_at, updated_at
        )
      `)
      .eq("id", userId)
      .maybeSingle();

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const profile = Array.isArray(userData.profiles) ? userData.profiles[0] : userData.profiles;
    const profileId = profile?.id || null;

    const firstName = dec(profile?.first_name);
    const lastName = dec(profile?.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(" ") || userData.email;

    // ── 2. Time Entries ────────────────────────────────────────────────────
    const { data: timeEntries } = await supabaseAdmin
      .from("time_entries")
      .select("id, action, timestamp, notes, event_id")
      .eq("user_id", userId)
      .order("timestamp", { ascending: false });

    // ── 3. Events worked (via event_teams + time_entries event_ids) ────────
    const eventIds = new Set<string>();
    (timeEntries || []).forEach((t: any) => { if (t.event_id) eventIds.add(t.event_id); });

    const { data: teamRows } = await supabaseAdmin
      .from("event_teams")
      .select("event_id, status, invited_at, confirmed_at, role")
      .eq("vendor_id", userId);

    (teamRows || []).forEach((t: any) => { if (t.event_id) eventIds.add(t.event_id); });

    let events: any[] = [];
    if (eventIds.size > 0) {
      const { data: eventsData } = await supabaseAdmin
        .from("events")
        .select("id, event_name, artist, venue, city, state, event_date, start_time, end_time, ticket_sales, commission_pool, required_staff, is_active")
        .in("id", Array.from(eventIds));
      events = eventsData || [];
    }

    const teamByEvent = new Map<string, any>();
    (teamRows || []).forEach((t: any) => teamByEvent.set(t.event_id, t));

    // ── 4. Compute hours per event ─────────────────────────────────────────
    type Shift = { event_id: string | null; date: string; clock_in: string; clock_out: string; hours: number };
    const shifts: Shift[] = [];
    const sortedEntries = [...(timeEntries || [])].sort(
      (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    let openIn: any = null;
    for (const row of sortedEntries) {
      if (row.action === "clock_in") { openIn = row; }
      else if (row.action === "clock_out" && openIn) {
        const startMs = new Date(openIn.timestamp).getTime();
        const endMs = new Date(row.timestamp).getTime();
        if (endMs > startMs) {
          shifts.push({
            event_id: row.event_id || openIn.event_id || null,
            date: String(openIn.timestamp).slice(0, 10),
            clock_in: openIn.timestamp,
            clock_out: row.timestamp,
            hours: Math.round(((endMs - startMs) / 3600000) * 100) / 100,
          });
        }
        openIn = null;
      }
    }

    // eventNameById is populated here initially and extended after createdEvents is fetched
    const eventNameById = new Map<string, string>();
    events.forEach((e: any) => eventNameById.set(e.id, e.event_name || e.venue || e.id));

    // ── 5. Background check ────────────────────────────────────────────────
    let bgCheck: any = null;
    if (profileId) {
      const { data: bg } = await supabaseAdmin
        .from("vendor_background_checks")
        .select("background_check_completed, completed_date, notes, created_at, updated_at")
        .eq("profile_id", profileId)
        .maybeSingle();
      bgCheck = bg;
    }

    // ── 6. Onboarding status ───────────────────────────────────────────────
    let onboarding: any = null;
    if (profileId) {
      const { data: ob } = await supabaseAdmin
        .from("vendor_onboarding_status")
        .select("onboarding_completed, completed_date, created_at, updated_at")
        .eq("profile_id", profileId)
        .maybeSingle();
      onboarding = ob;
    }

    // ── 7. Form signatures ─────────────────────────────────────────────────
    const { data: signatures } = await supabaseAdmin
      .from("form_signatures")
      .select("form_id, form_type, signature_role, signed_at, is_valid, ip_address")
      .eq("user_id", userId)
      .order("signed_at", { ascending: false });

    // ── 8. Payments ────────────────────────────────────────────────────────
    const { data: payments } = await supabaseAdmin
      .from("vendor_payments")
      .select("*")
      .eq("vendor_id", userId)
      .order("created_at", { ascending: false });

    // ── 9. Background check PDFs ───────────────────────────────────────────
    const { data: bgPdfs } = await supabaseAdmin
      .from("background_check_pdfs")
      .select("id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    // ── 10. PDF Downloads ──────────────────────────────────────────────────
    const { data: pdfDownloads } = await supabaseAdmin
      .from("background_check_pdf_downloads")
      .select("downloaded_at")
      .eq("user_id", userId)
      .order("downloaded_at", { ascending: false });

    // ── 11. Events CREATED by this user ────────────────────────────────────
    const { data: createdEvents } = await supabaseAdmin
      .from("events")
      .select("id, event_name, artist, venue, city, state, event_date, start_time, end_time, ticket_sales, commission_pool, required_staff, confirmed_staff, is_active, created_at, updated_at")
      .eq("created_by", userId)
      .order("event_date", { ascending: false });

    // Extend the map with created events (covers timesheet edits referencing these events)
    (createdEvents || []).forEach((e: any) => eventNameById.set(e.id, e.event_name || e.venue || e.id));

    // ── 12. Invitations sent BY this user ──────────────────────────────────
    // Source 1: vendor_invitations (email-token based invites)
    const { data: sentInvitations } = await supabaseAdmin
      .from("vendor_invitations")
      .select("id, vendor_id, status, invitation_type, created_at, responded_at, expires_at, start_date, end_date, event_id")
      .eq("invited_by", userId)
      .order("created_at", { ascending: false });

    // Source 2: event_teams assignments (direct team assignments use assigned_by)
    const { data: assignedTeamRows } = await supabaseAdmin
      .from("event_teams")
      .select("vendor_id, event_id, status, created_at, confirmation_token")
      .eq("assigned_by", userId)
      .order("created_at", { ascending: false });

    // Collect all invitee IDs from both sources
    const inviteeIds = [...new Set([
      ...(sentInvitations || []).map((i: any) => i.vendor_id),
      ...(assignedTeamRows || []).map((r: any) => r.vendor_id),
    ].filter(Boolean))];

    const inviteeNameById = new Map<string, string>();
    if (inviteeIds.length > 0) {
      const { data: inviteeProfiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", inviteeIds);
      (inviteeProfiles || []).forEach((p: any) => {
        inviteeNameById.set(p.user_id, [dec(p.first_name), dec(p.last_name)].filter(Boolean).join(" "));
      });
    }

    // Collect event IDs from team assignments not already in eventNameById
    const assignedEventIds = (assignedTeamRows || [])
      .map((r: any) => r.event_id)
      .filter((id: string) => id && !eventNameById.has(id));
    if (assignedEventIds.length > 0) {
      const { data: assignedEvents } = await supabaseAdmin
        .from("events")
        .select("id, event_name, venue")
        .in("id", [...new Set(assignedEventIds)]);
      (assignedEvents || []).forEach((e: any) => eventNameById.set(e.id, e.event_name || e.venue || e.id));
    }

    // ── 13. Audit log actions by this user ─────────────────────────────────
    const { data: auditLogs } = await supabaseAdmin
      .from("audit_logs")
      .select("id, action, resource_type, resource_id, ip_address, success, metadata, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);

    // ── 14. Form audit trail by this user ──────────────────────────────────
    const { data: formAudit } = await supabaseAdmin
      .from("form_audit_trail")
      .select("id, form_id, form_type, action, field_changed, old_value, new_value, ip_address, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500);

    // ── 15. Sick leaves approved BY this user ──────────────────────────────
    let approvedLeaves: any[] = [];
    try {
      const { data: al, error: alErr } = await supabaseAdmin
        .from("sick_leaves")
        .select("id, user_id, start_date, end_date, duration_hours, status, reason, approved_at, created_at")
        .eq("approved_by", userId)
        .order("approved_at", { ascending: false });
      if (!alErr) approvedLeaves = al || [];
    } catch { /* table may not exist */ }

    // Enrich sick leaves with worker names
    const leaveWorkerIds = [...new Set((approvedLeaves || []).map((l: any) => l.user_id).filter(Boolean))];
    const leaveWorkerNameById = new Map<string, string>();
    if (leaveWorkerIds.length > 0) {
      const { data: leaveProfiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, first_name, last_name")
        .in("user_id", leaveWorkerIds);
      (leaveProfiles || []).forEach((p: any) => {
        leaveWorkerNameById.set(p.user_id, [dec(p.first_name), dec(p.last_name)].filter(Boolean).join(" "));
      });
    }

    // ── 16. Timesheet edits on events this user manages ────────────────────
    // Try edited_by column; silently ignore if it doesn't exist
    let timesheetEdits: any[] = [];
    try {
      const { data: te, error: teErr } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, event_id, action, timestamp, notes, created_at")
        .eq("edited_by", userId)
        .order("created_at", { ascending: false });
      if (!teErr) timesheetEdits = te || [];
    } catch { /* column may not exist */ }

    // Also fetch edit-action time entries for events created by this user
    const createdEventIds = (createdEvents || []).map((e: any) => e.id).filter(Boolean);
    let eventTimesheetEdits: any[] = [];
    if (createdEventIds.length > 0) {
      const { data: evtEdits } = await supabaseAdmin
        .from("time_entries")
        .select("id, user_id, event_id, action, timestamp, notes, created_at")
        .in("event_id", createdEventIds)
        .not("notes", "is", null)
        .ilike("notes", "%edit%")
        .order("created_at", { ascending: false })
        .limit(200);
      eventTimesheetEdits = evtEdits || [];
    }

    // Resolve any event IDs in timesheet edits not yet in the map
    const allTsEventIds = [
      ...timesheetEdits.map((r: any) => r.event_id),
      ...eventTimesheetEdits.map((r: any) => r.event_id),
    ].filter((id): id is string => !!id && !eventNameById.has(id));
    const missingEventIds = [...new Set(allTsEventIds)];
    if (missingEventIds.length > 0) {
      const { data: missingEvents } = await supabaseAdmin
        .from("events")
        .select("id, event_name, venue")
        .in("id", missingEventIds);
      (missingEvents || []).forEach((e: any) => eventNameById.set(e.id, e.event_name || e.venue || e.id));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Build workbook
    // ─────────────────────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // Sheet 1: Profile Summary
    const profileSheet = XLSX.utils.aoa_to_sheet([
      ["Field", "Value"],
      ["User ID", userData.id],
      ["Full Name", fullName],
      ["Email", userData.email || ""],
      ["Role", userData.role || ""],
      ["Division", userData.division || ""],
      ["Active", userData.is_active ? "Yes" : "No"],
      [""],
      ["Phone", dec(profile?.phone)],
      ["Address", dec(profile?.address)],
      ["City", dec(profile?.city)],
      ["State", dec(profile?.state)],
      ["Zip Code", dec(profile?.zip_code)],
      ["Latitude", profile?.latitude ?? ""],
      ["Longitude", profile?.longitude ?? ""],
      ["Region ID", profile?.region_id ?? ""],
      [""],
      ["Account Created", fmtDate(userData.created_at)],
      ["Profile Updated", fmtDate(profile?.updated_at)],
      ["MFA Enabled", profile?.mfa_enabled ? "Yes" : "No"],
      [""],
      ["Background Check Completed", userData.background_check_completed || bgCheck?.background_check_completed ? "Yes" : "No"],
      ["Background Check Date", fmtDate(bgCheck?.completed_date)],
      ["BG Check Notes", bgCheck?.notes || ""],
      [""],
      ["Onboarding PDF Submitted", profile?.onboarding_completed_at ? "Yes" : "No"],
      ["Onboarding PDF Submitted At", fmtDate(profile?.onboarding_completed_at)],
      ["Onboarding Approved", onboarding?.onboarding_completed ? "Yes" : "No"],
      ["Onboarding Approved Date", fmtDate(onboarding?.completed_date)],
    ]);
    // Style the header row
    profileSheet["!cols"] = [{ wch: 30 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, profileSheet, "Profile");

    // Sheet 2: Time Entries
    const timeHeaders = ["Entry ID", "Action", "Date & Time", "Event ID", "Event Name", "Notes"];
    const timeRows = (timeEntries || []).map((t: any) => [
      t.id,
      t.action,
      fmtDate(t.timestamp),
      t.event_id || "",
      t.event_id ? (eventNameById.get(t.event_id) || "") : "",
      t.notes || "",
    ]);
    const timeSheet = XLSX.utils.aoa_to_sheet([timeHeaders, ...timeRows]);
    timeSheet["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 22 }, { wch: 36 }, { wch: 30 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, timeSheet, "Time Entries");

    // Sheet 3: Shifts (computed)
    const shiftHeaders = ["Date", "Clock In", "Clock Out", "Hours", "Event ID", "Event Name"];
    const shiftRows = shifts.map(s => [
      s.date,
      fmtDate(s.clock_in),
      fmtDate(s.clock_out),
      s.hours,
      s.event_id || "",
      s.event_id ? (eventNameById.get(s.event_id) || "") : "",
    ]);
    const totalHours = shifts.reduce((sum, s) => sum + s.hours, 0);
    const shiftSheet = XLSX.utils.aoa_to_sheet([
      shiftHeaders,
      ...shiftRows,
      [],
      ["", "", "TOTAL HOURS", Math.round(totalHours * 100) / 100, "", ""],
    ]);
    shiftSheet["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 10 }, { wch: 36 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, shiftSheet, "Shifts & Hours");

    // Sheet 4: Events
    const eventHeaders = ["Event ID", "Event Name", "Artist", "Venue", "City", "State", "Date", "Start Time", "End Time", "Ticket Sales", "Commission Pool", "Required Staff", "Team Status", "Confirmed At"];
    const eventRows = events.map((e: any) => {
      const team = teamByEvent.get(e.id);
      return [
        e.id,
        e.event_name || "",
        e.artist || "",
        e.venue || "",
        e.city || "",
        e.state || "",
        e.event_date || "",
        e.start_time || "",
        e.end_time || "",
        e.ticket_sales ?? "",
        e.commission_pool ?? "",
        e.required_staff ?? "",
        team?.status || "",
        fmtDate(team?.confirmed_at),
      ];
    });
    const eventsSheet = XLSX.utils.aoa_to_sheet([eventHeaders, ...eventRows]);
    eventsSheet["!cols"] = [{ wch: 36 }, { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, eventsSheet, "Events");

    // Sheet 5: Form Signatures
    const sigHeaders = ["Form ID", "Form Type", "Role", "Signed At", "Valid", "IP Address"];
    const sigRows = (signatures || []).map((s: any) => [
      s.form_id || "",
      s.form_type || "",
      s.signature_role || "",
      fmtDate(s.signed_at),
      s.is_valid ? "Yes" : "No",
      s.ip_address || "",
    ]);
    const sigsSheet = XLSX.utils.aoa_to_sheet([sigHeaders, ...sigRows]);
    sigsSheet["!cols"] = [{ wch: 36 }, { wch: 25 }, { wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, sigsSheet, "Form Signatures");

    // Sheet 6: Payments
    if ((payments || []).length > 0) {
      const payKeys = Object.keys(payments![0]).filter(k => k !== "signature_data");
      const payHeaders = payKeys;
      const payRows = (payments || []).map((p: any) =>
        payKeys.map(k => {
          const v = p[k];
          if (typeof v === "string" && (k.endsWith("_at") || k === "created_at" || k === "updated_at")) return fmtDate(v);
          return v ?? "";
        })
      );
      const paymentsSheet = XLSX.utils.aoa_to_sheet([payHeaders, ...payRows]);
      XLSX.utils.book_append_sheet(wb, paymentsSheet, "Payments");
    }

    // Sheet 7: Background Check PDFs
    const bgPdfHeaders = ["PDF ID", "Submitted At"];
    const bgPdfRows = (bgPdfs || []).map((p: any) => [p.id, fmtDate(p.created_at)]);
    const bgDownloadRows = (pdfDownloads || []).map((d: any) => fmtDate(d.downloaded_at));
    const bgSheet = XLSX.utils.aoa_to_sheet([
      ["Background Check PDFs"],
      bgPdfHeaders,
      ...bgPdfRows,
      [],
      ["PDF Downloads"],
      ["Downloaded At"],
      ...bgDownloadRows.map(d => [d]),
    ]);
    bgSheet["!cols"] = [{ wch: 36 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, bgSheet, "Background Check PDFs");

    // Sheet 8: Events Created by User
    const createdEventsHeaders = ["Event ID", "Event Name", "Artist", "Venue", "City", "State", "Date", "Start", "End", "Ticket Sales", "Commission Pool", "Required Staff", "Confirmed Staff", "Active", "Created At", "Updated At"];
    const createdEventsRows = (createdEvents || []).map((e: any) => [
      e.id, e.event_name || "", e.artist || "", e.venue || "", e.city || "", e.state || "",
      e.event_date || "", e.start_time || "", e.end_time || "",
      e.ticket_sales ?? "", e.commission_pool ?? "", e.required_staff ?? "", e.confirmed_staff ?? "",
      e.is_active ? "Yes" : "No", fmtDate(e.created_at), fmtDate(e.updated_at),
    ]);
    const createdEventsSheet = XLSX.utils.aoa_to_sheet([createdEventsHeaders, ...createdEventsRows]);
    createdEventsSheet["!cols"] = createdEventsHeaders.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, createdEventsSheet, "Events Created");

    // Sheet 9: Invitations Sent by User (vendor_invitations + event_teams assignments)
    const inviteHeaders = ["Source", "Invite ID", "Invitee Name", "Status", "Type", "Event Name", "Start Date", "End Date", "Responded At", "Expires At", "Sent At"];
    const inviteRows = [
      ...(sentInvitations || []).map((i: any) => [
        "Email Invite",
        i.id,
        inviteeNameById.get(i.vendor_id) || i.vendor_id || "",
        i.status || "",
        i.invitation_type || "event",
        i.event_id ? (eventNameById.get(i.event_id) || i.event_id) : "",
        i.start_date || "",
        i.end_date || "",
        fmtDate(i.responded_at),
        fmtDate(i.expires_at),
        fmtDate(i.created_at),
      ]),
      ...(assignedTeamRows || []).map((r: any) => [
        "Team Assignment",
        r.confirmation_token ? r.confirmation_token.slice(0, 8) + "…" : "—",
        inviteeNameById.get(r.vendor_id) || r.vendor_id || "",
        r.status || "",
        "team",
        r.event_id ? (eventNameById.get(r.event_id) || r.event_id) : "",
        "", "",
        "", "",
        fmtDate(r.created_at),
      ]),
    ];
    const invitesSheet = XLSX.utils.aoa_to_sheet([inviteHeaders, ...inviteRows]);
    invitesSheet["!cols"] = [{ wch: 16 }, { wch: 20 }, { wch: 25 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, invitesSheet, "Invitations Sent");

    // Sheet 10: Timesheet Edits (on events they manage)
    const tsEditHeaders = ["Entry ID", "Worker ID", "Event ID", "Event Name", "Action", "Timestamp", "Notes", "Created At"];
    const tsEditRows = [
      ...(timesheetEdits || []),
      ...eventTimesheetEdits.filter((r: any) => r.user_id !== userId),
    ].map((r: any) => [
      r.id, r.user_id || "", r.event_id || "",
      r.event_id ? (eventNameById.get(r.event_id) || "") : "",
      r.action || "", fmtDate(r.timestamp), r.notes || "", fmtDate(r.created_at),
    ]);
    const tsEditsSheet = XLSX.utils.aoa_to_sheet([tsEditHeaders, ...tsEditRows]);
    tsEditsSheet["!cols"] = [{ wch: 36 }, { wch: 36 }, { wch: 36 }, { wch: 28 }, { wch: 14 }, { wch: 22 }, { wch: 40 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, tsEditsSheet, "Timesheet Edits");

    // Sheet 11: Audit Log (all actions by user)
    if ((auditLogs || []).length > 0) {
      const auditHeaders = ["ID", "Action", "Resource Type", "Resource ID", "Success", "IP Address", "Metadata", "Timestamp"];
      const auditRows = (auditLogs || []).map((a: any) => [
        a.id, a.action || "", a.resource_type || "", a.resource_id || "",
        a.success ? "Yes" : "No", a.ip_address || "",
        a.metadata ? JSON.stringify(a.metadata) : "",
        fmtDate(a.created_at),
      ]);
      const auditSheet = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]);
      auditSheet["!cols"] = [{ wch: 36 }, { wch: 30 }, { wch: 18 }, { wch: 36 }, { wch: 8 }, { wch: 18 }, { wch: 50 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, auditSheet, "Audit Log");
    }

    // Sheet 12: Form Audit Trail
    if ((formAudit || []).length > 0) {
      const fAuditHeaders = ["ID", "Form ID", "Form Type", "Action", "Field Changed", "Old Value", "New Value", "IP Address", "Timestamp"];
      const fAuditRows = (formAudit || []).map((a: any) => [
        a.id, a.form_id || "", a.form_type || "", a.action || "",
        a.field_changed || "", a.old_value || "", a.new_value || "",
        a.ip_address || "", fmtDate(a.created_at),
      ]);
      const fAuditSheet = XLSX.utils.aoa_to_sheet([fAuditHeaders, ...fAuditRows]);
      fAuditSheet["!cols"] = [{ wch: 36 }, { wch: 36 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 25 }, { wch: 25 }, { wch: 18 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, fAuditSheet, "Form Audit Trail");
    }

    // Sheet 13: Sick Leaves Approved by User
    if ((approvedLeaves || []).length > 0) {
      const leaveHeaders = ["Leave ID", "Worker Name", "Worker ID", "Start Date", "End Date", "Hours", "Status", "Reason", "Approved At", "Created At"];
      const leaveRows = (approvedLeaves || []).map((l: any) => [
        l.id,
        leaveWorkerNameById.get(l.user_id) || l.user_id || "",
        l.user_id || "",
        l.start_date || "", l.end_date || "",
        l.duration_hours ?? "",
        l.status || "", l.reason || "",
        fmtDate(l.approved_at), fmtDate(l.created_at),
      ]);
      const leavesSheet = XLSX.utils.aoa_to_sheet([leaveHeaders, ...leaveRows]);
      leavesSheet["!cols"] = [{ wch: 36 }, { wch: 25 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, leavesSheet, "Sick Leaves Approved");
    }

    // ── Write to buffer ────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const safeFileName = fullName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="user_${safeFileName}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[USER-EXPORT]", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
