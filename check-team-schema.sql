-- Check if confirmation_token column exists in event_teams table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'event_teams'
ORDER BY ordinal_position;

-- Check existing team records
SELECT id, event_id, vendor_id, status, confirmation_token, created_at
FROM event_teams
LIMIT 10;

-- Add confirmation_token column if it doesn't exist
-- Uncomment the following if the column is missing:
/*
ALTER TABLE event_teams
ADD COLUMN IF NOT EXISTS confirmation_token TEXT;
*/
