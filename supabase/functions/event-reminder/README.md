# event-reminder

Supabase Edge Function that emails a reminder **the night before a Non Event Time
Sheet** (`events.event_type = 'special'`) — at 8 PM local time the evening before.

## What it does

On each invocation it:

1. Loads active `special` events whose `event_date` is within ±2 days (UTC).
2. For each assigned team member who hasn't declined (`event_teams`), resolves
   **that recipient's own real-life timezone**: `profiles.timezone` (an explicit
   IANA zone like `America/Bogota`) when set, otherwise the zone mapped from
   `profiles.state`. This lets non-US / traveling users get reminders in their
   real local time.
3. Sends the reminder once the clock reaches `REMINDER_HOUR_LOCAL` (20:00 = 8 PM)
   on the day before the event (`REMINDER_DAYS_BEFORE` = 1) in that recipient's
   timezone, and only while the event hasn't started yet. So two users in
   different timezones get reminded at 8 PM their *own* local time the evening
   before — different absolute moments. (Change `REMINDER_HOUR_LOCAL` /
   `REMINDER_DAYS_BEFORE` at the top of `index.ts` to adjust.)
4. Emails via Resend with the start shown in the recipient's local time (plus
   the event's location timezone for context when it differs) and a
   **"Open Your Timesheet"** button linking to `{APP_URL}/time-sheets/{eventId}`.
5. Records each send in `public.event_reminder_log` (unique on
   `event_id, vendor_id, reminder_type`) so nobody is reminded twice.

Because it is idempotent, it is safe to invoke as often as you like — only
genuinely-due, not-yet-sent reminders go out.

## Scheduling

A `pg_cron` job (`event-1h-reminder`) calls it every 5 minutes through `pg_net`.
See `supabase/migrations/20260621000002_schedule_event_reminder.sql`.

## Configuration

| Variable | Source | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | env secret **or** Vault | required to send. Read from the env secret if set; otherwise from the Vault secret `resend_api_key` via `public.get_app_secret()`. Currently stored in Vault. |
| `RESEND_FROM_EVENTS` / `RESEND_FROM` | optional secret | sender; defaults to `PDS Events <service@pdsportal.site>` |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | optional secret | base for the timesheet link; defaults to `https://pds-murex.vercel.app` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | DB access |

The Resend key lives in Vault because Edge Function dashboard secrets can't be
set via the management API. To move it to a normal env secret later, add
`RESEND_API_KEY` under Dashboard → Edge Functions → Secrets (it takes precedence)
and optionally drop the Vault copy:
`select vault.delete_secret((select id from vault.secrets where name='resend_api_key'));`

## Manual test

```bash
curl -X POST \
  'https://bwvnvzlmqqcdemkpecjw.supabase.co/functions/v1/event-reminder' \
  -H "Authorization: Bearer $ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"dryRun": true}'
```

`dryRun: true` resolves the recipients and computes the timezone-aware times
**without** sending email or writing to the log.
