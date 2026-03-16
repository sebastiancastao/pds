-- Add tips override columns to event_vendor_payments
-- tips_override: NULL = use calculated value, number = manual override amount
-- tips_deleted: TRUE = vendor excluded from tips pool entirely
ALTER TABLE event_vendor_payments
  ADD COLUMN IF NOT EXISTS tips_override DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tips_deleted BOOLEAN NOT NULL DEFAULT FALSE;
