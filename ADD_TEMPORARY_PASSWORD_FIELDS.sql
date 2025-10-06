-- Quick Migration: Add Temporary Password Fields to USERS Table
-- Safe to run on existing database
-- This script ONLY adds the new temporary password fields to the users table

-- ============================================
-- Add Temporary Password Management Fields to USERS Table
-- ============================================

-- Add temporary password flag (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'is_temporary_password') THEN
    ALTER TABLE public.users ADD COLUMN is_temporary_password BOOLEAN NOT NULL DEFAULT false;
    RAISE NOTICE '✅ Added column to users table: is_temporary_password';
  ELSE
    RAISE NOTICE '⚠️  Column already exists in users table: is_temporary_password';
  END IF;
END $$;

-- Add must change password flag (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'must_change_password') THEN
    ALTER TABLE public.users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
    RAISE NOTICE '✅ Added column to users table: must_change_password';
  ELSE
    RAISE NOTICE '⚠️  Column already exists in users table: must_change_password';
  END IF;
END $$;

-- Add password expiration timestamp (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'password_expires_at') THEN
    ALTER TABLE public.users ADD COLUMN password_expires_at TIMESTAMPTZ;
    RAISE NOTICE '✅ Added column to users table: password_expires_at';
  ELSE
    RAISE NOTICE '⚠️  Column already exists in users table: password_expires_at';
  END IF;
END $$;

-- Add last password change timestamp (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'last_password_change') THEN
    ALTER TABLE public.users ADD COLUMN last_password_change TIMESTAMPTZ;
    RAISE NOTICE '✅ Added column to users table: last_password_change';
  ELSE
    RAISE NOTICE '⚠️  Column already exists in users table: last_password_change';
  END IF;
END $$;

-- ============================================
-- Verify New Columns
-- ============================================

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'users'
AND column_name IN (
  'is_temporary_password',
  'must_change_password',
  'password_expires_at',
  'last_password_change'
)
ORDER BY column_name;

-- ============================================
-- Success Message
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✅ TEMPORARY PASSWORD FIELDS ADDED SUCCESSFULLY';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '  Fields added to USERS table:';
  RAISE NOTICE '  - is_temporary_password (BOOLEAN)';
  RAISE NOTICE '  - must_change_password (BOOLEAN)';
  RAISE NOTICE '  - password_expires_at (TIMESTAMPTZ)';
  RAISE NOTICE '  - last_password_change (TIMESTAMPTZ)';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  Next steps:';
  RAISE NOTICE '  1. Run database/create_test_user.sql to create test user';
  RAISE NOTICE '  2. Verify fields with the query above';
  RAISE NOTICE '  3. Update TypeScript types (already done in lib/database.types.ts)';
  RAISE NOTICE '';
END $$;

