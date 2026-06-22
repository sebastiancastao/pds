// Supabase Edge Function: event-reminder
// ---------------------------------------------------------------------------
// Sends a reminder email the NIGHT BEFORE a "Non Event Time Sheet"
// (events.event_type = 'special') takes place, to every assigned team member
// who hasn't declined, including a link to their timesheet.
//
// TIMING: the reminder fires at REMINDER_HOUR_LOCAL (20:00 = 8 PM) on the day
// before the event, measured in the RECIPIENT's own real-life timezone
// (profiles.timezone if set, else derived from profiles.state). So a user in
// New York and a user in Los Angeles each get reminded at 8 PM their own local
// time the evening before. It sends on the first cron tick at/after that 8 PM,
// and never after the event has already started. The email shows the event's
// start in the user's local time, plus the event's location timezone for
// context when it differs.
//
// Trigger: invoked every ~5 minutes by a pg_cron job. Sends are de-duplicated
// via the public.event_reminder_log table, so re-invocation never sends twice.
//
// Resend key: RESEND_API_KEY secret, or (fallback) Vault secret 'resend_api_key'
// via public.get_app_secret(). Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional: RESEND_FROM_EVENTS / RESEND_FROM (sender), APP_URL (link base).
// ---------------------------------------------------------------------------

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const REMINDER_TYPE = "night_before";
const REMINDER_DAYS_BEFORE = 1; // the evening before the event day
const REMINDER_HOUR_LOCAL = 20; // 20:00 = 8 PM local "night" send time
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_APP_URL = "https://pds-murex.vercel.app";

// 2-letter US state -> IANA timezone (mirrors lib/timezones.ts in the app repo).
const STATE_TIMEZONE_MAP: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/; // allows HH:MM, HH:MM:SS, HH:MM:SS.ffffff
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getTimezoneForState(state: string | null | undefined): string {
  if (!state) return DEFAULT_TIMEZONE;
  const normalized = state.toUpperCase().trim();
  return STATE_TIMEZONE_MAP[normalized] ?? DEFAULT_TIMEZONE;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Prefer an explicit per-user IANA timezone (profiles.timezone); otherwise fall
// back to the US state -> timezone mapping. Lets non-US / traveling users get
// reminders in their real local time.
function resolveUserTimezone(
  timezone: string | null | undefined,
  state: string | null | undefined,
): string {
  const tz = (timezone || "").trim();
  if (tz && isValidTimeZone(tz)) return tz;
  return getTimezoneForState(state);
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const token = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;

  if (!token || token === "GMT" || token === "UTC") return 0;
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(token);
  if (!match) throw new Error(`Unsupported time zone offset token: ${token}`);
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

// Interpret a local date + time-of-day in `timeZone` and return the absolute
// UTC instant as a Date. Iterates to settle DST boundaries (mirrors app logic).
function zonedToUtc(
  dateStr: string,
  timeValue: string | null | undefined,
  timeZone: string,
): Date | null {
  const d = DATE_RE.exec(dateStr || "");
  const t = TIME_RE.exec((timeValue || "").trim());
  if (!d || !t) return null;

  let hours = Number(t[1]);
  const minutes = Number(t[2]);
  const seconds = t[3] ? Number(t[3]) : 0;
  if (hours === 24 && minutes === 0 && seconds === 0) hours = 0;
  if (hours < 0 || hours > 23 || minutes > 59 || seconds > 59) return null;

  const localMsAsUtc = Date.UTC(
    Number(d[1]), Number(d[2]) - 1, Number(d[3]), hours, minutes, seconds, 0,
  );

  let offset = getTimeZoneOffsetMinutes(new Date(localMsAsUtc), timeZone);
  let utcMs = localMsAsUtc - offset * 60_000;
  for (let i = 0; i < 2; i++) {
    const adjusted = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
    if (adjusted === offset) break;
    offset = adjusted;
    utcMs = localMsAsUtc - offset * 60_000;
  }
  return new Date(utcMs);
}

// e.g. "Tue, Jun 23, 2026, 2:00 PM PDT"
function formatInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test((email || "").trim());
}

function ymdUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Add/subtract whole days from a YYYY-MM-DD string, returning YYYY-MM-DD.
function addDaysToYmd(ymd: string, days: number): string | null {
  const m = DATE_RE.exec(ymd || "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The calendar date (YYYY-MM-DD) in a given timezone for an instant.
function ymdInTz(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const da = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${mo}-${da}`;
}

// Whole-day difference (b - a) between two YYYY-MM-DD strings.
function daysBetweenYmd(a: string, b: string): number | null {
  const ma = DATE_RE.exec(a || "");
  const mb = DATE_RE.exec(b || "");
  if (!ma || !mb) return null;
  const ua = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const ub = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((ub - ua) / 86_400_000);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(opts: {
  eventName: string;
  venue: string | null;
  city: string | null;
  state: string | null;
  startUtc: Date;
  userTz: string;
  eventTz: string;
  timesheetUrl: string;
  whenWord: string | null;
}): string {
  const eventName = escapeHtml(opts.eventName || "Your event");
  const heading = opts.whenWord ? `Reminder: event ${opts.whenWord}` : "Upcoming event reminder";
  const intro = opts.whenWord
    ? `This is a reminder that you're scheduled for the following event ${opts.whenWord}.`
    : "This is a reminder that you have the following event coming up.";
  const localTimeStr = formatInTz(opts.startUtc, opts.userTz);
  const eventTimeStr = formatInTz(opts.startUtc, opts.eventTz);
  const differentTz = opts.eventTz !== opts.userTz;
  const url = escapeHtml(opts.timesheetUrl);

  const locationParts = [
    opts.venue,
    [opts.city, opts.state].filter(Boolean).join(", "),
  ].filter((p) => p && p.trim().length > 0) as string[];
  const location = escapeHtml(locationParts.join(" — "));

  const eventTzRow = differentTz
    ? `
      <tr>
        <td style="padding:8px 0;"><strong style="color:#555;">Event location time:</strong></td>
        <td style="padding:8px 0;text-align:right;"><span style="color:#333;font-size:16px;">${escapeHtml(eventTimeStr)}</span></td>
      </tr>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Event Reminder</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f5;padding:40px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:36px 30px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:26px;">📅 ${heading}</h1>
            <p style="color:#e6e6ff;margin:10px 0 0 0;font-size:16px;">${eventName}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 30px;">
            <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 20px 0;">
              ${intro}
            </p>
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8f9fa;border-radius:8px;border:2px solid #667eea;margin:20px 0;">
              <tr><td style="padding:24px;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">What:</strong></td>
                    <td style="padding:8px 0;text-align:right;"><span style="color:#333;font-size:16px;">${eventName}</span></td>
                  </tr>
                  ${location ? `
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">Where:</strong></td>
                    <td style="padding:8px 0;text-align:right;"><span style="color:#333;font-size:16px;">${location}</span></td>
                  </tr>` : ""}
                  <tr>
                    <td style="padding:8px 0;"><strong style="color:#555;">When (your time):</strong></td>
                    <td style="padding:8px 0;text-align:right;"><span style="color:#333;font-size:16px;">${escapeHtml(localTimeStr)}</span></td>
                  </tr>
                  ${eventTzRow}
                </table>
              </td></tr>
            </table>

            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 4px 0;">
              <tr><td align="center">
                <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#ffffff;text-decoration:none;padding:15px 40px;border-radius:6px;font-size:16px;font-weight:bold;">
                  Open Your Timesheet
                </a>
              </td></tr>
              <tr><td align="center" style="padding-top:14px;">
                <p style="color:#666;font-size:13px;margin:0;">
                  Or copy and paste this link:<br>
                  <a href="${url}" style="color:#667eea;text-decoration:none;word-break:break-all;">${url}</a>
                </p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#f8f9fa;padding:24px 30px;text-align:center;border-top:1px solid #e0e0e0;">
            <p style="color:#999;font-size:11px;margin:0;">© ${new Date().getFullYear()} PDS. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

async function sendResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: `[${res.status}] ${payload?.message || res.statusText}` };
    }
    return { ok: true, id: payload?.id };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

Deno.serve(async (req: Request) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("RESEND_FROM_EVENTS") ||
      Deno.env.get("RESEND_FROM") ||
      "PDS Events <service@pdsportal.site>";
    const APP_URL = (Deno.env.get("APP_URL") ||
      Deno.env.get("NEXT_PUBLIC_APP_URL") ||
      DEFAULT_APP_URL).replace(/\/+$/, "");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    // Optional { "dryRun": true } body: resolves recipients without sending.
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dryRun === true;
    } catch (_) { /* empty body is fine */ }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Fall back to the Vault-stored key if no env secret is configured.
    if (!RESEND_API_KEY) {
      const { data: vaultKey } = await supabase.rpc("get_app_secret", {
        secret_name: "resend_api_key",
      });
      if (typeof vaultKey === "string" && vaultKey.trim().length > 0) {
        RESEND_API_KEY = vaultKey.trim();
      }
    }

    if (!dryRun && !RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY is not set (env or Vault)" }, 500);
    }

    const now = new Date();
    // Widen the calendar window to ±2 days so per-user start instants (which can
    // be many hours from UTC midnight depending on the user's timezone) are caught.
    const fromDate = ymdUTC(new Date(now.getTime() - 2 * 86_400_000));
    const toDate = ymdUTC(new Date(now.getTime() + 2 * 86_400_000));

    const { data: events, error: evErr } = await supabase
      .from("events")
      .select("id,event_name,venue,city,state,event_date,start_time,event_type,is_active")
      .eq("event_type", "special")
      .eq("is_active", true)
      .gte("event_date", fromDate)
      .lte("event_date", toDate);
    if (evErr) throw evErr;

    const results: Array<Record<string, unknown>> = [];
    let sentCount = 0;

    for (const ev of events ?? []) {
      if (!ev.start_time) continue;
      const eventTz = getTimezoneForState(ev.state);

      // "Assigned team members" = everyone on the team who hasn't declined
      // (covers confirmed, pending_confirmation, pending, invited).
      const { data: team, error: teamErr } = await supabase
        .from("event_teams")
        .select("vendor_id,status")
        .eq("event_id", ev.id)
        .neq("status", "declined");
      if (teamErr) throw teamErr;

      const vendorIds = [...new Set((team ?? []).map((t) => t.vendor_id).filter(Boolean))];
      if (vendorIds.length === 0) continue;

      const { data: sent } = await supabase
        .from("event_reminder_log")
        .select("vendor_id")
        .eq("event_id", ev.id)
        .eq("reminder_type", REMINDER_TYPE)
        .in("vendor_id", vendorIds);
      const sentSet = new Set((sent ?? []).map((s) => s.vendor_id));
      const pending = vendorIds.filter((id) => !sentSet.has(id));
      if (pending.length === 0) continue;

      const [{ data: users }, { data: profiles }] = await Promise.all([
        supabase.from("users").select("id,email").in("id", pending),
        supabase.from("profiles").select("user_id,state,timezone").in("user_id", pending),
      ]);
      const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));
      const profById = new Map((profiles ?? []).map((p) => [p.user_id, p]));

      for (const vendorId of pending) {
        const email = emailById.get(vendorId);
        if (!email || !isValidEmail(email)) {
          results.push({ event_id: ev.id, vendor_id: vendorId, skipped: "no valid email" });
          continue;
        }

        // Resolve the recipient's real-life timezone.
        const prof = profById.get(vendorId);
        const userTz = resolveUserTimezone(prof?.timezone, prof?.state);

        // Event start in the user's timezone, and the night-before send instant
        // (REMINDER_HOUR_LOCAL on the day before the event, same zone).
        const startUtc = zonedToUtc(ev.event_date, ev.start_time, userTz);
        const reminderYmd = addDaysToYmd(ev.event_date, -REMINDER_DAYS_BEFORE);
        const sendAtUtc = reminderYmd
          ? zonedToUtc(reminderYmd, `${String(REMINDER_HOUR_LOCAL).padStart(2, "0")}:00`, userTz)
          : null;
        if (!startUtc || !sendAtUtc) continue;

        // Fire on/after the night-before send time, but not once the event has started.
        if (!(now.getTime() >= sendAtUtc.getTime() && now.getTime() < startUtc.getTime())) continue;

        // Relative day wording for the copy ("tomorrow"/"today"), from the
        // recipient's local date right now.
        const dayDiff = daysBetweenYmd(ymdInTz(now, userTz), ev.event_date);
        const whenWord = dayDiff === 1 ? "tomorrow" : dayDiff === 0 ? "today" : null;

        const timesheetUrl = `${APP_URL}/time-sheets/${ev.id}`;

        if (dryRun) {
          results.push({
            event_id: ev.id, vendor_id: vendorId, email,
            user_tz: userTz, event_tz: eventTz,
            event_date: ev.event_date, when: whenWord,
            send_at_utc: sendAtUtc.toISOString(),
            start_utc: startUtc.toISOString(),
            timesheet_url: timesheetUrl, dryRun: true,
          });
          continue;
        }

        // Claim the send first (unique constraint prevents concurrent double-send).
        const { error: claimErr } = await supabase
          .from("event_reminder_log")
          .insert({
            event_id: ev.id,
            vendor_id: vendorId,
            reminder_type: REMINDER_TYPE,
            recipient_email: email,
          });
        if (claimErr) {
          // 23505 = already claimed by a concurrent run; skip quietly.
          continue;
        }

        const subject = `Reminder: ${ev.event_name || "Your event"} is ${whenWord ?? "coming up"}`;
        const html = buildEmailHtml({
          eventName: ev.event_name,
          venue: ev.venue,
          city: ev.city,
          state: ev.state,
          startUtc,
          userTz,
          eventTz,
          timesheetUrl,
          whenWord,
        });

        const sendRes = await sendResend(RESEND_API_KEY!, FROM, email, subject, html);
        if (!sendRes.ok) {
          // Roll back the claim so the next cron tick retries this recipient.
          await supabase
            .from("event_reminder_log")
            .delete()
            .eq("event_id", ev.id)
            .eq("vendor_id", vendorId)
            .eq("reminder_type", REMINDER_TYPE);
          results.push({ event_id: ev.id, vendor_id: vendorId, email, error: sendRes.error });
          continue;
        }

        await supabase
          .from("event_reminder_log")
          .update({ resend_message_id: sendRes.id })
          .eq("event_id", ev.id)
          .eq("vendor_id", vendorId)
          .eq("reminder_type", REMINDER_TYPE);

        sentCount++;
        results.push({ event_id: ev.id, vendor_id: vendorId, email, message_id: sendRes.id });
      }
    }

    return json(
      { ok: true, now: now.toISOString(), candidates: events?.length ?? 0, sent: sentCount, results },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
