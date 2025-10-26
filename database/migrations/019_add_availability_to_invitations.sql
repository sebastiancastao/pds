-- Add availability column to vendor_invitations table
-- This stores the vendor's submitted availability data (array of dates with available/notes)

ALTER TABLE vendor_invitations
ADD COLUMN IF NOT EXISTS availability JSONB;

-- Add index for querying availability data
CREATE INDEX IF NOT EXISTS idx_vendor_invitations_availability ON vendor_invitations USING GIN (availability);

-- Add comment
COMMENT ON COLUMN vendor_invitations.availability IS 'JSON array of vendor availability: [{date: "YYYY-MM-DD", available: boolean, notes: string}]';
