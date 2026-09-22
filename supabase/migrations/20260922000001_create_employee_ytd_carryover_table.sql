-- Per-employee year-to-date carryover baseline, imported from an outside
-- payroll provider (ADP) when an employee's payroll history moves into this
-- system mid-year. One row per employee: the latest known YTD totals for
-- taxes, earnings and reimbursements as of a given date.
-- Written by the new /adp-ytd-import page via POST /api/employee-ytd-carryover,
-- which upserts on user_id so a re-import replaces the prior baseline rather
-- than accumulating duplicate rows.
-- Accessed only through service-role API routes (RLS on, no policies); the
-- API route itself checks the caller's role (exec/admin/hr/hr_admin).
-- Not yet read by /paystub-generator, which still gets its YTD figures from
-- its own "Import from Excel" upload or manual entry for each pay run. This
-- table is the durable source an admin maintains here and exports from, in
-- the paystub-generator import template's exact column format.

create table if not exists public.employee_ytd_carryover (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- As-of date for these totals (the last ADP pay date they reflect).
  as_of_date date,
  state_code text,

  -- Statutory taxes (YTD)
  federal_income_ytd numeric(12, 2),
  social_security_ytd numeric(12, 2),
  medicare_ytd numeric(12, 2),
  state_income_ytd numeric(12, 2),
  state_di_ytd numeric(12, 2),
  calsavers_roth_ret_ytd numeric(12, 2),

  -- Earnings (YTD)
  regular_ytd numeric(12, 2),
  overtime_ytd numeric(12, 2),
  doubletime_ytd numeric(12, 2),
  commission_ytd numeric(12, 2),
  variable_incentive_ytd numeric(12, 2),
  credit_card_tips_ytd numeric(12, 2),
  rest_break_pay_ytd numeric(12, 2),
  travel_pay_ytd numeric(12, 2),
  bonus_ytd numeric(12, 2),
  sick_pay_ytd numeric(12, 2),
  meal_premium_ytd numeric(12, 2),
  gross_pay_ytd numeric(12, 2),

  -- Reimbursements (YTD)
  equipment_reimb_ytd numeric(12, 2),
  mileage_reimb_ytd numeric(12, 2),
  misc_reimbursement_ytd numeric(12, 2),

  source text not null default 'adp_import',
  notes text,
  imported_by uuid references public.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id)
);

create index if not exists idx_employee_ytd_carryover_user_id
  on public.employee_ytd_carryover(user_id);

alter table public.employee_ytd_carryover enable row level security;

comment on table public.employee_ytd_carryover is
  'Latest known year-to-date payroll totals per employee, imported from an outside provider (ADP) as the carryover baseline for paystubs generated in this system.';
