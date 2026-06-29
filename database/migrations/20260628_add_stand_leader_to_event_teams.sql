-- Add a stand_leader flag to event team members.
-- When true, the team member is a "stand leader" for that event and may run
-- check-in for the event (for the whole team) from their own employee profile
-- at /employees/[user-id] -> redirects to the /check-in kiosk for the event.

ALTER TABLE public.event_teams
  ADD COLUMN IF NOT EXISTS stand_leader BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_teams.stand_leader IS
  'When true, this team member is a stand leader for the event and may run check-in for the event from their employee profile.';
