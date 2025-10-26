-- Create event_teams table to track team assignments for events
-- This table stores which vendors are assigned to work at specific events

CREATE TABLE IF NOT EXISTS event_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'assigned',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure a vendor is only assigned once per event
  UNIQUE(event_id, vendor_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_event_teams_event_id ON event_teams(event_id);
CREATE INDEX IF NOT EXISTS idx_event_teams_vendor_id ON event_teams(vendor_id);
CREATE INDEX IF NOT EXISTS idx_event_teams_assigned_by ON event_teams(assigned_by);
CREATE INDEX IF NOT EXISTS idx_event_teams_status ON event_teams(status);

-- Add check constraint for status
ALTER TABLE event_teams
ADD CONSTRAINT event_teams_status_check
CHECK (status IN ('assigned', 'confirmed', 'declined', 'completed'));

-- Add comments
COMMENT ON TABLE event_teams IS 'Stores vendor team assignments for events';
COMMENT ON COLUMN event_teams.event_id IS 'The event this team member is assigned to';
COMMENT ON COLUMN event_teams.vendor_id IS 'The vendor assigned to the event';
COMMENT ON COLUMN event_teams.assigned_by IS 'The manager who assigned this vendor';
COMMENT ON COLUMN event_teams.status IS 'Status: assigned, confirmed, declined, completed';

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_event_teams_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS event_teams_updated_at_trigger ON event_teams;
CREATE TRIGGER event_teams_updated_at_trigger
  BEFORE UPDATE ON event_teams
  FOR EACH ROW
  EXECUTE FUNCTION update_event_teams_updated_at();
