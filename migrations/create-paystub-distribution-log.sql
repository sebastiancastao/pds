-- Migration: create paystub_distribution_log
-- Tracks every paystub distribution to employee profiles: who received it, who triggered it, and when.

CREATE TABLE IF NOT EXISTS paystub_distribution_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Employee who received the paystub
  employee_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_name        TEXT NOT NULL,

  -- Pay period covered by this paystub
  pay_date             DATE,
  pay_period_start     DATE,
  pay_period_end       DATE,

  -- Who triggered the distribution
  triggered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  triggered_by_email   TEXT,

  -- Distribution details
  distribution_mode    TEXT NOT NULL DEFAULT 'single' CHECK (distribution_mode IN ('single', 'batch')),
  status               TEXT NOT NULL DEFAULT 'sent'   CHECK (status IN ('sent', 'failed')),
  error_message        TEXT,

  sent_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_pdl_employee_user_id     ON paystub_distribution_log (employee_user_id);
CREATE INDEX IF NOT EXISTS idx_pdl_triggered_by         ON paystub_distribution_log (triggered_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pdl_sent_at              ON paystub_distribution_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdl_pay_date             ON paystub_distribution_log (pay_date);

-- RLS: admins/HR can read all rows; employees can read only their own
ALTER TABLE paystub_distribution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR and admins can read all distribution logs"
  ON paystub_distribution_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'hr_admin', 'manager', 'supervisor', 'supervisor3')
    )
  );

CREATE POLICY "Employees can read their own distribution logs"
  ON paystub_distribution_log FOR SELECT
  USING (employee_user_id = auth.uid());

-- Only the service role (API) can insert/update/delete
CREATE POLICY "Service role can manage distribution logs"
  ON paystub_distribution_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
