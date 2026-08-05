-- Add a work_details column to events, used by Non Event Time Sheets to capture
-- a required description of the work being performed (there's no artist/venue
-- program to describe it otherwise). Nullable at the DB level like the other
-- "required" event fields (event_name, venue, ...) -- the requirement is
-- enforced in the create/edit forms and API routes for event_type = 'special'.

ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS work_details TEXT;

COMMENT ON COLUMN public.events.work_details IS
  'Description of the work performed; required for Non Event Time Sheets (event_type = special).';
