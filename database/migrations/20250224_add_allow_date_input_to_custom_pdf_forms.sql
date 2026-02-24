-- Migration: add allow_date_input to custom_pdf_forms
-- Run this in your Supabase SQL editor

ALTER TABLE custom_pdf_forms
  ADD COLUMN IF NOT EXISTS allow_date_input BOOLEAN NOT NULL DEFAULT false;
