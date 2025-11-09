-- Add confirmation_token column to event_teams table
-- This is required for team confirmation emails

-- 1. Add the confirmation_token column
ALTER TABLE event_teams
ADD COLUMN IF NOT EXISTS confirmation_token TEXT;

-- 2. Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_event_teams_confirmation_token
ON event_teams(confirmation_token);

-- 3. Update any existing team records with new tokens (optional)
-- Uncomment this if you want to generate tokens for existing records
/*
UPDATE event_teams
SET confirmation_token = encode(gen_random_bytes(32), 'hex')
WHERE confirmation_token IS NULL
  AND status = 'pending_confirmation';
*/

-- 4. Verify the changes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'event_teams'
ORDER BY ordinal_position;
