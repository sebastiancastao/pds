-- Migration: Add end_date column to events table
-- Description: Allows Non Event Time Sheets (event_type = 'special') to span several
--              consecutive days. event_date is the first day; end_date is the last day.
--              start_time / end_time define the daily window applied to each day in range.
--              For normal events end_date is left NULL (single-day, ends_next_day still applies).

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS end_date DATE;

COMMENT ON COLUMN public.events.end_date IS 'Last day of a multi-day Non Event Time Sheet. NULL means single-day (use event_date only).';
