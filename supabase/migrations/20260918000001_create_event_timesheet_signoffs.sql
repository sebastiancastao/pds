-- Manager sign-off on an event's timesheet.
-- One row per event. The Sales tab in /event-dashboard stays read-only for
-- non-exec users until a manager submits this signature from the Timesheet tab.
-- Accessed only through the service-role API route (RLS on, no policies).

create table if not exists public.event_timesheet_signoffs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  signed_by uuid references public.users(id) on delete set null,
  signed_by_name text,
  note text,
  signature_data text not null,
  signature_hash text not null,
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.event_timesheet_signoffs enable row level security;

comment on table public.event_timesheet_signoffs is
  'Manager signature (drawn PNG) plus optional note confirming an event timesheet; unlocks Sales entry for non-exec users.';
