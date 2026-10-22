-- Lets an approved availability change request (filed from /employees/[id])
-- carry a time frame for the day, e.g. "available 16:00-02:00", instead of
-- only flipping the whole date between available and unavailable.
--
-- Same shape the vendor's own availability form already stores inside
-- vendor_invitations.availability ({allDay, startTime, endTime}, "HH:MM",
-- end may be earlier than start for windows that cross midnight), so
-- /api/events/[id]/available-vendors can treat both sources the same way
-- and the /dashboard, /global-calendar and /event-dashboard team pickers
-- show the window as a partial-availability badge.
--
-- all_day semantics:
--   NULL  = legacy correction recorded before time frames existed (keeps the
--           old behavior: "available" never clears a submitted time frame).
--   TRUE  = available all day (overrides any submitted time frame).
--   FALSE = available only between start_time and end_time.
-- The vendor_availability_change_requests.date_changes JSONB needs no
-- schema change; new entries simply carry the extra keys.

ALTER TABLE public.vendor_availability_corrections
  ADD COLUMN IF NOT EXISTS all_day BOOLEAN,
  ADD COLUMN IF NOT EXISTS start_time TEXT,
  ADD COLUMN IF NOT EXISTS end_time TEXT;

ALTER TABLE public.vendor_availability_corrections
  DROP CONSTRAINT IF EXISTS vendor_availability_corrections_time_frame_check;

ALTER TABLE public.vendor_availability_corrections
  ADD CONSTRAINT vendor_availability_corrections_time_frame_check CHECK (
    (
      all_day IS DISTINCT FROM FALSE
      AND start_time IS NULL
      AND end_time IS NULL
    )
    OR (
      all_day = FALSE
      AND available = TRUE
      AND start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND start_time <> end_time
    )
  );

COMMENT ON COLUMN public.vendor_availability_corrections.all_day IS
  'NULL = legacy (pre time frame) correction; TRUE = all day; FALSE = only between start_time and end_time.';
COMMENT ON COLUMN public.vendor_availability_corrections.start_time IS
  'HH:MM (24h) start of the approved time frame when all_day = FALSE.';
COMMENT ON COLUMN public.vendor_availability_corrections.end_time IS
  'HH:MM (24h) end of the approved time frame when all_day = FALSE; may be earlier than start_time for windows crossing midnight.';
