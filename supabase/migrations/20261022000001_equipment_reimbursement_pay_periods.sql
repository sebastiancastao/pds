-- Equipment reimbursement is now a flat $20 a month per checked vendor, booked
-- in one of the month's bi-weekly pay periods (Monday to Sunday, anchored on
-- Feb 2, 2026). Each row records which pay period it belongs to, and a person
-- can have only one row per month. pay_month is the month the period ends in.
-- The table was empty when this was written, so the new columns can be NOT NULL.

ALTER TABLE public.equipment_reimbursement_queue
  ADD COLUMN IF NOT EXISTS pay_period_start DATE,
  ADD COLUMN IF NOT EXISTS pay_period_end DATE;

ALTER TABLE public.equipment_reimbursement_queue
  ALTER COLUMN pay_period_start SET NOT NULL,
  ALTER COLUMN pay_period_end SET NOT NULL;

ALTER TABLE public.equipment_reimbursement_queue
  DROP CONSTRAINT IF EXISTS equipment_reimbursement_period_length;
ALTER TABLE public.equipment_reimbursement_queue
  ADD CONSTRAINT equipment_reimbursement_period_length
  CHECK (pay_period_end = pay_period_start + 13);

ALTER TABLE public.equipment_reimbursement_queue
  DROP CONSTRAINT IF EXISTS equipment_reimbursement_month_of_period;
ALTER TABLE public.equipment_reimbursement_queue
  ADD CONSTRAINT equipment_reimbursement_month_of_period
  CHECK (pay_month = date_trunc('month', pay_period_end)::date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_equipment_reimbursement_user_month
  ON public.equipment_reimbursement_queue(user_id, pay_month);
CREATE INDEX IF NOT EXISTS idx_equipment_reimbursement_queue_period_start
  ON public.equipment_reimbursement_queue(pay_period_start);

COMMENT ON COLUMN public.equipment_reimbursement_queue.pay_period_start IS 'First day (Monday) of the bi-weekly pay period this reimbursement is paid in';
COMMENT ON COLUMN public.equipment_reimbursement_queue.pay_period_end IS 'Last day (Sunday) of that pay period; pay_month is the month of this date';
