-- ============================================
-- CHECK SPECIFIC USER'S BACKGROUND CHECK STATUS
-- Run this in Supabase SQL Editor
-- ============================================

-- Query 1: Check your specific user by ID
SELECT
    id,
    email,
    is_temporary_password,
    background_check_completed,
    background_check_completed_at,
    created_at,
    last_login
FROM users
WHERE id = 'c2b77e6d-6bc4-4b74-a88c-647a2b66448f';

-- Query 2: Check your specific user by email
SELECT
    id,
    email,
    is_temporary_password,
    background_check_completed,
    background_check_completed_at,
    created_at,
    last_login
FROM users
WHERE email = 'sebastiancastao379@gmail.com';

-- Query 3: See ALL users and their status
SELECT
    email,
    is_temporary_password,
    background_check_completed,
    created_at
FROM users
ORDER BY created_at DESC;

-- ============================================
-- TO SET YOUR USER TO TRUE (for testing)
-- ============================================

-- Set background_check_completed to TRUE
UPDATE users
SET
    background_check_completed = true,
    background_check_completed_at = NOW()
WHERE id = 'c2b77e6d-6bc4-4b74-a88c-647a2b66448f';

-- Verify it was updated
SELECT
    email,
    background_check_completed,
    background_check_completed_at
FROM users
WHERE id = 'c2b77e6d-6bc4-4b74-a88c-647a2b66448f';
