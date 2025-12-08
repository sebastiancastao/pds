-- =====================================================
-- CREATE MEAL WAIVERS TABLE
-- =====================================================
-- This table stores meal period waiver agreements for hourly employees

CREATE TABLE IF NOT EXISTS meal_waivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Employee Information
    employee_name VARCHAR(255) NOT NULL,
    employee_signature TEXT,
    signature_date DATE NOT NULL,

    -- Waiver Details
    waiver_type VARCHAR(20) NOT NULL CHECK (waiver_type IN ('6_hour', '10_hour', '12_hour')),
    acknowledges_terms BOOLEAN DEFAULT false,

    -- Employment Details
    position VARCHAR(255),
    department VARCHAR(255),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure only one waiver per type per user
    UNIQUE(user_id, waiver_type)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_meal_waivers_user_id ON meal_waivers(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_waivers_type ON meal_waivers(waiver_type);

-- Enable RLS
ALTER TABLE meal_waivers ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view and edit their own waivers
DROP POLICY IF EXISTS "Users can manage their own meal waivers" ON meal_waivers;
CREATE POLICY "Users can manage their own meal waivers"
    ON meal_waivers
    FOR ALL
    USING (user_id = auth.uid());

-- Policy: HR/exec can view all waivers
DROP POLICY IF EXISTS "HR and exec can view all meal waivers" ON meal_waivers;
CREATE POLICY "HR and exec can view all meal waivers"
    ON meal_waivers
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('hr', 'exec', 'admin', 'manager', 'finance')
        )
    );

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_meal_waivers_updated_at ON meal_waivers;
CREATE TRIGGER update_meal_waivers_updated_at
    BEFORE UPDATE ON meal_waivers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE meal_waivers IS 'Meal period waiver agreements for hourly employees (6-hour, 10-hour, 12-hour)';
COMMENT ON COLUMN meal_waivers.waiver_type IS 'Type of waiver: 6_hour, 10_hour, or 12_hour';
COMMENT ON COLUMN meal_waivers.employee_signature IS 'Base64-encoded drawn signature or typed name';
