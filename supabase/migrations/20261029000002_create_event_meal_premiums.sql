-- "Meal Premium" toggle on the /event-dashboard Timesheet tab (exec only).
-- An exec switches it on next to a vendor when that vendor is owed a meal premium for the
-- event. A row means "on"; no row means "off". Each row pays one extra hour at the vendor's
-- Rate in Effect for the pay period, never below $28.50 (lib/meal-premium): the Payment tab,
-- the HR dashboard Payroll tab and the paystub PDF all read it.
-- Accessed only through service-role API routes (RLS on, no policies).

create table if not exists public.event_meal_premiums (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  marked_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.event_meal_premiums enable row level security;

comment on table public.event_meal_premiums is
  'Vendors with the Meal Premium toggle on in the event Timesheet tab. Row present = on = one hour at the Rate in Effect (min $28.50) added to pay.';
