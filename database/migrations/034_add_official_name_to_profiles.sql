-- =====================================================
-- ADD OFFICIAL NAME TO PROFILES TABLE
-- =====================================================
-- Adds official_name column to profiles table for matching with payroll systems

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS official_name TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_official_name ON profiles(official_name);

-- Add comment
COMMENT ON COLUMN profiles.official_name IS 'Official legal name used for payroll and tax documents';
