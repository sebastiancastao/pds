CREATE TABLE IF NOT EXISTS vendor_reimbursement_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NULL REFERENCES events(id) ON DELETE SET NULL,
  purchase_date DATE NOT NULL,
  description TEXT NOT NULL,
  requested_amount NUMERIC(12, 2) NOT NULL,
  approved_amount NUMERIC(12, 2) NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled')),
  receipt_path TEXT NULL,
  receipt_filename TEXT NULL,
  approved_pay_date DATE NULL,
  review_notes TEXT NULL,
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_reimbursement_requests_user_id
  ON vendor_reimbursement_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_vendor_reimbursement_requests_event_id
  ON vendor_reimbursement_requests(event_id);

CREATE INDEX IF NOT EXISTS idx_vendor_reimbursement_requests_status
  ON vendor_reimbursement_requests(status);

CREATE INDEX IF NOT EXISTS idx_vendor_reimbursement_requests_approved_pay_date
  ON vendor_reimbursement_requests(approved_pay_date);

ALTER TABLE vendor_reimbursement_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their reimbursement requests" ON vendor_reimbursement_requests;
CREATE POLICY "Users can view their reimbursement requests"
  ON vendor_reimbursement_requests FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their reimbursement requests" ON vendor_reimbursement_requests;
CREATE POLICY "Users can insert their reimbursement requests"
  ON vendor_reimbursement_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update submitted reimbursement requests" ON vendor_reimbursement_requests;
CREATE POLICY "Users can update submitted reimbursement requests"
  ON vendor_reimbursement_requests FOR UPDATE
  USING (user_id = auth.uid() AND status = 'submitted')
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Exec and admin can review reimbursement requests" ON vendor_reimbursement_requests;
CREATE POLICY "Exec and admin can review reimbursement requests"
  ON vendor_reimbursement_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('exec', 'admin')
    )
  );

ALTER TABLE payment_adjustments
  ADD COLUMN IF NOT EXISTS adjustment_type TEXT NULL;

ALTER TABLE event_vendor_payments
  ADD COLUMN IF NOT EXISTS worked_hours NUMERIC(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS effective_hours NUMERIC(10, 2) NULL;

CREATE OR REPLACE FUNCTION update_vendor_reimbursement_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_vendor_reimbursement_requests_timestamp ON vendor_reimbursement_requests;
CREATE TRIGGER update_vendor_reimbursement_requests_timestamp
  BEFORE UPDATE ON vendor_reimbursement_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_vendor_reimbursement_requests_updated_at();

COMMENT ON TABLE vendor_reimbursement_requests IS 'Vendor submitted reimbursement requests that are reviewed before payroll inclusion';
COMMENT ON COLUMN vendor_reimbursement_requests.approved_pay_date IS 'Required for approved standalone reimbursements that are not tied to an event';
