-- Dedicated table for per-vendor mileage/travel pay approvals per event
-- Separate from event_vendor_payments so no ALTER TABLE is required on existing data.
-- NULL = not yet reviewed (treated as approved in the UI).

CREATE TABLE IF NOT EXISTS event_payment_approvals (
  event_id   UUID NOT NULL,
  user_id    UUID NOT NULL,
  mileage_approved BOOLEAN DEFAULT NULL,
  travel_approved  BOOLEAN DEFAULT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_payment_approvals_event_id ON event_payment_approvals(event_id);
