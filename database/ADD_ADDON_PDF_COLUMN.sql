-- Adds addon_pdf_data column to store the third background check PDF
-- This stores the Background Check Form #3 Add-On PDF independently.

ALTER TABLE IF EXISTS background_check_pdfs
  ADD COLUMN IF NOT EXISTS addon_pdf_data TEXT;

-- Optional: create helpful index for querying presence
CREATE INDEX IF NOT EXISTS idx_bcp_addon_present ON background_check_pdfs((addon_pdf_data IS NOT NULL));

-- Add comment
COMMENT ON COLUMN background_check_pdfs.addon_pdf_data IS 'Base64 encoded Add-on PDF data (Form 3)';
