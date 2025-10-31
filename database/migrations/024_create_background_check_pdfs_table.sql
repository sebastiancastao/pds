-- Migration: Create background_check_pdfs table
-- This table stores the completed background check waiver PDFs for each user

-- Create the background_check_pdfs table
CREATE TABLE IF NOT EXISTS background_check_pdfs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pdf_data TEXT NOT NULL, -- Base64 encoded PDF data
    signature TEXT, -- Signature data (typed name or drawn signature as data URL)
    signature_type VARCHAR(10) CHECK (signature_type IN ('type', 'draw')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id) -- One background check PDF per user
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_background_check_pdfs_user_id ON background_check_pdfs(user_id);
CREATE INDEX IF NOT EXISTS idx_background_check_pdfs_created_at ON background_check_pdfs(created_at);

-- Add RLS (Row Level Security) policies
ALTER TABLE background_check_pdfs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own background check PDF
CREATE POLICY "Users can view their own background check PDF"
    ON background_check_pdfs
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own background check PDF
CREATE POLICY "Users can insert their own background check PDF"
    ON background_check_pdfs
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own background check PDF (before completion)
CREATE POLICY "Users can update their own background check PDF"
    ON background_check_pdfs
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all background check PDFs
CREATE POLICY "Admins can view all background check PDFs"
    ON background_check_pdfs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'exec', 'finance')
        )
    );

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_background_check_pdfs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER trigger_update_background_check_pdfs_updated_at
    BEFORE UPDATE ON background_check_pdfs
    FOR EACH ROW
    EXECUTE FUNCTION update_background_check_pdfs_updated_at();

-- Add comments
COMMENT ON TABLE background_check_pdfs IS 'Stores completed background check waiver PDFs for each user';
COMMENT ON COLUMN background_check_pdfs.pdf_data IS 'Base64 encoded PDF data';
COMMENT ON COLUMN background_check_pdfs.signature IS 'User signature (typed name or drawn signature as data URL)';
COMMENT ON COLUMN background_check_pdfs.signature_type IS 'Type of signature: type (typed name) or draw (drawn signature)';
