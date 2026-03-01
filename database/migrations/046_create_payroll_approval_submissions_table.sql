-- Migration: Create payroll_approval_submissions table
-- Tracks every payroll approval submission sent from the HR dashboard

CREATE TABLE IF NOT EXISTS payroll_approval_submissions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name     text        NOT NULL,
  status        text        NOT NULL DEFAULT 'submitted'
                            CHECK (status IN ('submitted', 'approved', 'rejected')),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  notes         text
);

-- Index for quick lookups by submitter and status
CREATE INDEX IF NOT EXISTS idx_payroll_approval_submissions_submitted_by
  ON payroll_approval_submissions (submitted_by);

CREATE INDEX IF NOT EXISTS idx_payroll_approval_submissions_status
  ON payroll_approval_submissions (status);

-- Allow HR/admin/exec to read all rows; only service role inserts
ALTER TABLE payroll_approval_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR can view approval submissions"
  ON payroll_approval_submissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('hr', 'admin', 'exec')
    )
  );
