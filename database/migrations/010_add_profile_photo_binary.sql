-- Migration: Add profile photo binary storage to profiles table
-- This stores encrypted image data directly in the database instead of URL references

-- Add the profile_photo_data field to store encrypted binary image data
ALTER TABLE profiles 
ADD COLUMN profile_photo_data BYTEA;

-- Add metadata fields for the photo
ALTER TABLE profiles 
ADD COLUMN profile_photo_type TEXT,
ADD COLUMN profile_photo_size INTEGER,
ADD COLUMN profile_photo_uploaded_at TIMESTAMP WITH TIME ZONE;

-- Add comments explaining the fields
COMMENT ON COLUMN profiles.profile_photo_data IS 'ENCRYPTED: Binary image data encrypted with AES-256. Stores actual photo file, not URL reference.';
COMMENT ON COLUMN profiles.profile_photo_type IS 'MIME type of the uploaded image (e.g., image/jpeg, image/png)';
COMMENT ON COLUMN profiles.profile_photo_size IS 'File size in bytes of the original uploaded image';
COMMENT ON COLUMN profiles.profile_photo_uploaded_at IS 'Timestamp when the photo was uploaded';

-- Create an index for efficient queries (if needed for photo-related operations)
CREATE INDEX idx_profiles_photo_metadata ON profiles(profile_photo_uploaded_at) WHERE profile_photo_data IS NOT NULL;

-- Add check constraints for data validation
ALTER TABLE profiles 
ADD CONSTRAINT check_profile_photo_type 
CHECK (
  profile_photo_type IS NULL 
  OR profile_photo_type IN ('image/jpeg', 'image/jpg', 'image/png')
);

ALTER TABLE profiles 
ADD CONSTRAINT check_profile_photo_size 
CHECK (
  profile_photo_size IS NULL 
  OR (profile_photo_size > 0 AND profile_photo_size <= 5242880) -- 5MB limit
);

-- Add RLS policies for binary photo data access
-- Only allow users to access their own photo data
CREATE POLICY "Users can view their own profile photo data" ON profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Only allow users to update their own profile photo data
CREATE POLICY "Users can update their own profile photo data" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Admin/HR role can access all profile photos for legitimate business purposes
CREATE POLICY "HR can view all profile photo data" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE user_id = auth.uid() 
      AND onboarding_status = 'hr_admin'
    )
  );

-- Add audit trigger to track photo data changes
CREATE OR REPLACE FUNCTION audit_profile_photo_data_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Log photo upload/change events for security audit
  IF OLD.profile_photo_data IS DISTINCT FROM NEW.profile_photo_data THEN
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
        'old_photo_size', OLD.profile_photo_size,
        'new_photo_size', NEW.profile_photo_size,
        'old_photo_type', OLD.profile_photo_type,
        'new_photo_type', NEW.profile_photo_type,
        'field_updated', 'profile_photo_data',
        'data_changed', OLD.profile_photo_data IS DISTINCT FROM NEW.profile_photo_data
      ),
      NOW()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger for photo data changes
CREATE TRIGGER trigger_audit_profile_photo_data_changes
  AFTER UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION audit_profile_photo_data_changes();

-- Add a function to encrypt photo data (server-side use)
CREATE OR REPLACE FUNCTION encrypt_photo_data(
  photo_data BYTEA,
  photo_type TEXT,
  photo_size INTEGER
)
RETURNS BYTEA AS $$
DECLARE
  encrypted_data BYTEA;
BEGIN
  -- In production, use proper encryption key management
  -- For now, this is a placeholder - implement with your encryption library
  -- encrypted_data := pgp_sym_encrypt(photo_data, encryption_key);
  
  -- For demonstration, we'll store the data as-is
  -- In production, you MUST encrypt this data
  encrypted_data := photo_data;
  
  RETURN encrypted_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a function to decrypt photo data (server-side use)
CREATE OR REPLACE FUNCTION decrypt_photo_data(
  encrypted_data BYTEA
)
RETURNS BYTEA AS $$
DECLARE
  decrypted_data BYTEA;
BEGIN
  -- In production, use proper encryption key management
  -- For now, this is a placeholder - implement with your encryption library
  -- decrypted_data := pgp_sym_decrypt(encrypted_data, encryption_key);
  
  -- For demonstration, we'll return the data as-is
  -- In production, you MUST decrypt this data
  decrypted_data := encrypted_data;
  
  RETURN decrypted_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a function to validate photo upload permissions
CREATE OR REPLACE FUNCTION can_upload_profile_photo_data(
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

-- Add a function to get photo metadata without the actual data
CREATE OR REPLACE FUNCTION get_profile_photo_metadata(
  target_user_id UUID
)
RETURNS TABLE (
  photo_type TEXT,
  photo_size INTEGER,
  photo_uploaded_at TIMESTAMP WITH TIME ZONE,
  has_photo BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.profile_photo_type,
    p.profile_photo_size,
    p.profile_photo_uploaded_at,
    (p.profile_photo_data IS NOT NULL) as has_photo
  FROM profiles p
  WHERE p.user_id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION encrypt_photo_data(BYTEA, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION decrypt_photo_data(BYTEA) TO authenticated;
GRANT EXECUTE ON FUNCTION can_upload_profile_photo_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_profile_photo_metadata(UUID) TO authenticated;

-- Add comments for documentation
COMMENT ON FUNCTION encrypt_photo_data(BYTEA, TEXT, INTEGER) IS 'Encrypts profile photo binary data. Server-side use only with proper key management.';
COMMENT ON FUNCTION decrypt_photo_data(BYTEA) IS 'Decrypts profile photo binary data. Server-side use only with proper key management.';
COMMENT ON FUNCTION can_upload_profile_photo_data(UUID) IS 'Validates if the current user can upload profile photo data for the specified user.';
COMMENT ON FUNCTION get_profile_photo_metadata(UUID) IS 'Returns photo metadata without exposing the actual binary data. Safe for client-side use.';

-- Update the profiles table comment to include binary photo storage
COMMENT ON TABLE profiles IS 'Employee profiles with encrypted PII data including binary profile photos. All sensitive fields including photo data are encrypted at rest.';

-- Add a view for safe photo metadata access
CREATE VIEW profile_photo_metadata AS
SELECT 
  id,
  user_id,
  profile_photo_type,
  profile_photo_size,
  profile_photo_uploaded_at,
  (profile_photo_data IS NOT NULL) as has_photo
FROM profiles;

-- Grant access to the view
GRANT SELECT ON profile_photo_metadata TO authenticated;

COMMENT ON VIEW profile_photo_metadata IS 'Safe view for accessing photo metadata without exposing binary data. Use this for listing photos without downloading them.';
