-- ⚡ QUICK FIX: Remove Duplicate Profiles
-- Run this ONE command in Supabase SQL Editor

-- Delete all duplicate profiles, keeping only the newest one
DELETE FROM profiles
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM profiles
  ORDER BY user_id, created_at DESC
);

-- Add unique constraint to prevent duplicates in the future
ALTER TABLE profiles 
ADD CONSTRAINT IF NOT EXISTS profiles_user_id_unique UNIQUE (user_id);

-- ✅ Done! Now test your login again.




