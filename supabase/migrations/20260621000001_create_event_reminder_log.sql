-- Tracks the 1-hour-before reminder emails sent by the `event-reminder` edge
-- function, so a given vendor is reminded at most once per event. Written only
-- by the edge function (service role, which bypasses RLS).

create table if not exists public.event_reminder_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  vendor_id uuid not null references public.users(id) on delete cascade,
  reminder_type text not null default 'start_1h',
  recipient_email text,
  resend_message_id text,
  sent_at timestamptz not null default now(),
  constraint event_reminder_log_unique unique (event_id, vendor_id, reminder_type)
);

create index if not exists idx_event_reminder_log_event on public.event_reminder_log(event_id);

alter table public.event_reminder_log enable row level security;

comment on table public.event_reminder_log is
  'Dedupe log for the 1-hour-before reminder emails sent per vendor per event by the event-reminder edge function.';
