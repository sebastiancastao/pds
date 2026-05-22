CREATE TABLE IF NOT EXISTS public.planned_calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  venue_id UUID NOT NULL REFERENCES public.venue_reference(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planned_calendar_events_date ON public.planned_calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_planned_calendar_events_venue ON public.planned_calendar_events(venue_id);

COMMENT ON TABLE public.planned_calendar_events IS 'Planned future events linked to the venue_reference table';
