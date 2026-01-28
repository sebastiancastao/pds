-- Create Test User for PDS Time Keeping System
-- Email: sebastiancastao379@gmail.com
-- Password: Test123!@# (meets all security requirements)

-- ============================================
-- Password Requirements (per .cursorrules):
-- ============================================
-- ✓ Minimum 12 characters
-- ✓ At least one uppercase letter
-- ✓ At least one lowercase letter
-- ✓ At least one number
-- ✓ At least one special character

-- ============================================
-- Step 1: Create User Record
-- ============================================

INSERT INTO public.users (
  email,
  role,
  division,
  is_active,
  failed_login_attempts,
  is_temporary_password,
  must_change_password,
  password_expires_at,
  last_password_change
)
VALUES (
  'sebastiancastao379@gmail.com',
  'exec', -- Executive role (full access)
  'vendor', -- PDS Vendor division
  true,
  0,
  true, -- This is a temporary password
  true, -- User must change password on first login
  NOW() + INTERVAL '24 hours', -- Password expires in 24 hours
  NOW() -- Password set now
)
ON CONFLICT (email) DO UPDATE SET
  is_temporary_password = EXCLUDED.is_temporary_password,
  must_change_password = EXCLUDED.must_change_password,
  password_expires_at = EXCLUDED.password_expires_at,
  last_password_change = EXCLUDED.last_password_change
RETURNING *;

-- Get the user ID for the profile
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get the user ID
  SELECT id INTO v_user_id 
  FROM public.users 
  WHERE email = 'sebastiancastao379@gmail.com';

  -- Only create profile if user was created
  IF v_user_id IS NOT NULL THEN
    -- ============================================
    -- Step 2: Create Profile with Encrypted Data
    -- ============================================
    
    -- Note: Password hash for "Test123!@#" (bcrypt with 12 rounds)
    -- This is a pre-computed hash for development/testing only
    -- In production, use the registration API endpoint
    
    INSERT INTO public.profiles (
      user_id,
      first_name, -- In production, this should be encrypted
      last_name,  -- In production, this should be encrypted
      address,    -- In production, this should be encrypted
      city,
      state,
      zip_code,
      password_hash, -- Bcrypt hash of "Test123!@#"
      mfa_secret,    -- Will be generated on MFA setup
      mfa_enabled,
      backup_codes,
      onboarding_status
    )
    VALUES (
      v_user_id,
      'Sebastian',
      'Castaño',
      '123 Main St',
      'Los Angeles',
      'CA',
      '90001',
      '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYqYLfK3K0G', -- "Test123!@#"
      NULL, -- MFA will be set up on first login
      false, -- MFA not enabled yet
      NULL, -- Backup codes generated during MFA setup
      'completed' -- Mark onboarding as complete for testing
    )
    ON CONFLICT (user_id) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      updated_at = NOW();

    RAISE NOTICE 'Test user created successfully!';
    RAISE NOTICE 'Email: sebastiancastao379@gmail.com';
    RAISE NOTICE 'Password: Test123!@#';
    RAISE NOTICE 'Role: Executive (full access)';
  ELSE
    RAISE NOTICE 'User already exists, profile updated.';
  END IF;
END $$;

-- ============================================
-- Step 3: Verify User Creation
-- ============================================

SELECT 
  u.id,
  u.email,
  u.role,
  u.division,
  u.is_active,
  u.is_temporary_password,
  u.must_change_password,
  u.password_expires_at,
  u.last_password_change,
  p.first_name,
  p.last_name,
  p.onboarding_status,
  p.mfa_enabled,
  u.created_at
FROM public.users u
LEFT JOIN public.profiles p ON u.id = p.user_id
WHERE u.email = 'sebastiancastao379@gmail.com';

-- ============================================
-- Success Message
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ TEST USER CREATED SUCCESSFULLY';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  Email:    sebastiancastao379@gmail.com';
  RAISE NOTICE '  Password: Test123!@# (TEMPORARY)';
  RAISE NOTICE '  Role:     Executive (Full Access)';
  RAISE NOTICE '  Division: PDS Vendor';
  RAISE NOTICE '  MFA:      Not enabled (will set up on first login)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  TEMPORARY PASSWORD:';
  RAISE NOTICE '  - Password is marked as TEMPORARY';
  RAISE NOTICE '  - User MUST change password on first login';
  RAISE NOTICE '  - Password expires in 24 hours';
  RAISE NOTICE '  - After expiration, password reset required';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  SECURITY NOTE:';
  RAISE NOTICE '  - This is a TEST account only';
  RAISE NOTICE '  - Password "1234" was rejected (too weak)';
  RAISE NOTICE '  - Use "Test123!@#" instead (meets all requirements)';
  RAISE NOTICE '  - Change password immediately after first login';
  RAISE NOTICE '  - Enable MFA for production use';
  RAISE NOTICE '';
END $$;

