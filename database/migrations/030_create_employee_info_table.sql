-- =====================================================
-- CREATE EMPLOYEE INFO TABLE
-- =====================================================
-- Stores supplemental employee details that extend the meal waiver workflow.

CREATE TABLE IF NOT EXISTS employee_info (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    waiver_type VARCHAR(20) NOT NULL CHECK (waiver_type IN ('6_hour', '10_hour', '12_hour')),
    notes TEXT,
    manager_email VARCHAR(255),
    supervisor_acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_info_user_id ON employee_info(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_info_type ON employee_info(waiver_type);

ALTER TABLE employee_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage employee info" ON employee_info;
CREATE POLICY "Users can manage employee info"
    ON employee_info
    FOR ALL
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "HR can view employee info" ON employee_info;
CREATE POLICY "HR can view employee info"
    ON employee_info
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('hr', 'exec', 'admin', 'manager', 'finance')
        )
    );

DROP TRIGGER IF EXISTS update_employee_info_updated_at ON employee_info;
CREATE TRIGGER update_employee_info_updated_at
    BEFORE UPDATE ON employee_info
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE employee_info IS 'Supplemental employee information tied to the meal waiver sequence';
COMMENT ON COLUMN employee_info.waiver_type IS 'Matches the primary waiver_type (6_hour, 10_hour, 12_hour)';
COMMENT ON COLUMN employee_info.supervisor_acknowledged IS 'Whether the supervisor confirmed the waiver with the employee';
