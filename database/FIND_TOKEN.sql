-- =====================================================
-- FIND TOKEN IN DATABASE
-- Check if a specific confirmation token exists
-- =====================================================

-- Replace 'YOUR_TOKEN_HERE' with the actual token from the URL
SELECT
  et.*,
  e.event_name,
  e.event_date,
  u.email as vendor_email,
  p.first_name,
  p.last_name
FROM event_teams et
LEFT JOIN events e ON et.event_id = e.id
LEFT JOIN users u ON et.vendor_id = u.id
LEFT JOIN profiles p ON et.vendor_id = p.user_id
WHERE et.confirmation_token = 'bbb90573677dd9f404d59e5cff903102fe4092df9907f78fcd358702d3d6b26c';

-- If this returns NO ROWS, the token wasn't saved!
-- This could mean:
-- 1. The confirmation_token column doesn't exist (run migration)
-- 2. The team creation failed silently
-- 3. The token in the email doesn't match what's in the database

-- Check ALL team records to see what's stored
SELECT
  id,
  event_id,
  vendor_id,
  status,
  confirmation_token,
  created_at
FROM event_teams
ORDER BY created_at DESC
LIMIT 10;
