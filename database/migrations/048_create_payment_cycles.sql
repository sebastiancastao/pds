-- =============================================================================
-- Migration 048: Payment cycles + auto-fill link for sick-leave paysheets
-- =============================================================================
-- Adds recurring payment cycles (pay periods) generated from a single org-wide
-- cadence config. HR retrieves the sick-leave + worked hours an employee used
-- inside a cycle window and auto-fills queued sick_leave_paysheets for that
-- cycle's pay date.
--
-- RLS is enabled with no policies: all access is through the service-role key
-- in the /api/hr/payment-cycles routes (same pattern as sick_leave_paysheets).

-- ---------------------------------------------------------------------------
-- 1. payment_cycle_config — single active org-wide cadence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_cycle_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frequency       TEXT NOT NULL DEFAULT 'biweekly'
                  CHECK (frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  anchor_date     DATE NOT NULL,
  pay_offset_days INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (pay_offset_days >= 0)
);

-- Only one active config at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_cycle_config_single_active
  ON public.payment_cycle_config(is_active)
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 2. payment_cycles — materialized pay-period instances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_cycles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  pay_date     DATE NOT NULL,
  frequency    TEXT NOT NULL
               CHECK (frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'processed')),
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  UNIQUE (start_date, end_date)
);

CREATE INDEX IF NOT EXISTS idx_payment_cycles_pay_date
  ON public.payment_cycles(pay_date);
CREATE INDEX IF NOT EXISTS idx_payment_cycles_status
  ON public.payment_cycles(status);

-- ---------------------------------------------------------------------------
-- 3. Link sick_leave_paysheets to the cycle that generated them
-- ---------------------------------------------------------------------------
ALTER TABLE public.sick_leave_paysheets
  ADD COLUMN IF NOT EXISTS cycle_id UUID
  REFERENCES public.payment_cycles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sick_leave_paysheets_cycle_id
  ON public.sick_leave_paysheets(cycle_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse the generic function pattern)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_payment_cycles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_cycle_config_updated_at ON public.payment_cycle_config;
CREATE TRIGGER payment_cycle_config_updated_at
  BEFORE UPDATE ON public.payment_cycle_config
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_cycles_updated_at();

DROP TRIGGER IF EXISTS payment_cycles_updated_at ON public.payment_cycles;
CREATE TRIGGER payment_cycles_updated_at
  BEFORE UPDATE ON public.payment_cycles
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_cycles_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (service-role only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payment_cycle_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_cycles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payment_cycle_config IS 'Single active org-wide recurring pay-cycle cadence config';
COMMENT ON TABLE public.payment_cycles IS 'Materialized pay-period instances generated from payment_cycle_config';
COMMENT ON COLUMN public.payment_cycles.pay_date IS 'period end + pay_offset_days; used as sick_leave_paysheets.payment_date when auto-filling';
COMMENT ON COLUMN public.sick_leave_paysheets.cycle_id IS 'Payment cycle that auto-filled this paysheet (null for manual entries)';
