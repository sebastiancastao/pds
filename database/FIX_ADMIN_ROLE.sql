-- Fix Admin Role
-- This script will help you verify and fix your admin role

-- STEP 1: Check your current user and role
-- Replace 'your-email@example.com' with your actual login email
SELECT
    id,
    email,
    full_name,
    role,
    created_at
FROM profiles
WHERE email = 'your-email@example.com';  -- ⚠️ CHANGE THIS TO YOUR EMAIL

-- STEP 2: If the role is not 'admin', run this to update it:
-- Remove the -- comment to run this line after updating your email above
-- UPDATE profiles
-- SET role = 'admin'
-- WHERE email = 'your-email@example.com';  -- ⚠️ CHANGE THIS TO YOUR EMAIL

-- STEP 3: Verify the update worked
-- SELECT
--     id,
--     email,
--     full_name,
--     role
-- FROM profiles
-- WHERE email = 'your-email@example.com';  -- ⚠️ CHANGE THIS TO YOUR EMAIL

-- STEP 4: Check what roles exist in your system
SELECT
    role,
    COUNT(*) as count
FROM profiles
GROUP BY role
ORDER BY count DESC;

-- If you see roles like 'vendor', 'worker', etc., but no 'admin',
-- then you need to set one user as admin using the UPDATE query above.
