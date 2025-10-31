-- Test queries for profile photo binary storage functionality
-- Use these to verify the binary photo storage system is working correctly

-- 1. Check if the photo fields were added successfully
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN ('profile_photo_data', 'profile_photo_type', 'profile_photo_size', 'profile_photo_uploaded_at')
ORDER BY column_name;

-- 2. Test the photo metadata view
SELECT * FROM profile_photo_metadata LIMIT 5;

-- 3. Test the upload permission function (replace with actual user ID)
-- SELECT can_upload_profile_photo_data('123e4567-e89b-12d3-a456-426614174000'::uuid) as can_upload;

-- 4. Test the metadata function (replace with actual user ID)
-- SELECT * FROM get_profile_photo_metadata('123e4567-e89b-12d3-a456-426614174000'::uuid);

-- 5. Check RLS policies are in place
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename = 'profiles' 
AND policyname LIKE '%photo%';

-- 6. Verify the check constraints are working
-- These should fail if data is invalid:
-- UPDATE profiles SET profile_photo_type = 'image/gif' WHERE id = 'some-uuid'; -- Invalid type
-- UPDATE profiles SET profile_photo_size = 10485760 WHERE id = 'some-uuid'; -- Too large (>5MB)

-- 7. Check audit trigger is created
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_audit_profile_photo_data_changes';

-- 8. Test binary data storage (for development/testing only)
-- WARNING: This is just for testing - in production, use proper encryption
-- INSERT INTO profiles (
--   user_id, 
--   profile_photo_data, 
--   profile_photo_type, 
--   profile_photo_size, 
--   profile_photo_uploaded_at
-- ) VALUES (
--   auth.uid(),
--   '\x89504e470d0a1a0a0000000d4948445200000001000000010100000000376ef9240000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082'::bytea, -- 1x1 PNG
--   'image/png',
--   67,
--   NOW()
-- );

-- 9. Query to get user's profile photo metadata (safe for client-side)
SELECT 
  id,
  first_name,
  last_name,
  profile_photo_type,
  profile_photo_size,
  profile_photo_uploaded_at,
  has_photo
FROM profile_photo_metadata 
WHERE user_id = auth.uid();

-- 10. Query to get actual photo data (server-side only, requires decryption)
-- SELECT 
--   id,
--   first_name,
--   last_name,
--   decrypt_photo_data(profile_photo_data) as photo_data,
--   profile_photo_type,
--   profile_photo_size
-- FROM profiles 
-- WHERE user_id = auth.uid() 
-- AND profile_photo_data IS NOT NULL;

-- 11. Check database size impact (monitor storage usage)
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename = 'profiles';

-- 12. Count profiles with photos
SELECT 
  COUNT(*) as total_profiles,
  COUNT(profile_photo_data) as profiles_with_photos,
  COUNT(profile_photo_data)::float / COUNT(*) * 100 as photo_percentage
FROM profiles;

-- 13. Check photo size distribution
SELECT 
  CASE 
    WHEN profile_photo_size < 100000 THEN '< 100KB'
    WHEN profile_photo_size < 500000 THEN '100KB - 500KB'
    WHEN profile_photo_size < 1000000 THEN '500KB - 1MB'
    WHEN profile_photo_size < 2000000 THEN '1MB - 2MB'
    ELSE '> 2MB'
  END as size_range,
  COUNT(*) as count
FROM profiles 
WHERE profile_photo_size IS NOT NULL
GROUP BY 1
ORDER BY MIN(profile_photo_size);

-- 14. View recent photo uploads (audit log)
SELECT 
  al.created_at,
  al.user_id,
  al.changes->>'old_photo_size' as old_size,
  al.changes->>'new_photo_size' as new_size,
  al.changes->>'old_photo_type' as old_type,
  al.changes->>'new_photo_type' as new_type
FROM audit_logs al
WHERE al.table_name = 'profiles' 
AND al.changes->>'field_updated' = 'profile_photo_data'
ORDER BY al.created_at DESC 
LIMIT 10;

