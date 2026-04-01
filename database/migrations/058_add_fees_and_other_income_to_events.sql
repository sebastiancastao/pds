-- Migration: Add fees and other_income columns to events table
-- fees: processing/CC fees deducted from net sales
-- other_income: other revenue added to net sales

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS fees DECIMAL(12, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS other_income DECIMAL(12, 2) DEFAULT NULL;
