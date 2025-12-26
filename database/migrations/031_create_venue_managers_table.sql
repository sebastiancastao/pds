-- =====================================================
-- CREATE VENUE MANAGERS TABLE
-- =====================================================
-- This table manages which manager users are assigned to which venues

CREATE TABLE IF NOT EXISTS venue_managers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venue_id UUID NOT NULL REFERENCES venue_reference(id) ON DELETE CASCADE,
    manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(venue_id, manager_id)
);


-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_venue_managers_venue ON venue_managers(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_managers_manager ON venue_managers(manager_id);
CREATE INDEX IF NOT EXISTS idx_venue_managers_active ON venue_managers(is_active);

-- Enable RLS
ALTER TABLE venue_managers ENABLE ROW LEVEL SECURITY;

-- Policy: Exec and Admin can manage all venue assignments
CREATE POLICY "Exec and admin can manage venue assignments"
    ON venue_managers
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );

-- Policy: Managers can view their own assignments
CREATE POLICY "Managers can view their venue assignments"
    ON venue_managers
    FOR SELECT
    USING (
        manager_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin', 'hr')
        )
    );

-- Trigger for updated_at
CREATE TRIGGER update_venue_managers_updated_at
    BEFORE UPDATE ON venue_managers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE venue_managers IS 'Manages assignment of manager users to venues';
COMMENT ON COLUMN venue_managers.venue_id IS 'Reference to the venue';
COMMENT ON COLUMN venue_managers.manager_id IS 'Reference to the manager user';
COMMENT ON COLUMN venue_managers.assigned_by IS 'User who made the assignment';
COMMENT ON COLUMN venue_managers.is_active IS 'Whether this assignment is currently active';
