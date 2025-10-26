-- Migration: Create vendor_background_checks table
-- This table tracks background check status for vendors who have been invited to events

CREATE TABLE IF NOT EXISTS vendor_background_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    background_check_completed BOOLEAN DEFAULT FALSE,
    completed_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(profile_id)
);

-- Create index for faster lookups
CREATE INDEX idx_vendor_background_checks_profile_id ON vendor_background_checks(profile_id);
CREATE INDEX idx_vendor_background_checks_completed ON vendor_background_checks(background_check_completed);

-- Add RLS policies
ALTER TABLE vendor_background_checks ENABLE ROW LEVEL SECURITY;

-- Policy: Allow admins to view all background checks
CREATE POLICY "Admins can view all background checks"
    ON vendor_background_checks
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Allow admins to insert background checks
CREATE POLICY "Admins can insert background checks"
    ON vendor_background_checks
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Allow admins to update background checks
CREATE POLICY "Admins can update background checks"
    ON vendor_background_checks
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_vendor_background_checks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER trigger_update_vendor_background_checks_updated_at
    BEFORE UPDATE ON vendor_background_checks
    FOR EACH ROW
    EXECUTE FUNCTION update_vendor_background_checks_updated_at();

-- Comment on table
COMMENT ON TABLE vendor_background_checks IS 'Tracks background check status for vendors invited to events';
