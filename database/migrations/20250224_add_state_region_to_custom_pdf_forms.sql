-- Migration: Add target_state and target_region to custom_pdf_forms
-- These fields allow admins to restrict a form's visibility to employees
-- in a specific US state or geographic region.
-- NULL means "show to all" (no restriction).

ALTER TABLE custom_pdf_forms
  ADD COLUMN IF NOT EXISTS target_state TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_region TEXT DEFAULT NULL;
