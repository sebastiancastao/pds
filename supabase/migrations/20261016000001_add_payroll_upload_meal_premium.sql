-- HR's payroll uploads (HR dashboard Payroll tab > Upload Payroll) can carry a
-- Meal Premium column (ADP's "Meal Premium" earnings line, the Payroll tab's
-- "Meal Break Premium" adjustment). It was not read before, so it never reached
-- the paystub's Meal Premium row. It now gets its own column.

alter table public.payroll_period_upload_rows
  add column if not exists meal_premium numeric;

comment on column public.payroll_period_upload_rows.meal_premium is
  'Meal premium pay on this uploaded line (paystub "Meal Premium" row; part of Total Gross Pay).';
