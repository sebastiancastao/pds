-- Migration: Add event_id column to sick_leaves table
-- Description: Links each employee sick leave request to the specific event it applies to.
-- Nullable: existing sick leave records have no associated event.

ALTER TABLE public.sick_leaves
ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sick_leaves_event_id ON public.sick_leaves(event_id);

COMMENT ON COLUMN public.sick_leaves.event_id IS 'Event the sick leave request applies to; NULL for records created before this column existed';
