-- Migration: Add ends_next_day column to events table
-- Description: Adds a boolean flag to indicate if an event extends past midnight to the next day

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS ends_next_day BOOLEAN NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.events.ends_next_day IS 'Indicates if the event ends on the next day (extends past midnight)';
