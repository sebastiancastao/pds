-- Fix Duplicate Profiles Issue
-- Issue: "Cannot coerce the result to a single JSON object"
-- Cause: Multiple profile records for the same user_id

-- Step 1: Check how many profiles exist for your user
SELECT 
  id,
  user_id,
  mfa_enabled,
  mfa_secret IS NOT NULL as has_secret,
  backup_codes IS NOT NULL as has_codes,
  created_at,
  updated_at
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
ORDER BY created_at DESC;

-- Expected: Should see MULTIPLE rows (that's the problem!)

---

-- Step 2: Find which profile has the most complete MFA setup
SELECT 
  id,
  user_id,
  mfa_enabled,
  mfa_secret IS NOT NULL as has_secret,
  backup_codes IS NOT NULL as has_codes,
  created_at,
  CASE 
    WHEN mfa_enabled = true AND mfa_secret IS NOT NULL AND backup_codes IS NOT NULL THEN 'COMPLETE'
    WHEN mfa_secret IS NOT NULL THEN 'PARTIAL'
    ELSE 'EMPTY'
  END as status
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
ORDER BY 
  CASE 
    WHEN mfa_enabled = true AND mfa_secret IS NOT NULL AND backup_codes IS NOT NULL THEN 1
    WHEN mfa_secret IS NOT NULL THEN 2
    ELSE 3
  END,
  created_at DESC;

-- The TOP row is the one you should keep!

---

-- Step 3: DELETE duplicate profiles
-- ⚠️ IMPORTANT: Review the results from Step 2 first!
-- ⚠️ Only run this after you've identified which profile to KEEP

-- Option A: Keep the NEWEST profile (most likely to have latest data)
DELETE FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
AND id NOT IN (
  -- Keep the profile with the most recent created_at date
  SELECT id FROM profiles
  WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
  ORDER BY created_at DESC
  LIMIT 1
);

-- Option B: Keep the profile with MFA setup (if one has it)
/*
DELETE FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
AND id NOT IN (
  -- Keep the profile with MFA enabled
  SELECT id FROM profiles
  WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6'
  AND mfa_enabled = true
  ORDER BY created_at DESC
  LIMIT 1
);
*/

---

-- Step 4: Verify only ONE profile remains
SELECT COUNT(*) as profile_count
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6';

-- Should return: 1

---

-- Step 5: Check the remaining profile
SELECT 
  id,
  user_id,
  mfa_enabled,
  mfa_secret IS NOT NULL as has_secret,
  backup_codes IS NOT NULL as has_codes,
  created_at
FROM profiles
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6';

-- If mfa_enabled is NULL or false, set it up properly:
/*
UPDATE profiles
SET 
  mfa_enabled = false,
  mfa_secret = NULL,
  backup_codes = NULL
WHERE user_id = 'c14e61fc-8e0d-434e-aa31-68ac920950b6';
*/

---

-- Step 6: Prevent duplicates in the future
-- Add a unique constraint on user_id
ALTER TABLE profiles 
ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);

-- This will prevent duplicate profiles from being created again

