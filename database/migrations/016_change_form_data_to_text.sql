-- Change pdf_form_progress.form_data from BYTEA to TEXT
-- This fixes the issue where Supabase was serializing Buffer to JSON string

-- Drop existing data (if you want to keep data, export it first)
TRUNCATE TABLE pdf_form_progress;

-- Change column type from BYTEA to TEXT
ALTER TABLE pdf_form_progress
ALTER COLUMN form_data TYPE TEXT;

-- Add comment
COMMENT ON COLUMN pdf_form_progress.form_data IS 'Base64-encoded PDF data stored as text';
