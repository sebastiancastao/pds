-- Manual per-vendor commission-split override: lets a vendor be forced into the
-- equal-split commission bucket or the hours-prorated bucket regardless of what
-- the short-shift hour threshold (default 8h) would otherwise assign them.
-- Tri-state: NULL = auto (hours-threshold rule decides), TRUE = forced into the
-- equal-split bucket, FALSE = forced into the hours-prorated bucket.
ALTER TABLE event_vendor_payments
  ADD COLUMN IF NOT EXISTS commission_even_split BOOLEAN;
