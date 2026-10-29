-- "Pay hourly instead of commission" on the /hr-dashboard Payroll tab.
-- HR, exec or admin switches it on for a vendor whose Commission Pay is under 50% of
-- Commission Pay + Variable Incentive. One row per event and vendor: that vendor is paid
-- hourly at hourly_rate on that event (California $28.50 with daily + weekly overtime,
-- other states $25.92 with weekly overtime) instead of commission. No row = commission.
-- Read by the HR dashboard Payroll tab (views, totals, exports, payment emails).
-- Accessed only through service-role API routes (RLS on, no policies).

create table if not exists public.payroll_hourly_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  hourly_rate numeric(10, 2) not null check (hourly_rate > 0 and hourly_rate < 1000),
  set_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists payroll_hourly_overrides_user_id_idx on public.payroll_hourly_overrides (user_id);

alter table public.payroll_hourly_overrides enable row level security;

comment on table public.payroll_hourly_overrides is
  'HR Payroll tab "Pay hourly" toggle: vendor paid hourly at hourly_rate instead of commission on this event. Row present = hourly.';
