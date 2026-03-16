-- Add commission override columns to event_vendor_payments
-- commission_override: NULL = use calculated value, number = manual override amount
-- commission_deleted: TRUE = vendor receives no commission (only base pay)
ALTER TABLE event_vendor_payments
  ADD COLUMN IF NOT EXISTS commission_override DECIMAL(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS commission_deleted BOOLEAN NOT NULL DEFAULT FALSE;
