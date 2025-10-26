-- Check your admin role and verify the setup
-- Run this in Supabase SQL Editor

-- 1. First, let's see what your current role is
SELECT
    id,
    email,
    full_name,
    role,
    created_at
FROM profiles
WHERE email = 'YOUR_EMAIL_HERE'  -- Replace with your actual email
LIMIT 1;

-- 2. If the role is not 'admin', update it with this query:
-- UPDATE profiles
-- SET role = 'admin'
-- WHERE email = 'YOUR_EMAIL_HERE';  -- Replace with your actual email

-- 3. Verify the update worked:
-- SELECT id, email, full_name, role
-- FROM profiles
-- WHERE email = 'YOUR_EMAIL_HERE';

-- 4. Check if there are any RLS policies blocking the profiles table read:
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'profiles';
