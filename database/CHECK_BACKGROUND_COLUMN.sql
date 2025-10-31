-- ============================================
-- CHECK BACKGROUND_CHECK_COMPLETED COLUMN STATUS
-- Run this in Supabase SQL Editor to diagnose issues
-- ============================================

-- Step 1: Check if the column exists
SELECT
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('background_check_completed', 'background_check_completed_at');

-- Expected: Should return 2 rows
-- If returns 0 rows, the migration was NOT applied!

-- Step 2: Check the actual value for your user
SELECT
    id,
    email,
    is_temporary_password,
    background_check_completed,
    background_check_completed_at,
    created_at
FROM users
WHERE email = 'sebastiancastao379@gmail.com';  -- Replace with your test email

-- Step 3: Check all users' background check status
SELECT
    email,
    background_check_completed,
    is_temporary_password,
    created_at
FROM users
ORDER BY created_at DESC
LIMIT 10;

-- Step 4: Count users by background check status
SELECT
    background_check_completed,
    COUNT(*) as user_count
FROM users
GROUP BY background_check_completed;

-- ============================================
-- IF COLUMN DOESN'T EXIST, RUN THIS:
-- ============================================
/*
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_completed BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_background_check_completed ON users(background_check_completed);
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_completed_at TIMESTAMP WITH TIME ZONE;
*/

-- ============================================
-- TO MANUALLY SET A USER'S STATUS FOR TESTING:
-- ============================================
/*
-- Set to TRUE (background check completed)
UPDATE users
SET background_check_completed = true,
    background_check_completed_at = NOW()
WHERE email = 'sebastiancastao379@gmail.com';

-- Set to FALSE (needs to complete background check)
UPDATE users
SET background_check_completed = false,
    background_check_completed_at = NULL
WHERE email = 'sebastiancastao379@gmail.com';
*/
