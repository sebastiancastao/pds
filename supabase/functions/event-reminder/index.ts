// Supabase Edge Function: event-reminder
// ---------------------------------------------------------------------------
// Sends a reminder email ~1 hour before a "Non Event Time Sheet"
// (events.event_type = 'special') starts, to every assigned/confirmed team
// member. The email shows the start time in BOTH the event's local timezone
// (derived from events.state) AND the recipient's own local timezone
// (derived from profiles.state), so it is unambiguous across timezones.
//
// Trigger: invoked every ~5 minutes by a pg_cron job (see the
// schedule_event_reminder migration). Sends are de-duplicated via the
// public.event_reminder_log table, so re-invocation never sends twice.
//
// Required secret: RESEND_API_KEY  (set via the Supabase dashboard).
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional: RESEND_FROM_EVENTS / RESEND_FROM (sender address).
// ---------------------------------------------------------------------------

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const REMINDER_TYPE = "start_1h";
const WINDOW_MINUTES = 60; // fire once the event is <= 60 min away (and not yet started)
const DEFAULT_TIMEZONE = "America/Los_Angeles";

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
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getTimezoneForState(state: string | null | undefined): string {
  if (!state) return DEFAULT_TIMEZONE;
  const normalized = state.toUpperCase().trim();
  return STATE_TIMEZONE_MAP[normalized] ?? DEFAULT_TIMEZONE;
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
  eventTz: string;
  userTz: string;
}): string {
  const eventName = escapeHtml(opts.eventName || "Your event");
  const eventTimeStr = formatInTz(opts.startUtc, opts.eventTz);
  const userTimeStr = formatInTz(opts.startUtc, opts.userTz);
  const differentTz = opts.eventTz !== opts.userTz;

  const locationParts = [
    opts.venue,
    [opts.city, opts.state].filter(Boolean).join(", "),
  ].filter((p) => p && p.trim().length > 0) as string[];
  const location = escapeHtml(locationParts.join(" — "));

  const localTimeRow = differentTz
    ? `
      <tr>
        <td style="padding:8px 0;"><strong style="color:#555;">Your local time:</strong></td>
        <td style="padding:8px 0;text-align:right;"><span style="color:#333;font-size:16px;">${escapeHtml(userTimeStr)}</span></td>
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
            <h1 style="color:#ffffff;margin:0;font-size:26px;">⏰ Starting in about 1 hour</h1>
            <p style="color:#e6e6ff;margin:10px 0 0 0;font-size:16px;">${eventName}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 30px;">
            <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 20px 0;">
              This is a reminder that you're scheduled for the following. It starts in approximately one hour.
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
                    <td style="padding:8px 0;"><strong style="color:#555;">Starts (event time):</strong></td>
                    <td style="padding:8px 0;text-align:right;"><span style="color:#333;font-size:16px;">${escapeHtml(eventTimeStr)}</span></td>
                  </tr>
                  ${localTimeRow}
                </table>
              </td></tr>
            </table>
            ${differentTz ? `
            <p style="color:#777;font-size:13px;line-height:1.6;margin:0;">
              Times above are shown in the event's local timezone and in your local timezone.
            </p>` : ""}
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
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM = Deno.env.get("RESEND_FROM_EVENTS") ||
      Deno.env.get("RESEND_FROM") ||
      "PDS Events <service@pdsportal.site>";

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    // Optional { "dryRun": true } body: resolves recipients without sending.
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dryRun === true;
    } catch (_) { /* empty body is fine */ }

    if (!dryRun && !RESEND_API_KEY) {
      return json({ error: "RESEND_API_KEY is not set" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    const now = new Date();
    const fromDate = ymdUTC(new Date(now.getTime() - 86_400_000)); // today-1 (UTC)
    const toDate = ymdUTC(new Date(now.getTime() + 86_400_000)); // today+1 (UTC)

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
      const eventTz = getTimezoneForState(ev.state);
      const startUtc = zonedToUtc(ev.event_date, ev.start_time, eventTz);
      if (!startUtc) continue;

      const minutesUntil = (startUtc.getTime() - now.getTime()) / 60_000;
      // Fire once the event is within the next hour and hasn't started yet.
      if (!(minutesUntil > 0 && minutesUntil <= WINDOW_MINUTES)) continue;

      const { data: team, error: teamErr } = await supabase
        .from("event_teams")
        .select("vendor_id,status")
        .eq("event_id", ev.id)
        .in("status", ["assigned", "confirmed"]);
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
        supabase.from("profiles").select("user_id,state").in("user_id", pending),
      ]);
      const emailById = new Map((users ?? []).map((u) => [u.id, u.email]));
      const stateById = new Map((profiles ?? []).map((p) => [p.user_id, p.state]));

      for (const vendorId of pending) {
        const email = emailById.get(vendorId);
        if (!email || !isValidEmail(email)) {
          results.push({ event_id: ev.id, vendor_id: vendorId, skipped: "no valid email" });
          continue;
        }
        const userTz = getTimezoneForState(stateById.get(vendorId)) || eventTz;

        if (dryRun) {
          results.push({
            event_id: ev.id, vendor_id: vendorId, email,
            event_tz: eventTz, user_tz: userTz,
            start_utc: startUtc.toISOString(),
            minutes_until: Math.round(minutesUntil), dryRun: true,
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

        const subject = `Reminder: ${ev.event_name || "Your event"} starts in about 1 hour`;
        const html = buildEmailHtml({
          eventName: ev.event_name,
          venue: ev.venue,
          city: ev.city,
          state: ev.state,
          startUtc,
          eventTz,
          userTz,
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
