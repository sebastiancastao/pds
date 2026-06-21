-- Schedules the `event-reminder` edge function to run every 5 minutes via
-- pg_cron + pg_net. The cron job authenticates to the function with the
-- project's anon key, stored in Vault under the name 'event_reminder_anon_key'.
--
-- One-time prerequisite (run once, replacing the value with your anon key):
--   select vault.create_secret('<ANON_KEY>', 'event_reminder_anon_key',
--     'Anon API key used by pg_cron to call the event-reminder edge function');

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Recreate the schedule idempotently.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'event-1h-reminder') then
    perform cron.unschedule('event-1h-reminder');
  end if;
end $$;

select cron.schedule(
  'event-1h-reminder',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://bwvnvzlmqqcdemkpecjw.supabase.co/functions/v1/event-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'event_reminder_anon_key'
      )
    ),
    body := '{}'::jsonb
  );
  $job$
);
