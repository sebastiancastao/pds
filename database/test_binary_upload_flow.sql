-- Test script for binary photo upload flow
-- Run this after applying the binary storage migration

-- 1. Check if the binary photo fields exist
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name IN ('profile_photo_data', 'profile_photo_type', 'profile_photo_size', 'profile_photo_uploaded_at')
ORDER BY column_name;

-- 2. Test the encryption/decryption functions (if using PostgreSQL pgcrypto)
-- Note: These functions are placeholders in the migration
-- In production, implement proper encryption with your encryption library

-- Test encrypt function
-- SELECT encrypt_photo_data(
--   '\x89504e470d0a1a0a0000000d4948445200000001000000010100000000376ef9240000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082'::bytea,
--   'image/png',
--   67
-- ) as encrypted_data;

-- 3. Check photo metadata view
SELECT * FROM profile_photo_metadata LIMIT 5;

-- 4. Test permission function
-- SELECT can_upload_profile_photo_data('123e4567-e89b-12d3-a456-426614174000'::uuid) as can_upload;

-- 5. Check audit trigger
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_audit_profile_photo_data_changes';

-- 6. Sample profile data with binary photo (for testing only)
-- WARNING: This is just for testing structure - use actual encryption in production
-- INSERT INTO profiles (
--   user_id,
--   first_name,
--   last_name,
--   email,
--   profile_photo_data,
--   profile_photo_type,
--   profile_photo_size,
--   profile_photo_uploaded_at,
--   onboarding_status,
--   onboarding_completed_at
-- ) VALUES (
--   auth.uid(),
--   encrypt('John'),
--   encrypt('Doe'),
--   'john.doe@example.com',
--   '\x89504e470d0a1a0a0000000d4948445200000001000000010100000000376ef9240000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082'::bytea, -- 1x1 PNG
--   'image/png',
--   67,
--   NOW(),
--   'pending',
--   NOW()
-- );

-- 7. Query to verify photo data storage
-- SELECT 
--   id,
--   user_id,
--   profile_photo_type,
--   profile_photo_size,
--   profile_photo_uploaded_at,
--   (profile_photo_data IS NOT NULL) as has_photo_data,
--   octet_length(profile_photo_data) as data_size_bytes
-- FROM profiles 
-- WHERE user_id = auth.uid();

-- 8. Check database size impact
SELECT 
  pg_size_pretty(pg_total_relation_size('profiles')) as total_table_size,
  pg_size_pretty(pg_relation_size('profiles')) as table_size,
  pg_size_pretty(pg_total_relation_size('profiles') - pg_relation_size('profiles')) as index_size;

-- 9. Count profiles with photos
SELECT 
  COUNT(*) as total_profiles,
  COUNT(profile_photo_data) as profiles_with_photos,
  ROUND(COUNT(profile_photo_data)::numeric / COUNT(*) * 100, 2) as photo_percentage
FROM profiles;

-- 10. Check photo size distribution
SELECT 
  CASE 
    WHEN profile_photo_size < 100000 THEN '< 100KB'
    WHEN profile_photo_size < 500000 THEN '100KB - 500KB'
    WHEN profile_photo_size < 1000000 THEN '500KB - 1MB'
    WHEN profile_photo_size < 2000000 THEN '1MB - 2MB'
    ELSE '> 2MB'
  END as size_range,
  COUNT(*) as count,
  ROUND(AVG(profile_photo_size)::numeric) as avg_size_bytes
FROM profiles 
WHERE profile_photo_size IS NOT NULL
GROUP BY 1
ORDER BY MIN(profile_photo_size);

-- 11. View recent photo uploads (audit log)
SELECT 
  al.created_at,
  al.user_id,
  al.changes->>'old_photo_size' as old_size,
  al.changes->>'new_photo_size' as new_size,
  al.changes->>'old_photo_type' as old_type,
  al.changes->>'new_photo_type' as new_type,
  al.changes->>'data_changed' as data_changed
FROM audit_logs al
WHERE al.table_name = 'profiles' 
AND al.changes->>'field_updated' = 'profile_photo_data'
ORDER BY al.created_at DESC 
LIMIT 10;

-- 12. Test metadata function
-- SELECT * FROM get_profile_photo_metadata(auth.uid());

-- 13. Verify RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename = 'profiles' 
AND policyname LIKE '%photo%';

-- 14. Check constraints
SELECT conname, contype, consrc
FROM pg_constraint 
WHERE conrelid = 'profiles'::regclass
AND conname LIKE '%photo%';

-- 15. Performance check - explain query plan for photo queries
-- EXPLAIN (ANALYZE, BUFFERS) 
-- SELECT id, profile_photo_type, profile_photo_size 
-- FROM profiles 
-- WHERE user_id = auth.uid();
