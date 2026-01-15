-- =====================================================
-- CREATE EMPLOYEE INFORMATION TABLE
-- =====================================================
-- Stores Employee Information Form submissions.

CREATE TABLE IF NOT EXISTS employee_information (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Personal Details
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    middle_initial TEXT,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    ssn TEXT NOT NULL,

    -- Employment Details
    position TEXT NOT NULL,
    department TEXT,
    manager TEXT,
    start_date DATE NOT NULL,
    employee_id TEXT,

    -- Emergency Contact
    emergency_contact_name TEXT NOT NULL,
    emergency_contact_relationship TEXT NOT NULL,
    emergency_contact_phone TEXT NOT NULL,

    -- Acknowledgement + Signature
    acknowledgements BOOLEAN NOT NULL DEFAULT FALSE,
    signature TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_information_user_id ON employee_information(user_id);

ALTER TABLE employee_information ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their employee information" ON employee_information;
CREATE POLICY "Users can manage their employee information"
    ON employee_information
    FOR ALL
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "HR can view employee information" ON employee_information;
CREATE POLICY "HR can view employee information"
    ON employee_information
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('hr', 'exec', 'worker', 'manager', 'finance')
        )
    );

DROP TRIGGER IF EXISTS update_employee_information_updated_at ON employee_information;
CREATE TRIGGER update_employee_information_updated_at
    BEFORE UPDATE ON employee_information
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE employee_information IS 'Employee Information Form submissions';
