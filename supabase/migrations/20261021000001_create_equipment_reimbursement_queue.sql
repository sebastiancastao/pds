-- Equipment reimbursement queue (HR dashboard Payroll tab).
-- Equipment reimbursement is paid once a month as an off-cycle payment to
-- active vendors and employees. Each row is one person's equipment
-- reimbursement for one pay month, queued until HR marks it paid.

CREATE TABLE IF NOT EXISTS public.equipment_reimbursement_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  pay_month    DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  description  TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'paid')),
  paid_date    DATE,
  paid_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount >= 0),
  CHECK (pay_month = date_trunc('month', pay_month)::date)
);

CREATE INDEX IF NOT EXISTS idx_equipment_reimbursement_queue_pay_month
  ON public.equipment_reimbursement_queue(pay_month);
CREATE INDEX IF NOT EXISTS idx_equipment_reimbursement_queue_user_id
  ON public.equipment_reimbursement_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_reimbursement_queue_status
  ON public.equipment_reimbursement_queue(status);

CREATE OR REPLACE FUNCTION update_equipment_reimbursement_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equipment_reimbursement_queue_updated_at ON public.equipment_reimbursement_queue;
CREATE TRIGGER equipment_reimbursement_queue_updated_at
  BEFORE UPDATE ON public.equipment_reimbursement_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_equipment_reimbursement_queue_updated_at();

-- Only the service-role API (/api/hr/equipment-reimbursements) reads and writes it.
ALTER TABLE public.equipment_reimbursement_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.equipment_reimbursement_queue IS 'Monthly off-cycle equipment reimbursements for active vendors and employees, queued from the HR dashboard Payroll tab';
COMMENT ON COLUMN public.equipment_reimbursement_queue.pay_month IS 'First day of the month this equipment reimbursement belongs to';
COMMENT ON COLUMN public.equipment_reimbursement_queue.status IS 'queued (awaiting the monthly off-cycle run) or paid';
COMMENT ON COLUMN public.equipment_reimbursement_queue.paid_date IS 'Date the off-cycle payment was issued';
