-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Migration: Add Bulk Invitation Support
-- =====================================================

-- Add fields for bulk invitations to vendor_invitations table
-- This allows vendors to be invited to work across multiple events for a period of time

ALTER TABLE vendor_invitations
ADD COLUMN IF NOT EXISTS invitation_type VARCHAR(20) DEFAULT 'single',
ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS duration_weeks INTEGER;

-- Add check constraint for invitation_type (drop first if exists to avoid error)
ALTER TABLE vendor_invitations
DROP CONSTRAINT IF EXISTS invitation_type_check;

ALTER TABLE vendor_invitations
ADD CONSTRAINT invitation_type_check
CHECK (invitation_type IN ('single', 'bulk'));

-- Add comment to document the fields
COMMENT ON COLUMN vendor_invitations.invitation_type IS 'Type of invitation: single (for one event) or bulk (for multiple events over a period)';
COMMENT ON COLUMN vendor_invitations.start_date IS 'Start date for bulk invitations';
COMMENT ON COLUMN vendor_invitations.end_date IS 'End date for bulk invitations';
COMMENT ON COLUMN vendor_invitations.duration_weeks IS 'Duration in weeks for bulk invitations';

-- Make event_id nullable for bulk invitations (it should already be nullable, but let's ensure it)
ALTER TABLE vendor_invitations
ALTER COLUMN event_id DROP NOT NULL;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'vendor_invitations'
ORDER BY ordinal_position;
