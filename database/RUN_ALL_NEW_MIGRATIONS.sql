-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Complete Migration: Bulk Invitations + Availability + Teams
-- =====================================================
-- This file consolidates all new migrations needed for the system

-- ============================================================
-- STEP 1: Add bulk invitation fields to vendor_invitations
-- ============================================================

ALTER TABLE vendor_invitations
ADD COLUMN IF NOT EXISTS invitation_type VARCHAR(20) DEFAULT 'single',
ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS duration_weeks INTEGER,
ADD COLUMN IF NOT EXISTS availability JSONB,
ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE;

-- Make event_id nullable for bulk invitations
ALTER TABLE vendor_invitations
ALTER COLUMN event_id DROP NOT NULL;

-- Add check constraint for invitation_type (drop first if exists)
ALTER TABLE vendor_invitations
DROP CONSTRAINT IF EXISTS invitation_type_check;

ALTER TABLE vendor_invitations
ADD CONSTRAINT invitation_type_check
CHECK (invitation_type IN ('single', 'bulk'));

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_availability ON vendor_invitations USING GIN (availability);
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_responded_at ON vendor_invitations(responded_at);

-- Add comments
COMMENT ON COLUMN vendor_invitations.invitation_type IS 'Type of invitation: single (for one event) or bulk (for multiple events over a period)';
COMMENT ON COLUMN vendor_invitations.start_date IS 'Start date for bulk invitations';
COMMENT ON COLUMN vendor_invitations.end_date IS 'End date for bulk invitations';
COMMENT ON COLUMN vendor_invitations.duration_weeks IS 'Duration in weeks for bulk invitations';
COMMENT ON COLUMN vendor_invitations.availability IS 'JSON array of vendor availability: [{date: "YYYY-MM-DD", available: boolean, notes: string}]';
COMMENT ON COLUMN vendor_invitations.responded_at IS 'Timestamp when vendor submitted their availability';

-- ============================================================
-- STEP 2: Create event_teams table
-- ============================================================

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

-- Drop and recreate check constraint (in case it exists)
ALTER TABLE event_teams DROP CONSTRAINT IF EXISTS event_teams_status_check;
ALTER TABLE event_teams
ADD CONSTRAINT event_teams_status_check
CHECK (status IN ('assigned', 'hed', 'declined', 'completed'));

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

-- ============================================================
-- STEP 3: Verify all changes
-- ============================================================

-- Check vendor_invitations columns
SELECT
  'vendor_invitations' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'vendor_invitations'
  AND column_name IN ('invitation_type', 'start_date', 'end_date', 'duration_weeks', 'availability', 'responded_at', 'event_id')
ORDER BY column_name;

-- Check event_teams table
SELECT
  'event_teams' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'event_teams'
ORDER BY ordinal_position;

-- Success message
SELECT 'All migrations completed successfully!' as status;
