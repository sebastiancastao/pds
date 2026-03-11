-- =====================================================
-- CREATE VENDOR VENUE ASSIGNMENTS TABLE
-- =====================================================
-- Links specific venues to vendor users.
-- Allows admins/execs to define which venues a vendor is authorized to work at.

CREATE TABLE IF NOT EXISTS vendor_venue_assignments (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    venue_id       UUID NOT NULL REFERENCES venue_reference(id) ON DELETE CASCADE,
    assigned_by    UUID REFERENCES users(id),
    assigned_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vendor_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_vva_vendor  ON vendor_venue_assignments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vva_venue   ON vendor_venue_assignments(venue_id);

ALTER TABLE vendor_venue_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Exec and admin manage vendor venue assignments"
  ON vendor_venue_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec', 'admin')
    )
  );

CREATE POLICY "Vendors can view their own venue assignments"
  ON vendor_venue_assignments FOR SELECT
  USING (vendor_id = auth.uid());

COMMENT ON TABLE vendor_venue_assignments IS
  'Tracks which venues each vendor user is authorized to work at.';
