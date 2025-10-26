-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Migration: Add Availability Column
-- =====================================================

-- Add availability column to vendor_invitations table
-- This stores the vendor's submitted availability data (array of dates with available/notes)

ALTER TABLE vendor_invitations
ADD COLUMN IF NOT EXISTS availability JSONB,
ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE;

-- Add index for querying availability data (GIN index is efficient for JSONB)
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_availability ON vendor_invitations USING GIN (availability);

-- Add index for responded_at
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_responded_at ON vendor_invitations(responded_at);

-- Add comments to document the fields
COMMENT ON COLUMN vendor_invitations.availability IS 'JSON array of vendor availability: [{date: "YYYY-MM-DD", available: boolean, notes: string}]';
COMMENT ON COLUMN vendor_invitations.responded_at IS 'Timestamp when vendor submitted their availability';

-- Verify the columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'vendor_invitations' AND column_name IN ('availability', 'responded_at')
ORDER BY column_name;
