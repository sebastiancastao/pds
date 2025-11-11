-- FIX: Allow users to read their own profiles
-- This fixes the "0 rows" error when workers try to query their profile

-- Step 1: Check current RLS policies
SELECT
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'profiles'
ORDER BY cmd;

-- Step 2: Add policy to allow users to read their own profile
CREATE POLICY IF NOT EXISTS "Users can view their own profile"
    ON profiles
    FOR SELECT
    USING (auth.uid() = user_id);

-- Step 3: Verify the policy was created
SELECT
    policyname,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'profiles'
AND cmd = 'SELECT';

-- Step 4: Test that the user can now read their profile
-- (Run this as a separate query after creating the policy)
/*
-- Login as the user first, then run:
SELECT id, user_id, role
FROM profiles
WHERE user_id = auth.uid();
*/
