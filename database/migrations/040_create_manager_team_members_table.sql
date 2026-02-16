-- =====================================================
-- CREATE MANAGER TEAM MEMBERS TABLE
-- =====================================================
-- Organizational hierarchy: assigns users (supervisors, workers, etc.)
-- to a manager's team. Managed by exec/admin users.

CREATE TABLE IF NOT EXISTS manager_team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(manager_id, member_id)
);



-- Indexes
CREATE INDEX IF NOT EXISTS idx_manager_team_members_manager ON manager_team_members(manager_id);
CREATE INDEX IF NOT EXISTS idx_manager_team_members_member ON manager_team_members(member_id);
CREATE INDEX IF NOT EXISTS idx_manager_team_members_active ON manager_team_members(is_active);

-- Enable RLS
ALTER TABLE manager_team_members ENABLE ROW LEVEL SECURITY;

-- Policy: Exec and Admin can manage all team assignments
CREATE POLICY "Exec and admin can manage team assignments"
    ON manager_team_members
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );

-- Policy: Managers can view their own team
CREATE POLICY "Managers can view their team"
    ON manager_team_members
    FOR SELECT
    USING (
        manager_id = auth.uid()
        OR member_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );

-- Trigger for updated_at
CREATE TRIGGER update_manager_team_members_updated_at
    BEFORE UPDATE ON manager_team_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE manager_team_members IS 'Organizational hierarchy: assigns users to a manager team';
COMMENT ON COLUMN manager_team_members.manager_id IS 'The manager who leads this team';
COMMENT ON COLUMN manager_team_members.member_id IS 'The user assigned to this manager team';
COMMENT ON COLUMN manager_team_members.assigned_by IS 'Exec/admin who made the assignment';
