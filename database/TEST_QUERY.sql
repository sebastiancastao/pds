-- =====================================================
-- TEST QUERY - Simulate what the API is doing
-- =====================================================

-- Step 1: Simple query (this is what the API tries first)
SELECT
  id,
  event_id,
  vendor_id,
  status,
  confirmation_token
FROM event_teams
WHERE confirmation_token = 'bbb90573677dd9f404d59e5cff903102fe4092df9907f78fcd358702d3d6b26c';

-- If the above returns a row, the token exists!

-- Step 2: Complex query with joins (this is what the API tries next)
-- This might fail if foreign keys aren't set up correctly
SELECT
  et.id,
  et.event_id,
  et.vendor_id,
  et.status,
  et.created_at,
  e.id as event_id_check,
  e.event_name,
  e.event_date,
  e.venue_name,
  u.id as user_id_check,
  u.email,
  p.first_name,
  p.last_name
FROM event_teams et
LEFT JOIN events e ON et.event_id = e.id
LEFT JOIN users u ON et.vendor_id = u.id
LEFT JOIN profiles p ON et.vendor_id = p.user_id
WHERE et.confirmation_token = 'bbb90573677dd9f404d59e5cff903102fe4092df9907f78fcd358702d3d6b26c';

-- Check foreign key constraints
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'event_teams' AND tc.constraint_type = 'FOREIGN KEY';
