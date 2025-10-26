-- Check ID Mismatch Between Auth and Profiles
-- The API is looking for user ID: 6b5ac93e-19d5-4f97-843f-62e4fa02010f

-- STEP 1: Check what's in auth.users for this ID
SELECT
    'AUTH USER' as source,
    id,
    email,
    created_at,
    email_confirmed_at
FROM auth.users
WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f';

-- STEP 2: Check if ANY profile exists with this exact ID
SELECT
    'PROFILE BY ID' as source,
    id,
    email,
    full_name,
    role
FROM profiles
WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f';

-- STEP 3: Get the email from auth.users and search profiles by email
-- This will show if you have a profile but with a DIFFERENT ID
SELECT
    'PROFILE BY EMAIL' as source,
    p.id as profile_id,
    p.email,
    p.full_name,
    p.role,
    p.created_at,
    '6b5ac93e-19d5-4f97-843f-62e4fa02010f' as auth_id,
    CASE
        WHEN p.id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f' THEN 'IDs MATCH ✓'
        ELSE 'IDs MISMATCH ✗ - This is the problem!'
    END as status
FROM profiles p
WHERE p.email = (
    SELECT email
    FROM auth.users
    WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f'
);

-- STEP 4: Show all profiles (to see what profiles exist)
SELECT
    id,
    email,
    full_name,
    role,
    created_at
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- IF STEP 3 SHOWS "IDs MISMATCH", run this to fix it:
-- This updates your profile's ID to match your auth user ID

-- UPDATE profiles
-- SET id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f'
-- WHERE email = (
--     SELECT email
--     FROM auth.users
--     WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f'
-- );

-- VERIFY THE FIX:
-- SELECT id, email, full_name, role
-- FROM profiles
-- WHERE id = '6b5ac93e-19d5-4f97-843f-62e4fa02010f';
