-- Migration: Add Email MFA Fields
-- Description: Adds fields to store email verification codes for MFA setup and login
-- Date: 2024-10-10

-- Add email MFA code fields to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS mfa_setup_code TEXT,
ADD COLUMN IF NOT EXISTS mfa_setup_code_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS mfa_login_code TEXT,
ADD COLUMN IF NOT EXISTS mfa_login_code_expires_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN public.users.mfa_setup_code IS 'Hashed email verification code for MFA setup (expires in 10 minutes)';
COMMENT ON COLUMN public.users.mfa_setup_code_expires_at IS 'Expiration timestamp for MFA setup code';
COMMENT ON COLUMN public.users.mfa_login_code IS 'Hashed email verification code for MFA login (expires in 10 minutes)';
COMMENT ON COLUMN public.users.mfa_login_code_expires_at IS 'Expiration timestamp for MFA login code';

-- Create index for code expiration cleanup
CREATE INDEX IF NOT EXISTS idx_users_mfa_setup_code_expires ON public.users(mfa_setup_code_expires_at) WHERE mfa_setup_code_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_mfa_login_code_expires ON public.users(mfa_login_code_expires_at) WHERE mfa_login_code_expires_at IS NOT NULL;

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'Email MFA fields added successfully';
  RAISE NOTICE '✓ mfa_setup_code';
  RAISE NOTICE '✓ mfa_setup_code_expires_at';
  RAISE NOTICE '✓ mfa_login_code';
  RAISE NOTICE '✓ mfa_login_code_expires_at';
END $$;

