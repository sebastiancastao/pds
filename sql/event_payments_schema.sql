-- SQL Schema for Event Payment Data
-- This schema stores payment calculations for events and their team members

-- Table 1: Event-level payment summary
CREATE TABLE IF NOT EXISTS event_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Commission pool data
  commission_pool_percent DECIMAL(5,4) DEFAULT 0, -- e.g., 0.15 for 15%
  commission_pool_dollars DECIMAL(10,2) DEFAULT 0, -- calculated $ amount

  -- Tips data
  total_tips DECIMAL(10,2) DEFAULT 0,

  -- Totals for all team members
  total_regular_hours DECIMAL(10,2) DEFAULT 0,
  total_overtime_hours DECIMAL(10,2) DEFAULT 0,
  total_doubletime_hours DECIMAL(10,2) DEFAULT 0,
  total_regular_pay DECIMAL(10,2) DEFAULT 0,
  total_overtime_pay DECIMAL(10,2) DEFAULT 0,
  total_doubletime_pay DECIMAL(10,2) DEFAULT 0,
  total_commissions DECIMAL(10,2) DEFAULT 0,
  total_tips_distributed DECIMAL(10,2) DEFAULT 0,
  total_payment DECIMAL(10,2) DEFAULT 0,

  -- Metadata
  base_rate DECIMAL(10,2), -- hourly base rate used
  net_sales DECIMAL(10,2), -- net sales used for commission calculation
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),

  -- Ensure only one payment record per event
  UNIQUE(event_id)
);

-- Table 2: Individual vendor payment details
CREATE TABLE IF NOT EXISTS event_vendor_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_payment_id UUID NOT NULL REFERENCES event_payments(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Hours worked breakdown
  actual_hours DECIMAL(10,2) DEFAULT 0,
  regular_hours DECIMAL(10,2) DEFAULT 0,
  overtime_hours DECIMAL(10,2) DEFAULT 0,
  doubletime_hours DECIMAL(10,2) DEFAULT 0,

  -- Pay breakdown
  regular_pay DECIMAL(10,2) DEFAULT 0,
  overtime_pay DECIMAL(10,2) DEFAULT 0,
  doubletime_pay DECIMAL(10,2) DEFAULT 0,

  -- Commissions and tips (prorated)
  commissions DECIMAL(10,2) DEFAULT 0,
  tips DECIMAL(10,2) DEFAULT 0,

  -- Total payment for this vendor
  total_pay DECIMAL(10,2) DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure only one payment record per vendor per event
  UNIQUE(event_id, user_id)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_event_payments_event_id ON event_payments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_payments_created_by ON event_payments(created_by);
CREATE INDEX IF NOT EXISTS idx_event_vendor_payments_event_id ON event_vendor_payments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_vendor_payments_user_id ON event_vendor_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_event_vendor_payments_event_payment_id ON event_vendor_payments(event_payment_id);

-- Row Level Security (RLS) Policies
ALTER TABLE event_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_vendor_payments ENABLE ROW LEVEL SECURITY;

-- Policy: Executives can view all payment records
CREATE POLICY "Executives can view all event payments"
  ON event_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec')
    )
  );

-- Policy: Event creators can view their own event payments
CREATE POLICY "Event creators can view their event payments"
  ON event_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_payments.event_id
      AND events.created_by = auth.uid()
    )
  );

-- Policy: Executives can insert/update event payments
CREATE POLICY "Executives can manage event payments"
  ON event_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec')
    )
  );

-- Policy: Event creators can insert/update their event payments
CREATE POLICY "Event creators can manage their event payments"
  ON event_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_payments.event_id
      AND events.created_by = auth.uid()
    )
  );

-- Policy: Executives can view all vendor payments
CREATE POLICY "Executives can view all vendor payments"
  ON event_vendor_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec')
    )
  );

-- Policy: Event creators can view vendor payments for their events
CREATE POLICY "Event creators can view their event vendor payments"
  ON event_vendor_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_vendor_payments.event_id
      AND events.created_by = auth.uid()
    )
  );

-- Policy: Vendors can view their own payment records
CREATE POLICY "Vendors can view their own payments"
  ON event_vendor_payments FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Executives can insert/update vendor payments
CREATE POLICY "Executives can manage vendor payments"
  ON event_vendor_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('exec')
    )
  );

-- Policy: Event creators can insert/update vendor payments for their events
CREATE POLICY "Event creators can manage their event vendor payments"
  ON event_vendor_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_vendor_payments.event_id
      AND events.created_by = auth.uid()
    )
  );

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_event_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_event_payments_timestamp
  BEFORE UPDATE ON event_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_event_payments_updated_at();

CREATE TRIGGER update_event_vendor_payments_timestamp
  BEFORE UPDATE ON event_vendor_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_event_payments_updated_at();

-- Comments for documentation
COMMENT ON TABLE event_payments IS 'Stores event-level payment summary including commission pool and tips';
COMMENT ON TABLE event_vendor_payments IS 'Stores individual vendor payment details for each event';
COMMENT ON COLUMN event_payments.commission_pool_percent IS 'Commission pool as a decimal (e.g., 0.15 for 15%)';
COMMENT ON COLUMN event_payments.commission_pool_dollars IS 'Commission pool in dollars calculated from net sales';
COMMENT ON COLUMN event_payments.net_sales IS 'Net sales used for commission calculation (ticket sales / (1 + tax rate))';
