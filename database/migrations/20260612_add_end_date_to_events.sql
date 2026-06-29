-- Migration: Add end_date column to events table
-- Description: Stores the date an event ends, allowing events to span multiple days.
-- Nullable: existing events only have event_date (start date).

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN public.events.end_date IS 'Date the event ends; NULL means the event ends on event_date';
