-- FIX: Make pdf_data nullable in background_check_pdfs table
-- This fixes the "null value in column pdf_data violates not-null constraint" error
--
-- Run this in the Supabase SQL Editor

-- Make pdf_data column nullable
ALTER TABLE background_check_pdfs
  ALTER COLUMN pdf_data DROP NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN background_check_pdfs.pdf_data IS 'Legacy base64 encoded PDF data (deprecated - use waiver_pdf_data and disclosure_pdf_data instead)';

-- Verify the change
SELECT
    column_name,
    is_nullable,
    data_type
FROM information_schema.columns
WHERE table_name = 'background_check_pdfs'
AND column_name IN ('pdf_data', 'waiver_pdf_data', 'disclosure_pdf_data');
