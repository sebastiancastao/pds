-- Add allow_venue_display flag to custom_pdf_forms
-- When true, the employee form page shows the employee's assigned venue(s),
-- equivalent to allow_print_name, allow_date_input, and requires_signature.

ALTER TABLE custom_pdf_forms
  ADD COLUMN IF NOT EXISTS allow_venue_display BOOLEAN NOT NULL DEFAULT FALSE;
