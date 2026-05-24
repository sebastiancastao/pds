CREATE TABLE IF NOT EXISTS timesheet_edit_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  requester_role TEXT NULL,
  request_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'approved', 'rejected', 'completed', 'cancelled')),
  review_notes TEXT NULL,
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timesheet_edit_requests_user_id
  ON timesheet_edit_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_edit_requests_event_id
  ON timesheet_edit_requests(event_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_edit_requests_requested_by
  ON timesheet_edit_requests(requested_by);

CREATE INDEX IF NOT EXISTS idx_timesheet_edit_requests_status
  ON timesheet_edit_requests(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_edit_requests_one_open_request
  ON timesheet_edit_requests(event_id, user_id)
  WHERE status IN ('submitted', 'in_review');

ALTER TABLE timesheet_edit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view related timesheet edit requests" ON timesheet_edit_requests;
CREATE POLICY "Users can view related timesheet edit requests"
  ON timesheet_edit_requests FOR SELECT
  USING (user_id = auth.uid() OR requested_by = auth.uid());

DROP POLICY IF EXISTS "Users can insert own timesheet edit requests" ON timesheet_edit_requests;
CREATE POLICY "Users can insert own timesheet edit requests"
  ON timesheet_edit_requests FOR INSERT
  WITH CHECK (requested_by = auth.uid());

DROP POLICY IF EXISTS "Privileged users can manage timesheet edit requests" ON timesheet_edit_requests;
CREATE POLICY "Privileged users can manage timesheet edit requests"
  ON timesheet_edit_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'exec', 'hr', 'manager', 'supervisor', 'supervisor2', 'supervisor3')
    )
  );

CREATE OR REPLACE FUNCTION update_timesheet_edit_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_timesheet_edit_requests_timestamp ON timesheet_edit_requests;
CREATE TRIGGER update_timesheet_edit_requests_timestamp
  BEFORE UPDATE ON timesheet_edit_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_timesheet_edit_requests_updated_at();

COMMENT ON TABLE timesheet_edit_requests IS 'Requests to reopen or manually review already attested event timesheets.';
