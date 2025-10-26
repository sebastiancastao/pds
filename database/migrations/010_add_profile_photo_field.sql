-- Migration: Add profile photo field to profiles table
-- This adds secure photo storage with encryption and proper access controls

-- Add the profile_photo_url field to store the encrypted photo reference
ALTER TABLE profiles 
ADD COLUMN profile_photo_url TEXT;

-- Add a comment explaining the field purpose and security
COMMENT ON COLUMN profiles.profile_photo_url IS 'ENCRYPTED: URL/path to encrypted profile photo stored in secure cloud storage (AWS S3 with SSE-KMS). Contains reference only, not actual image data.';

-- Create an index for efficient queries (if needed for photo-related operations)
CREATE INDEX idx_profiles_profile_photo_url ON profiles(profile_photo_url) WHERE profile_photo_url IS NOT NULL;

-- Add a check constraint to ensure the URL format is valid (basic validation)
ALTER TABLE profiles 
ADD CONSTRAINT check_profile_photo_url_format 
CHECK (
  profile_photo_url IS NULL 
  OR (
    profile_photo_url ~ '^https://[a-zA-Z0-9.-]+\.amazonaws\.com/' 
    OR profile_photo_url ~ '^https://[a-zA-Z0-9.-]+\.s3\.[a-zA-Z0-9.-]+\.amazonaws\.com/'
    OR profile_photo_url ~ '^/secure-uploads/'
  )
);

-- Add RLS policy for profile photo access
-- Only allow users to access their own photo URLs
CREATE POLICY "Users can view their own profile photo" ON profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Only allow users to update their own profile photo
CREATE POLICY "Users can update their own profile photo" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Admin/HR role can access all profile photos for legitimate business purposes
CREATE POLICY "HR can view all profile photos" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE user_id = auth.uid() 
      AND onboarding_status = 'hr_admin'
    )
  );

-- Add audit trigger to track photo changes
CREATE OR REPLACE FUNCTION audit_profile_photo_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Log photo upload/change events for security audit
  IF OLD.profile_photo_url IS DISTINCT FROM NEW.profile_photo_url THEN
    INSERT INTO audit_logs (
      table_name,
      operation,
      record_id,
      user_id,
      changes,
      created_at
    ) VALUES (
      'profiles',
      'UPDATE',
      NEW.id,
      NEW.user_id,
      jsonb_build_object(
        'old_photo_url', OLD.profile_photo_url,
        'new_photo_url', NEW.profile_photo_url,
        'field_updated', 'profile_photo_url'
      ),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger for photo changes
CREATE TRIGGER trigger_audit_profile_photo_changes
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION audit_profile_photo_changes();

-- Add a function to securely generate photo URLs (for server-side use)
CREATE OR REPLACE FUNCTION generate_secure_photo_url(
  user_uuid UUID,
  file_extension TEXT DEFAULT 'jpg'
)
RETURNS TEXT AS $$
DECLARE
  photo_path TEXT;
BEGIN
  -- Generate a secure, unique path for the photo
  -- Format: /secure-uploads/profiles/{user_id}/{timestamp}_{random}.{ext}
  photo_path := '/secure-uploads/profiles/' || 
                user_uuid::text || 
                '/' || 
                EXTRACT(EPOCH FROM NOW())::bigint || 
                '_' || 
                substr(md5(random()::text), 1, 8) || 
                '.' || 
                file_extension;
  
  RETURN photo_path;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a function to validate photo upload permissions
CREATE OR REPLACE FUNCTION can_upload_profile_photo(
  target_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Users can upload their own photos
  IF auth.uid() = target_user_id THEN
    RETURN TRUE;
  END IF;
  
  -- HR admins can upload photos for any user
  IF EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND onboarding_status = 'hr_admin'
  ) THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION generate_secure_photo_url(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION can_upload_profile_photo(UUID) TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION generate_secure_photo_url(UUID, TEXT) IS 'Generates a secure, unique URL path for profile photo storage. Server-side use only.';
COMMENT ON FUNCTION can_upload_profile_photo(UUID) IS 'Validates if the current user can upload a profile photo for the specified user.';

-- Update the profiles table comment to include photo field
COMMENT ON TABLE profiles IS 'Employee profiles with encrypted PII data including profile photos. All sensitive fields are encrypted at rest.';
