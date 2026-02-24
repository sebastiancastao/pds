-- Migration: add form_date to pdf_form_progress
-- Run this in your Supabase SQL editor

ALTER TABLE pdf_form_progress
  ADD COLUMN IF NOT EXISTS form_date DATE;
