-- Number of rest breaks a worker took on an event.
-- Managers and exec record it on the Timesheet tab of /event-dashboard; the Payment tab,
-- /hr-dashboard payroll and /paystub-generator price rest break pay from it.
-- No row means "not recorded", and the flat per-shift rest break schedule applies.
-- Accessed only through service-role API routes (RLS on, no policies), so workers
-- cannot change their own count.

create table if not exists public.event_rest_breaks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rest_break_count integer not null check (rest_break_count >= 0 and rest_break_count <= 10),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.event_rest_breaks enable row level security;

comment on table public.event_rest_breaks is
  'Rest breaks taken per worker per event, recorded by managers/exec on the event Timesheet tab. Absent row = not recorded (flat schedule applies).';
