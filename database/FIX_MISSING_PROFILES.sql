-- FIX: Create missing profiles for users
-- Run this in Supabase SQL Editor

-- Step 1: Check the profiles table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;

-- Step 2: Check if the specific user has a profile
SELECT
    u.id as user_id,
    u.email,
    us.role as users_role,
    p.id as profile_id,
    p.role as profile_role
FROM auth.users u
INNER JOIN users us ON us.id = u.id
LEFT JOIN profiles p ON p.user_id = u.id
WHERE u.id = 'bddee6de-47a0-4cee-9753-b7f370d1d547';

-- Step 3: Create profile for the specific user (adjust columns based on your table structure)
-- Simple version - only required fields
INSERT INTO profiles (user_id)
VALUES ('bddee6de-47a0-4cee-9753-b7f370d1d547')
ON CONFLICT (user_id) DO NOTHING
RETURNING *;

-- Alternative: If the above fails, try with more fields
-- (Uncomment and adjust based on your required columns)
/*
INSERT INTO profiles (
    user_id,
    role,
    first_name,
    last_name,
    created_at,
    updated_at
)
VALUES (
    'bddee6de-47a0-4cee-9753-b7f370d1d547',
    'worker',
    'Pending',
    'Pending',
    NOW(),
    NOW()
)
ON CONFLICT (user_id) DO NOTHING
RETURNING *;
*/

-- Step 4: Create profiles for ALL users that don't have one
INSERT INTO profiles (user_id, created_at, updated_at)
SELECT
    u.id,
    NOW(),
    NOW()
FROM auth.users u
WHERE NOT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;

-- Step 5: Verify all users now have profiles
SELECT
    u.id,
    u.email,
    us.role,
    p.id as profile_id
FROM auth.users u
INNER JOIN users us ON us.id = u.id
LEFT JOIN profiles p ON p.user_id = u.id
WHERE p.id IS NULL;
-- This should return 0 rows if successful
