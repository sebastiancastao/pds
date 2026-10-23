-- Equipment reimbursement is now picked by pay date instead of pay period.
-- Each row still stores its bi-weekly pay period, and the pay date is the last
-- day of that period plus 5 days (e.g. Sep 28 - Oct 11, 2026 is paid Oct 16).
-- The once-a-month rule now follows the month of the pay date, so pay_month is
-- the month of pay_period_end + 5 (October 2026 has Oct 2, Oct 16 and Oct 30).
-- Rows saved before this change all have the same month either way.

ALTER TABLE public.equipment_reimbursement_queue
  DROP CONSTRAINT IF EXISTS equipment_reimbursement_month_of_period;
ALTER TABLE public.equipment_reimbursement_queue
  ADD CONSTRAINT equipment_reimbursement_month_of_period
  CHECK (pay_month = date_trunc('month', pay_period_end + 5)::date);

COMMENT ON COLUMN public.equipment_reimbursement_queue.pay_period_end IS 'Last day (Sunday) of the pay period; the pay date is this date + 5 days and pay_month is the month of the pay date';
