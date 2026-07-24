-- Add a manually-entered "Variable Incentive" bonus amount per vendor/event.
-- This is a flat additive $ amount (like the "Other" adjustment), NOT the
-- existing computed commission-uplift figure also called "Variable Incentive"
-- in the HR payroll UI. Entered on the event-dashboard Payment tab, it flows
-- into hr-dashboard payroll totals on top of whatever is already computed.
ALTER TABLE event_vendor_payments
  ADD COLUMN IF NOT EXISTS variable_incentive DECIMAL(12,2) NOT NULL DEFAULT 0;
