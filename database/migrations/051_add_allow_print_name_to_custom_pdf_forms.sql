-- Add allow_print_name column to custom_pdf_forms table
ALTER TABLE custom_pdf_forms
  ADD COLUMN IF NOT EXISTS allow_print_name boolean NOT NULL DEFAULT false;
