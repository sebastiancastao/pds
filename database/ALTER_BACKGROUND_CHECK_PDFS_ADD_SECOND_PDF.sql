-- Adds separate columns to store each background check PDF
-- Waiver and Disclosure PDFs are stored independently.

ALTER TABLE IF EXISTS background_check_pdfs
  ADD COLUMN IF NOT EXISTS waiver_pdf_data TEXT,
  ADD COLUMN IF NOT EXISTS disclosure_pdf_data TEXT;

-- Optional: create helpful indexes for querying presence
CREATE INDEX IF NOT EXISTS idx_bcp_waiver_present ON background_check_pdfs((waiver_pdf_data IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_bcp_disclosure_present ON background_check_pdfs((disclosure_pdf_data IS NOT NULL));

