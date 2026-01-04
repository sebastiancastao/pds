-- Migration: Create vendor_onboarding_status table
-- This table tracks onboarding status for vendors

CREATE TABLE IF NOT EXISTS vendor_onboarding_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    onboarding_completed BOOLEAN DEFAULT FALSE,
    completed_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(profile_id)
);

-- Create index for faster lookups
CREATE INDEX idx_vendor_onboarding_status_profile_id ON vendor_onboarding_status(profile_id);
CREATE INDEX idx_vendor_onboarding_status_completed ON vendor_onboarding_status(onboarding_completed);

-- Add RLS policies
ALTER TABLE vendor_onboarding_status ENABLE ROW LEVEL SECURITY;

-- Policy: Allow admins to view all onboarding status
CREATE POLICY "Admins can view all onboarding status"
    ON vendor_onboarding_status
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Allow admins to insert onboarding status
CREATE POLICY "Admins can insert onboarding status"
    ON vendor_onboarding_status
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Allow admins to update onboarding status
CREATE POLICY "Admins can update onboarding status"
    ON vendor_onboarding_status
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_vendor_onboarding_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER trigger_update_vendor_onboarding_status_updated_at
    BEFORE UPDATE ON vendor_onboarding_status
    FOR EACH ROW
    EXECUTE FUNCTION update_vendor_onboarding_status_updated_at();

-- Comment on table
COMMENT ON TABLE vendor_onboarding_status IS 'Tracks onboarding status for vendors';
COMMENT ON COLUMN vendor_onboarding_status.id IS 'Unique identifier for the onboarding status record';
COMMENT ON COLUMN vendor_onboarding_status.profile_id IS 'Reference to the vendor profile';
COMMENT ON COLUMN vendor_onboarding_status.onboarding_completed IS 'Whether onboarding has been completed';
COMMENT ON COLUMN vendor_onboarding_status.completed_date IS 'Date when onboarding was marked as completed';
COMMENT ON COLUMN vendor_onboarding_status.notes IS 'Additional notes about the onboarding process';
COMMENT ON COLUMN vendor_onboarding_status.created_at IS 'Timestamp when the record was created';
COMMENT ON COLUMN vendor_onboarding_status.updated_at IS 'Timestamp when the record was last updated';
