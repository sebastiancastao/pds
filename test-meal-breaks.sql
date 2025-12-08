-- =====================================================
-- TEST DATA FOR MEAL BREAK DETECTION
-- Run this in Supabase SQL Editor to create test scenario
-- =====================================================
-- This will create a realistic work day with lunch break for testing

-- IMPORTANT: Replace these values with your actual IDs
-- Get event_id from your event dashboard URL
-- Get user_id from the team members (vendor who will work the event)

-- Example scenario with 2 meal breaks:
-- - Clock in at 9:00 AM
-- - Clock out at 12:00 PM (lunch 1 starts)
-- - Clock in at 12:30 PM (lunch 1 ends)
-- - Clock out at 3:00 PM (break starts)
-- - Clock in at 3:15 PM (break ends)
-- - Clock out at 5:00 PM (end of day)
-- Expected result:
-- - Work time: 3h (9-12) + 2.5h (12:30-3) + 1.75h (3:15-5) = 7.25 hours
-- - Meal 1: 12:00 PM to 12:30 PM (30 minutes)
-- - Meal 2: 3:00 PM to 3:15 PM (15 minutes)

DO $$
DECLARE
  test_event_id UUID := '4b98b589-bcfd-4311-8197-ca3fb67a3ffa'; -- YOUR EVENT ID
  test_user_id UUID := '95ac53aa-88ef-487e-a4a1-fa88db3ebb0a';  -- YOUR USER ID
  test_date DATE := '2025-11-18'; -- EVENT DATE
  test_division TEXT := 'vendor'; -- USER DIVISION
BEGIN
  -- Clean up any existing test entries for this user on this date
  DELETE FROM time_entries
  WHERE user_id = test_user_id
    AND timestamp::date = test_date;

  RAISE NOTICE 'Creating test time entries for user % on %', test_user_id, test_date;

  -- Morning shift: 9:00 AM - 12:00 PM
  INSERT INTO time_entries (user_id, action, timestamp, division, event_id, notes)
  VALUES (
    test_user_id,
    'clock_in',
    (test_date || ' 09:00:00')::timestamptz,
    test_division,
    test_event_id,
    'Test: Morning clock in'
  );

  INSERT INTO time_entries (user_id, action, timestamp, division, event_id, notes)
  VALUES (
    test_user_id,
    'clock_out',
    (test_date || ' 12:00:00')::timestamptz,
    test_division,
    test_event_id,
    'Test: Lunch break starts'
  );

  -- Early afternoon: 12:30 PM - 3:00 PM
  INSERT INTO time_entries (user_id, action, timestamp, division, event_id, notes)
  VALUES (
    test_user_id,
    'clock_in',
    (test_date || ' 12:30:00')::timestamptz,
    test_division,
    test_event_id,
    'Test: Back from lunch'
  );

  INSERT INTO time_entries (user_id, action, timestamp, division, event_id, notes)
  VALUES (
    test_user_id,
    'clock_out',
    (test_date || ' 15:00:00')::timestamptz,
    test_division,
    test_event_id,
    'Test: Afternoon break starts'
  );

  -- Late afternoon: 3:15 PM - 5:00 PM
  INSERT INTO time_entries (user_id, action, timestamp, division, event_id, notes)
  VALUES (
    test_user_id,
    'clock_in',
    (test_date || ' 15:15:00')::timestamptz,
    test_division,
    test_event_id,
    'Test: Back from break'
  );

  INSERT INTO time_entries (user_id, action, timestamp, division, event_id, notes)
  VALUES (
    test_user_id,
    'clock_out',
    (test_date || ' 17:00:00')::timestamptz,
    test_division,
    test_event_id,
    'Test: End of day'
  );

  RAISE NOTICE '✅ Created 6 test entries (3 work intervals with 2 meal breaks)';
  RAISE NOTICE 'Expected results:';
  RAISE NOTICE '  - First Clock In: 09:00';
  RAISE NOTICE '  - Last Clock Out: 17:00';
  RAISE NOTICE '  - Meal 1 Start: 12:00 (lunch)';
  RAISE NOTICE '  - Meal 1 End: 12:30';
  RAISE NOTICE '  - Meal 2 Start: 15:00 (break)';
  RAISE NOTICE '  - Meal 2 End: 15:15';
  RAISE NOTICE '  - Work Interval 1: 09:00-12:00 (3.0 hours)';
  RAISE NOTICE '  - Work Interval 2: 12:30-15:00 (2.5 hours)';
  RAISE NOTICE '  - Work Interval 3: 15:15-17:00 (1.75 hours)';
  RAISE NOTICE '  - Total Hours: 7.25';
END $$;

-- Verify the entries were created
SELECT
  id,
  user_id,
  action,
  timestamp AT TIME ZONE 'America/Los_Angeles' as local_time,
  division,
  notes
FROM time_entries
WHERE user_id = '95ac53aa-88ef-487e-a4a1-fa88db3ebb0a'
  AND timestamp::date = '2025-11-18'
ORDER BY timestamp;
