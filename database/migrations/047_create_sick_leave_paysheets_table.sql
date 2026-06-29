-- =============================================================================
-- Migration 047: Create sick_leave_paysheets table
-- =============================================================================
-- Stores sick-leave payroll sheets queued from the HR dashboard Payments tab.
-- Each row pays an employee for sick-leave hours at a given rate on a payment
-- date, and is surfaced in the payroll queue and on the employee profile.

CREATE TABLE IF NOT EXISTS public.sick_leave_paysheets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hours         NUMERIC(6,2)  NOT NULL DEFAULT 0,
  rate          NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_date  DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'paid')),
  notes         TEXT,
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hours >= 0),
  CHECK (rate >= 0),
  CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sick_leave_paysheets_user_id
  ON public.sick_leave_paysheets(user_id);
CREATE INDEX IF NOT EXISTS idx_sick_leave_paysheets_payment_date
  ON public.sick_leave_paysheets(payment_date);
CREATE INDEX IF NOT EXISTS idx_sick_leave_paysheets_status
  ON public.sick_leave_paysheets(status);

CREATE OR REPLACE FUNCTION update_sick_leave_paysheets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sick_leave_paysheets_updated_at ON public.sick_leave_paysheets;
CREATE TRIGGER sick_leave_paysheets_updated_at
  BEFORE UPDATE ON public.sick_leave_paysheets
  FOR EACH ROW
  EXECUTE FUNCTION update_sick_leave_paysheets_updated_at();

ALTER TABLE public.sick_leave_paysheets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sick_leave_paysheets IS 'Sick-leave payroll sheets queued from the HR dashboard Payments tab';
COMMENT ON COLUMN public.sick_leave_paysheets.status IS 'queued (awaiting payroll run) or paid';
COMMENT ON COLUMN public.sick_leave_paysheets.payment_date IS 'Date the sick-leave pay is scheduled/issued';
