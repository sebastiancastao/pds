-- Equipment reimbursement pay date is now open: HR types or picks any date
-- instead of choosing one of the fixed bi-weekly Fridays, and nothing is
-- preselected. The chosen date is stored in pay_date, and the once-a-month rule
-- (unique user_id + pay_month) follows the month of that date. Each row still
-- records the bi-weekly work period the pay date belongs to (the latest one
-- that ended before the pay date), which the Payroll tab uses to include the
-- row when it loads those work dates. Existing rows were all saved on the
-- standard pay date, the last day of their period + 5 days.

ALTER TABLE public.equipment_reimbursement_queue
  ADD COLUMN IF NOT EXISTS pay_date DATE;

UPDATE public.equipment_reimbursement_queue
  SET pay_date = pay_period_end + 5
  WHERE pay_date IS NULL;

ALTER TABLE public.equipment_reimbursement_queue
  ALTER COLUMN pay_date SET NOT NULL;

ALTER TABLE public.equipment_reimbursement_queue
  DROP CONSTRAINT IF EXISTS equipment_reimbursement_month_of_period;
ALTER TABLE public.equipment_reimbursement_queue
  ADD CONSTRAINT equipment_reimbursement_month_of_period
  CHECK (pay_month = date_trunc('month', pay_date)::date);

ALTER TABLE public.equipment_reimbursement_queue
  DROP CONSTRAINT IF EXISTS equipment_reimbursement_pay_date_after_period;
ALTER TABLE public.equipment_reimbursement_queue
  ADD CONSTRAINT equipment_reimbursement_pay_date_after_period
  CHECK (pay_date > pay_period_end AND pay_date <= pay_period_end + 14);

CREATE INDEX IF NOT EXISTS idx_equipment_reimbursement_queue_pay_date
  ON public.equipment_reimbursement_queue(pay_date);

COMMENT ON COLUMN public.equipment_reimbursement_queue.pay_date IS 'Date HR pays this reimbursement (any date HR picks); pay_month is the month of this date';
COMMENT ON COLUMN public.equipment_reimbursement_queue.pay_period_end IS 'Last day (Sunday) of the bi-weekly work period the pay date belongs to: the latest period that ended before pay_date';
