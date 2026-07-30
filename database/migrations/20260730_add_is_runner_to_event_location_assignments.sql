-- Add a runner flag to event location assignments, parallel to the existing
-- is_leader flag. Each location's assigned team can have one leader
-- (shown with 1 star) and one runner (shown with 2 stars) in the
-- /event-dashboard Locations tab.

ALTER TABLE public.event_location_assignments
  ADD COLUMN IF NOT EXISTS is_runner BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_location_assignments.is_runner IS
  'When true, this vendor is the runner for this location assignment (shown with 2 stars). Compare is_leader, shown with 1 star.';
