-- DEBUG: Why can't we retrieve the profile?
-- Run this in Supabase SQL Editor

-- Step 1: Check if profile exists (bypass RLS with service role)
SELECT
    p.id as profile_id,
    p.user_id,
    p.role as profile_role,
    p.first_name,
    p.last_name,
    p.created_at
FROM profiles p
WHERE p.user_id = 'bddee6de-47a0-4cee-9753-b7f370d1d547';
-- This should show the profile if it exists

-- Step 2: Check RLS policies on profiles table
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
-- This shows all RLS policies

-- Step 3: Check if RLS is enabled
SELECT
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'profiles';
-- rowsecurity should be true if RLS is enabled

-- Step 4: Test query as the actual user would see it
-- (This simulates what happens in the login code)
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "bddee6de-47a0-4cee-9753-b7f370d1d547"}';

SELECT
    p.id as profile_id,
    p.user_id,
    p.role
FROM profiles p
WHERE p.user_id = 'bddee6de-47a0-4cee-9753-b7f370d1d547';
-- This should fail if RLS is blocking it

RESET role;
RESET "request.jwt.claims";
