-- Fix Missing Profile Issue
-- Your auth user exists but there's no profile record in the database

-- STEP 1: Check if your profile exists
SELECT
    id,
    email,
    full_name,
    role,
    created_at
FROM profiles
WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f';  -- Your user ID

-- If the above returns 0 rows, your profile is missing!

-- STEP 2: Check what profiles DO exist
SELECT
    id,
    email,
    full_name,
    role
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- STEP 3: Check auth.users to find your email
SELECT
    id,
    email,
    created_at
FROM auth.users
WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f';

-- STEP 4: If your profile is missing, create it
-- Replace the values below with your actual information

-- First, check what email your auth user has (from STEP 3)
-- Then create a profile for that user:

INSERT INTO profiles (id, email, full_name, role, created_at, updated_at)
VALUES (
    '6b5ac93e-19d5-4f97-843f-62e4fa02010f',  -- Your auth user ID
    'your-email@example.com',  -- ⚠️ CHANGE THIS to your actual email from STEP 3
    'Your Full Name',           -- ⚠️ CHANGE THIS to your name
    'admin',                    -- Setting you as admin
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;  -- Safety: won't insert if profile already exists

-- STEP 5: Verify the profile was created
SELECT
    id,
    email,
    full_name,
    role,
    created_at
FROM profiles
WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f';
