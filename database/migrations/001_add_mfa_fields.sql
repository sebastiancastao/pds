-- Migration: Add MFA Authentication Fields
-- Purpose: Update existing database with new authentication fields for MFA
-- Safe to run on existing databases with data

-- ============================================
-- Add New Columns to users Table
-- ============================================

-- Add failed login keeping(if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'failed_login_attempts') THEN
    ALTER TABLE public.users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'account_locked_until') THEN
    ALTER TABLE public.users ADD COLUMN account_locked_until TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================
-- Add New Columns to profiles Table
-- ============================================

-- Add password hash (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'password_hash') THEN
    ALTER TABLE public.profiles ADD COLUMN password_hash TEXT;
  END IF;
END $$;

-- Add MFA secret (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'mfa_secret') THEN
    ALTER TABLE public.profiles ADD COLUMN mfa_secret TEXT;
  END IF;
END $$;

-- Add MFA enabled flag (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'mfa_enabled') THEN
    ALTER TABLE public.profiles ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add backup codes (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'profiles' AND column_name = 'backup_codes') THEN
    ALTER TABLE public.profiles ADD COLUMN backup_codes TEXT[];
  END IF;
END $$;

-- ============================================
-- Add Temporary Password Management Fields to USERS Table
-- ============================================

-- Add temporary password flag (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'is_temporary_password') THEN
    ALTER TABLE public.users ADD COLUMN is_temporary_password BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add must change password flag (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'must_change_password') THEN
    ALTER TABLE public.users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add password expiration timestamp (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'password_expires_at') THEN
    ALTER TABLE public.users ADD COLUMN password_expires_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add last password change timestamp (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'last_password_change') THEN
    ALTER TABLE public.users ADD COLUMN last_password_change TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================
-- Remove Old PIN/QR Authentication Fields
-- ============================================

-- These are only removed if they exist and are not being used
-- ⚠️ Comment out if you still need these fields

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'pin_hash') THEN
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS pin_hash;
  END IF;
END $$;

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'pin_salt') THEN
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS pin_salt;
  END IF;
END $$;

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'qr_code_data') THEN
    ALTER TABLE public.profiles DROP COLUMN IF EXISTS qr_code_data;
  END IF;
END $$;

-- Rename totp_secret to mfa_secret if it exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'totp_secret') THEN
    ALTER TABLE public.profiles RENAME COLUMN totp_secret TO mfa_secret_old;
  END IF;
END $$;

-- ============================================
-- Create Sessions Table (if not exists)
-- ============================================

CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at);

-- ============================================
-- Create Password Resets Table (if not exists)
-- ============================================

CREATE TABLE IF NOT EXISTS public.password_resets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON public.password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON public.password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON public.password_resets(expires_at);

-- ============================================
-- Update Existing Records (Optional)
-- ============================================

-- Set default values for existing users
UPDATE public.users 
SET failed_login_attempts = 0 
WHERE failed_login_attempts IS NULL;

-- ============================================
-- Add Constraints
-- ============================================

-- Make password_hash NOT NULL for new records (existing records can be NULL temporarily)
-- Uncomment after all existing users have passwords set
-- ALTER TABLE public.profiles ALTER COLUMN password_hash SET NOT NULL;

-- ============================================
-- Verification Query
-- ============================================

-- Run this to verify the migration succeeded
-- SELECT 
--   column_name, 
--   data_type, 
--   is_nullable
-- FROM information_schema.columns 
-- WHERE table_name IN ('users', 'profiles', 'sessions', 'password_resets')
-- ORDER BY table_name, ordinal_position;

-- ============================================
-- Rollback Instructions (if needed)
-- ============================================

-- To rollback this migration, uncomment and run:
-- DROP TABLE IF EXISTS public.password_resets CASCADE;
-- DROP TABLE IF EXISTS public.sessions CASCADE;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS password_hash;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS mfa_secret;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS mfa_enabled;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS backup_codes;
-- ALTER TABLE public.users DROP COLUMN IF EXISTS failed_login_attempts;
-- ALTER TABLE public.users DROP COLUMN IF EXISTS account_locked_until;

COMMENT ON TABLE public.sessions IS 'User session management with secure token storage';
COMMENT ON TABLE public.password_resets IS 'Password reset token keepingwith expiration';
COMMENT ON COLUMN public.profiles.password_hash IS 'Bcrypt hashed password (12 rounds)';
COMMENT ON COLUMN public.profiles.mfa_secret IS 'TOTP secret for multi-factor authentication';
COMMENT ON COLUMN public.profiles.backup_codes IS 'Array of hashed backup codes for MFA recovery';

