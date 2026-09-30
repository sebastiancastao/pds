-- Payroll data uploaded from an Excel file for a pay period, so HR can review
-- and edit it on the /hr-dashboard Payroll tab ("Upload Payroll" panel).
--
-- payroll_period_uploads      one row per uploaded file for a period
-- payroll_period_upload_rows  the payroll lines parsed from that file
--
-- This is a stored copy of the spreadsheet, separate from the live payroll the
-- Payroll tab computes from events. Nothing here writes back into event
-- payments, timesheets or commission data.
--
-- Accessed only through service-role API routes under /api/hr/payroll-uploads
-- (RLS on, no policies); the routes check the caller's role (hr/exec/admin).

create table if not exists public.payroll_period_uploads (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  file_name text,
  sheet_name text,
  status text not null default 'draft' check (status in ('draft', 'reviewed')),
  notes text,
  uploaded_by uuid references public.users(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_period_uploads_period_check check (period_end >= period_start)
);

create index if not exists idx_payroll_period_uploads_period
  on public.payroll_period_uploads(period_start, period_end);

create table if not exists public.payroll_period_upload_rows (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.payroll_period_uploads(id) on delete cascade,
  sort_order integer not null default 0,
  -- Sheet row number the line came from (null for rows added by hand).
  source_row integer,
  -- Employee matched by email at save time (null when no account matches).
  user_id uuid references public.users(id) on delete set null,

  first_name text,
  last_name text,
  email text,
  category text,
  venue text,
  city text,
  state text,
  event_name text,
  event_date text,

  reg_rate numeric,
  rate_in_effect numeric,
  hours numeric,
  regular_hours numeric,
  regular_pay numeric,
  overtime_hours numeric,
  overtime_pay numeric,
  doubletime_hours numeric,
  doubletime_pay numeric,
  commission_pay numeric,
  variable_incentive numeric,
  tips numeric,
  rest_break numeric,
  mileage_miles numeric,
  mileage_pay numeric,
  travel_pay numeric,
  reimbursement numeric,
  other numeric,
  total_gross_pay numeric,

  -- Spreadsheet columns that don't map to a field above, kept as-is.
  extra jsonb not null default '{}'::jsonb,
  -- Field values as first uploaded, so edits made during review can be shown.
  original jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payroll_period_upload_rows_upload
  on public.payroll_period_upload_rows(upload_id, sort_order);

create index if not exists idx_payroll_period_upload_rows_user
  on public.payroll_period_upload_rows(user_id);

alter table public.payroll_period_uploads enable row level security;
alter table public.payroll_period_upload_rows enable row level security;

comment on table public.payroll_period_uploads is
  'Payroll spreadsheets uploaded on the HR dashboard Payroll tab, one per file per pay period, reviewed and edited there.';
comment on table public.payroll_period_upload_rows is
  'Payroll lines parsed from a payroll_period_uploads file; editable during review.';
