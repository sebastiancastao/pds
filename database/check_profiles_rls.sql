-- Check Row Level Security policies on profiles table
-- This might be blocking the API from reading your profile

-- 1. Check all RLS policies on the profiles table
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY policyname;

-- 2. Check if RLS is enabled on profiles table
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'profiles';

-- 3. Test if you can read your own profile (run this while logged in)
-- This should return your profile if RLS allows it
SELECT
    id,
    email,
    full_name,
    role
FROM profiles
WHERE id = auth.uid();
