-- Migration: Make pdf_data nullable in background_check_pdfs table
-- The application now uses separate waiver_pdf_data and disclosure_pdf_data columns
-- The original pdf_data column is no longer required and should be nullable

ALTER TABLE background_check_pdfs
  ALTER COLUMN pdf_data DROP NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN background_check_pdfs.pdf_data IS 'Legacy base64 encoded PDF data (deprecated - use waiver_pdf_data and disclosure_pdf_data instead)';
