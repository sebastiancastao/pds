# event-reminder

Supabase Edge Function that emails a reminder **~1 hour before a Non Event Time
Sheet** (`events.event_type = 'special'`) starts.

## What it does

On each invocation it:

1. Loads active `special` events whose `event_date` is within ±1 day (UTC).
2. Computes each event's absolute start: `event_date` + `start_time` interpreted
   in the **event's timezone** (derived from `events.state`).
3. Keeps only events starting within the next `WINDOW_MINUTES` (60) and not yet
   started.
4. For each assigned/confirmed member in `event_teams`, sends an email via Resend
   showing the start time in **both** the event timezone and the **recipient's
   own timezone** (derived from `profiles.state`).
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
| `RESEND_API_KEY` | **set manually** (dashboard → Edge Functions → Secrets) | required to send |
| `RESEND_FROM_EVENTS` / `RESEND_FROM` | optional secret | sender; defaults to `PDS Events <service@pdsportal.site>` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto-injected | DB access |

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
