-- Add city and state fields to events table for vendor filtering

ALTER TABLE public.events
ADD COLUMN city TEXT,
ADD COLUMN state CHAR(2);

-- Create indexes for location-based queries
CREATE INDEX idx_events_city ON public.events(city);
CREATE INDEX idx_events_state ON public.events(state);
CREATE INDEX idx_events_location ON public.events(city, state);

COMMENT ON COLUMN public.events.city IS 'Event city for vendor invitation filtering';
COMMENT ON COLUMN public.events.state IS 'Event state for vendor invitation filtering';
