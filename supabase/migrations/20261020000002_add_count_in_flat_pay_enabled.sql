-- Count In Setup Day events (event_type = 'count_in_setup') pay each vendor who clocked hours a
-- flat $150 commission by default. Exec can switch it off per event on the HR dashboard
-- Payroll tab; the HR dashboard and /api/generate-paystub both read this column.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS count_in_flat_pay_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.events.count_in_flat_pay_enabled IS
  'Count In Setup Day events only: true (default) pays each vendor with hours a flat $150 commission; exec can set false on the HR dashboard.';
