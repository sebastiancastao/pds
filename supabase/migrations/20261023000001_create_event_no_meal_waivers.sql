-- "No Meal Waiver" marks on the /event-dashboard Timesheet tab.
-- A manager, exec, supervisor3 or supervisor6 clicks the button next to a vendor to record
-- that this vendor has no meal waiver for the event. A row means "marked"; no row means
-- "not marked". It is a record only: no pay, meal alert or payroll calculation reads it.
-- Accessed only through service-role API routes (RLS on, no policies).

create table if not exists public.event_no_meal_waivers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  marked_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.event_no_meal_waivers enable row level security;

comment on table public.event_no_meal_waivers is
  'Vendors marked "No Meal Waiver" on the event Timesheet tab. Row present = marked. Record only, not used in pay.';
