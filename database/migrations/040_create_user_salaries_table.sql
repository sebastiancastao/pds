-- =============================================================================
-- Migration 040: Create user_salaries table
-- =============================================================================
-- Stores annual salary and employment metadata for salaried employees.

CREATE TABLE IF NOT EXISTS public.user_salaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  annual_salary NUMERIC(12, 2) NOT NULL DEFAULT 0,
  department TEXT,
  position TEXT,
  employment_type TEXT NOT NULL DEFAULT 'salaried',
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_salaries_user_id UNIQUE (user_id),
  CHECK (annual_salary >= 0)
);

CREATE INDEX IF NOT EXISTS idx_user_salaries_user_id ON public.user_salaries(user_id);
CREATE INDEX IF NOT EXISTS idx_user_salaries_employment_type ON public.user_salaries(employment_type);

CREATE OR REPLACE FUNCTION update_user_salaries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_salaries_updated_at ON public.user_salaries;
CREATE TRIGGER user_salaries_updated_at
  BEFORE UPDATE ON public.user_salaries
  FOR EACH ROW
  EXECUTE FUNCTION update_user_salaries_updated_at();

ALTER TABLE public.user_salaries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.user_salaries IS 'Stores annual salary and employment type for salaried employees';
COMMENT ON COLUMN public.user_salaries.employment_type IS 'salaried or hourly';
COMMENT ON COLUMN public.user_salaries.effective_date IS 'Date the salary became effective';
