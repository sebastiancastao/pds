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

  -- Storage path so employees can download the PDF from their profile
  pdf_storage_path     TEXT,

  sent_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_pdl_employee_user_id ON paystub_distribution_log (employee_user_id);
CREATE INDEX IF NOT EXISTS idx_pdl_triggered_by     ON paystub_distribution_log (triggered_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pdl_sent_at          ON paystub_distribution_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdl_pay_date         ON paystub_distribution_log (pay_date);

-- Add pdf_storage_path if this table was created before the column existed
ALTER TABLE paystub_distribution_log
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

-- Remove recipient_email if it exists from an older version of this migration
ALTER TABLE paystub_distribution_log
  DROP COLUMN IF EXISTS recipient_email;

-- RLS: admins/HR can read all rows; employees can read only their own
ALTER TABLE paystub_distribution_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "HR and admins can read all distribution logs" ON paystub_distribution_log;
CREATE POLICY "HR and admins can read all distribution logs"
  ON paystub_distribution_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'hr_admin', 'manager', 'supervisor', 'supervisor3')
    )
  );

DROP POLICY IF EXISTS "Employees can read their own distribution logs" ON paystub_distribution_log;
CREATE POLICY "Employees can read their own distribution logs"
  ON paystub_distribution_log FOR SELECT
  USING (employee_user_id = auth.uid());

-- Only the service role (API) can insert/update/delete
DROP POLICY IF EXISTS "Service role can manage distribution logs" ON paystub_distribution_log;
CREATE POLICY "Service role can manage distribution logs"
  ON paystub_distribution_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Storage bucket for paystub PDFs (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('paystubs', 'paystubs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: employees download only their own files (path: {user_id}/{log_id}.pdf)
DROP POLICY IF EXISTS "Employees can download their own paystubs" ON storage.objects;
CREATE POLICY "Employees can download their own paystubs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'paystubs'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

DROP POLICY IF EXISTS "HR and admins can download all paystubs" ON storage.objects;
CREATE POLICY "HR and admins can download all paystubs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'paystubs'
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'hr_admin', 'manager', 'supervisor', 'supervisor3')
    )
  );

DROP POLICY IF EXISTS "Service role can manage paystub files" ON storage.objects;
CREATE POLICY "Service role can manage paystub files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'paystubs' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'paystubs' AND auth.role() = 'service_role');
