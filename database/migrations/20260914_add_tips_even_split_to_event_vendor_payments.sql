-- Manual per-vendor tips-split override: the tips analog of the existing
-- commission_even_split column (see 20260720_add_commission_even_split_to_event_vendor_payments.sql).
-- Lets a vendor be forced into the equal-split tips bucket or the hours-prorated
-- bucket regardless of what the event's global tips_distribution_mode (equal by
-- default, prorated as an opt-in) would otherwise assign them.
-- Tri-state: NULL = auto (defer to the event's global tips_distribution_mode),
-- TRUE = forced into the equal-split bucket, FALSE = forced into the
-- hours-prorated bucket.
ALTER TABLE event_vendor_payments
  ADD COLUMN IF NOT EXISTS tips_even_split BOOLEAN;
