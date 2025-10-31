-- Test queries for profile photo functionality
-- Use these to verify the photo upload system is working correctly

-- 1. Check if the photo field was added successfully
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name = 'profile_photo_url';

-- 2. Test the secure photo URL generation function
SELECT generate_secure_photo_url('123e4567-e89b-12d3-a456-426614174000'::uuid, 'jpg') as sample_photo_url;

-- 3. Test the upload permission function (replace with actual user ID)
-- SELECT can_upload_profile_photo('123e4567-e89b-12d3-a456-426614174000'::uuid) as can_upload;

-- 4. Check RLS policies are in place
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies 
WHERE tablename = 'profiles' 
AND policyname LIKE '%photo%';

-- 5. Verify the check constraint is working
-- This should fail if URL format is invalid:
-- UPDATE profiles SET profile_photo_url = 'invalid-url' WHERE id = 'some-uuid';

-- 6. Check audit trigger is created
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_audit_profile_photo_changes';

-- 7. Sample query to update a profile photo (for testing)
-- UPDATE profiles 
-- SET profile_photo_url = '/secure-uploads/profiles/user-id/photo.jpg'
-- WHERE user_id = auth.uid();

-- 8. Query to get user's profile photo URL
-- SELECT 
--   id,
--   first_name,
--   last_name,
--   profile_photo_url,
--   onboarding_status
-- FROM profiles 
-- WHERE user_id = auth.uid();

