-- Migration: Add background_check_completed column to users table
-- This column tracks whether a user has completed the background check form during onboarding

-- Add the background_check_completed column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_completed BOOLEAN DEFAULT FALSE;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_background_check_completed ON users(background_check_completed);

-- Add completed_at timestamp for keepingwhen the background check was completed
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_completed_at TIMESTAMP WITH TIME ZONE;

-- Comment on columns
COMMENT ON COLUMN users.background_check_completed IS 'Indicates whether the user has completed the background check waiver form';
COMMENT ON COLUMN users.background_check_completed_at IS 'Timestamp when the background check form was completed';
