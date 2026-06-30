-- Migration: Add end_date column to planned_calendar_events
-- Description: Allows planned events to span several days. Existing rows keep
--              only event_date (start date); end_date NULL means a single-day event.

ALTER TABLE public.planned_calendar_events
ADD COLUMN IF NOT EXISTS end_date DATE;

-- Guard against inverted ranges (end before start). NULL end_date is allowed (single day).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'planned_calendar_events_end_date_check'
  ) THEN
    ALTER TABLE public.planned_calendar_events
    ADD CONSTRAINT planned_calendar_events_end_date_check
    CHECK (end_date IS NULL OR end_date >= event_date);
  END IF;
END $$;

COMMENT ON COLUMN public.planned_calendar_events.end_date IS 'Date the planned event ends; NULL means a single-day event ending on event_date';
