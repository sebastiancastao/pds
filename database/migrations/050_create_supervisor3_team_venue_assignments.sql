-- =====================================================
-- CREATE SUPERVISOR3 TEAM VENUE ASSIGNMENTS TABLE
-- =====================================================
-- Links specific venues to supervisors who are on a supervisor3's team.
-- Supervisors with rows here see ONLY those venues (not the full sup3 chain).
-- FK constraints omitted: users.id / venue_reference.id use bigint in this project;
-- data integrity is enforced at the API layer instead.

CREATE TABLE IF NOT EXISTS supervisor3_team_venue_assignments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supervisor3_id UUID NOT NULL,
    supervisor_id  UUID NOT NULL,
    venue_id       UUID NOT NULL,
    assigned_by    UUID,
    assigned_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(supervisor3_id, supervisor_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_s3tva_supervisor3 ON supervisor3_team_venue_assignments(supervisor3_id);
CREATE INDEX IF NOT EXISTS idx_s3tva_supervisor  ON supervisor3_team_venue_assignments(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_s3tva_venue       ON supervisor3_team_venue_assignments(venue_id);

ALTER TABLE supervisor3_team_venue_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Exec and admin manage sup3 team venue assignments"
  ON supervisor3_team_venue_assignments FOR ALL
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') IN ('exec', 'admin')
  );

CREATE POLICY "Supervisors can view their own sup3 venue assignments"
  ON supervisor3_team_venue_assignments FOR SELECT
  USING (supervisor_id = auth.uid());

COMMENT ON TABLE supervisor3_team_venue_assignments IS
  'Venue-level access grants for supervisors assigned to a supervisor3 team. '
  'Overrides chain-based venue inheritance when rows exist for a given supervisor.';
