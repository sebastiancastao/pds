-- ============================================
-- FIX RLS POLICIES FOR background_check_completed
-- The column exists but RLS is blocking reads
-- ============================================

-- Step 1: Check existing RLS policies on users table
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
WHERE tablename = 'users';

-- Step 2: Check if RLS is enabled on users table
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'users';

-- ============================================
-- SOLUTION: Grant SELECT access to background_check_completed
-- ============================================

-- Option 1: Allow users to read their own background_check_completed
-- (This should already exist, but let's make sure)

-- Drop existing policy if it exists and recreate it to include the new column
DROP POLICY IF EXISTS "Users can view own record" ON users;

CREATE POLICY "Users can view own record"
    ON users
    FOR SELECT
    USING (auth.uid() = id);

-- Option 2: If the above doesn't work, temporarily disable RLS to test
-- (DO NOT USE IN PRODUCTION - only for debugging)
-- ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- ============================================
-- ALTERNATIVE: Check if column is in the schema
-- ============================================

-- Verify the column exists and can be queried
SELECT
    id,
    email,
    background_check_completed,
    is_temporary_password
FROM users
WHERE id = 'c2b77e6d-6bc4-4b74-a88c-647a2b66448f';

-- If this query works but the Supabase client doesn't return the column,
-- the issue is with RLS policies blocking it.

-- ============================================
-- DEBUGGING: Test direct query vs Supabase client
-- ============================================

-- If the SQL query above returns the column but Supabase client doesn't,
-- you need to:
-- 1. Check RLS policies allow SELECT on this column
-- 2. Refresh Supabase schema cache (restart your dev server)
-- 3. Check if there are column-level permissions
