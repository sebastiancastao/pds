ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS linked_commission_event_id UUID NULL REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_linked_commission_event_id
  ON public.events(linked_commission_event_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_linked_commission_event_id_not_self'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_linked_commission_event_id_not_self
      CHECK (
        linked_commission_event_id IS NULL
        OR linked_commission_event_id <> id
      );
  END IF;
END $$;
