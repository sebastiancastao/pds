-- =====================================================
-- CREATE PDF DOWNLOADS TRACKING TABLE
-- =====================================================
-- This table tracks when background check PDFs are downloaded

CREATE TABLE IF NOT EXISTS background_check_pdf_downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    downloaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    downloaded_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_download UNIQUE(user_id, downloaded_by)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_pdf_downloads_user_id ON background_check_pdf_downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_pdf_downloads_downloaded_by ON background_check_pdf_downloads(downloaded_by);

-- Enable RLS
ALTER TABLE background_check_pdf_downloads ENABLE ROW LEVEL SECURITY;

-- Policy: Admins, HR, and Exec can view all downloads
CREATE POLICY "Admins HR and Exec can view all downloads"
    ON background_check_pdf_downloads
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'hr', 'exec')
        )
    );

-- Policy: Admins, HR, and Exec can insert downloads
CREATE POLICY "Admins HR and Exec can insert downloads"
    ON background_check_pdf_downloads
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'hr', 'exec')
        )
        AND downloaded_by = auth.uid()
    );

-- Comments
COMMENT ON TABLE background_check_pdf_downloads IS 'Tracks when background check PDFs are downloaded by admins/HR/exec';
COMMENT ON COLUMN background_check_pdf_downloads.user_id IS 'The user whose PDF was downloaded';
COMMENT ON COLUMN background_check_pdf_downloads.downloaded_by IS 'The admin/HR/exec who downloaded the PDF';
COMMENT ON COLUMN background_check_pdf_downloads.downloaded_at IS 'Timestamp when the PDF was downloaded';
