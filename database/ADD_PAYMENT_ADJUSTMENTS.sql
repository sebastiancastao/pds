-- ============================================================
-- Create payment_adjustments table (used by /api/vendor-payments)
-- ============================================================

-- Stores per-user manual adjustments for a given event's payments
-- Composite PK (event_id, user_id) prevents duplicates

CREATE TABLE IF NOT EXISTS payment_adjustments (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  adjustment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  adjustment_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_event_id ON payment_adjustments(event_id);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_user_id ON payment_adjustments(user_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION payment_adjustments_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_adjustments_updated_at_trigger ON payment_adjustments;
CREATE TRIGGER payment_adjustments_updated_at_trigger
  BEFORE UPDATE ON payment_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION payment_adjustments_set_updated_at();

-- Optional comments
COMMENT ON TABLE payment_adjustments IS 'Manual per-user payment adjustments for events';
COMMENT ON COLUMN payment_adjustments.adjustment_amount IS 'Adjustment in dollars (can be negative)';
COMMENT ON COLUMN payment_adjustments.adjustment_note IS 'Reason/notes for the adjustment';

