-- Add optional per-location call time for event location assignments.
ALTER TABLE IF EXISTS event_locations
ADD COLUMN IF NOT EXISTS call_time TIME;

COMMENT ON COLUMN event_locations.call_time IS
  'Optional per-location call time used for location-specific assignment messaging.';
