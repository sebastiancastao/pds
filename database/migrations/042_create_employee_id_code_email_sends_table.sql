-- =====================================================
-- CREATE EMPLOYEE ID CODE EMAIL SEND LOGS TABLE
-- =====================================================
-- Stores one row each time an Employee ID Code email is sent.

CREATE TABLE IF NOT EXISTS employee_id_code_email_sends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employee_id_code_email_sends_user_id
    ON employee_id_code_email_sends(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_id_code_email_sends_sent_at
    ON employee_id_code_email_sends(sent_at DESC);

-- Enable RLS
ALTER TABLE employee_id_code_email_sends ENABLE ROW LEVEL SECURITY;

-- Policy: service role writes/reads logs via API
DROP POLICY IF EXISTS "Service role can manage employee id code email sends"
    ON employee_id_code_email_sends;
CREATE POLICY "Service role can manage employee id code email sends"
    ON employee_id_code_email_sends
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Comments
COMMENT ON TABLE employee_id_code_email_sends IS
    'One row per Employee ID Code email successfully sent from /employee-id-codes';
COMMENT ON COLUMN employee_id_code_email_sends.user_id IS
    'Recipient user id that received the email';
COMMENT ON COLUMN employee_id_code_email_sends.sent_at IS
    'Timestamp when the email send was confirmed successful';
