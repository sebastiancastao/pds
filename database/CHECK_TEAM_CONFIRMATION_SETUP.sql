-- =====================================================
-- CHECK TEAM CONFIRMATION SETUP
-- Run this to verify the confirmation system is ready
-- =====================================================

-- Check if confirmation_token column exists in event_teams
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'event_teams'
  AND column_name = 'confirmation_token';

-- If the above returns NO ROWS, the column doesn't exist!
-- You need to run RUN_ALL_NEW_MIGRATIONS.sql

-- Check current event_teams structure
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'event_teams'
ORDER BY ordinal_position;

-- Check status constraint
SELECT
  constraint_name,
  check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'event_teams_status_check';

-- If status constraint doesn't include 'pending_confirmation', run the migration!

-- Check if there are any existing team records
SELECT
  COUNT(*) as total_team_records,
  COUNT(CASE WHEN status = 'pending_confirmation' THEN 1 END) as pending_confirmations,
  COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
  COUNT(CASE WHEN status = 'declined' THEN 1 END) as declined
FROM event_teams;

-- Show sample team records (if any)
SELECT
  id,
  event_id,
  vendor_id,
  status,
  confirmation_token,
  created_at
FROM event_teams
LIMIT 5;
