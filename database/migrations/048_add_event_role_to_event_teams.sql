ALTER TABLE public.event_teams
  ADD COLUMN IF NOT EXISTS event_role VARCHAR(20) NOT NULL DEFAULT 'staff';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_teams_event_role_check'
  ) THEN
    ALTER TABLE public.event_teams
      ADD CONSTRAINT event_teams_event_role_check
      CHECK (event_role IN ('staff', 'manager', 'supervisor'));
  END IF;
END $$;

COMMENT ON COLUMN public.event_teams.event_role IS
  'Event-specific team role used for assignments such as staff, manager, or supervisor.';
