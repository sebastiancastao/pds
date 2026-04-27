CREATE TABLE IF NOT EXISTS salaried_pay_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  annual_salary NUMERIC(12, 2) NOT NULL,
  gross_pay NUMERIC(12, 2) NOT NULL,
  federal_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
  state_tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
  social_security NUMERIC(12, 2) NOT NULL DEFAULT 0,
  medicare NUMERIC(12, 2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
  deduction_notes TEXT NULL,
  net_pay NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  notes TEXT NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salaried_pay_records_user_id
  ON salaried_pay_records(user_id);

CREATE INDEX IF NOT EXISTS idx_salaried_pay_records_pay_period
  ON salaried_pay_records(pay_period_start, pay_period_end);

CREATE INDEX IF NOT EXISTS idx_salaried_pay_records_status
  ON salaried_pay_records(status);

ALTER TABLE salaried_pay_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Exec and admin can manage salaried pay records" ON salaried_pay_records;
CREATE POLICY "Exec and admin can manage salaried pay records"
  ON salaried_pay_records FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin', 'finance')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin', 'finance')
    )
  );

DROP POLICY IF EXISTS "Users can view their own salaried pay records" ON salaried_pay_records;
CREATE POLICY "Users can view their own salaried pay records"
  ON salaried_pay_records FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION update_salaried_pay_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_salaried_pay_records_timestamp ON salaried_pay_records;
CREATE TRIGGER update_salaried_pay_records_timestamp
  BEFORE UPDATE ON salaried_pay_records
  FOR EACH ROW
  EXECUTE FUNCTION update_salaried_pay_records_updated_at();

COMMENT ON TABLE salaried_pay_records IS 'Pay records for salaried employees by pay period';
COMMENT ON COLUMN salaried_pay_records.gross_pay IS 'Actual pay for this period (annual_salary / pay_periods_per_year)';
COMMENT ON COLUMN salaried_pay_records.net_pay IS 'gross_pay minus all deductions';
