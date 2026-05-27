CREATE TABLE IF NOT EXISTS data_edition_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_name TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'onboarding' CHECK (document_type IN ('onboarding', 'custom')),
  reason TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_edition_requests_user_id
  ON data_edition_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_data_edition_requests_status
  ON data_edition_requests(status);

CREATE INDEX IF NOT EXISTS idx_data_edition_requests_created_at
  ON data_edition_requests(created_at DESC);

ALTER TABLE data_edition_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own data edition requests" ON data_edition_requests;
CREATE POLICY "Users can view own data edition requests"
  ON data_edition_requests FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own data edition requests" ON data_edition_requests;
CREATE POLICY "Users can insert own data edition requests"
  ON data_edition_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Privileged users can manage data edition requests" ON data_edition_requests;
CREATE POLICY "Privileged users can manage data edition requests"
  ON data_edition_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'finance')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3', 'finance')
    )
  );

CREATE OR REPLACE FUNCTION update_data_edition_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_data_edition_requests_timestamp ON data_edition_requests;
CREATE TRIGGER update_data_edition_requests_timestamp
  BEFORE UPDATE ON data_edition_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_data_edition_requests_updated_at();

COMMENT ON TABLE data_edition_requests IS 'Employee requests to edit previously submitted onboarding or custom form data.';
