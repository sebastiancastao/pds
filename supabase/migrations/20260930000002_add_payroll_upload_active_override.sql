-- Lets an uploaded payroll file replace the system-calculated payroll for its
-- pay period on the /hr-dashboard Payroll tab.
--
-- is_active = true marks the upload that "Load Payments" shows for that exact
-- period (period_start + period_end). At most one upload per period can be
-- active. The system payroll is never modified: HR can still retrieve it from
-- the tab ("Retrieve System Payroll"), and turning the flag off (or deleting the
-- upload) makes the period use system payroll again.

alter table public.payroll_period_uploads
  add column if not exists is_active boolean not null default false;

create unique index if not exists uq_payroll_period_uploads_active_period
  on public.payroll_period_uploads(period_start, period_end)
  where is_active;

comment on column public.payroll_period_uploads.is_active is
  'True when this upload replaces the system payroll for its exact period on the HR dashboard Payroll tab. At most one per period.';
