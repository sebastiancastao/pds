-- SQL Schema for Payment Adjustments
-- This allows storing manual adjustments to vendor payments

-- Table: Payment adjustments for individual vendors per event
CREATE TABLE IF NOT EXISTS payment_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Adjustment amount (can be positive or negative)
  adjustment_amount DECIMAL(10,2) DEFAULT 0,

  -- Optional note/reason for adjustment
  adjustment_note TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),

  -- Ensure only one adjustment record per vendor per event
  UNIQUE(event_id, user_id)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_event_id ON payment_adjustments(event_id);
CREATE INDEX IF NOT EXISTS idx_payment_adjustments_user_id ON payment_adjustments(user_id);

-- Row Level Security (RLS) Policies
ALTER TABLE payment_adjustments ENABLE ROW LEVEL SECURITY;

-- Policy: Executives can view all adjustments
CREATE POLICY "Executives can view all adjustments"
  ON payment_adjustments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec')
    )
  );

-- Policy: Event creators can view adjustments for their events
CREATE POLICY "Event creators can view their event adjustments"
  ON payment_adjustments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = payment_adjustments.event_id
      AND events.created_by = auth.uid()
    )
  );

-- Policy: Executives can insert/update/delete adjustments
CREATE POLICY "Executives can manage adjustments"
  ON payment_adjustments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec')
    )
  );

-- Policy: Event creators can insert/update/delete adjustments for their events
CREATE POLICY "Event creators can manage their event adjustments"
  ON payment_adjustments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = payment_adjustments.event_id
      AND events.created_by = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_adjustments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER update_payment_adjustments_timestamp
  BEFORE UPDATE ON payment_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_adjustments_updated_at();

-- Comments for documentation
COMMENT ON TABLE payment_adjustments IS 'Stores manual payment adjustments for vendors per event';
COMMENT ON COLUMN payment_adjustments.adjustment_amount IS 'Adjustment amount in dollars (positive or negative)';
COMMENT ON COLUMN payment_adjustments.adjustment_note IS 'Optional note explaining the reason for adjustment';
