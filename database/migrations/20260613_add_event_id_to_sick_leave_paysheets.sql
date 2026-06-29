-- Migration: Add event_id column to sick_leave_paysheets table
-- Description: Links each queued sick-leave pay sheet to the specific event it
-- applies to, so calculated sick-leave pay can be surfaced on the event in the
-- HR payroll "View by Event" and "View by Vendor" breakdowns.
-- Nullable: existing pay sheets have no associated event.

ALTER TABLE public.sick_leave_paysheets
ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sick_leave_paysheets_event_id
  ON public.sick_leave_paysheets(event_id);

COMMENT ON COLUMN public.sick_leave_paysheets.event_id IS 'Event the sick-leave pay applies to; NULL for records created before this column existed';
