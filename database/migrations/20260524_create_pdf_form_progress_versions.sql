CREATE TABLE IF NOT EXISTS pdf_form_progress_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_form_progress_id UUID NULL REFERENCES pdf_form_progress(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  form_name VARCHAR(255) NOT NULL,
  form_data TEXT NOT NULL,
  form_date DATE NULL,
  source_updated_at TIMESTAMPTZ NULL,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_by_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  entry_point TEXT NULL,
  is_proxy_edit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdf_form_progress_versions_user_form
  ON pdf_form_progress_versions(user_id, form_name);

CREATE INDEX IF NOT EXISTS idx_pdf_form_progress_versions_replaced_at
  ON pdf_form_progress_versions(replaced_at DESC);

ALTER TABLE pdf_form_progress_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own PDF form progress versions" ON pdf_form_progress_versions;
CREATE POLICY "Users can view their own PDF form progress versions"
  ON pdf_form_progress_versions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Privileged users can view all PDF form progress versions" ON pdf_form_progress_versions;
CREATE POLICY "Privileged users can view all PDF form progress versions"
  ON pdf_form_progress_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin', 'hr', 'hr_admin')
    )
  );

DROP POLICY IF EXISTS "Service role can insert PDF form progress versions" ON pdf_form_progress_versions;
CREATE POLICY "Service role can insert PDF form progress versions"
  ON pdf_form_progress_versions
  FOR INSERT
  WITH CHECK (true);

GRANT SELECT ON pdf_form_progress_versions TO authenticated;
GRANT SELECT, INSERT ON pdf_form_progress_versions TO service_role;

COMMENT ON TABLE pdf_form_progress_versions IS 'Historical snapshots of replaced pdf_form_progress rows so prior document versions remain viewable after edits.';
