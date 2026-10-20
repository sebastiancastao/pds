-- Adds the "Count In Setup Day" event type (events.event_type = 'count_in_setup').
-- It is timed and paid like a normal event; see lib/event-types.ts.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type = ANY (ARRAY['normal'::text, 'count_in_setup'::text, 'special'::text]));
