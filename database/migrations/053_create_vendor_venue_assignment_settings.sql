-- =====================================================
-- CREATE VENDOR VENUE ASSIGNMENT SETTINGS TABLE
-- =====================================================
-- Stores vendor-level assignment behavior flags.
-- manual_override=true means distance-based auto-assignment no longer applies.

CREATE TABLE IF NOT EXISTS vendor_venue_assignment_settings (
    vendor_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    manual_override  BOOLEAN NOT NULL DEFAULT false,
    updated_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vvas_manual_override
  ON vendor_venue_assignment_settings(manual_override);

ALTER TABLE vendor_venue_assignment_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Exec and admin manage vendor venue assignment settings"
  ON vendor_venue_assignment_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec', 'admin')
    )
  );

CREATE POLICY "Vendors can view their own vendor venue assignment settings"
  ON vendor_venue_assignment_settings FOR SELECT
  USING (vendor_id = auth.uid());

CREATE TRIGGER update_vendor_venue_assignment_settings_updated_at
  BEFORE UPDATE ON vendor_venue_assignment_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE vendor_venue_assignment_settings IS
  'Per-vendor settings for venue assignment behavior (manual override lock).';
