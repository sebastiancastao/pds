-- =============================================================================
-- Migration 035: Create sick_leaves table
-- =============================================================================
-- Tracks approved or pending sick leave periods per employee for auditing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'leave_status'
  ) THEN
    CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'denied');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sick_leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  duration_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  status leave_status NOT NULL DEFAULT 'pending',
  reason TEXT,
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (duration_hours >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sick_leaves_user_id ON public.sick_leaves(user_id);
CREATE INDEX IF NOT EXISTS idx_sick_leaves_status ON public.sick_leaves(status);
CREATE INDEX IF NOT EXISTS idx_sick_leaves_start_date ON public.sick_leaves(start_date);

CREATE OR REPLACE FUNCTION update_sick_leaves_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sick_leaves_updated_at ON public.sick_leaves;
CREATE TRIGGER sick_leaves_updated_at
  BEFORE UPDATE ON public.sick_leaves
  FOR EACH ROW
  EXECUTE FUNCTION update_sick_leaves_updated_at();

ALTER TABLE public.sick_leaves ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sick_leaves IS 'Records sick leave requests for the HR portal';
COMMENT ON COLUMN public.sick_leaves.duration_hours IS 'Duration in hours (supports partial days)';
COMMENT ON COLUMN public.sick_leaves.status IS 'One of pending/approved/denied to track workflow';
